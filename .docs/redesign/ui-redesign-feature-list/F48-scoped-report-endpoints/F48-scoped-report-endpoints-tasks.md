# F48 — Project-scoped report endpoints + deprecate old routes: Plan + Task Breakdown

> **Feature:** F48 — Project-scoped report endpoints + deprecate old routes (Phase 4 — Backend: project-scoped Reports, unblocks F49)
> **Feature index:** [`../ui-redesign-features.md`](../ui-redesign-features.md) (lines 348-362)
> **Slug:** `SLYK` · **Depends on:** F47 (done — `requireProjectMember` landed Path B) · **PRD ref:** §4.6, §5 (T5.1/T5.3/T5.4)
> **Sources:** [`../ui-redesign-features.md`](../ui-redesign-features.md), [`../../ui-redesign-plan.md`](../../ui-redesign-plan.md) (§5.2), the project rules (`js-style-guide.md`, `js-testing-rules.md`, `js-development-rules.md`, `git-guidelines.md`, `persona.md`), and direct codebase analysis of `reportService.ts`, `report.routes.ts`, `projects.routes.ts`, `requireProjectMember.ts`.

---

## 1. F48 Recap

**Goal:** Ship the project-scoped Reports API the PRD §4.6 calls for: `GET /api/projects/:slug/reports/time` and `GET /api/projects/:slug/reports/tickets`, each aggregating **only that project's** data, gated by F47's `requireProjectMember` (creator-or-admin). The existing global `/api/reports/*` routes are deprecated (present but log a warning) per D2's "deprecate-one-release" default — removal is a follow-up ticket owned by F49/F50.

**Ships:**
- `reportService.getTimeReport` and `getTicketSummary` gain an optional `projectId?: string` filter; every WHERE clause / join is scoped when provided.
- A new `projectReportsRouter` defining `/:slug/reports/time` and `/:slug/reports/tickets`, mounted on `projectsRouter` (mirrors the `projectLabelsRouter` bare-mount pattern at `projects.routes.ts:144`).
- The old `reportRouter` (`/api/reports/*`) keeps working but logs `console.warn('[DEPRECATED] ...')` per handler.
- Co-located route tests: scoped aggregation passes the right `projectId`; non-member → 403; old route still works (backward compat); 401/400/validation cases.

**Acceptance (definition of done):**
- Scoped endpoints mirror the existing response shape (`{ data: { users, window } }`); service signatures become `{ period, offset, projectId? }`.
- `authenticate` + `requireProjectMember` applied (membership gate's first real consumer — F47 shipped the middleware but mounted nothing).
- Non-member → 403; scoped aggregation returns only the project's tickets/time.
- Old routes present-but-deprecated (per-handler `console.warn`); no removal in this release.
- Backend tests green: scoped aggregation correctness, non-member 403, old-route backward compat.

**Edge cases resolved up front:**
- **D2 keep-vs-remove:** deprecate-one-release (default). Old handlers stay, log a warning, and forward to the service **without** `projectId` (global aggregation, old behavior). Removal is filed as a follow-up — F49's FE redirect lands regardless.
- **Window math untouched:** period/offset UTC window computation (`computeWindowStart`/`computeWindowEnd`/`formatWindowLabel`) is unchanged. Only the project filter is added — the window itself is project-independent.
- **Backward compat:** without `projectId`, both service functions aggregate globally as before. The old routes rely on this.
- **No DB migration:** `tickets.projectId` already exists (`schema.ts`); `timeEntries` has no `projectId` column, so time scoping joins `timeEntries → tickets` on `ticketId` and filters `tickets.projectId`.
- **Done-column derivation in `getTicketSummary`:** today loads ALL projects to build a global `doneColumnIds` set. Scoped, this collapses to reading `req.project.columns` directly (the gate already attached it) — no DB query needed for step 1 when `projectId` is provided.

---

## 2. Codebase Analysis Summary

- **State:** The service and routes exist (F23/F24) but aggregate globally with no project filter. F47's `requireProjectMember` is landed but unmounted — F48 is its first mount site. No report tests exist today.

- **Existing structure this feature builds on:**
  - **`reportService.ts`** — exports `getTimeReport({period, offset})` and `getTicketSummary({period, offset})`. Window helpers (`computeWindowStart` UTC Monday/1st, `computeWindowEnd` +7d/+1mo, `formatWindowLabel`) are project-agnostic. Time query: `select(...).from(timeEntries).leftJoin(users,...)` filtered by `[startTime, endTime)` + `isNotNull(endTime)` — aggregates per-user `totalMs` in JS. Ticket query: loads all projects to build `doneColumnIds`, then `select(...).from(tickets).leftJoin(assignee)` filtered by `[updatedAt, ...)` + `isNull(deletedAt)` + `isNotNull(assigneeId)`, filters `doneColumnIds.has(statusColumn)` in JS, aggregates per-user `TicketCountByPriority`.
  - **`report.routes.ts`** — `reportRouter` mounted at `/api/reports` (`index.ts:83`). Two `authenticate`-only GET handlers; inline `period`/`offset` query parsing (`period` defaults `'weekly'`, `offset` defaults `0`); response `success(report)` → `{ data: { users, window } }`.
  - **`projects.routes.ts`** — `projectsRouter` at `/api/projects`. Sub-router pattern: `projectLabelsRouter` defines full `/:slug/labels` paths and bare-mounts via `projectsRouter.use(projectLabelsRouter)` (line 144). **F48 mirrors this exactly** with `projectReportsRouter`.
  - **`requireProjectMember.ts` (F47)** — runs after `authenticate`, reads `req.params.slug`, resolves via `getProjectBySlug`, checks `req.user.id === project.creatorId || req.user.role === 'ADMIN'` (Path B), attaches **`req.project = project`** (full `ProjectRow`, incl. `.id` + `.columns`), else throws `FORBIDDEN` with message `"You do not have access to this project"`. Unknown-slug and non-member share one message (anti-oracle).
  - **`projects.schema.ts`** — `slugParamSchema` (`/^[A-Z][A-Z0-9]{1,15}$/`, 2-16 chars) is the `:slug` validator.
  - **Schema:** `tickets` has `projectId uuid NOT NULL → projects.id`. `timeEntries` has `ticketId → tickets.id` (no direct `projectId`). `projects.columns` is jsonb `Column[]`; the last column is the "Done" column by convention.

- **Prior art:** None for scoped reports. The `projectLabelsRouter` bare-mount is the precise precedent for project-scoped sub-routers.

- **File paths this feature touches:**
  - `backend/src/services/reportService.ts` — EDIT: add `projectId?` to both signatures; scope WHERE/joins.
  - `backend/src/routes/report.routes.ts` — EDIT: add a `projectReportsRouter` (or co-locate); add deprecation `console.warn` to old handlers; mount on `projectsRouter`.
  - `backend/src/routes/projects.routes.ts` — EDIT: import + `projectsRouter.use(projectReportsRouter)`.
  - `backend/src/routes/report.routes.test.ts` — NEW: co-located route tests.

- **Project rules:**
  - `js-style-guide.md` — 2-space indent `.ts`, early returns, async/await, no `any`, `AppError` error handling, import order (external → internal → types).
  - `js-testing-rules.md` — Vitest, co-located `*.test.ts`, `vi.fn()` mocks, table-driven preferred.
  - `js-development-rules.md` — RESTful, parameterized queries (Drizzle — no string SQL), middleware composition.
  - `git-guidelines.md` — `SLYK-F48:` commit prefix, single-line message, rebase-and-merge only.

- **Hidden coupling:**
  - **F49 depends on F48's endpoint shape + 403.** FE catches `ErrorCode.FORBIDDEN` from `requireProjectMember` and redirects to `/projects`. The scoped response shape must equal the old shape so F49's `useReport` swap is a URL change, not a payload change.
  - **`getTicketSummary`'s "load all projects" step** is the one place scoping changes more than a WHERE clause — when `projectId` is set, read `doneColumnIds` from `req.project.columns` directly (the gate attached it). The service can't read `req`, so it accepts the resolved project row's column list OR re-derives from the single project. Simplest: when `projectId` provided, query only that one project's columns (single-row `select`). Keeps the service `req`-free.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Service signature | **`{ period, offset, projectId? }`** on both functions. Optional — absent = global (old behavior). | Minimal blast radius: old routes call without `projectId` and keep working. Scoped routes pass `req.project.id`. Spec line 362 calls this out explicitly. |
| D2 | Old global routes | **Deprecate-one-release (default).** Keep mounted at `/api/reports`, add `console.warn('[DEPRECATED] Global /reports/time used — use /projects/:slug/reports/time instead.')` at the top of each handler. Do NOT remove. | Spec D2 default. Prevents breaking the live FE (F49 not yet landed) and any external consumers. Removal is a follow-up ticket. |
| D3 | Scoped route mount | **New `projectReportsRouter` bare-mounted on `projectsRouter`** via `projectsRouter.use(projectReportsRouter)`, routes defined as `/:slug/reports/time` + `/:slug/reports/tickets`. | Exact mirror of `projectLabelsRouter` (line 144). Keeps all project-scoped routes composed the same way; no special-case mounting logic. |
| D4 | Middleware chain (scoped) | **`authenticate, validateRequest({params: slugParamSchema}), requireProjectMember, handler`**. | `authenticate` sets `req.user`; `validateRequest` guards slug format FIRST (a malformed slug is a 400 VALIDATION_FAILED, not a hidden 403); `requireProjectMember` then resolves the validated slug + sets `req.project`. Validation-before-membership matches the convention that input shape errors surface as 400s before any business-logic/lookup denial. (Initial draft had membership before validation; the lowercase-slug test caught this — a bad-format slug hit the membership gate and returned 403 instead of 400. Reordered.) |
| D5 | Time-report scoping | **Join `timeEntries → tickets` on `ticketId`, filter `tickets.projectId = projectId`.** `timeEntries` has no `projectId` column. | Only way to scope time by project without a migration. The join is a cheap indexed FK lookup. |
| D6 | Ticket-summary Done-column derivation | **When `projectId` provided: query only that one project's columns (`select().from(projects).where(eq(projects.id, projectId)).limit(1)`), build `doneColumnIds` from its last column.** When absent: keep the load-all-projects behavior. | Avoids reading `req` inside the service (stays `req`-free). Single-row query is cheaper than the global scan it replaces. Preserves backward compat. |
| D7 | `projectId` source in handler | **`req.project.id`** (set by `requireProjectMember`). Never re-resolve the slug in the handler. | The gate already paid the lookup cost; `req.project.id` is the canonical PK. Re-resolving would double the queries. |
| D8 | Deprecation log mechanism | **`console.warn(...)`** with a stable `[DEPRECATED]` prefix per handler invocation. | Spec says "header/log warning." A response header would require a per-response write in each handler; `console.warn` is simpler and shows in server logs (where deprecation tracking belongs). Matches the spec's "log warning" phrasing. |
| D9 | TypeScript | **`.ts`** throughout. | Repo convention: zero `.js` source in `backend/src`. |
| D10 | Scoped query parsing | **Reuse the exact inline parsing from the old handlers** (`period` `'weekly'`/`'monthly'` default `'weekly'`; `offset` `parseInt` default `0`). No Zod on query (matches existing behavior; Zod guards params only). | Behavioral parity between scoped and global routes. If we Zod the query later, do it for both in one pass (out of F48 scope). |

---

## 4. Architecture Overview (Target Tree)

```
backend/
  src/
    services/
      reportService.ts          # EDIT: add projectId? to both fns; scope WHERE/joins (D1, D5, D6)
    routes/
      report.routes.ts          # EDIT: export projectReportsRouter; add deprecation warns to old handlers (D2, D3, D8)
      report.routes.test.ts     # NEW: scoped agg, non-member 403, old-route backward compat
      projects.routes.ts        # EDIT: import + projectsRouter.use(projectReportsRouter) (D3)
```

**Request lifecycle (scoped route):**
```
GET /api/projects/:slug/reports/time?period=weekly&offset=0
  → authenticate            (sets req.user = { id, email, role })
  → validateRequest(params) (slugParamSchema — 400 on bad slug format)
  → requireProjectMember    (resolves slug → project; creator||admin? → req.project; else 403)
  → handler                 (parse period/offset; reportService.getTimeReport({ period, offset, projectId: req.project.id }))
  → success(report)         → { data: { users, window } }
```

**Old route (deprecated, unchanged behavior):**
```
GET /api/reports/time
  → authenticate
  → handler (console.warn('[DEPRECATED] ...'); reportService.getTimeReport({ period, offset }) /* no projectId = global */)
```

---

## 5. Parallelization Strategy

F48 is small and tightly coupled (the service change, the route mount, and the tests all reference each other). It is a **single-developer, sequential** feature — no parallel batches. Tasks are ordered by dependency.

### Dependency diagram

```
T1 (service: add projectId)  →  T2 (routes: scoped + deprecate + mount)  →  T3 (tests)  →  T4 (gates)
```

- **T1 → T2:** T2's scoped handlers call `getTimeReport({ ..., projectId: req.project.id })` — the param must exist on the signature first or T2 won't typecheck.
- **T2 → T3:** T3 tests hit the mounted scoped routes; they must exist.
- **T3 → T4:** gates run against the merged result.

### Summary table

| # | Target files | Depends on | Can parallel with |
|---|--------------|------------|-------------------|
| **T1** | `backend/src/services/reportService.ts` | F47 (done) | — |
| **T2** | `backend/src/routes/report.routes.ts`, `backend/src/routes/projects.routes.ts` | T1 | — |
| **T3** | `backend/src/routes/report.routes.test.ts` | T1, T2 | — |
| **T4** | (no files — gate verification) | T1-T3 | — |

### Developer assignment

- **Solo:** T1 → T2 → T3 → T4. Sub-half-day; single commit `SLYK-F48:`.

---

## 6. Tasks

### T1 — Add `projectId` filter to `reportService`

**Depends on:** F47 (done) · **Parallel with:** —

**Description:** Add an optional `projectId?: string` to both `getTimeReport` and `getTicketSummary`. When provided:
- `getTimeReport`: join `timeEntries → tickets` on `ticketId`, add `eq(tickets.projectId, projectId)` to the WHERE clause.
- `getTicketSummary`: (a) step-1 "Done column" derivation queries only the single project instead of all projects; (b) add `eq(tickets.projectId, projectId)` to the ticket query.

When absent, behavior is unchanged (global aggregation — backward compat for the deprecated routes).

**Acceptance Criteria:**
- [ ] Both signatures accept `projectId?: string`; absent preserves the exact current behavior.
- [ ] `getTimeReport` with `projectId` joins `tickets` and filters `tickets.projectId`; duration aggregation logic unchanged.
- [ ] `getTicketSummary` with `projectId` derives `doneColumnIds` from only that project's columns and filters the ticket query by `projectId`.
- [ ] No `any`; Drizzle `eq`/`and` only (no raw SQL).
- [ ] `npm run -w backend typecheck` clean.

**Dependencies:** F47 (landed).

---

### T2 — Scoped report routes + deprecate old + mount

**Depends on:** T1 · **Parallel with:** —

**Description:** Create a `projectReportsRouter` exporting two routes (`/:slug/reports/time`, `/:slug/reports/tickets`), each with chain `authenticate, requireProjectMember, validateRequest({params: slugParamSchema}), handler`. Handlers parse `period`/`offset` identically to the old ones and call the service with `projectId: req.project.id`. Mount on `projectsRouter` via `projectsRouter.use(projectReportsRouter)` (mirror `projectLabelsRouter`). Add a `console.warn('[DEPRECATED] ...')` at the top of each old global handler.

**Acceptance Criteria:**
- [ ] `projectReportsRouter` exported from `report.routes.ts`; two GET routes with the correct middleware chain (`authenticate, validateRequest, requireProjectMember, handler` — validation before membership).
- [ ] Scoped handlers pass `projectId: req.project.id` to the service; never re-resolve the slug.
- [ ] `projectsRouter.use(projectReportsRouter)` added in `projects.routes.ts` (after the labels mount or alongside).
- [ ] Old `/api/reports/time` and `/api/reports/tickets` still mounted; each handler logs `[DEPRECATED]` via `console.warn` and calls the service **without** `projectId` (global).
- [ ] Response shape identical: `{ data: { users, window } }`.
- [ ] `npm run -w backend typecheck` clean.

**Dependencies:** T1.

---

### T3 — Report route tests

**Depends on:** T1, T2 · **Parallel with:** —

**Description:** Create `backend/src/routes/report.routes.test.ts` following the `projects.routes.test.ts` pattern (supertest + `vi.mock` the service + tokenVersion + projectService). Cases:

**Scoped `/:slug/reports/time` and `/:slug/reports/tickets`:**
| Case | Role | getProjectBySlug | Expected |
|------|------|------------------|----------|
| member (creator) → 200 + scoped data | MEMBER | project (creatorId=u1) | 200; service called with `{ projectId: 'p1', period: 'weekly', offset: 0 }` |
| admin → 200 + scoped data | ADMIN | project | 200; service called with `projectId` |
| non-member → 403 | MEMBER | project (creatorId='other') | 403 FORBIDDEN; report service NOT called |
| unknown slug → 403 | MEMBER | null | 403 FORBIDDEN; report service NOT called |
| no bearer → 401 | — | (not called) | 401 UNAUTHENTICATED |
| invalid slug format (lowercase) → 400 | MEMBER | (not called) | 400 VALIDATION_FAILED |
| `period=monthly&offset=-1` forwarded | MEMBER | project | service called with `{ projectId, period: 'monthly', offset: -1 }` |

**Old global `/api/reports/time` and `/api/reports/tickets` (backward compat):**
| Case | Expected |
|------|----------|
| authed → 200 | 200; service called **without** `projectId` (i.e. `{ period: 'weekly', offset: 0 }`) |
| no bearer → 401 | 401 UNAUTHENTICATED |

**Acceptance Criteria:**
- [ ] Scoped agg test asserts the service receives `projectId: 'p1'` (the membership gate's attached id).
- [ ] Non-member and unknown-slug both → 403; report service NOT called (membership gate short-circuits).
- [ ] Old routes still return 200 and call the service **without** `projectId`.
- [ ] `period`/`offset` query parsing forwarded correctly in both scoped and global paths.
- [ ] All tests green; `vi.clearAllMocks()` in `beforeEach`.

**Dependencies:** T1, T2.

---

### T4 — Gates: typecheck, test, build

**Depends on:** T1-T3 · **Parallel with:** —

**Description:** Terminal verification gate.

Steps:
1. `cd backend && npm run typecheck` — zero errors.
2. `cd backend && npm test` — `report.routes.test.ts` green; no regressions in existing suites.
3. `cd backend && npm run build` — compiles cleanly.
4. Confirm old `/api/reports/*` still serves (test covers it) and new scoped routes serve (test covers them).

**Acceptance Criteria:**
- [ ] `tsc --noEmit` exit 0.
- [ ] vitest exit 0 (new + existing suites).
- [ ] build exit 0.
- [ ] No new lint violations on touched files.

**Dependencies:** T1-T3.

---

## 7. Final F48 Acceptance Checklist

- [ ] `reportService.getTimeReport` / `getTicketSummary` accept `projectId?`; scoped WHERE/joins correct; absent = global (backward compat).
- [ ] `GET /api/projects/:slug/reports/time` and `/:slug/reports/tickets` mounted; chain `authenticate, requireProjectMember, validateRequest`; pass `req.project.id`.
- [ ] Old `/api/reports/*` present + `console.warn('[DEPRECATED] ...')` per handler; call service without `projectId`.
- [ ] Non-member → 403; unknown slug → 403 (same message — anti-oracle preserved by F47).
- [ ] Response shape `{ data: { users, window } }` unchanged on all four endpoints.
- [ ] Route tests green: scoped agg, non-member 403, old-route backward compat, query-param forwarding.
- [ ] typecheck + test + build all exit 0.

**Integration record:**
- Feature commit SHA: `________`
- Scoped endpoint paths: `GET /api/projects/:slug/reports/{time,tickets}`
- Deprecation prefix logged: `[DEPRECATED]`
- typecheck/test/build exit codes: `0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**None.** `tickets.projectId` already exists. `timeEntries` scoping is done via a join to `tickets` (no new column, no migration). This satisfies the spec's "NO DB migration" constraint.
