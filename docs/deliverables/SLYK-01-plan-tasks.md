# SLYK-01 — Task Breakdown

**Source plan:** [`SLYK-01-plan.md`](./SLYK-01-plan.md)
**Ticket:** [`SLYK-01.md`](./SLYK-01.md) · Three-Tier Roles & Project Membership
**Generated:** 2026-06-30

> **Convention (binding — from plan §Summary, verified against the live tree):**
> The codebase collapses the aspirational `Route → Controller → Service → Repository`
> layering (in `AGENTS.md`) to **`Route handler → Service (singleton Drizzle ORM db)`** —
> `backend/src/controllers/` and `backend/src/repositories/` contain only `.gitkeep`.
> Services import the singleton `db` from `../db/client`, own business logic + persistence
> + transactions, and throw `new AppError(ErrorCode.X, msg)` for control flow. The
> centralized `errorMiddleware` serializes errors via the `success()`/`error()` envelope
> (`backend/src/utils/envelope.ts`). `ErrorCode` vocabulary:
> `VALIDATION_FAILED | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | INTERNAL_ERROR`
> (FORBIDDEN→403, UNAUTHENTICATED→401, CONFLICT→409, NOT_FOUND→404).
>
> **Non-revealing FORBIDDEN wording (must be byte-identical for not-found vs. not-a-member):**
> `'You do not have access to this project'` — matches the existing anti-oracle test at
> `backend/src/routes/report.routes.test.ts:150`. Do **not** use the plan's suggested
> "Project not found" wording — it would break anti-oracle parity.
>
> **Service transaction idiom:** `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];`
> (`userService.ts:19`); wrap multi-step mutations in `db.transaction(async (tx) => {...})`;
> `PG_UNIQUE_VIOLATION = '23505'` (`userService.ts:16`).
>
> All `file:line` citations reference the **current** tree (pre-SLYK-01); re-verify line
> numbers after each task lands.

---

## Parallelization Strategy

### Batch execution model

Tasks are organized into **7 batches** by dependency order. All tasks within a batch are
parallelizable with **zero merge conflicts** (they touch disjoint files), unless noted.

### Visual batch dependency diagram

```
                         ┌─────────────────────────────────┐
                         │  BATCH 1 — Foundation           │
                         │  A  schema                      │
                         │  B  migration 0000 + seed       │
                         │  C  env BOOTSTRAP_ADMIN_*       │
                         │  D  atomic role→pa rename       │
                         └────────────────┬────────────────┘
                                          │
                         ┌────────────────▼────────────────┐
                         │  BATCH 2 — Core services        │
                         │  E  bootstrapService            │
                         │  F  membershipService           │
                         │  G  userService refactor        │
                         │  H  login gate rewrite          │
                         └────────────────┬────────────────┘
                                          │
   ┌──────────────────────────────────────┴─────────────────────────────────┐
   │                            BATCH 3 — Authz core                         │
   │   ┌──────────────────┐      sig contract      ┌────────────────────┐   │
   │   │ I  middleware     │◀──────────────────────│ J  project          │   │
   │   │ (requirePlatformAdm,│                     │     visibility      │   │
   │   │  requireProjectMember,│                   │  listProjects(uid,pa)│  │
   │   │  requireProjectAdmin,│                   │  getProjectBySlug    │   │
   │   │  resolveTicket/Label)│                   │    (slug,uid,pa)     │   │
   │   └────────┬──────────┘                      └─────────┬──────────┘   │
   └────────────┼──────────────────────────────────────────┼──────────────┘
                │                                          │
   ┌────────────▼──────────────────────────────────────────▼──────────────┐
   │                            BATCH 4 — Matrix + Member API              │
   │   ┌──────────────────────┐                  ┌──────────────────────┐ │
   │   │ K  matrix sweep       │                  │ L  member-mgmt routes│ │
   │   │   (projects, tickets, │                  │   + schema, mounted  │ │
   │   │    labels, reports,   │                  │   under projectsRouter│ │
   │   │    users)             │                  │                      │ │
   │   └──────────┬───────────┘                  └──────────┬───────────┘ │
   └──────────────┼──────────────────────────────────────────┼────────────┘
                  │                                          │
   ┌──────────────▼──────────────────────────────────────────▼────────────┐
   │                            BATCH 5 — Frontend rename                  │
   │   ┌────────────────────────────────────────────────────────────────┐ │
   │   │ M  types/store/guard + consumer sweep (role → isPlatformAdmin)  │ │
   │   └──────────────────────────┬─────────────────────────────────────┘ │
   └──────────────────────────────┼───────────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼───────────────────────────────────────┐
   │                            BATCH 6 — Frontend member UX              │
   │   ┌────────────────────────────────────────────────────────────────┐ │
   │   │ N  shared 403 handler + member-management UI + route            │ │
   │   └──────────────────────────┬─────────────────────────────────────┘ │
   └──────────────────────────────┼───────────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼───────────────────────────────────────┐
   │                            BATCH 7 — Tests                            │
   │   ┌────────────────────────────────────────────────────────────────┐ │
   │   │ O  matrix table-driven + member/bootstrap coverage (BE + FE)    │ │
   │   └────────────────────────────────────────────────────────────────┘ │
   └───────────────────────────────────────────────────────────────────────┘
```

### Merge-order rules

1. **Batches merge in numeric order** (1 → 2 → 3 → 4 → 5 → 6 → 7). Each batch's
   tests/behavior assume the prior batch's surface exists.
2. **Within Batch 1:** merge **A first** (schema column changes), then **B** (regenerates
   migration from A's schema) and **D** (atomic rename — type-complete only after A).
   **C** is independent. Recommended: A+B in one PR, D in a follow-up (or same PR).
3. **Within Batch 3:** agree the service signature contract
   (`getProjectBySlug(slug, uid?, pa?)`, `listProjects(uid, pa)`) **first**, then I and J
   bodies are editable in parallel. If on the same branch, merge as one PR.
4. **Within Batch 4:** **K and L may merge in either order** but **must land in the same
   release** as M (frontend rename is breaking). Recommended: L first (additive), then K
   (deletes `requireRole`).
5. **Batch 5 before 6:** N's member UI consumes M's `isPlatformAdmin` store field.
6. **Rebase-and-merge only** (project policy, `AGENTS.md` §Merge Policy). No squash, no
   merge commits. Each task = its own branch + PR.
7. **Backend + frontend deploy together** for the release that includes Batch 4 + 5
   (plan §Edge Cases: the `role` → `isPlatformAdmin` rename is breaking on both sides).
8. **Never merge O before its dependency batches** — O's matrix test is the regression
   guard and must reflect the merged surface.

### Summary table

| #   | Batch | Target File(s) | Dependencies | Can Parallel With |
|-----|-------|----------------|--------------|-------------------|
| A   | 1 | `backend/src/db/schema.ts` | None | C |
| B   | 1 | `backend/src/db/migrations/**`; `backend/src/db/seed.ts` | A | C (after A lands) |
| C   | 1 | `backend/src/config/env.ts` | None | A, B, D |
| D   | 1 | `jwt.ts`; `express.d.ts`; `auth.ts`; `requireRole.ts`; `auth.routes.ts`; `userService.ts`; `users.routes.ts`; `labels.routes.ts` (+ tests) | A | C |
| E   | 2 | **new** `services/bootstrapService.ts`; `index.ts` | A, C, B | F, G |
| F   | 2 | **new** `services/membershipService.ts` | A | E, G |
| G   | 2 | `services/userService.ts` | A, D | E, F |
| H   | 2 | `routes/auth.routes.ts` | D, G | — |
| I   | 3 | `middleware/requireRole.ts`→`requirePlatformAdmin.ts`; `middleware/requireProjectMember.ts`; **new** `middleware/requireProjectAdmin.ts`; **new** `middleware/resolveProject.ts`; `types/express.d.ts` | Batches 1–2; J (sig) | J |
| J   | 3 | `services/projectService.ts` | A (F's `isMember`) | I |
| K   | 4 | `routes/{projects,tickets,labels,report,users}.routes.ts` | I, J, G | L |
| L   | 4 | **new** `routes/projectMembers.routes.ts`; **new** `routes/projectMembers.schema.ts`; mount in `projects.routes.ts` | I, F, G | K |
| M   | 5 | `api/auth.ts`; `api/users.ts`; `stores/useAuthStore.ts`; `hooks/useRequireRole.ts`→`useRequirePlatformAdmin.ts`; `components/RequireRole.tsx`→`RequirePlatformAdmin.tsx`; `routes/index.tsx`; `pages/*`; `components/*`; `hooks/*` | K, L | — |
| N   | 6 | `api/client.ts`; **new** `api/members.ts`; **new** `hooks/useProjectMembers.ts`; **new** `pages/ProjectMembersPage.tsx`; `routes/index.tsx` | L, M, K | — |
| O   | 7 | `**/*.test.ts(x)` BE + FE; **new** `membershipService.test.ts`, `bootstrapService.test.ts`, `ProjectMembersPage.test.tsx`, `client.403.test.ts` | I, J, K, L, M, N | — (final) |

### Developer assignment tracks (3 parallel paths)

- **Track A — Backend Authorization Core:** Task J → Task I → K-slice (`projects.routes`,
  `report.routes`, `users.routes`). Owns the non-revealing-FORBIDDEN contract and the
  middleware surface. Hands off the middleware + service signatures to Track B.
- **Track B — Backend Routes & Member API:** Task F (can start in Batch 2) → K-slice
  (`tickets.routes`, `labels.routes` slug-less resolution) → Task L. Starts once Track A
  lands Task I. Hands off the final HTTP surface to Track C.
- **Track C — Frontend:** Task M → Task N → frontend half of O. Blocked until Batch 4
  lands (breaking rename). Coordinate `/auth/me` + `/users` response shapes
  (`isPlatformAdmin` + `displayName`) and member-endpoint contracts up front.

Test coverage (Task O) is split: Track A owns middleware/visibility/matrix tests for its
routes; Track B owns member-route tests + `bootstrapService`/`membershipService` unit
tests; Track C owns all frontend tests.

---

# Batch 1 — Foundation (no internal dependencies)

## Task A — Rewrite the Drizzle schema

**Description**

Foundation for the entire three-tier model. Single source of truth for the fresh
migration. Edit **only** `backend/src/db/schema.ts`.

**What to change:**

1. **Remove** `roleEnum` (`schema.ts:23` — `pgEnum('Role', ['ADMIN', 'MEMBER'])`) and the
   `users.role` column (`schema.ts:35` — `role: roleEnum('role').default('MEMBER').notNull()`).
2. **Add** to the `users` table:
   - `isPlatformAdmin: boolean('is_platform_admin').notNull().default(false)`.
   - `displayName: text('display_name')` (nullable).
   - Keep `googleId` **nullable** and UNIQUE-nullable (Postgres allows multiple NULLs, so
     the bootstrap admin and member-created users coexist safely before first login).
     Confirm the regenerated migration reflects nullable on the unique index.
3. **Add** to the `projects` table:
   - `isActive: boolean('is_active').notNull().default(true)`. **Column only** —
     deactivation *behavior* is owned by DEL-04.
4. **Add** the project-member role enum:
   ```ts
   export const projectMemberRoleEnum = pgEnum('ProjectMemberRole', ['PROJECT_ADMIN', 'MEMBER']);
   ```
5. **Add** the `projectMembers` table (composite PK enforces the unique
   `(projectId, userId)` constraint mandated by the ticket):
   ```ts
   export const projectMembers = pgTable(
     'project_members',
     {
       projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
       userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
       role: projectMemberRoleEnum('role').notNull().default('MEMBER'),
       createdAt: timestamptz('created_at').notNull().defaultNow(),
     },
     (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
   );
   ```
6. Add an index on `projectMembers.userId` for "list my projects" queries
   (`pgIndex('project_members_user_id_idx', ...)`).

**References:** existing `Users` table `schema.ts:25-52`; `Projects` `schema.ts:66-78`;
enum pattern `schema.ts:19`; note the schema comment at `schema.ts:65-69` confirming
`users_one_admin` was already dropped (no action needed).

**Acceptance Criteria**
- [ ] `roleEnum` and `users.role` are gone; `grep -n "roleEnum\|users.role" backend/src/db/schema.ts` is empty.
- [ ] `users.isPlatformAdmin` (bool, default false, not null) and `users.displayName` (nullable text) exist.
- [ ] `projects.isActive` (bool, default true, not null) exists.
- [ ] `projectMemberRoleEnum` and `projectMembers` table exist with composite PK `(projectId, userId)` + `userId` index.
- [ ] `users.googleId` remains nullable + UNIQUE-nullable.
- [ ] `npm run typecheck -w backend` passes.

**Dependencies:** None.

**Files touched:** `backend/src/db/schema.ts`.

---

## Task B — Discard migration chain, author fresh `0000`, fix seed

**Description**

The ticket explicitly mandates discarding the entire migration chain (no data
preservation). Regenerate one fresh `0000` from Task A's schema.

**What to do:**

1. **Delete every file** under `backend/src/db/migrations/` — all `*.sql` and
   `meta/_journal.json` + `meta/*_snapshot.json`.
2. Run `npm run db:generate` (`drizzle-kit generate`, `package.json:11`) to emit a single
   `0000_*.sql` + fresh `meta/`.
3. **Target databases must be reset** (drop schema / recreate) before applying, since the
   journal hash changes. Document this in the PR description.
4. **Update `backend/src/db/seed.ts`** to the new schema:
   - Drop every `role:` assignment (`seed.ts:31,37,50,55,65`) and the
     `.where(eq(users.role, 'ADMIN'))` filter.
   - **Seed EXACTLY ONE user: a Platform Admin** (`isPlatformAdmin: true`). **Do NOT seed any member/seed-user fixtures** — per product decision, the seed contains only a single Platform Admin, nobody else.
   - Seed exactly one `project_members` row: the Platform Admin as `PROJECT_ADMIN` of the seeded project (so the membership model has one row and the member-management UI has data). **No `MEMBER`-role fixture row** (there is no other user to attach it to).
   - Drop the dead `users_one_admin` references at `seed.ts:24-27`.

**References:** migration runner `backend/src/index.ts:runMigrations()` (`:84-105`) uses
its own short-lived `Pool` on `env.directDatabaseUrl`; config `backend/drizzle.config.ts`.

**Acceptance Criteria**
- [ ] `backend/src/db/migrations/` contains exactly one `0000_*.sql` + a fresh `meta/` (no `0010`–`0012` remnants).
- [ ] `npm run db:generate` is idempotent (re-running produces no further SQL).
- [ ] `seed.ts` contains no `role:` / `roleEnum` / `users.role` references; seeds **exactly one** Platform Admin (no other users) and one `project_members` row (the PA as `PROJECT_ADMIN`).
- [ ] PR description documents the DB-reset requirement.

**Dependencies:** A (schema must be final before `db:generate`).

**Files touched:** `backend/src/db/migrations/**`; `backend/src/db/seed.ts`.

---

## Task C — Extend env config with bootstrap-admin vars

**Description**

Externalize the bootstrap-admin configuration per project convention (fail-fast at boot
happens in Task E's `bootstrapService`, not the loader).

**What to add** to the `Config` interface and `loadConfig()` in
`backend/src/config/env.ts`:

- `bootstrapAdminEmail` — optional `string` (email).
- `bootstrapAdminFullName` — optional `string`.
- `bootstrapAdminDisplayName` — optional `string` (nullable short name).

Keep them **optional at the loader level** (so the app can boot without them in non-prod).
`bootstrapService` (Task E) will fail-exit if `bootstrapAdminEmail` is set without a
matching `ALLOWED_DOMAIN`. If `bootstrapAdminEmail` is unset, bootstrap is skipped
entirely (dev convenience; `bootstrapService` logs a warning).

**References:** existing optional-var pattern `env.ts:51-62`; required-var fail-fast
`env.ts:25-47`.

**Acceptance Criteria**
- [ ] `Config` interface + `loadConfig()` expose the three optional bootstrap-admin fields.
- [ ] App still boots when none are set (no throw at load time).
- [ ] Missing-required-var fail-fast behavior for truly required vars is unchanged.

**Dependencies:** None.

**Files touched:** `backend/src/config/env.ts`.

---

## Task D — Atomic `role` → `isPlatformAdmin` / `pa` rename + compile cascade

**Description**

Rename the global role concept end-to-end: the JWT carries a boolean platform-admin claim
(`pa`) instead of `role: 'ADMIN'|'MEMBER'`; `AuthenticatedUser` exposes `isPlatformAdmin`;
`authenticate` populates it. This is **one atomic task** — it must touch every production
file that references the old `role` so the backend compiles and the existing test suite's
intent is preserved after this task alone. Project-scoped roles (PROJECT_ADMIN/MEMBER) are
**not** in the JWT (they're per-project, resolved by middleware in Batch 3); only the
platform-admin boolean belongs here.

**Core files (the rename plumbing):**

1. **`backend/src/utils/jwt.ts`** —
   - `JwtUserClaims` (`:16-21`): replace `role: 'ADMIN' | 'MEMBER';` (`:17`) with
     `pa: boolean;`. Keep `sub`, `email`, `ver`.
   - `signJwt` (`:22`): change the payload to `{ email: claims.email, pa: claims.pa, ver: claims.ver }`.
   - `verifyJwt` (`:52-56`): replace the `role` narrowing with `pa` narrowing:
     ```ts
     const pa = payload.pa;
     if (typeof pa !== 'boolean') {
       throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing required claims');
     }
     return { ...payload, sub, email, pa, ver: payload.ver };
     ```
2. **`backend/src/types/express.d.ts`** —
   - `AuthenticatedUser` (`:3-7`): replace `role: 'ADMIN' | 'MEMBER';` (`:6`) with
     `isPlatformAdmin: boolean;`.
   - Add an optional project-member context field (set by `requireProjectMember` in Batch 3;
     declare now so the type is ready):
     ```ts
     projectMember?: 'PROJECT_ADMIN' | 'MEMBER' | null;
     ```
   - Keep `req.project?: ProjectRow;` (`:13`) and `req.user?: AuthenticatedUser;`.
3. **`backend/src/middleware/auth.ts`** —
   - Final assignment (`:55`/`:41`): `req.user = { id: payload.sub, email: payload.email, isPlatformAdmin: payload.pa };`

**Required cascade files (so the backend compiles after D):**

4. **`backend/src/middleware/requireRole.ts`** — rewrite the gate to the new model so call
   sites still compile and routes still function as a **placeholder** until Batch 3
   replaces them with `requireProjectAdmin`:
   ```ts
   // Placeholder gate kept for compile continuity; Batch 3 replaces call sites with
   // requirePlatformAdmin / requireProjectAdmin.
   export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
     if (!req.user) {
       throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
     }
     if (!req.user.isPlatformAdmin) {
       throw new AppError(ErrorCode.FORBIDDEN, 'This action requires Platform Admin');
     }
     next();
   }
   // Backwards-compatible alias so existing requireRole('ADMIN') call sites can be swept
   // in Batch 3; remove that alias in Batch 3.
   export const requireRole = requirePlatformAdmin;
   ```
   (Drop the `AuthenticatedUser['role']` param signature — it no longer exists.)
5. **`backend/src/routes/auth.routes.ts`** — both `POST /google` (`:40-44`) and `GET /me`
   (`:62-70`):
   - `signJwt({ …, role: user.role, … })` → `signJwt({ sub: user.id, email: user.email, pa: user.isPlatformAdmin, ver: user.tokenVersion })`.
   - Response `user` object: replace `role: user.role` (`:42,:53,:72,:83`) with
     `isPlatformAdmin: user.isPlatformAdmin` and add `displayName: user.displayName`.
6. **`backend/src/services/userService.ts`** — minimal change only (do **not** restructure
   business logic; that's Batch 2): wherever it returns/reads `role`, surface
   `isPlatformAdmin` instead. Remove/adjust first-user-`ADMIN` promotion logic only if it
   references the now-deleted column and would fail to compile; otherwise leave for Batch 2.
   If `updateUserRole` exists, remove it if now-unreferenced (confirm via grep) — Batch 2
   owns the `setPlatformAdmin` replacement. **Goal: compiles, not behaviorally final.**
7. **`backend/src/routes/users.routes.ts`** — minimal compile fix:
   - `requireRole('ADMIN')` call sites (`:28`, `:47`) → `requireRole()` (alias).
   - `PATCH /:userId/role` handler + `roleBody` zod schema (`:11`, `:34`): **delete the
     route + schema + the `updateUserRole` call** (matrix has no global role; the
     `PATCH /:userId/isPlatformAdmin` replacement is added in Batch 4 K). Note this so K
     knows it's already gone.
8. **`backend/src/routes/labels.routes.ts`** — `requireRole('ADMIN')` call sites
   (`:27`, `:43`, `:56`) → `requireRole()` (alias). Compile-only; Batch 3 K replaces with
   `requireProjectAdmin`.
9. **`backend/src/routes/tickets.routes.ts:149`** — `isAdmin: req.user!.role === 'ADMIN'`
   → `isPlatformAdmin: req.user!.isPlatformAdmin` (passed to `timerService.stopTimer`).

**Test files (must update so the suite is green after D):**

10. **`backend/src/utils/jwt.test.ts`** — `role: 'MEMBER'` (`:21`, `:32`, `:99`, `:117`) →
    `pa: true`/`pa: false`; assertion `payload.role` (`:58`) → `payload.pa`.
11. **`backend/src/middleware/auth.test.ts`** — every `AuthenticatedUser` fixture with
    `role:` (`:27,29,42,44,75,85,90,103,145,162,176,191,200,207`) → `isPlatformAdmin:`.
12. **`backend/src/routes/*.routes.test.ts`** — the shared `tokenFor(role)` helpers
    (`tickets.routes.test.ts:61`, `labels.routes.test.ts:52`, `users.routes.test.ts:56`)
    and all `signJwt({ role })` / `role:` literals → `tokenFor(isPlatformAdmin: boolean)`
    signing `pa`. Also update user-fixture inserts that set `role:` to set `isPlatformAdmin:`.
    **Scope:** make tests compile and assert the new shape; do **not** rewrite test
    scenarios (matrix rewrites happen in Batch 4/7).

> **Note on `slug.ts:13`** (`'ADMIN'` in a reserved-slug list): that is a reserved URL
> slug, **unrelated** to the role enum. Do not touch it (also `slug.test.ts:37`).

**Conflict surface:** Touches ~10 production files + ~4 test files, but **all changes are
mechanical renames** (no business-logic restructure), so merges with later batches stay
clean. The placeholder `requireRole`/`requirePlatformAdmin` alias is the explicit hand-off
point to Batch 3.

**Acceptance Criteria**
- [ ] `JwtUserClaims` has `pa: boolean` and no `role`; `signJwt`/`verifyJwt` use `pa`; tokens signed pre-D are rejected (claim narrowing fails closed).
- [ ] `AuthenticatedUser` has `isPlatformAdmin: boolean` and `projectMember?` field; no `role`.
- [ ] `authenticate` sets `req.user.isPlatformAdmin` from `payload.pa`.
- [ ] `POST /google` and `GET /me` responses return `isPlatformAdmin` + `displayName`; no `role`.
- [ ] `requireRole.ts` exports a working platform-admin gate; no reference to `AuthenticatedUser['role']`.
- [ ] `PATCH /:userId/role` route + `roleBody` schema removed; `updateUserRole` removed if now-unreferenced.
- [ ] `labels.routes.ts` + `users.routes.ts` + `tickets.routes.ts` call sites compile under the new gate.
- [ ] `userService.ts` compiles with no `.role` references.
- [ ] `grep -rn "\.role\b\|roleEnum\|'ADMIN' | 'MEMBER'\|role: 'ADMIN'\|role: 'MEMBER'" backend/src` returns **no production-code hits** (test files updated; `slug.ts` reserved-slug `'ADMIN'` is the only allowed exception).
- [ ] `npm run typecheck -w backend` passes.
- [ ] `npm test -w backend` is green (tests updated to the new claim/type shape).

**Dependencies:** A (deletes the `role` column D stops reading). Recommended: A+B and D
land in the same PR or consecutive PRs.

**Files touched:** `backend/src/utils/jwt.ts`; `backend/src/utils/jwt.test.ts`;
`backend/src/types/express.d.ts`; `backend/src/middleware/auth.ts`;
`backend/src/middleware/auth.test.ts`; `backend/src/middleware/requireRole.ts`;
`backend/src/routes/auth.routes.ts`; `backend/src/services/userService.ts`;
`backend/src/routes/users.routes.ts`; `backend/src/routes/labels.routes.ts`;
`backend/src/routes/tickets.routes.ts`; `backend/src/routes/tickets.routes.test.ts`;
`backend/src/routes/labels.routes.test.ts`; `backend/src/routes/users.routes.test.ts`.

---

# Batch 2 — Core services (depend on Batch 1)

> Depends on Batch 1 (schema rewrite, fresh `0000` migration, env `BOOTSTRAP_ADMIN_*`, JWT
> claim `role`→`pa:boolean`, `AuthenticatedUser.isPlatformAdmin`, `req.projectMember`,
> auth middleware populating `isPlatformAdmin`). Non-revealing FORBIDDEN wording reserved
> for Batch 3: `"You do not have access to this project"`.

## Task E — `bootstrapService.ts` (NEW) + wire into `index.ts`

**Description**

Create `backend/src/services/bootstrapService.ts` exporting
`ensureBootstrapAdmin(): Promise<void>`. This replaces the now-removed signup-time
first-user-admin heuristic with a **boot-time, env-driven, idempotent** Platform Admin
creator.

**Logic (inside one `db.transaction`):**

1. Read `env.bootstrapAdminEmail`. If unset/empty → **skip**:
   `logger.info('Bootstrap admin email not set; skipping')` and `return`.
2. Domain gate: if `env.allowedDomain` is set and
   `normalizeEmailDomain(env.bootstrapAdminEmail)` !==
   `normalizeEmailDomain('x@' + env.allowedDomain)` (reuse
   `accessControl.normalizeEmailDomain`, `accessControl.ts:7`) → `logger.error(...)` then
   **`process.exit(1)`**. (Do NOT throw — boot must hard-stop per acceptance criterion.)
3. Idempotent find by email: `tx.select().from(users).where(eq(users.email, env.bootstrapAdminEmail)).limit(1)`.
   - Exists + `isPlatformAdmin === true` → no-op (idempotent success; `return`).
   - Exists + `isPlatformAdmin === false` → `tx.update(users).set({ isPlatformAdmin: true })`
     (documented "exactly one Platform Admin" promotion; safe + idempotent).
   - Not found → `tx.insert(users).values({ email, fullName: env.bootstrapAdminFullName ?? null, displayName: env.bootstrapAdminDisplayName ?? null, isPlatformAdmin: true, googleId: null, blocked: false })`.
4. Log the outcome (created / promoted / already-admin).

**Wire into `backend/src/index.ts:start()`** (`index.ts:107-148`) — insert **after** the
`runMigrations()` `try/catch` block (~`index.ts:117-125`) and **before** `app.listen(...)`
(~`index.ts:127`):

```ts
try {
  await ensureBootstrapAdmin();
} catch (err) {
  logger.error({ err }, '[slykboard-backend] bootstrap admin failed on boot');
  process.exit(1);
}
```

Use the project's `Tx` alias for the inner transaction client (mirrors `userService.ts:19`).

**References:** `index.ts:runMigrations()` block `:111-118`; `connectWithRetry` exit
pattern `:108-110`; removed signup-time logic `userService.ts:26-69`.

**Acceptance Criteria**
- [ ] `ensureBootstrapAdmin()` exported from `backend/src/services/bootstrapService.ts`.
- [ ] When `env.bootstrapAdminEmail` unset → logs + returns; no DB writes; process continues to boot.
- [ ] When `env.allowedDomain` set **and** email domain mismatches → logs error + `process.exit(1)` (process does NOT start listening).
- [ ] When `env.allowedDomain` unset → domain check skipped (any domain accepted).
- [ ] When no user row exists → inserts exactly one row: `isPlatformAdmin=true, googleId=null, blocked=false`, email/fullName/displayName from env.
- [ ] When a row exists with `isPlatformAdmin=false` → promotes to `isPlatformAdmin=true` (idempotent re-run is a no-op).
- [ ] When a row exists with `isPlatformAdmin=true` → no-op, no writes.
- [ ] Entire lookup/insert/promotion runs inside one `db.transaction`.
- [ ] `index.ts:start()` calls `ensureBootstrapAdmin()` after `runMigrations()` succeeds and before `app.listen`, wrapped in `try/catch → process.exit(1)`.
- [ ] No use of `process.exit` inside the service except the documented domain-mismatch hard-stop.

**Dependencies:** Batch 1 — A (schema `users.isPlatformAdmin`, `users.displayName`), C
(env `bootstrapAdminEmail/FullName/DisplayName`), B (fresh `0000` migration).
`accessControl.normalizeEmailAllowed` already exists (`accessControl.ts:7`).

**Files touched:** **new** `backend/src/services/bootstrapService.ts`;
`backend/src/index.ts`.

---

## Task F — `membershipService.ts` (NEW)

**Description**

Create `backend/src/services/membershipService.ts` centralizing all `project_members`
access. Import the singleton `db` (`../db/client`), `projectMembers` + `users` from
`../db/schema`, `AppError`/`ErrorCode`, and `assertDomainAllowed` from `./accessControl`
for `createAndAddMember`. Reuse the project `Tx` alias
(`type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]`).

**Functions:**

1. `isProjectMember(tx: Tx, projectId: string, userId: string): Promise<boolean>` —
   `tx.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))).limit(1)`
   → `rows.length > 0`. **Takes a `tx`** so middleware can call it inside the same
   transactional read as project resolution.
2. `getMemberRole(projectId: string, userId: string): Promise<'PROJECT_ADMIN' | 'MEMBER' | null>`
   — select `.role`; return `null` if not a member.
3. `listProjectMembers(projectId: string)` — join `projectMembers` ↔ `users` returning
   `{ userId, email, fullName, displayName, avatarUrl, role, createdAt }` ordered by
   `fullName`.
4. `addMember(projectId: string, userId: string, role: 'PROJECT_ADMIN' | 'MEMBER' = 'MEMBER')`
   — insert; **idempotent on `23505`**: catch unique_violation →
   `tx.update(projectMembers).set({ role }).where(...)`. Reuse the
   `PG_UNIQUE_VIOLATION = '23505'` constant idiom from `userService.ts:16`.
5. `removeMember(projectId: string, userId: string)` — delete the composite-PK row; throw
   `AppError(ErrorCode.NOT_FOUND, 'Member not found')` if zero rows affected.
6. `promoteToProjectAdmin(projectId: string, userId: string)` — `update set role='PROJECT_ADMIN'`;
   NOT_FOUND if missing.
7. `createAndAddMember({ email, fullName, displayName, projectId, role }): Promise<{ userId: string }>`
   — **one `db.transaction`**: `assertDomainAllowed(email)` **at creation** (throws
   FORBIDDEN on domain mismatch BEFORE any insert), then insert `users` row
   `{ googleId: null, isPlatformAdmin: false, blocked: false, email, fullName, displayName }`
   (`.returning()` the `id`), then insert the `project_members` row. Returns `{ userId }`.

**References:** service conventions `userService.ts:16,19,23`; `assertDomainAllowed`
`accessControl.ts:23-30`; `project_members` schema (Task A, composite PK
`(projectId, userId)`).

**Acceptance Criteria**
- [ ] `isProjectMember(tx, projectId, userId)` accepts a transaction client and returns a boolean.
- [ ] `getMemberRole` returns the enum value or `null` for non-members.
- [ ] `listProjectMembers` returns joined user display fields + role, ordered by `fullName`.
- [ ] `addMember` defaults role to `'MEMBER'`; inserting a duplicate `(projectId, userId)` does NOT throw — it upserts the role (handles `23505`).
- [ ] `removeMember` throws `AppError(ErrorCode.NOT_FOUND, 'Member not found')` when the row is absent.
- [ ] `promoteToProjectAdmin` sets `role='PROJECT_ADMIN'`; throws NOT_FOUND when absent.
- [ ] `createAndAddMember` runs user-insert + membership-insert in a **single transaction**.
- [ ] `createAndAddMember` calls `assertDomainAllowed(email)` before any insert, so a wrong-domain email throws `FORBIDDEN` with zero side effects.
- [ ] `createAndAddMember` creates the user with `googleId=null, isPlatformAdmin=false, blocked=false`.
- [ ] No raw SQL string-concatenation — all queries via Drizzle's parameterized builder.

**Dependencies:** Batch 1 — A (`project_members` table, `projectMemberRoleEnum`).
`accessControl.assertDomainAllowed` already exists.

**Files touched:** **new** `backend/src/services/membershipService.ts`.

---

## Task G — `userService.ts` refactor (remove first-user heuristic + role enum)

**Description**

Refactor `backend/src/services/userService.ts` to drop the global `role` model and
signup-time first-user-admin logic. (Task D already made this file compile; this task
removes the dead business logic and adds the new exports the login gate + matrix need.)

**Remove:**
- `ADMIN_ROLE` / `MEMBER_ROLE` consts (`userService.ts:12-13`).
- `upsertByGoogleId` and the entire first-user-admin insert path + `retryAsMemberOrRefresh`
  (`userService.ts:24-100`).
- `updateUserRole` (`userService.ts:148-185`) — if Task D did not already remove it.
- `UserListItem.role` / `UserOption.role` references in `listUsers` select
  (`userService.ts:116,132,143,149` — drop the `role: users.role` column from the select).
- Any `users_one_admin` references (already dead per the schema comment; ensure none remain).

**Add / replace:**

1. `findUserByEmail(email: string): Promise<UserRow | undefined>` —
   `db.select().from(users).where(eq(users.email, email)).limit(1)`. (Replaces the
   `findUserByGoogleId`-driven login lookup.)
2. `linkGoogleId(userId: string, googleId: string): Promise<UserRow>` — **atomic
   conditional UPDATE**: `UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL`.
   If `rowCount === 0` → a `googleId` is already set; re-read the row and if
   `row.googleId !== googleId` → `throw AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch')`,
   else return the row (concurrent first-login already linked it). Handle PG `23505`
   defensively (map to the same mismatch path). Race-safe per the plan's edge-case note.
3. `createUser({ email, fullName, displayName }): Promise<UserRow>` — applies
   `assertDomainAllowed(email)` (creation-time gate) then inserts
   `{ googleId: null, isPlatformAdmin: false, blocked: false, email, fullName, displayName }`.
4. `setPlatformAdmin(userId: string, isPlatformAdmin: boolean): Promise<UserRow>` — with
   **last-platform-admin guard**: when demoting (`true→false`),
   `SELECT count(*) FROM users WHERE is_platform_admin = true`; if `<= 1` →
   `throw AppError(ErrorCode.CONFLICT, 'Cannot demote the last platform admin')`.
   `await bumpTokenVersion(userId)` after the change. NOT_FOUND if the user row is missing.

**Keep unchanged:** `findUserById` (`:103-107`), `setUserBlocked` (`:189-205`, keep
semantics incl. `bumpTokenVersion`), `bumpTokenVersion` usage, the `Tx` type alias (`:19`).

**Update `listUsers`** to return `{ id, email, fullName, displayName, avatarUrl, isPlatformAdmin, blocked }`
(no `role`).

**References:** current first-user logic `userService.ts:26-69`; last-admin guard pattern
`userService.ts:131-137`; `bumpTokenVersion` `services/tokenVersion.ts`.

**Acceptance Criteria**
- [ ] `ADMIN_ROLE`/`MEMBER_ROLE` consts, `upsertByGoogleId`, `retryAsMemberOrRefresh`, `updateUserRole` all deleted.
- [ ] No reference to `users.role` remains in `userService.ts` (selects, inserts, updates).
- [ ] `findUserByEmail(email)` added; returns `UserRow | undefined`.
- [ ] `linkGoogleId` performs a conditional `UPDATE ... WHERE google_id IS NULL`; when zero rows updated and stored `googleId` differs → `FORBIDDEN 'Account identity mismatch'`; when stored matches → returns the row (concurrent-link-safe).
- [ ] `createUser` calls `assertDomainAllowed(email)` before insert; inserts with `googleId=null, isPlatformAdmin=false, blocked=false`.
- [ ] `setPlatformAdmin(userId, true)` promotes; `setPlatformAdmin(userId, false)` blocks demotion of the last platform admin with `CONFLICT`; both `bumpTokenVersion` after.
- [ ] `setUserBlocked` and `findUserById` unchanged in behavior.
- [ ] `listUsers` returns `isPlatformAdmin` + `displayName`, never `role`.
- [ ] No empty `catch {}` blocks; errors rethrown or surfaced via `AppError`.

**Dependencies:** Batch 1 — A (`users.isPlatformAdmin`, `users.displayName`, `googleId`
nullable), D (file already compiles). Reuses `accessControl.assertDomainAllowed`. **Task H**
consumes `findUserByEmail` + `linkGoogleId`.

**Files touched:** `backend/src/services/userService.ts`.

---

## Task H — Rewrite login gate `backend/src/routes/auth.routes.ts` `POST /google`

**Description**

Rewrite `POST /google` (`auth.routes.ts:14-62`) to a **lookup-by-email → reject-unknown →
link-googleId → reject-blocked** flow (user provisioning now happens only via bootstrap or
Member Management, never via ad-hoc Google login).

**New `POST /google` flow:**

1. `const info = await exchangeCodeForUser(code);` unchanged (`services/googleOAuth.ts` —
   still requires `email_verified === true`).
2. `const user = await userService.findUserByEmail(info.email);`
3. **Reject unknown:** `if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED, 'No account for this email');`
4. **Reject blocked:** `if (user.blocked) throw new AppError(ErrorCode.FORBIDDEN, 'Account deactivated');`
   (keep current behavior `auth.routes.ts:45`).
5. **Link `googleId` on first login:**
   - If `user.googleId === null` → `user = await userService.linkGoogleId(user.id, info.googleId);`
   - If `user.googleId !== null && user.googleId !== info.googleId` →
     `throw AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch');` (Task G's
     `linkGoogleId` also defends this; the handler-level check keeps the message path explicit).
6. **Do NOT re-check `ALLOWED_DOMAIN`** for existing users — remove the
   `findUserByGoogleId` + `assertDomainAllowed(info.email)` block (`auth.routes.ts:33-37`).
   Domain enforcement now lives only at creation paths (bootstrap, `createAndAddMember`,
   `createUser`).
7. Issue JWT with the Batch-1 claim shape (`pa: user.isPlatformAdmin`, `ver: user.tokenVersion`).

**Response shape** (`auth.routes.ts:42,:45-53` for `/google`; `auth.routes.ts:62,:72,:83`
for `/me`) — replace `role` with `isPlatformAdmin: boolean` and add `displayName`:

```ts
user: {
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  isPlatformAdmin: user.isPlatformAdmin,
}
```

**`GET /me`** (`auth.routes.ts:62-83`): keep `findUserById(req.user.id)` + re-sign JWT, but
update the response shape and the `signJwt` call to use `pa` (Batch 1). Drop `role`.

**Imports:** replace `upsertByGoogleId, findUserByGoogleId` import (`auth.routes.ts:9`) with
`findUserByEmail, findUserById, linkGoogleId` from `userService`. Remove the
`assertDomainAllowed` import (no longer used in this file).

**References:** current login flow `auth.routes.ts:14-62`; domain gate being removed
`auth.routes.ts:33-37`; blocked gate `auth.routes.ts:45`; `/me` `auth.routes.ts:62-83`.

**Acceptance Criteria**
- [ ] `POST /google` looks up the user by **email** (`findUserByEmail`), not by `googleId`.
- [ ] Unknown email → `AppError(ErrorCode.UNAUTHENTICATED, 'No account for this email')`.
- [ ] Blocked user → `AppError(ErrorCode.FORBIDDEN, 'Account deactivated')`.
- [ ] First login (`googleId === null`) → calls `linkGoogleId`; subsequent logins succeed without re-linking.
- [ ] Stored `googleId` mismatch → `AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch')`.
- [ ] `ALLOWED_DOMAIN` is **not** checked on the login path for existing users (no `assertDomainAllowed` call in this file).
- [ ] `POST /google` and `GET /me` responses return `isPlatformAdmin: boolean` and `displayName`; no `role` field anywhere in this file.
- [ ] `signJwt` calls use `pa` (Batch 1 claim), not `role`.
- [ ] `findUserByGoogleId`, `upsertByGoogleId`, `assertDomainAllowed` imports removed from `auth.routes.ts`.
- [ ] `/logout` handler behavior unchanged.
- [ ] HTTP tests: unknown email → 401; blocked → 403; first-login links `googleId` and succeeds; `googleId` mismatch → 403; existing user with wrong-domain email still logs in (domain not re-checked).

**Dependencies:** Batch 1 — D (JWT claim `role`→`pa`, `AuthenticatedUser.isPlatformAdmin`).
**Task G** (`findUserByEmail`, `linkGoogleId`) must land first or together.

**Files touched:** `backend/src/routes/auth.routes.ts`.

---

# Batch 3 — Authorization core (I, J)

## Task I — Middleware rewrites + new project-scoped gates

**Description**

Rewrite the authorization middleware layer so every project-scoped route resolves real
`project_members` rows instead of the creator-or-admin heuristic, and so the Platform-Admin
bypass + Project-Admin tier are first-class.

1. **Rename + rewrite** `backend/src/middleware/requireRole.ts` →
   `backend/src/middleware/requirePlatformAdmin.ts`:
   - Replace the Task-D placeholder with a final zero-arg `requirePlatformAdmin()` that
     gates on `req.user.isPlatformAdmin === true`.
   - On `!req.user` → `throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required')`.
   - On `isPlatformAdmin !== true` → `throw new AppError(ErrorCode.FORBIDDEN, 'This action requires Platform Admin')`.
   - Remove the Task-D `requireRole` alias; delete the old file path.
2. **Rewrite** `backend/src/middleware/requireProjectMember.ts` (`:1-44`):
   - Drop the heuristic `req.user.id === project.creatorId || req.user.role === 'ADMIN'`
     at `requireProjectMember.ts:36`.
   - Keep the `!req.user` guard (`:24-26`) and the slug lookup via `getProjectBySlug(slug)` (`:28`).
   - **Platform-Admin bypass:** if `req.user.isPlatformAdmin === true` → attach
     `req.project = project`, set `req.projectMember = null` (sentinel: "bypass, not a real
     member"), `next()`.
   - Else call `membershipService.isMember(project.id, req.user.id)`. The not-found and
     not-a-member branches must throw the **identical** non-revealing error already in use
     at `requireProjectMember.ts:30` and `:39`:
     `throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')`.
     Do not introduce a 404 anywhere.
   - On member: attach `req.project = project` and
     `req.projectMember = await membershipService.getMemberRole(project.id, req.user.id)`.
3. **New** `backend/src/middleware/requireProjectAdmin.ts`:
   - Must be mounted **after** `requireProjectMember` (depends on `req.project` +
     `req.projectMember` being set).
   - Allow when `req.user.isPlatformAdmin === true` **OR** `req.projectMember === 'PROJECT_ADMIN'`.
   - Else `throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')`
     (same non-revealing string — do not leak that the user *is* a member but lacks the tier).
4. **New slug-less resolution middleware** `backend/src/middleware/resolveProject.ts`
   exporting two factories:
   - `resolveTicketProject` — for `/api/tickets/:ticketId*`: loads the ticket via
     `ticketService.getTicket(req.params.ticketId)`, reads `ticket.projectId`, then runs
     the same membership decision as `requireProjectMember` (Platform-Admin bypass OR
     `membershipService.isMember`), attaches `req.project` (re-fetched by id) +
     `req.projectMember`, and throws the non-revealing FORBIDDEN on miss/non-member. A
     missing ticket (no row at all) remains NOT_FOUND; once the ticket row exists, the
     membership decision is FORBIDDEN (per plan §Edge Cases "non-revealing after the ticket
     is resolved").
   - `resolveLabelProject` — for `/api/labels/:id` PATCH/DELETE: loads the label via
     `labelService.getLabel(id)` (add this read if missing), reads `label.projectId`, then
     the same membership decision. Compose with `requireProjectAdmin` for write paths.
   - Both must set `req.project` (full `ProjectRow`) and `req.projectMember` so downstream
     handlers and `requireProjectAdmin` work unchanged.
   - `req.params.ticketId` / `req.params.id` are validated by the existing `ticketIdParam` /
     `labelIdParam` Zod schemas — mount `validateRequest` before these resolvers.
5. Extend `backend/src/types/express.d.ts`: declare
   `req.projectMember?: 'PROJECT_ADMIN' | 'MEMBER' | null` (Task D may have already added
   this; ensure it's present alongside `req.project?`).

**Acceptance Criteria**
- [ ] `requireRole` file no longer exists; `requirePlatformAdmin.ts` exists and exports `requirePlatformAdmin()`.
- [ ] `requireProjectMember` no longer references `creatorId` or a global `role`; it calls `membershipService.isMember` / `getMemberRole`.
- [ ] Platform Admins pass `requireProjectMember` for projects they are not members of, with `req.projectMember === null`.
- [ ] `requireProjectAdmin` permits Platform Admins and `PROJECT_ADMIN` members; rejects `MEMBER` members with the non-revealing FORBIDDEN.
- [ ] `resolveTicketProject` / `resolveLabelProject` attach `req.project` + `req.projectMember` for slug-less routes and return the non-revealing FORBIDDEN for non-members.
- [ ] No 404 is emitted from any of these middleware for a missing/hidden project; only the ticket-not-found / label-not-found cases (no row at all) remain NOT_FOUND.

**Dependencies:** Batch 1 (`membershipService` primitives, `req.projectMember` type), Batch
2 (login gate / `isPlatformAdmin` claim). **J** — agree the `getProjectBySlug` signature
contract first. None within Batch 3.

**Files touched:** `backend/src/middleware/requireRole.ts` (rename → `requirePlatformAdmin.ts`);
`backend/src/middleware/requireProjectMember.ts`; **new** `backend/src/middleware/requireProjectAdmin.ts`;
**new** `backend/src/middleware/resolveProject.ts`; `backend/src/types/express.d.ts`.

---

## Task J — Project visibility (membership-scoped + non-revealing)

**Description**

Rewrite `backend/src/services/projectService.ts` so listing and single-project reads are
membership-scoped with a Platform-Admin bypass, and so inaccessible slugs are
indistinguishable from unknown slugs.

1. `listProjects()` (`projectService.ts:59-61`) → `listProjects(userId: string, isPlatformAdmin: boolean)`:
   - `isPlatformAdmin === true` → return all projects (current behavior:
     `db.select().from(projects).orderBy(projects.createdAt)`).
   - Else → `projects` inner-join `project_members` on `userId`, ordered by `createdAt`.
     Members always see their projects regardless of `projects.isActive` (deactivation
     *behavior* is DEL-04; here we only scope). Return `ProjectRow[]`.
2. `getProjectBySlug(slug)` (`projectService.ts:64-67`) → `getProjectBySlug(slug, userId?, isPlatformAdmin?)`:
   - Resolve the row as today. If not found → return `null` **only when called without a
     user** (internal pre-checks like `createProject`'s slug-uniqueness probe at
     `projectService.ts:43-50` must still see `null` vs. conflict). When called **with**
     `userId` + `isPlatformAdmin`:
     - not found **OR** (`isPlatformAdmin === false` **AND**
       `!await membershipService.isMember(row.id, userId)`) →
       `throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')`.
     - else return the row.
   - This makes the service itself non-revealing; Task I's middleware is defense-in-depth.
3. Update internal callers that today rely on the no-arg signature:
   - `createProject`'s uniqueness pre-check (`projectService.ts:43`) → call the no-user
     overload (returns `null` for genuinely unknown slugs; uniqueness probing must not throw).
   - `updateProject` (`projectService.ts:75-79`) is only reachable after
     `requireProjectMember`/`requirePlatformAdmin` has resolved the project, so its NOT_FOUND
     can stay (the project is guaranteed to exist). Leave as-is but verify.

**Acceptance Criteria**
- [ ] A Member calling `GET /api/projects` sees only projects where they have a `project_members` row.
- [ ] A Platform Admin calling `GET /api/projects` sees all projects.
- [ ] `GET /api/projects/:slug` for an unknown slug and for a real-but-non-member slug return byte-identical FORBIDDEN envelopes (`code: FORBIDDEN`, message `'You do not have access to this project'`).
- [ ] `createProject`'s slug-conflict path (`CONFLICT`) still works because the uniqueness probe uses the no-user overload.

**Dependencies:** Batch 1 — A (`project_members` schema), F (`membershipService.isMember`).
Task I (the `requireProjectMember` rewrite calls the new signature). Can be developed in
parallel with I as long as the signature contract is agreed first.

**Files touched:** `backend/src/services/projectService.ts`.

---

# Batch 4 — Matrix enforcement (K) + Member-management API (L)

## Task K — Permission matrix sweep across all routes

**Description**

Apply the matrix to every route by composing the middleware from Task I. Replace every
`requireRole('ADMIN')` / `requireRole()` (Task-D alias) import and adapt handlers that read
`req.user.role`.

**`backend/src/routes/projects.routes.ts`:**
- `GET /` (`:14-17`) → pass `req.user!.id`, `req.user!.isPlatformAdmin` into `projectService.listProjects(...)`.
- `GET /:slug` (`:19-29`) → insert `requireProjectMember` between `authenticate` and the handler; drop the inline `if (!project) NOT_FOUND` block (`:24-28`) — the service now non-revealing-throws (Task J). The handler reads the project from `req.project`.
- `GET /:slug/board` (`:31-46`) → add `requireProjectMember`.
- `POST /:slug/tickets` (`:48-62`) and `GET /:slug/tickets/:displayId` (`:64-87`) → add `requireProjectMember` (any member manages tickets per matrix).
- `POST /` (create, `:89-103`) → replace `requireRole('ADMIN')` (`:93`) with `requirePlatformAdmin()`.
- `PATCH /:slug` (rename/columns, `:105-122`) → replace `requireRole('ADMIN')` (`:109`) with `requirePlatformAdmin()` (matrix: Create/rename → Platform Admin only).

**`backend/src/routes/tickets.routes.ts`:**
- All `:ticketId*` routes (`:8-179`) → insert `resolveTicketProject` after `validateRequest({ params: ticketIdParam })` and before the handler. Covers `GET /:ticketId`, `GET /:ticketId/activity`, `PATCH /:ticketId`, `DELETE /:ticketId`, and the timer sub-resources.
- `DELETE /:ticketId` (`:79-90`) → replace `requireRole('ADMIN')` (`:115`) with `requireProjectAdmin()` (plan §10 default: ticket soft-delete = Project Admin / Platform Admin).
- Timer stop handler `isAdmin: req.user!.role === 'ADMIN'` (`:149`) — Task D already renamed to `isPlatformAdmin`; verify it passes the correct flag to `timerService.stopTimer` (confirm whether Project Admins may close others' timers; default: pass `isPlatformAdmin` only).

**`backend/src/routes/labels.routes.ts`:**
- `GET /:slug/labels` (`:19-28`) → add `requireProjectMember`.
- `POST /:slug/labels` (`:30-42`) → replace `requireRole('ADMIN')` (`:32`) with `requireProjectAdmin()` (confirm `projectLabelsRouter` inherits `requireProjectMember` from the parent mount; if not, mount both explicitly).
- `PATCH /labels/:id` (`:44-54`) and `DELETE /labels/:id` (`:56-64`) → replace `requireRole('ADMIN')` (`:46`, `:61`) with `resolveLabelProject` + `requireProjectAdmin()`. The label row's `projectId` drives the membership decision.

**`backend/src/routes/report.routes.ts`:**
- Project-scoped `/:slug/reports/{time,tickets}` (`:27-55`) → already gated by `requireProjectMember`; keep (Task I made that gate real).
- Deprecated global `reportRouter` `GET /time` (`:60-66`) and `GET /tickets` (`:68-74`) → add `requirePlatformAdmin()` after `authenticate`.

**`backend/src/routes/users.routes.ts`:**
- `GET /` (`:18-21`) → replace `authenticate` with `authenticate, requirePlatformAdmin()` (global user list = Platform Admin only; project-scoped user picking goes through Task L's member routes).
- `PATCH /:userId/role` — already removed in Task D.
- **New** `PATCH /:userId/isPlatformAdmin` → `authenticate, requirePlatformAdmin()`, body `{ isPlatformAdmin: boolean }`. Service: `userService.setPlatformAdmin(userId, isPlatformAdmin)` (Task G — last-Platform-Admin guard + `bumpTokenVersion`).
- `PATCH /:userId/blocked` (`:42-56`) → replace `requireRole('ADMIN')` (`:46`) with `requirePlatformAdmin()`.

**Acceptance Criteria**
- [ ] `grep -rn "requireRole" backend/src` is empty.
- [ ] `grep -rn "req.user.*role" backend/src` is empty; the only role-shaped field on `req.user` is `isPlatformAdmin`.
- [ ] For each matrix row, an HTTP test asserts 2xx for the allowed tier(s) and 403 (non-revealing message) for the disallowed tier(s). (Full coverage in Task O.)
- [ ] `PATCH /users/:userId/isPlatformAdmin` demoting the last PA returns `409 CONFLICT 'Cannot demote the last platform admin'` and bumps token version on success.

**Dependencies:** Task I (all four middleware pieces), Task J (visibility signatures used in
`projects.routes` `GET /` and `GET /:slug`). Batch 2 — G (`userService.setPlatformAdmin`).

**Files touched:** `backend/src/routes/projects.routes.ts`;
`backend/src/routes/tickets.routes.ts`; `backend/src/routes/labels.routes.ts`;
`backend/src/routes/report.routes.ts`; `backend/src/routes/users.routes.ts`.

---

## Task L — Member-management routes + schema

**Description**

Greenfield `backend/src/routes/projectMembers.routes.ts` +
`backend/src/routes/projectMembers.schema.ts`, mounted under `projectsRouter` so paths are
`/api/projects/:slug/members...`.

1. **`projectMembers.schema.ts`** (Zod, co-located per `routes/<resource>.schema.ts` convention):
   - `memberRoleSchema = z.enum(['PROJECT_ADMIN', 'MEMBER'])`.
   - `addMemberBodySchema = z.object({ userId: z.string().uuid() }).or(z.object({ email: z.string().email() }))` (add existing platform user by id or email).
   - `createMemberBodySchema = z.object({ email: z.string().email(), fullName: z.string().min(1).max(200).optional(), displayName: z.string().max(100).nullable().optional(), role: memberRoleSchema.optional() })`.
   - `updateMemberRoleBodySchema = z.object({ role: memberRoleSchema })`.
   - Reuse `slugParamSchema` from `projects.schema.ts` for `:slug`; add
     `memberUserIdParamSchema = slugParamSchema.extend({ userId: z.string().uuid() })`.
2. **`projectMembers.routes.ts`** — export `projectMembersRouter`, bare-mount on
   `projectsRouter` (mirror `projectLabelsRouter` mounting at `projects.routes.ts:131`):

| Method+Path | Middleware chain | Service call |
|---|---|---|
| `GET /:slug/members` | `authenticate, requireProjectMember` | `membershipService.listProjectMembers(req.project!.id)` |
| `POST /:slug/members` (add existing) | `authenticate, requireProjectMember, requireProjectAdmin` | resolve `{userId}` or `{email}`→`userService.findUserByEmail`; `membershipService.addMember(projectId, userId, role ?? 'MEMBER')` |
| `POST /:slug/members/new` (create+add) | `authenticate, requireProjectMember, requireProjectAdmin` | `membershipService.createAndAddMember({ email, fullName, displayName, projectId, role })` (applies `assertDomainAllowed` at creation) |
| `PATCH /:slug/members/:userId/role` | `authenticate, requireProjectMember, requireProjectAdmin` | `membershipService.promoteToProjectAdmin(...)` / demote based on `body.role` |
| `DELETE /:slug/members/:userId` | `authenticate, requireProjectMember, requireProjectAdmin` | `membershipService.removeMember(projectId, userId)` |

3. **Mount** in `projects.routes.ts`: `projectsRouter.use(projectMembersRouter)` next to
   `projectLabelsRouter` / `projectReportsRouter` (`:131`, `:137`).
4. All responses use `success()`; all errors `throw new AppError(...)`. Member-not-found
   on add → `NOT_FOUND 'User not found'`. Already-a-member on add → idempotent update of
   role (per `membershipService.addMember` contract).

**Acceptance Criteria**
- [ ] A Project Admin can add an existing platform user, create+add a brand-new user (rejected with `FORBIDDEN` if the email violates `ALLOWED_DOMAIN`), promote/demote, and remove members.
- [ ] A Member (`projectMember === 'MEMBER'`) gets 403 on `POST/PATCH/DELETE` but 200 on `GET`.
- [ ] A Platform Admin can perform all of the above on any project, even without a `project_members` row.
- [ ] Zod validation rejects malformed `userId` / `email` / `role` with `VALIDATION_FAILED`.

**Dependencies:** Task I (`requireProjectMember`, `requireProjectAdmin`), Batch 1 — F
(`membershipService` full API), G (`userService.findUserByEmail`). Independent of Task K's
route sweeps except for the mount point.

**Files touched:** **new** `backend/src/routes/projectMembers.routes.ts`; **new**
`backend/src/routes/projectMembers.schema.ts`; `backend/src/routes/projects.routes.ts` (mount).

---

# Batch 5 — Frontend role migration (M)

## Task M — Frontend types / store / guard + consumer sweep

**Description**

Migrate the frontend from the global `role: 'ADMIN' | 'MEMBER'` model to
`isPlatformAdmin: boolean` (+ `displayName`), and rename the role guard primitive.

1. **`frontend/src/api/auth.ts`** (`:5-10`): `AuthResponseUser.role` → `isPlatformAdmin: boolean`;
   add `displayName: string | null`. Drop the `role` field.
2. **`frontend/src/api/users.ts`** (`:11-17`): `WorkspaceUser.role` → `isPlatformAdmin: boolean`;
   add `displayName?: string | null`. Delete `updateUserRole` (`:30-38`) and replace with
   `updatePlatformAdmin(userId, isPlatformAdmin: boolean)` hitting
   `PATCH /users/:userId/isPlatformAdmin`. Keep `setUserBlocked`. `UserOption` (`:5-9`) is
   unchanged (assignee picker shape, no role).
3. **`frontend/src/stores/useAuthStore.ts`** (`:11` `AuthUser.role`): replace with
   `isPlatformAdmin: boolean`; add `displayName?: string | null`. Keep `name` (maps from `fullName`).
4. **Rename** `frontend/src/hooks/useRequireRole.ts` → `useRequirePlatformAdmin.ts`:
   - Replace `useRequireRole(...allowedRoles: Role[])` (`:9-14`) with
     `useRequirePlatformAdmin(): boolean` returning `!!useAuthStore((s) => s.user?.isPlatformAdmin)`.
   - Delete the `Role` type export (`:3`).
5. **Rename** `frontend/src/components/RequireRole.tsx` → `RequirePlatformAdmin.tsx`:
   - Drop the `role` prop (`:8-10`); render `<ForbiddenPage />` when
     `!useRequirePlatformAdmin()`, else `<Outlet />` (`:13-19`).
6. **Consumer sweep** (every site flagged by the grep in the codebase analysis):
   - `frontend/src/routes/index.tsx:102` — `<RequireRole role="ADMIN">` → `<RequirePlatformAdmin />`.
   - `frontend/src/pages/ProjectsPage.tsx:17` — `useRequireRole('ADMIN')` → `useRequirePlatformAdmin()`; rename local `isAdmin` → `isPlatformAdmin`; update gate at `:70`/`:100`.
   - `frontend/src/pages/ProjectSettingsPage.tsx:30` — same rename; update gate at `:56`.
   - `frontend/src/components/ProjectPicker.tsx:53,176` — same rename.
   - `frontend/src/components/TopNav.tsx:56,104,238` — `ADMIN_NAV_LINKS`; `useRequireRole('ADMIN')` → `useRequirePlatformAdmin()`; Settings link gate.
   - `frontend/src/components/TicketDetailModal.tsx:41,191` — delete-button gate → `useRequirePlatformAdmin()` (project-admin tier isn't knowable client-side from the JWT; show the button when `isPlatformAdmin` — the server still enforces `requireProjectAdmin` and returns 403 otherwise, surfaced by Task N).
   - `frontend/src/pages/SettingsPage.tsx` — rewrite around `isPlatformAdmin` (`:32,41-42,56,92-99,167,198,207,290-291`). Replace promote/demote admin UI with a Platform-Admin toggle calling `updatePlatformAdmin`. Keep last-admin guard logic but count `isPlatformAdmin` rows.
   - `frontend/src/pages/LoginPage.tsx:28` — map `isPlatformAdmin` (+ `displayName`) into the store instead of `role`.
   - `frontend/src/hooks/useAuthSync.ts:22` — read `isPlatformAdmin` + `displayName` from `/auth/me`.
   - `frontend/src/hooks/useUserManagement.ts:9-11` — swap `updateUserRole` for `updatePlatformAdmin`; adjust mutation signature.
   - `frontend/src/lib/queryClient.ts:39` — update the 403/role-demotion comment (now 403 = project-access or PA-only).
7. Update `frontend/src/api/client.ts` only if needed for type-only reasons; the 403 UX work is Task N.

> Carefully distinguish the HTML/ARIA `role="..."` attribute (unrelated — do **not** touch)
> from the auth `role` field being renamed.

**Acceptance Criteria**
- [ ] `grep -rn "useRequireRole\|RequireRole\b" frontend/src` returns **zero** matches outside test files.
- [ ] `grep -rn "\.role\b\|'ADMIN'\|'MEMBER'" frontend/src` returns **zero** matches outside test files (Task O) and ARIA `role="..."` attributes.
- [ ] `AuthUser`, `AuthResponseUser`, `WorkspaceUser` all carry `isPlatformAdmin: boolean`; `displayName` flows end-to-end.
- [ ] The app builds (`tsc --noEmit` / `npm run build`) with no `role`-shaped type errors.
- [ ] A PA sees the admin-only chrome (ProjectPicker create button, ProjectsPage create button, SettingsPage management, ProjectSettings save button); a non-PA does not.

**Dependencies:** Task K (the `/users/:userId/isPlatformAdmin` endpoint + `isPlatformAdmin`
on `/auth/me` and `/users` responses must exist). Frontend-only otherwise. The
breaking-change risk means M + K + L must land in the same release.

**Files touched:** `frontend/src/api/auth.ts`; `frontend/src/api/users.ts`;
`frontend/src/stores/useAuthStore.ts`; `hooks/useRequireRole.ts` → `useRequirePlatformAdmin.ts`;
`components/RequireRole.tsx` → `RequirePlatformAdmin.tsx`; `routes/index.tsx`;
`pages/{ProjectsPage,ProjectSettingsPage,SettingsPage,LoginPage}.tsx`;
`components/{ProjectPicker,TopNav,TicketDetailModal}.tsx`; `hooks/{useAuthSync,useUserManagement}.ts`;
`lib/queryClient.ts`.

---

# Batch 6 — Frontend 403 UX + Member-Management UI (N)

## Task N — Shared 403 handler + member-management UI

**Description**

1. **Shared non-revealing 403 UX** in `frontend/src/api/client.ts`:
   - Today only `ReportsPage.tsx:64,77-79` handles 403. With project/board routes now
     membership-gated, add a consistent handler: when
     `ApiClientError.status === 403` (and `code === 'FORBIDDEN'`) on a project-scoped
     request, surface the server's non-revealing message
     (`'You do not have access to this project'`) and redirect to `/projects`.
   - Implement as either a global handler in `apiFetch` (post-refresh path,
     `client.ts:97-115`) or a `<RequireProjectAccess>` wrapper component mounted on
     project routes in `routes/index.tsx`. Keep the 401 interceptor (`client.ts:74-95`) unchanged.
   - Ensure project boards that 403 do *not* trigger the 401 refresh cycle (refresh only
     fires on 401).
2. **`frontend/src/api/members.ts`** (new): `listMembers(slug)`, `addMember(slug, body)`,
   `createAndAddMember(slug, body)`, `updateMemberRole(slug, userId, role)`,
   `removeMember(slug, userId)` — typed against the Task L response shapes.
3. **`frontend/src/hooks/useProjectMembers.ts`** (new): TanStack Query hooks —
   `useProjectMembers(slug)` (list, 30s stale like board), `useAddMember`,
   `useCreateAndAddMember`, `useUpdateMemberRole`, `useRemoveMember`. Invalidate on success.
4. **`frontend/src/pages/ProjectMembersPage.tsx`** (new) — or a panel inside
   `ProjectSettingsPage.tsx` (decide based on the existing settings layout): list members
   with role badges, add-existing (by email/id), create-new-user (by email + optional name),
   promote/demote, remove. Gate the management controls on
   `useRequirePlatformAdmin() || projectMember === 'PROJECT_ADMIN'` (derive the
   project-admin flag from the `GET /:slug/members` response's current-user row via a
   `useCurrentProjectMembership` hook).
5. **Route** `/projects/:slug/members` under `RequireAuth`. Add nav link in
   `ProjectSettingsPage` / sidebar.

**Acceptance Criteria**
- [ ] A 403 on `/api/projects/:slug*` shows the non-revealing message and bounces to `/projects`; no 404 flash, no 401-refresh loop.
- [ ] A Project Admin / Platform Admin can fully manage members through the UI; a Member sees the read-only roster.
- [ ] Adding a brand-new user with a wrong-domain email shows the server's `FORBIDDEN` domain error inline.

**Dependencies:** Task L (member API), Task M (frontend `isPlatformAdmin` plumbing), Task K
(matrix gives the 403s the handler reacts to).

**Files touched:** `frontend/src/api/client.ts`; **new** `frontend/src/api/members.ts`;
**new** `frontend/src/hooks/useProjectMembers.ts`; **new**
`frontend/src/pages/ProjectMembersPage.tsx`; `frontend/src/routes/index.tsx`;
`frontend/src/pages/ProjectSettingsPage.tsx` (nav link, optional panel).

---

# Batch 7 — Tests (O)

## Task O — Backend + frontend test migration + matrix coverage

**Description**

Update every test broken by the rename and add matrix + member-management coverage. Follow
project convention: Vitest + supertest (backend), Vitest + Testing Library (frontend),
table-driven, co-located `*.test.ts(x)`.

1. **Backend unit tests:**
   - **new** `membershipService.test.ts` — member/non-member, role lookup, add (idempotent
     on `23505`), remove, promote/demote, `createAndAddMember` applies `assertDomainAllowed`
     and is transactional.
   - **new** `bootstrapService.test.ts` — idempotent create, idempotent promote,
     domain-mismatch `process.exit(1)`, skip-when-env-unset.
   - `userService.test.ts` — `findUserByEmail`, `linkGoogleId` (atomic conditional update +
     mismatch rejection), `createUser` domain gate, `setPlatformAdmin` last-PA guard.
     Remove `upsertByGoogleId`/`updateUserRole` tests (`:12,17-23,135-211`).
   - Update `middleware/requireProjectMember.test.ts` (`:33,50,65,80`) to the real
     membership model (no `creatorId`/`role` fixtures).
2. **Backend HTTP tests (supertest), table-driven over the route inventory:**
   - A route-inventory array
     `[{ method, path, body, allowedTiers: ['PA'|'PROJECT_ADMIN'|'MEMBER'], setup }]`
     looped with `forEach` asserting 2xx for allowed tiers and 403 (non-revealing message)
     for others. Cover at minimum:
     - `POST /api/projects` (PA only), `PATCH /api/projects/:slug` (PA only).
     - `GET /api/projects/:slug`, `GET /api/projects/:slug/board`, `POST /api/projects/:slug/tickets`, `GET /api/projects/:slug/tickets/:displayId` (any member).
     - `GET/PATCH/DELETE /api/tickets/:ticketId` (member; DELETE → PROJECT_ADMIN/PA).
     - `GET /api/projects/:slug/labels` (member); `POST /api/projects/:slug/labels`, `PATCH/DELETE /api/labels/:id` (PROJECT_ADMIN/PA).
     - `GET /api/users`, `PATCH /api/users/:userId/isPlatformAdmin`, `PATCH /api/users/:userId/blocked` (PA only).
     - Deprecated `GET /api/reports/{time,tickets}` (PA only).
   - Login-gate tests: unknown email → 401; blocked → 403; first-login links `googleId`;
     existing `googleId` mismatch → 403; domain **not** re-checked for existing users.
   - Member routes (Task L): add existing, create-new-user (domain gate), promote, remove.
   - **Non-revealing assertion:** `GET /api/projects/:slug` for unknown slug and for
     real-but-non-member slug return **identical** JSON bodies (deep-equal) — preserves the
     anti-oracle intent of `report.routes.test.ts:150`.
3. **Frontend tests** — migrate fixtures:
   - `App.test.tsx:78`, `ProjectsPage.test.tsx:83,128`, `ProjectSettingsPage.test.tsx:29,60-61,83,107,111,158`, `TicketDetailModal.test.tsx:61-66,360,367,376,383`, `ProjectPicker.test.tsx:12-13,23,75,212,220`, `LoginPage.test.tsx:34,106`, `RequireAuth.test.tsx:25`, `useAuthStore.test.ts:10,41`, `api/auth.test.ts:21`, `api/client.test.ts:11,60`, `api/auth.logout-loop.test.tsx:50,57`, `TopNav.test.tsx:39,298-327` — replace `role: 'ADMIN'|'MEMBER'` with `isPlatformAdmin: boolean` (+ `displayName`); rename `useRequireRole` mocks to `useRequirePlatformAdmin`.
   - **new** `ProjectMembersPage.test.tsx` — render roster, add flow, promote/demote, remove, PA/Project-Admin gating.
   - **new** `client.403.test.ts` — assert the shared handler redirects to `/projects` on a project-scoped 403 and does not invoke the 401 refresh.

**Acceptance Criteria**
- [ ] `npm test -w backend` and `npm test -w frontend` both pass with zero references to the old `role` enum.
- [ ] The matrix table-driven test fails if any route's middleware chain regresses (commit it as a regression guard).
- [ ] Business-logic coverage on `membershipService`, `bootstrapService`, `userService.setPlatformAdmin` ≥ 80%.
- [ ] The non-revealing deep-equal assertion is present and green.

**Dependencies:** Tasks I, J, K, L (backend coverage), M, N (frontend coverage). Lands last.

**Files touched:** `backend/src/**/*.test.ts` (updates + new `membershipService.test.ts`,
`bootstrapService.test.ts`); `frontend/src/**/*.test.tsx` (updates + new
`ProjectMembersPage.test.tsx`, `client.403.test.ts`).

---

## Resolved Decisions (binding — confirmed by product owner)

- **Project rename by Project Admin?** → **No. Platform Admin only.** Task K's Platform-Admin-only `PATCH /:slug` is correct as written.
- **Ticket deletion tier?** → **Project Admin or Platform Admin.** Task K's default (`DELETE /api/tickets/:id` → Project Admin / Platform Admin) is correct as written.
- **Platform-admin promotion UI?** → **Confirmed — implement it.** Task K keeps `PATCH /:userId/isPlatformAdmin` (Platform Admin only, last-admin guard) and Task N keeps the frontend PA promote/demote UI wired to it.
- **Deprecated global `/api/reports/*`:** → **Keep gated to Platform Admin within SLYK-01.** Making reports **project-scoped** is a separate, deferred deliverable — see `docs/deliverables/SLYK-16.md`. Do NOT refactor report scoping in this ticket.
- **Seed/dev fixtures:** → **Seed EXACTLY ONE Platform Admin, nobody else.** Task B updated accordingly (single `project_members` row: the PA as `PROJECT_ADMIN`).

## Out of Scope (from plan)

- Project deactivation *behavior* (DEL-04) — Task A only adds the `projects.isActive` column.
- UI polish / full member-management design beyond a functional MVP page (Task N).
- Audit logging of membership changes.
- Any data migration from the old `role` enum (chain discarded — Task B).
