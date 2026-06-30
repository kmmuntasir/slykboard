# Task Breakdown — SLYK-16

**Plan:** `docs/deliverables/SLYK-16-plan.md`
**Ticket:** `docs/deliverables/SLYK-16.md`
**Title:** Project-Scoped Reports — retire the deprecated global `/api/reports/*` surface and tighten `reportService` so `projectId` is required.
**Generated:** 2026-06-30

> Scope reminder: **backend-only** source changes + test updates. **Frontend is already
> project-scoped** (verified) — no UI code change; a grep-verification pass only. No
> Drizzle schema change / migration required.

---

## Parallelization Strategy

Three batches, ordered by a hard build/test gate at each boundary. Inside a batch,
tasks touch **disjoint files** → they run in parallel with **zero merge conflicts**.
A batch may only start once the previous batch is fully merged **and** green.

### Merge-order rules

1. **Batch 1 → must merge before Batch 2.** Batch 2 tests assert the *new* contract
   (global routes gone, `projectId` required); they are meaningless against the
   pre-Batch-1 code.
2. **Within Batch 1, order matters (compile interdependency):**
   - **T1 (`report.routes.ts`) + T2 (`index.ts`) must merge BEFORE T3
     (`reportService.ts`)** — or all three land in one atomic merge.
   - *Why:* T3 makes `projectId` a **required** param. The deprecated global
     handlers deleted in T1 (`report.routes.ts:91,:99`) call the service *without*
     `projectId`; if T3 merges while those handlers still exist, `tsc` fails. Once
     T1 deletes them, T3 compiles clean. (T1/T2 alone are green at every
     intermediate — the service still treats `projectId` as optional.)
3. **Batch 2 → fully merged & green before Batch 3.** Batch 3 is read-only
   verification over the frozen Batch 1+2 artifact; it is the merge-readiness gate.
4. **Batch 3 contains no source edits.** If a Batch-3 check fails, the fix belongs
   to Batch 1 (T8/T9 build/route-absence failures) or Batch 2 (T8 test failures),
   not Batch 3.

### Visual batch diagram

```
                  SLYK-16 -- retire global /api/reports/*, require projectId
 =================================================================================
 BATCH 1 -- backend source edits (DISJOINT FILES -> parallel)        [merge first]
 +--------------------------+ +---------------------+ +------------------------+
 | T1  report.routes.ts     | | T2  index.ts        | | T3  reportService.ts   |
 | delete reportRouter;     | | drop import :24 +   | | projectId REQUIRED;    |
 | drop requirePlatformAdmin| | mount   :85         | | delete global branches |
 | import (now unused)      | |                     | | (:90-92,:104,:107-114, |
 |                          | |                     | |  :171-178,:189-197)    |
 +------------+-------------+ +----------+----------+ +-----------+------------+
              |   (disjoint files -> no merge conflict)            |
              +-----------------------+---------------------------+
                                      |
                          MERGE-ORDER RULE:
                          T1 + T2 merge BEFORE T3
                          (else tsc breaks: T3 requires projectId
                           while T1's deleted handlers still omit it)
                                      |  gate: tsc clean
                                      v
 BATCH 2 -- test updates (DISJOINT FILES -> parallel)               [after Batch 1]
 +--------------------+ +--------------------------+ +--------------------------+
 | T4 report.routes   | | T5 permissionMatrix.test | | T6 reportService.test.ts |
 |     .test.ts       | |     .ts                  | |     (NEW)                |
 | delete global      | | remove PA_ONLY rows      | | projectId required       |
 |   blocks;          | |   :355-356;              | |   + forwarded into WHERE |
 | + add 404 regress. | | keep MEMBER_PLUS :357-358| |                          |
 +---------+----------+ +------------+-------------+ +------------+-------------+
           +-----------------------+    +---------------------------+
                                     |
                                      |  gate: vitest run green
                                      v
 BATCH 3 -- verification (READ-ONLY / RUN-ONLY -> all parallel)     [after Batch 2]
 +----------------+ +---------------------+ +----------------------+
 | T7 frontend    | | T8 backend build    | | T9 manual checklist  |
 |     grep       | |     + full tests    | |     (5 steps)        |
 +-------+--------+ +---------+-----------+ +----------+-----------+
          +----------------+  +---------------------+
                         |
                         v
                   MERGE-READY (rebase & merge)
```

### Summary table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `backend/src/routes/report.routes.ts` | None | T2, T3 |
| T2 | 1 | `backend/src/index.ts` | None | T1, T3 |
| T3 | 1 | `backend/src/services/reportService.ts` | **Merge after T1+T2** (compile) | T1, T2 (parallel dev; ordered merge) |
| T4 | 2 | `backend/src/routes/report.routes.test.ts` | T1, T2, T3 | T5, T6 |
| T5 | 2 | `backend/src/routes/permissionMatrix.routes.test.ts` | T1, T2 | T4, T6 |
| T6 | 2 | `backend/src/services/reportService.test.ts` *(NEW)* | T3 | T4, T5 |
| T7 | 3 | `frontend/src/**` (grep verify) | Batch 1+2 merged | T8, T9 *(or run now â FE already scoped)* |
| T8 | 3 | `backend/` (`tsc` + `vitest run`) | Batch 1+2 merged | T7, T9 |
| T9 | 3 | running BE+FE (manual) | Batch 1+2 runnable | T7, T8 |

### Developer assignment tracks (2â3 paths)

- **Track Î± â Service core (highest-skill; owns the security-critical edit):**
  T3 â T6 â co-own T8. Critical path; gates merge.
- **Track Î² â Routing/wiring:** T1 + T2 *(same dev â symbol + mount are tightly
  coupled)* â T4 â T5. Hands off to Î³ for matrix sign-off.
- **Track Î³ â Verification/QA:** T7 *(can start immediately â FE already in target
  state)* â T9 â final T8 sign-off with Î±.

---

## Batch 1 â Backend source edits

### T1 â Remove the deprecated global `reportRouter`

**File:** `backend/src/routes/report.routes.ts`

**Description:**
Delete the deprecated global `reportRouter` (the two `GET /{time,tickets}` handlers)
and clean up the now-unused `requirePlatformAdmin` import.

- **Delete the `reportRouter` block** (`report.routes.ts:70` export through its two
  handlers at `:72` `/time` and `:81` `/tickets`, including the `[DEPRECATED]`
  `console.warn` lines and the leading comment block). Drop `reportRouter` from the
  module's exports.
- **Remove the `requirePlatformAdmin` import** at `report.routes.ts:3`. Verified:
  its **only** callers in this file are the two deleted handlers (`:72`, `:81`); the
  scoped `projectReportsRouter` uses `requireProjectMember` instead. (The middleware
  itself stays â still used in `users.routes.ts:21,35,50` and
  `projects.routes.ts:117,136`.)
- **Keep untouched:** `projectReportsRouter` (`:37-71`), `parseReportQuery`
  (`:16-23`), and all other imports (`authenticate`, `requireProjectMember`,
  `validateRequest`, `slugParamSchema`, `reportService`, `success`, `Router`).

**Acceptance Criteria:**
- [ ] `grep -n "reportRouter" backend/src/routes/report.routes.ts` returns **zero** hits.
- [ ] `grep -n "requirePlatformAdmin" backend/src/routes/report.routes.ts` returns **zero** hits.
- [ ] `projectReportsRouter` and `parseReportQuery` are byte-identical to before.
- [ ] `requirePlatformAdmin` middleware file is unchanged (still used elsewhere).
- [ ] `npm run build` (tsc) is clean *after T2 also lands* (T1 alone is green).

**Dependencies:** None (merge-order: T1 + T2 merge before T3).

---

### T2 â Unmount `/api/reports`

**File:** `backend/src/index.ts`

**Description:**
Remove the global report router's import and mount so the deleted routes are
unreachable.

- **Delete the mount** at `index.ts:85`: `app.use('/api/reports', reportRouter);`
- **Remove `reportRouter` from the import** at `index.ts:24`
  (`import { reportRouter } from './routes/report.routes';`). If the import is the
  only symbol on that line, delete the whole line; if it shares the line, remove
  just the `reportRouter` binding.
- **Keep untouched:** the `projectsRouter` mount (`app.use('/api/projects',
  projectsRouter)`) â `projectReportsRouter` is bare-mounted inside
  `projects.routes.ts:21,159` and stays.

**Acceptance Criteria:**
- [ ] `grep -n "api/reports" backend/src/index.ts` returns **zero** hits.
- [ ] `grep -n "reportRouter" backend/src/index.ts` returns **zero** hits.
- [ ] `projectsRouter` mount is unchanged.
- [ ] `npm run build` (tsc) is clean (no dangling import).

**Dependencies:** None (merge-order: T1 + T2 merge before T3).

---

### T3 â Tighten `reportService` â make `projectId` required, delete global branches

**File:** `backend/src/services/reportService.ts`

**Description:**
Defense-in-depth: make `projectId` a **required** param on both functions and delete
the global (no-join / unscoped) code branches so project-scoping can never be
bypassed at the service layer. The scoped paths already join/filter correctly â
keep them verbatim; only remove the `?:` branching and the optional type.

**Subtasks:**

1. **`getTimeReport` (`:73-145`):**
   - Change signature `:80` from `projectId?: string` â `projectId: string`.
   - Delete the global `withoutProject` builder (`:90-92`).
   - Collapse the query-builder ternary at `:104`
     (`const query = args.projectId ? withProject() : withoutProject();`) â
     unconditional `const query = withProject();`.
   - Collapse the WHERE conditional spread (`:107-114`,
     `...(args.projectId ? [eq(tickets.projectId, args.projectId)] : [])`) â literal
     `eq(tickets.projectId, args.projectId)`.
   - `withProject` (`:95-100`) is kept verbatim.

2. **`getTicketSummary` (`:148-243`):**
   - Change signature `:155` from `projectId?: string` â `projectId: string`.
   - Delete the global Done-column `else` scan branch (`:171-178`) and collapse the
     `if (args.projectId) { â¦ } else { â¦ }` (`:165-180`) â keep only the
     single-project `projects.columns` lookup (`:161-170`), unconditional.
   - Collapse the ticket WHERE conditional spread (`:189-197`,
     `...(args.projectId ? [eq(tickets.projectId, args.projectId)] : [])`) â literal
     `eq(tickets.projectId, args.projectId)`.
   - The `assigneeAlias` join (`:185-186`) and aggregation logic (`:200-230`) are
     project-agnostic â unchanged.

> **Note on `project_members`:** membership is enforced by the `requireProjectMember`
> middleware (the authorization boundary); the service filters by
> `tickets.projectId` (the already-authorized project). A redundant
> `project_members` join inside the report SQL is **not** required and is out of
> scope (would duplicate middleware auth and risk hiding legitimate non-member
> assignees). See plan "Edge Cases".

**Acceptance Criteria:**
- [ ] Both `getTimeReport` and `getTicketSummary` declare `projectId: string`
      (required) â no `?`.
- [ ] No `args.projectId ?` conditional remains in `reportService.ts`.
- [ ] No `withoutProject` symbol / global Done-column scan remains.
- [ ] Scoped query paths (`withProject`, single-project column lookup,
      `eq(tickets.projectId, args.projectId)`) are unchanged in behavior.
- [ ] `npm run build` (tsc) is clean *after T1 + T2 have merged* (the deleted global
      handlers are the only callers that omitted `projectId`).
- [ ] No `project_members` join added (out of scope).

**Dependencies:** Merge **after T1 + T2** (compile interdependency â see merge-order
rules).

---

## Batch 2 â Test updates

### T4 â Strip deprecated global-report test cases + add 404 regression

**File:** `backend/src/routes/report.routes.test.ts`

**Description:**
1. **Delete** the deprecated global-endpoint coverage:
   - The `// F23/F24 (DEPRECATED â¦)` section header comment (around `:272`).
   - `describe('GET /api/reports/time (deprecated global, backward compat)', â¦)`
     block (`:278` through its closing `});`).
   - `describe('GET /api/reports/tickets (deprecated global, backward compat)', â¦)`
     block (`:321` through end of file `~:352`).

2. **Keep verbatim** the project-scoped describes at `:132` (time) and `:232`
   (tickets). These already assert the service is called with
   `{ period, offset, projectId: 'p1' }`, so they stay **green** after T3 tightens
   the signature. The `vi.mock('../services/reportService', â¦)` at `:65-66` and the
   `vi.mocked(reportService.getTimeReport / getTicketSummary)` at `:75-76` are
   reused by the new regression block â leave them.

3. **Add** a new regression `describe` (in place of the deleted block) asserting
   **both** removed global routes return **404** for **every** role, guarding
   against accidental re-mounting:

   ```ts
   describe('SLYK-16: removed global report routes return 404', () => {
     const cases = [
       { path: '/api/reports/time' },
       { path: '/api/reports/tickets' },
     ];
     cases.forEach(({ path }) => {
       it(`${path} â 404 for a MEMBER`, async () => {
         const res = await request(app)
           .get(path)
           .set('Authorization', `Bearer ${await tokenFor(false)}`);
         expect(res.status).toBe(404);
         expect(mockedGetTimeReport).not.toHaveBeenCalled();
         expect(mockedGetTicketSummary).not.toHaveBeenCalled();
       });
       it(`${path} â 404 for a PLATFORM_ADMIN`, async () => {
         const res = await request(app)
           .get(path)
           .set('Authorization', `Bearer ${await tokenFor(true)}`);
         expect(res.status).toBe(404);
         expect(mockedGetTimeReport).not.toHaveBeenCalled();
         expect(mockedGetTicketSummary).not.toHaveBeenCalled();
       });
     });
   });
   ```
   (Reuses the existing `tokenFor`, `request`, `app`, `mockedGetTimeReport`,
   `mockedGetTicketSummary` already in the file â no new imports. Adapt helper
   names to the file's actual locals.)

**Acceptance Criteria:**
- [ ] No `describe` referencing `GET /api/reports/time` or `GET /api/reports/tickets`
      (global path) remains.
- [ ] New `describe('SLYK-16: removed global report routes return 404', â¦)` asserts
      **404** for `/api/reports/time` AND `/api/reports/tickets` for **both** MEMBER
      and PLATFORM_ADMIN roles (4 assertions).
- [ ] Each 404 assertion also asserts **neither** service mock was called.
- [ ] Scoped describes (`:132`, `:232`) unchanged and still green.
- [ ] `npm test -- src/routes/report.routes.test.ts` green; `npm run build` clean.

**Dependencies:** T1, T2, T3 (the regression asserts the post-removal 404 contract).

---

### T5 â Remove deprecated global-report rows from the permission matrix

**File:** `backend/src/routes/permissionMatrix.routes.test.ts`

**Description:**
Delete the two `PA_ONLY` rows for the removed global report routes at
`:355-356`:

```ts
{ label: 'GET /api/reports/time (deprecated global)',     method: 'get', path: '/api/reports/time',     allowed: PA_ONLY },
{ label: 'GET /api/reports/tickets (deprecated global)',  method: 'get', path: '/api/reports/tickets',  allowed: PA_ONLY },
```

**Keep verbatim** the project-scoped `MEMBER_PLUS` rows immediately after at
`:357-358` (`/api/projects/:slug/reports/{time,tickets}`). Leave the
`// --- Reports ---` section comment.

> Mandatory: the matrix loops every `Row` across all tiers and asserts a 2xx for
> `allowed`. After T2 unmounts `/api/reports/*`, those paths 404 and the PA-tier
> assertion fails. Removing the rows restores green. The `ROWS.length >= 26` floor
> guard stays satisfied (30 â 28 rows).

**Acceptance Criteria:**
- [ ] The `ROWS` array contains no entry whose `path` is `/api/reports/time` or
      `/api/reports/tickets`.
- [ ] Scoped report rows (`/api/projects/:slug/reports/*`) remain.
- [ ] No other matrix row touched.
- [ ] `npm test -- src/routes/permissionMatrix.routes.test.ts` green; `ROWS.length`
      still satisfies its floor guard.

**Dependencies:** T1, T2 (the rows only become invalid once `/api/reports/*` is
unmounted).

---

### T6 â New service-level test `reportService.test.ts` (projectId required + forwarded)

**File (NEW):** `backend/src/services/reportService.test.ts`

**Description:**
Create a Vitest test file co-located next to `reportService.ts`. This closes a
**coverage gap** â every other service in `backend/src/services/` has a co-located
`*.test.ts`; `reportService` is the lone exception. Lock the T3 contract at the
service layer, independent of HTTP/middleware. Table-driven per project convention
(one behavior per `it`); mock the DB client at the edge (no `app`/supertest, no live
DB).

Read `reportService.ts` first to mirror the actual Drizzle query chain
(`db.select().from(...).leftJoin(...).where(...)`); the assertion targets are the
filter sites at `:104`/`:107-114` (time) and `:189-197` (tickets).

**Test cases:**
1. **`projectId` forwarded into the ticket join/WHERE (table-driven):** for each of
   `getTimeReport` and `getTicketSummary`, mock the DB client, call with
   `projectId: 'p1'`, assert the query passed to `tickets` includes
   `eq(tickets.projectId, 'p1')` (project-scoping cannot be silently dropped).
   ```ts
   const CASES = [
     { name: 'getTimeReport',     fn: reportService.getTimeReport,     args: { period: 'weekly', offset: 0, projectId: 'p1' } },
     { name: 'getTicketSummary',  fn: reportService.getTicketSummary,  args: { period: 'weekly', offset: 0, projectId: 'p1' } },
   ];
   ```
2. **Missing `projectId` rejected at runtime:** call each function with `projectId`
   omitted (cast through `unknown` to bypass TS so the JS path runs) and assert it
   throws before producing a result â locks the contract for JS callers that bypass
   TS. Pin the assertion to whatever T3 implements (explicit guard â assert its
   shape; else Drizzle null-key error).
3. **(Documentation) Compile-time guard:** include a commented-out example showing
   the now-rejected call shape (omitting `projectId`), so the type guard is
   self-documenting.

**Acceptance Criteria:**
- [ ] File `backend/src/services/reportService.test.ts` exists, co-located next to
      the service.
- [ ] Table-driven cases cover **both** functions for `projectId` forwarding (â¥2
      cases).
- [ ] At least one `it` asserts omitting/`undefined` `projectId` is **rejected at
      runtime** (throws).
- [ ] No live DB hit (DB client mocked); no `app`/supertest import.
- [ ] `npm test -- src/services/reportService.test.ts` green; `npm run build` clean.

**Dependencies:** T3 (the required-`projectId` signature + deleted global branches
are exactly what this test asserts).

---

## Batch 3 â Verification (read-only / run-only)

> No source edits. If a check fails, the fix belongs to Batch 1 or Batch 2.

### T7 â Frontend regression grep (no global endpoint reference)

**Target:** `frontend/src/**` (read-only).

**Description:**
Confirm the frontend has zero references to the removed global endpoint and is
fully project-scoped. *Can start immediately* â the FE is already in the target
state; this is the pre-flight baseline + post-merge guard.

**Steps:**
1. `grep -rn "api/reports" frontend/src` â expect **zero** request-path matches. The
   only acceptable hit is the *module import* `@/api/reports`
   (`frontend/src/hooks/useReport.ts:3`), which is a filename, not an endpoint.
2. Confirm `fetchTimeReport` / `fetchTicketSummary` build URLs from
   `/projects/${projectSlug}/reports/...` only â `frontend/src/api/reports.ts:14,26`.
3. Confirm `useReport` / `useTicketSummary` require `projectSlug` â
   `frontend/src/hooks/useReport.ts`.
4. Confirm `ReportsPage` reads `:slug` from the URL and 403-redirects non-members
   (`isForbidden` â `<Navigate to="/projects">`) â
   `frontend/src/pages/ReportsPage.tsx`.

**Acceptance Criteria:**
- [ ] No global-endpoint path string anywhere in `frontend/src`.
- [ ] All three FE files confirmed project-scoped.
- [ ] If any stale `/api/reports/...` URL is found â escalate to `react-coder`
      (unexpected; plan says none).

**Dependencies:** None to *run* (FE already scoped). Part of the final merge gate.

---

### T8 â Backend build + full test suite green

**Target:** `backend/`.

**Description:**
The compile + test gate proving Batches 1 & 2 are complete and correct.

**Steps:**
1. `npm run build` (tsc) from `backend/` â zero errors. This is the compile-time
   proof `projectId` is required and no caller omits it.
2. `npm test` (vitest run, non-watch) from `backend/` â all green, specifically:
   - Project-scoped cases pass (member 200, PA bypass 200, non-member/unknown-slug
     identical non-revealing 403 with service **not** called, no-Bearer 401, invalid
     slug 400) â `report.routes.test.ts`.
   - New regression: `GET /api/reports/{time,tickets}` â **404** for member + PA.
   - `permissionMatrix.routes.test.ts` green with global rows removed.
   - New `reportService.test.ts` green.
3. Confirm no test is `.skip`/`.todo`'d in `report.routes.test.ts` or
   `permissionMatrix.routes.test.ts`.
4. Confirm CI workflow runs the same `build` + `vitest run` (no filter that would
   hide the 404 tests).

**Acceptance Criteria:**
- [ ] `npm run build` clean.
- [ ] `npm test` fully green (incl. new 404 + service-level regressions).
- [ ] No skipped tests in the report/matrix files.
- [ ] CI commands match local verification.

**Dependencies:** Batch 1 + Batch 2 merged.

---

### T9 â Manual verification checklist (acceptance criteria)

**Target:** running backend + frontend with seeded data.

**Description:**
Execute the plan's "Manual verification" block verbatim. The only task that needs a
human + running environment.

**Steps:**
1. As a **Member** of project `SLYK` â `GET /api/projects/SLYK/reports/time?period=weekly`
   â **200**, only `SLYK` data.
2. As a **non-member** â same â **403** `FORBIDDEN` "You do not have access to this
   project", byte-identical to an unknown-slug 403.
3. As a **Platform Admin** (non-member) â same â **200** (bypass).
4. `GET /api/reports/time` â **404** (removed).
5. Open the frontend Reports page for a project â loads, scoped to that project;
   non-member redirects to `/projects`.

**Acceptance Criteria:**
- [ ] All five steps pass.
- [ ] Covers: project-scoped access, non-revealing 403, PA bypass, no cross-project
      leakage, FE scoped.

**Dependencies:** Batch 1 + Batch 2 runnable/deployed.

---

## Out of scope (per plan)

- A rich Platform-Admin cross-project analytics dashboard (separate deliverable).
- Audit logging of report access.
- Adding a `project_members` join into the report SQL (membership enforced by
  middleware; report rows scoped by `tickets.projectId`).
- Any Drizzle schema change or migration (none required).
- Frontend UI changes (already project-scoped).
