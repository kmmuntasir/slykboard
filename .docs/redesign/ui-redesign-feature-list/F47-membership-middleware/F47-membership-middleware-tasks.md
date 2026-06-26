# F47 — Build project-membership middleware: Plan + Task Breakdown

> **Feature:** F47 — Build project-membership middleware (scope correction) (Phase 4 — Backend: project-scoped Reports, unblocks F49)
> **Feature index:** [`../ui-redesign-features.md`](../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** — · **PRD ref:** §5.2 T5.2 ("reuse existing project-membership middleware" — scope correction), §4.6, §5
> **Sources:** [`../ui-redesign-features.md`](../ui-redesign-features.md) (lines 335-346), cross-cutting decision #7 ("Membership middleware — BUILD, not reuse"), [`../../ui-redesign-plan.md`](../../ui-redesign-plan.md) (§5.2 T5.2/T5.4, lines 257-259), the project rules discovered for this repo (`js-style-guide.md`, `js-testing-rules.md`, `js-development-rules.md`, `git-guidelines.md`, `persona.md`).

---

## 1. F47 Recap

**Goal:** Create the `requireProjectMember` middleware the PRD §5.2 T5.2 *assumes exists* but does not. It resolves `:slug` → project, verifies the authenticated user is a member, attaches `req.project` for downstream handlers, else denies. Modeled on `requireRole.ts` (the closest existing precedent).

**Ships:** `backend/src/middleware/requireProjectMember.ts` (+ `.test.ts`) that composes AFTER `authenticate`, resolves the slug via `projectService.getProjectBySlug`, runs a membership check, attaches `req.project`, and throws `FORBIDDEN` (403) on non-member / unknown slug. F48 mounts it on the new `/api/projects/:slug/reports/*` routes; F49's FE then reacts to its 403.

**Acceptance (definition of done):**
- Middleware created; resolves slug via the existing project lookup (`projectService.getProjectBySlug`); runs a membership check; 403 on non-member; unknown-slug handling decided (default 403 — hides existence); passes `req.project` downstream.
- Composes after `authenticate` (which sets `req.user = { id, email, role }`).
- Unit tests for: member allowed, non-member denied (403), unknown slug (403), admin override.
- Reuses `accessControl.ts` patterns where applicable (the spec calls this out) — though `accessControl` only does a signup-time *domain* check, so the reuse is idiomatic (AppError + ErrorCode), not logical.

**Edge cases to resolve up front:**
- **PRD says "reuse"; nothing exists to reuse.** → **Decision (OWNER SIGN-OFF, cross-cutting #7):** BUILD. `backend/src/middleware/` has only `auth`, `requireRole`, `validateRequest`, `errorMiddleware`, `notFound`, `requestLogger`, `pingRoute`. The closest existing logic (`accessControl.ts`) does a signup-time domain check — insufficient for per-project membership. This feature builds the middleware from scratch.
- **404 vs 403 for unknown slug.** → **Decision:** **403 (FORBIDDEN) for both unknown-slug AND non-member — single code path, hides project existence.** Rationale: the spec default is "mirror BE pattern"; the BE pattern for *existing* project routes is `NOT_FOUND` (404) for unknown slug (`projects.routes.ts:38`, `projectService.ts:109`). **However**, F47's purpose is access *control* on a project-scoped resource — leaking existence of a project to a non-member is an information disclosure. We default to 403 (hides both existence and membership state) and surface the 404-vs-403 choice as the one reversible decision in §3 D6. **Owner sign-off needed** because it diverges from the existing `projects.routes.ts` 404 precedent.
- **Admin override — should admins bypass membership?** → **Decision:** **Yes — admin = super-member.** `req.user.role === 'ADMIN'` short-circuits the membership check and is allowed even when not in the membership set. Mirrors the project's role model (`roleEnum = ['ADMIN', 'MEMBER']`, `requireRole('ADMIN')`); an admin who cannot read a project's reports is incoherent.
- **What does "member" MEAN — there is no membership table.** → **OWNER QUESTION (load-bearing, see D1):** The schema has NO `projectMembers` table and NO membership concept anywhere (`schema.ts` lines 1-256; `D-ProjectMembers: no membership yet` comments at `projects.routes.ts:23,45,83`). Cross-cutting decision #7 says "BUILD, not reuse" but is silent on storage. Feature line 429 says "No DB migration." These are mutually inconsistent — you cannot check membership against a table that doesn't exist without adding it. **D1 resolves this with two paths; owner picks one before T1 starts.**

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for the middleware; **greenfield + schema gap for membership**. There is no `requireProjectMember`, no membership service, and no membership table. The PRD's "reuse" assumption is the scope correction this feature exists to fix. Cross-cutting decision #7 (line 443) locks BUILD, not reuse — but does NOT settle storage (see §3 D1).

- **Existing structure this feature builds on:**
  - **Middleware dir:** `backend/src/middleware/` — `auth.ts` (`authenticate`: Bearer JWT → `req.user = { id, email, role }`, lines 9-43), `requireRole.ts` (the model F47 mirrors — factory returning `(req,res,next)`, throws `AppError(FORBIDDEN)`, lines 9-23), `validateRequest.ts` (Zod edge), `errorMiddleware.ts`, `notFound.ts`, `requestLogger.ts`, `pingRoute.ts`. Every middleware has a co-located `.test.ts`.
  - **Express type augmentation:** `backend/src/types/express.d.ts` — augments `express-serve-static-core` `Request` with `user?: AuthenticatedUser`. **F47 must extend this same declaration to add `project?`** (the spec's `req.project` requirement).
  - **Project lookup:** `backend/src/services/projectService.ts:95` — `getProjectBySlug(slug): Promise<ProjectRow | null>` (Drizzle `eq(projects.slug, slug)`). This is the exact lookup F47 reuses.
  - **Error envelope:** `backend/src/utils/envelope.ts` exports `ErrorCode` enum (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`, `INTERNAL_SERVER_ERROR`) + `HttpStatus`. `backend/src/utils/appError.ts` — `AppError(code, message, details?)`. All denial paths throw `AppError`; `errorMiddleware` translates to the JSON envelope.
  - **Access-control idiom:** `backend/src/services/accessControl.ts` — `assertDomainAllowed` throws `AppError(FORBIDDEN)` on domain mismatch. F47 reuses the *idiom* (AppError + FORBIDDEN), not the logic.
  - **Route composition pattern:** `backend/src/routes/projects.routes.ts` — every route is `authenticate, [requireRole('ADMIN')], validateRequest({...}), handler`. F48 will mount F47 as `authenticate, requireProjectMember, handler` on `/api/projects/:slug/reports/*`.
  - **DB access:** Drizzle ORM over `node-postgres` (`backend/src/db/client.ts` — `export const db = drizzle(pool, { schema })`). Schema in `backend/src/db/schema.ts`. Dev DB is journal-based `drizzle migrate` (`make migrate`); reset by dropping both `public` + `drizzle` schemas (memory `dev-db-push-based-no-migration-journal`).
  - **Role model:** `roleEnum = pgEnum('Role', ['ADMIN', 'MEMBER'])` (`schema.ts:23`). `AuthenticatedUser.role: 'ADMIN' | 'MEMBER'` (`express.d.ts:3`).

- **Prior art / partial work:** None for membership. The `D-ProjectMembers: no membership yet` comments at `projects.routes.ts:23/45/83` are explicit "TODO when membership lands" markers — this feature is what those comments were waiting for (for Reports; full rollout to Board/tickets is out of scope — see §3 Out-of-scope).

- **File paths the plan references that do NOT exist yet (will be created):**
  - `backend/src/middleware/requireProjectMember.ts` — the middleware.
  - `backend/src/middleware/requireProjectMember.test.ts` — co-located unit tests.
  - *(Path A only — see D1)* `backend/src/db/schema.ts` — add `projectMembers` table (edit).
  - *(Path A only)* `backend/src/db/migrations/` — new migration journal entry (`make migrate`).
  - *(Path A only)* `backend/src/services/membershipService.ts` + `.test.ts` — `isMember(userId, projectId)` query.

- **Project rules this plan must satisfy:**
  - `js-style-guide.md` — 2-space indent for `.ts`, early returns, async/await, explicit types (no `any`), PascalCase types, `AppError`-based error handling.
  - `js-testing-rules.md` — Vitest, co-located `*.test.ts`, table-driven preferred, `vi.fn()` mocks, `getByRole` priority (N/A for pure middleware — assert on `next` call + thrown `AppError`).
  - `js-development-rules.md` — middleware in `middleware/`, services in `services/`, repos in `repositories/`, parameterized queries only.
  - `git-guidelines.md` — `SLYK-F47:` commit prefix, single-line message, rebase-and-merge only, no squash.
  - `persona.md` — backend code → `./backend/`.

- **Hidden coupling to plan for:**
  - **`req.project` type augmentation is required by the spec and consumed by F48** — must land in `express.d.ts` regardless of which D1 path is chosen, or F48 handlers can't read `req.project` type-safely.
  - **The membership-storage decision (D1) is on the critical path of T1.** Nothing else can start until it's settled. Both paths are fully specified in §3 so the owner's pick is a one-line answer that unblocks immediately.
  - **Drizzle partial-index / enum gotcha (memory `drizzle-partial-index-enum-dollar1`):** if Path A's `projectMembers` table needs a partial unique index on an enum column, the migration SQL must be reconciled to a literal (e.g. `'ADMIN'`), not `$1`. Path A's schema uses a composite PK on `(userId, projectId)` — no partial index needed — so this is a guardrail, not a blocker.
  - **Dev DB is journal-based migrate, NOT push** (memory `dev-db-push-based-no-migration-journal`). Path A adds a real migration via `make migrate`; reset (if needed) drops both `public` + `drizzle` schemas.
  - **F49 depends on F47's 403 shape** (cross-cutting #9): FE catches BE 403 from `requireProjectMember` and redirects to `/projects`. The error code MUST be `ErrorCode.FORBIDDEN` (not `NOT_FOUND`) for F49's catch to work — this locks the unknown-slug-as-403 default (D6) from the FE-integration side too.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | **Membership storage — how does "is user X a member of project Y" get answered?** (OWNER SIGN-OFF, load-bearing) | **Default recommendation: Path A (add `projectMembers` table).** Alternative: Path B (degenerate rule, no migration). See D1-expansion below the table. | Schema has no membership concept (`D-ProjectMembers: no membership yet`). Feature line 429 ("No DB migration") and decision #7 ("BUILD") are mutually inconsistent — one must give. Path A is correct for any multi-member project (the PRD's whole model); Path B is a stopgap that breaks the moment a second user needs access. |
| D2 | Middleware shape | **Factory returning async handler** — `requireProjectMember()` → `(req, res, next) => Promise<void>`. | Mirrors `requireRole.ts:9` (factory) but async because it awaits `getProjectBySlug` (and, Path A, `isMember`). `requireRole` is sync because it only reads `req.user.role`. |
| D3 | Composition order | **`authenticate, requireProjectMember, handler`** — never the reverse. | F47 reads `req.user` (set by `authenticate`) and `req.params.slug`. Must run AFTER `authenticate` (spec: "composes after `authenticate`"). Mirrors `requireRole` ("Must run AFTER authenticate", `requireRole.ts:6`). |
| D4 | `req.project` attachment | **Attach the full `ProjectRow` (`typeof projects.$inferSelect`) as `req.project`.** Type-augment `express.d.ts` to declare it. | Spec: "attaches `req.project`". F48 handlers need `req.project.id` for `WHERE projectId =` clauses; attaching the row avoids a second lookup. Optional (`req.project?`) since not every route on a project-scoped router needs it, but F47 always sets it when it calls `next()`. |
| D5 | Admin override | **`req.user.role === 'ADMIN'` short-circuits → allowed, skips membership check.** | Admin = super-member (spec default). Coherent with `roleEnum`/`requireRole('ADMIN')`. An admin denied a project's reports is a contradiction. The project is still resolved + attached (so `req.project` is populated for the admin too). |
| D6 | Unknown-slug status code | **Default: 403 (`ErrorCode.FORBIDDEN`) — hides existence.** Reversible alt: 404 (`ErrorCode.NOT_FOUND`) — matches `projects.routes.ts:38` precedent. | Spec default ("default 403 to mirror BE pattern") — note the BE pattern for *existing* project routes is actually 404, so "mirror BE" is ambiguous; we read the spec's *intent* (hide existence on an access-controlled resource) and default 403. F49's FE catches 403 specifically (cross-cutting #9), which locks 403 from the integration side. **Owner sign-off** because it diverges from the `projects.routes.ts` 404 precedent — flag if the owner prefers strict consistency with existing project routes. |
| D7 | Non-member status code | **403 (`ErrorCode.FORBIDDEN`)** — single code path with D6. | Spec: "else 403". Hides membership state (a non-member can't distinguish "exists but denied" from "doesn't exist"). |
| D8 | Reuse of `accessControl.ts` | **Idiomatic only** — reuse `AppError` + `ErrorCode.FORBIDDEN` pattern; do NOT call `assertDomainAllowed` (domain check is orthogonal, already enforced at signup). | Spec says "reuses `accessControl.ts` patterns where applicable." The only applicable pattern is the throw-shape. The function itself is a signup-time workspace gate, unrelated to project membership. |
| D9 | TypeScript (not JavaScript) | **`.ts`** | Repo convention: every file in `backend/src/middleware/`, `services/`, `routes/` is `.ts`. Spec's "(or `.js`)" is hedging; the repo has zero `.js` source. |
| D10 | Membership seeding (Path A only) | **Project creator is auto-member at create time.** `projectService.createProject` inserts a `projectMembers` row alongside the project + sequence (extend the existing transaction at `projectService.ts:69`). | Without this, the creator can't access their own project's reports — an obvious footgun. Stays inside the same transaction (atomicity). Adding existing-MEMBERs is a manual/admin UX deferred out of F47 (see Out-of-scope). |

### D1-expansion (the load-bearing choice — owner picks before T1)

The schema has **no** `projectMembers` table and **no** membership concept. Two paths:

- **Path A (recommended) — add a `projectMembers` join table.** New table `(userId, projectId, createdAt)` with composite PK + `(projectId, userId)` index. Membership = existence of a row. `membershipService.isMember(userId, projectId): Promise<boolean>`. Requires one migration (`make migrate`) — **this contradicts feature line 429 ("No DB migration")**, but line 429's own parenthetical ("a membership check in new middleware") *presupposes* something to check against, which only exists in Path A. We treat line 429 as under-specified, not as a hard constraint. This is the correct long-term shape: the PRD's model is multi-member per project (ProjectPicker, role-gated admin actions), and every future feature (Board membership gating, per-project roles) needs this table.

- **Path B (stopgap) — degenerate rule, no migration.** "Member" = `req.user.role === 'ADMIN'` OR `req.user.id === project.creatorId`. No table, no migration, no service. Satisfies the literal "No DB migration" line. **Breaks the moment a second MEMBER needs report access** — and F48's reports are exactly the kind of thing a non-creator MEMBER (e.g. a team lead) will want. Path B is a tech-debt time bomb dressed as a shortcut.

**Default recommendation: Path A.** The rest of this plan is written for Path A; Path B's deltas are called out per-task (T2/T3 collapse; T4 schema work is skipped). **The owner's path pick is the single unblock for this feature** — surface in chat before any task starts.

> **Out of F47 scope (explicitly deferred):**
> - **Applying `requireProjectMember` to existing project routes** (Board, tickets, labels at `projects.routes.ts:24/30/46/65/89`). Those carry `D-ProjectMembers: no membership yet` TODOs but the redesign only relocates Reports. Rollout to Board/tickets is a post-redesign feature — touching them now is scope creep that risks breaking the F10 board contract.
> - **A membership-management UI / admin API** (add/remove members, per-project roles). F47 only *checks* membership; administering it is a separate feature. Path A's D10 seeds only the creator.
> - **Per-project roles** (project-scoped ADMIN vs workspace ADMIN). Out of scope; `role` is workspace-global (`users.role`). F47's admin override uses the global role.
> - **Deprecating the old global `/api/reports/*` routes** — owned by F48 (cross-cutting #5).
> - **Frontend 403 handling** — owned by F49 (cross-cutting #9).

> **Owner sign-off needed:**
> 1. **D1 path (A vs B)** — load-bearing, unblocks everything. Default A.
> 2. **D6 unknown-slug code (403 vs 404)** — diverges from `projects.routes.ts` 404 precedent. Default 403 (also locked by F49's FE 403-catch).

---

## 4. Architecture Overview (Target Tree)

```
backend/
  src/
    db/
      schema.ts                      # EDIT (Path A): add projectMembers table
      migrations/                    # NEW (Path A): migration journal entry
    services/
      membershipService.ts           # NEW (Path A): isMember(userId, projectId)
      membershipService.test.ts      # NEW (Path A): table-driven unit tests
      projectService.ts              # EDIT (Path A D10): seed creator membership in createProject tx
      projectService.test.ts         # EDIT (Path A): assert creator-membership row inserted
    middleware/
      requireProjectMember.ts        # NEW: the middleware (this feature's core deliverable)
      requireProjectMember.test.ts   # NEW: member/non-member/unknown-slug/admin-override
    types/
      express.d.ts                   # EDIT: augment Request with `project?: ProjectRow`
```

**Request lifecycle (F48-mounted route):**
```
GET /api/projects/:slug/reports/time
  → authenticate          (sets req.user = { id, email, role })
  → requireProjectMember  (resolves slug → project; checks member OR admin; sets req.project; else 403)
  → handler               (reads req.project.id; reportService aggregates WHERE projectId = ?)
```

If `requireProjectMember` throws `AppError(FORBIDDEN)`, `errorMiddleware` renders the `{ error: { code: 'FORBIDDEN', message } }` envelope → F49's FE catches 403 → redirects to `/projects`.

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches** by dependency order. Within a batch, tasks touch disjoint file sets → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
Batch A (D1 decision gate — OWNER, not a dev task)
   │
   ▼
Batch B:  T1 (express.d.ts type aug)  ─┬—  T2 (membershipService + test, Path A)
                                        └—  T3 (schema + migration + projectService seed, Path A)
   │  (T2 ‖ T3; both unblock T4)
   ▼
Batch C:  T4 (requireProjectMember + test)  →  T5 (integration verification)
```

- **Batch A → Batch B** is a hard barrier: **D1 (Path A vs B) must be settled by the owner before any code is written.** Path B collapses T2/T3 (no service, no schema). This is a one-line decision, not a dev task.
- **Batch B → Batch C** is a hard barrier: T4 imports `membershipService.isMember` (Path A) and the augmented `Request` type from T1. T4 cannot typecheck until T1 lands.
- **T5 → done**: terminal verification on the merged result.

### Merge order rules

1. **Batch B merges first.** T1 (type aug) must be on `main` before T4 branches (T4's `req.project` is typed by it). T2 and T3 (Path A) can merge in either order — they touch disjoint files (`services/membershipService.*` vs `db/schema.ts` + `services/projectService.*`).
2. **Batch C (T4) merges second.** Depends on T1+T2+T3 being on `main`.
3. **T5 (verification) merges last** — it's a definition-of-done gate, run against the merged feature.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | B | `backend/src/types/express.d.ts` | D1 (owner) | T2, T3 |
| **T2** | B | `backend/src/services/membershipService.ts` + `.test.ts` (Path A) | D1=A | T1, T3 |
| **T3** | B | `backend/src/db/schema.ts`, `backend/src/db/migrations/`, `backend/src/services/projectService.ts` + `.test.ts` (Path A) | D1=A | T1, T2 |
| **T4** | C | `backend/src/middleware/requireProjectMember.ts` + `.test.ts` | T1, T2 (Path A) | — |
| **T5** | C | (no files — verification gate) | T1-T4 | — |

### Developer assignment tracks

- **Solo:** owner picks D1 → T1 → (T2 ‖ T3) → T4 → T5.
- **2 devs:** Dev-A: T1 → T4. Dev-B: T2 → T3. Merge B first, then C.
- **If D1 = Path B:** T2 and T3 are dropped entirely; track collapses to owner-pick → T1 → T4 → T5. Single dev, sub-half-day.

---

## 6. Tasks

### T1 — Augment Express `Request` with `project`

**Batch:** B · **Depends on:** D1 (owner decision — either path) · **Parallel with:** T2, T3

**Description:** The spec mandates `req.project` downstream. `express.d.ts` currently augments `Request` with only `user?: AuthenticatedUser`. Add an optional `project` field typed as the Drizzle-inferred project row so F48 (and F47's own `next()` path) read `req.project.id` type-safely. This is independent of D1 — needed for both Path A and Path B.

Create / Modify:
- **`backend/src/types/express.d.ts`** — add `ProjectRow` import (`typeof projects.$inferSelect` from `../db/schema`) and `project?: ProjectRow` on the augmented `Request`. Keep `user?` exactly as-is. Example shape after edit:
  ```ts
  import type { projects } from '../db/schema';
  export type ProjectRow = typeof projects.$inferSelect;
  export interface AuthenticatedUser { id: string; email: string; role: 'ADMIN' | 'MEMBER'; }
  declare module 'express-serve-static-core' {
    interface Request {
      user?: AuthenticatedUser;
      project?: ProjectRow; // F47: set by requireProjectMember on member/admin.
    }
  }
  ```

**Acceptance Criteria:**
- [ ] `express.d.ts` declares `project?: ProjectRow` (optional) without altering `user?`.
- [ ] `npm run -w backend typecheck` (or `tsc --noEmit`) passes — no circular-import error from the `projects` import (schema has no inbound deps on `types/`).
- [ ] No existing middleware/route breaks (the augmentation is additive).

**Dependencies:** D1 owner decision (either path uses this).

---

### T2 — `membershipService` with `isMember` query (Path A only)

**Batch:** B · **Depends on:** D1 = Path A · **Parallel with:** T1, T3

**Description:** Encapsulate the membership read behind a service so the middleware (T4) stays thin and the query is unit-testable in isolation. Mirrors the `projectService`/`userService` layering (`services/` dir, `import * as service` consumers). `isMember` returns a boolean — existence of a `(userId, projectId)` row — NOT the row, so the middleware branches cleanly.

> **If D1 = Path B: SKIP this task.** The middleware (T4) inlines `req.user.id === project.creatorId` instead.

Create / Modify:
- **`backend/src/services/membershipService.ts`** — single exported function:
  ```ts
  import { and, eq } from 'drizzle-orm';
  import { db } from '../db/client';
  import { projectMembers } from '../db/schema';

  export async function isMember(userId: string, projectId: string): Promise<boolean> {
    const [row] = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)))
      .limit(1);
    return row !== undefined;
  }
  ```
  No `any`; parameterized via Drizzle (no string-concat SQL — satisfies `js-development-rules.md` security).
- **`backend/src/services/membershipService.test.ts`** — table-driven unit tests. Mock `db` (the singleton) via `vi.mock('../db/client')`. Cases: `(userId, projectId)` row exists → `true`; no row → `false`; row for different project → `false`; row for different user → `false`. Follow `projectService.test.ts` mock pattern.

**Acceptance Criteria:**
- [ ] `isMember(userId, projectId)` returns `Promise<boolean>`; `true` iff a membership row exists for the pair.
- [ ] Query is parameterized (Drizzle `eq`/`and`) — no raw SQL string interpolation.
- [ ] Unit tests pass; `db` is mocked, not hit.
- [ ] No `any`; explicit types per `js-style-guide.md`.

**Dependencies:** T3 must define the `projectMembers` table this imports — but T2 and T3 are written against the **same** agreed schema shape (composite PK `(userId, projectId)`), so they can be authored in parallel and will typecheck once both merge. If running solo/sequential, do T3 first so the import resolves.

---

### T3 — `projectMembers` table + migration + creator-seed (Path A only)

**Batch:** B · **Depends on:** D1 = Path A · **Parallel with:** T1, T2

**Description:** Add the membership table to the Drizzle schema, generate/apply the migration, and seed the creator as a member at project-create time (D10). The table is the source of truth T2's `isMember` reads. Seed-in-transaction prevents the footgun where a creator can't read their own project.

> **If D1 = Path B: SKIP this task.**

Create / Modify:
- **`backend/src/db/schema.ts`** — append the table (mirror the `ticketLabels` composite-PK idiom at lines 178-193):
  ```ts
  // F47 D1-Path-A: project membership join table. Composite PK prevents dupes.
  // userId ON DELETE CASCADE (membership dies with the user); projectId ON DELETE
  // CASCADE (membership dies with the project). F47 only reads; admin/manage API deferred.
  export const projectMembers = pgTable(
    'ProjectMembers',
    {
      projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
      userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
      joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    },
    (table) => ({
      pk: primaryKey({ columns: [table.projectId, table.userId] }),
      // Lookup-by-user (F47 checks member-of-project; future: list-my-projects).
      userProjectIdx: index('project_members_user_id_idx').on(table.userId),
    }),
  );
  ```
  No partial index on an enum column → the `drizzle-partial-index-enum-dollar1` gotcha does not apply (guardrail only).
- **`backend/src/db/migrations/`** — generate via `make migrate` (journal-based, per memory `dev-db-push-based-no-migration-journal`). Verify the emitted SQL creates the table + composite PK + index. Apply against dev DB.
- **`backend/src/services/projectService.ts`** — extend the `createProject` transaction (currently lines 69-87) to also insert a `projectMembers` row for `creatorId`:
  ```ts
  // F47 D10: creator is auto-member so they can access their own project.
  await tx.insert(projectMembers).values({ projectId: project!.id, userId: input.creatorId });
  ```
  Add `projectMembers` to the schema import (line 6 block).
- **`backend/src/services/projectService.test.ts`** — extend the existing `createProject` test to assert a `projectMembers` row exists for `(project.id, creatorId)` after creation. Reuse the existing test's DB setup/teardown.

**Acceptance Criteria:**
- [ ] `projectMembers` table defined with composite PK `(projectId, userId)`, both FKs `ON DELETE CASCADE`, `joinedAt` default now.
- [ ] `make migrate` generates + applies cleanly; migration SQL inspected (table + PK + index present).
- [ ] `createProject` inserts a creator-membership row inside the same transaction; rollback on either insert fails both.
- [ ] `projectService.test.ts` green with the new assertion.
- [ ] No partial-enum-index `$1` bug in the emitted SQL (verify; expected clean given composite-PK design).

**Dependencies:** D1 = Path A. Author in parallel with T2 against the agreed schema shape.

---

### T4 — `requireProjectMember` middleware + tests

**Batch:** C · **Depends on:** T1, T2 (Path A) · **Parallel with:** —

**Description:** The feature's core deliverable. Factory returning an async handler that: (1) requires `req.user` (defensive — must follow `authenticate`), (2) reads `req.params.slug`, (3) resolves the project via `projectService.getProjectBySlug`, (4) on miss → `throw new AppError(ErrorCode.FORBIDDEN, ...)` per D6, (5) admin override (D5) → attach `req.project`, `next()`, (6) else `membershipService.isMember` → member: attach + next; non-member: `throw AppError(FORBIDDEN)` per D7. Modeled line-for-line on `requireRole.ts:9-23`.

Create / Modify:
- **`backend/src/middleware/requireProjectMember.ts`**:
  ```ts
  import type { Request, Response, NextFunction } from 'express';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import * as projectService from '../services/projectService';
  import * as membershipService from '../services/membershipService'; // Path A; Path B drops this import

  // F47 D3: must run AFTER authenticate (sets req.user). Resolves :slug → project,
  // verifies membership (or admin override D5), attaches req.project, else FORBIDDEN (D6/D7).
  export function requireProjectMember() {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      if (!req.user) {
        // Defensive — requireProjectMember must be mounted after authenticate.
        throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
      }
      const slug = req.params.slug as string;
      const project = await projectService.getProjectBySlug(slug);
      if (!project) {
        // D6: 403 hides existence (default). Switch to NOT_FOUND if owner picks the
        // projects.routes.ts:38 precedent — also update F49's FE catch accordingly.
        throw new AppError(ErrorCode.FORBIDDEN, 'Access denied');
      }
      // D5: admin = super-member; short-circuit the membership check.
      const allowed =
        req.user.role === 'ADMIN' || (await membershipService.isMember(req.user.id, project.id));
      // Path B alternative: req.user.role === 'ADMIN' || req.user.id === project.creatorId;
      if (!allowed) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Access denied');
      }
      req.project = project; // D4: full ProjectRow for downstream handlers.
      next();
    };
  }
  ```
  Note the deliberate identical message for unknown-slug and non-member ("Access denied") — prevents an oracle that distinguishes the two.
- **`backend/src/middleware/requireProjectMember.test.ts`** — table-driven, mirroring `requireRole.test.ts:7-65`. Mock `projectService.getProjectBySlug` and `membershipService.isMember` via `vi.mock`. Cases (each asserts `next` called-or-not + thrown `AppError.code`):
  | Case | req.user | slug resolves? | isMember | admin? | Expected |
  |------|----------|----------------|----------|--------|----------|
  | member allowed | MEMBER | yes (project) | true | — | `next()` called once, `req.project` set |
  | non-member denied | MEMBER | yes | false | — | throws `FORBIDDEN`, `next` not called |
  | unknown slug | MEMBER | null | (not called) | — | throws `FORBIDDEN`, `next` not called |
  | admin override (non-member) | ADMIN | yes | false (or not awaited) | yes | `next()` called, `req.project` set |
  | admin override (unknown slug) | ADMIN | null | — | — | throws `FORBIDDEN` (admin can't bypass a nonexistent project) |
  | req.user absent | undefined | — | — | — | throws `UNAUTHENTICATED` |
  - Assert the non-member and unknown-slug messages are **identical** (anti-oracle).
  - Assert `req.project` is the resolved `ProjectRow` on the allow path.

**Acceptance Criteria:**
- [ ] Middleware exports `requireProjectMember` (factory → async handler).
- [ ] Reads `req.user` (throws `UNAUTHENTICATED` if absent) and `req.params.slug`.
- [ ] Resolves via `projectService.getProjectBySlug`; null → `FORBIDDEN` (D6 default).
- [ ] Admin override: `role === 'ADMIN'` skips the membership check BUT still requires the project to resolve.
- [ ] Non-member → `FORBIDDEN`; member → `next()` + `req.project` set to the full `ProjectRow`.
- [ ] Unknown-slug and non-member messages are byte-identical (no existence oracle).
- [ ] All 6 test cases green; table-driven per `js-testing-rules.md`.
- [ ] `tsc --noEmit` clean against T1's augmented `Request.project`.

**Dependencies:** T1 (type), T2 (Path A `isMember`). If D1 = Path B, drop the T2 dependency and inline the creator check.

---

### T5 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1-T4 · **Parallel with:** —

**Description:** The final definition-of-done gate. F47 ships no route of its own (F48 mounts it), so verification is: type/test/lint green on the merged result, plus a manual exercise of the middleware via a throwaway mount or a direct unit-level integration check. Record proof for F48 to consume.

Steps:
1. `cd backend && npm run typecheck` (or `npx tsc --noEmit`) — confirm zero errors, including T1's `Request.project` augmentation and T2/T3 imports.
2. `npm test --workspace backend` (or `npm test` in `backend/`) — confirm `requireProjectMember.test.ts`, `membershipService.test.ts` (Path A), and the updated `projectService.test.ts` (Path A) all pass.
3. Lint + format (`npm run lint`, `npm run format:check` per the repo's scripts) — zero violations on touched files.
4. **Manual membership proof (Path A):** in a dev shell, create a project via the existing `POST /api/projects` (now seeds creator membership per T3), then exercise the middleware logic directly (or via a temporary route F48 would add) as: (a) creator → 200/`req.project` set, (b) a second MEMBER not in `projectMembers` → 403, (c) ADMIN not in `projectMembers` → allowed (D5), (d) a random nonexistent slug → 403 (D6). Confirm the 403 body is `{ error: { code: 'FORBIDDEN', message: 'Access denied' } }` (the shape F49 will catch).
5. Record commit SHAs and the observed 403 envelope for F48's consumption.

**Acceptance Criteria:**
- [ ] `tsc --noEmit` exit 0.
- [ ] All backend tests exit 0 (`requireProjectMember`, `membershipService`, `projectService`).
- [ ] Lint + format:check exit 0 on touched files.
- [ ] Manual exercise: member allowed, non-member 403, admin override allowed, unknown slug 403 — all observed and recorded.
- [ ] 403 envelope shape confirmed for F49: `{ error: { code: 'FORBIDDEN', message: 'Access denied' } }`.

**Dependencies:** T1, T2, T3, T4 all merged.

---

## 7. Final F47 Acceptance Checklist

- [ ] `requireProjectMember` middleware created; resolves `:slug` via `projectService.getProjectBySlug`; runs membership check (Path A: `membershipService.isMember`; Path B: creator rule); 403 on non-member and unknown-slug; passes `req.project` downstream.
- [ ] Composes after `authenticate` (defensive `req.user` check throws `UNAUTHENTICATED` if absent).
- [ ] Admin override: `role === 'ADMIN'` short-circuits membership (D5) but not project resolution.
- [ ] Unit tests for member / non-member / unknown-slug / admin-override / req.user-absent (6 cases).
- [ ] `express.d.ts` augmented with `project?: ProjectRow`.
- [ ] (Path A) `projectMembers` table + migration applied; creator auto-seeded at create time.
- [ ] Lint + format pass on an empty change (`format:check` clean).
- [ ] Typecheck + tests pass (`tsc --noEmit` exit 0, vitest exit 0).

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- D1 path chosen (A / B): `________`
- D6 unknown-slug code (403 / 404): `________`
- Observed 403 envelope (for F49): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

Feature line 429 claims "No DB migration" — **this is incorrect for Path A and is flagged as the D1 owner question.** If the owner picks Path A (recommended), F47 owns this delta:

| Delta | Detail | Migration |
| --- | --- | --- |
| `projectMembers` table (Path A only) | Columns: `projectId uuid NOT NULL REFERENCES projects ON DELETE CASCADE`, `userId uuid NOT NULL REFERENCES users ON DELETE CASCADE`, `joinedAt timestamptz NOT NULL DEFAULT now()`. Composite PK `(project_id, user_id)`. Index `project_members_user_id_idx` on `user_id`. | Generated by `make migrate` (Drizzle journal-based). Emitted SQL inspected for the `drizzle-partial-index-enum-dollar1` gotcha — N/A here (composite PK, no partial/enum index). |

If the owner picks Path B, this section is N/A and "No DB migration" holds — at the cost of a degenerate membership rule (see D1-expansion).
