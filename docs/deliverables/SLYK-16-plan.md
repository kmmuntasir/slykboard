# Implementation Plan — SLYK-16

**Ticket:** `docs/deliverables/SLYK-16.md`
**Type:** Enhancement
**Title:** Project-Scoped Reports (deprecate/remove global `/api/reports/*`, consolidate under project-scoped routes)
**Generated:** 2026-06-30

---

## Summary

SLYK-16 finishes the work SLYK-01 started: making reporting **project-scoped by
default** and removing the cross-project leakage surface. Today the backend
exposes two parallel reporting surfaces:

1. **Project-scoped** — `GET /api/projects/:slug/reports/{time,tickets}`, gated by
   `authenticate` → `requireProjectMember()` (PA bypass), calling
   `reportService.getTimeReport / getTicketSummary` with `projectId`. This surface
   is **already correct** and is the one the frontend (`ReportsPage`) already
   drives off exclusively.
2. **Global (deprecated)** — `GET /api/reports/{time,tickets}`, gated by
   `requirePlatformAdmin()`, calling the same service functions **without**
   `projectId`, producing workspace-wide aggregations that ignore `project_members`
   entirely. These were left PA-only by SLYK-01 to stop leakage and explicitly
   tagged for retirement by SLYK-16.

This ticket retires surface (2). The deliverable is:

- **Remove** the deprecated global `reportRouter` (`/api/reports/*`) and its mount.
- **Tighten** `reportService` so `projectId` is **required** (a string, not
  optional) — delete the global/no-join/unscoped code branches so project-scoping
  can never be bypassed at the service layer.
- **Update tests** — delete the global-endpoint test cases and the
  `permissionMatrix` PA-ONLY rows for reports; add a regression assertion that no
  global report route exists / the service rejects a missing `projectId`.
- **Frontend is already project-scoped** (verified) — no UI change required; only
  confirm nothing references the removed global endpoint.

The preferred option per the ticket (remove, not repurpose) is taken: there is no
explicit PA cross-project dashboard requirement, so the global endpoints are
removed outright rather than repurposed. A future ticket can add an explicit PA
aggregated dashboard if/when needed (called out as Out of Scope).

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Route | `backend/src/routes/report.routes.ts` | Remove the deprecated `reportRouter` (global `/time`, `/tickets`); keep `projectReportsRouter`. |
| App mount | `backend/src/index.ts` | Remove the `app.use('/api/reports', reportRouter)` mount + its import. |
| Service | `backend/src/services/reportService.ts` | Make `projectId` required on both functions; delete the global (no-join / unscoped) branches. |
| Types | `reportService.ts` (inline arg types) / any shared report DTO | Tighten `projectId?: string` → `projectId: string`. |
| Test (integration) | `backend/src/routes/report.routes.test.ts` | Delete the global-endpoint test cases; add "no global route / missing projectId rejected" regression. |
| Test (matrix) | `backend/src/routes/permissionMatrix.routes.test.ts` | Remove the `PA_ONLY` global report rows (`:355-356`); project-scoped rows stay. |
| Frontend | `frontend/src/pages/ReportsPage.tsx` | **No code change** — already project-scoped; verify only. |
| Frontend | `frontend/src/api/reports.ts` | **No code change** — already calls `/projects/:slug/reports/*`; verify only. |
| Frontend | `frontend/src/hooks/useReport.ts` | **No code change** — already project-scoped via `projectSlug`; verify only. |

## Proposed Implementation

The changes are backend-only and ordered by build dependency: routes/service first
(schema-less refactor), then tests, then a frontend verification pass.

### Backend Changes

#### 1. Remove the deprecated global report router

**File:** `backend/src/routes/report.routes.ts`
**What:** Delete the `reportRouter` definition (the two `GET /{time,tickets}`
routes, their `console.warn('[DEPRECATED] …')` handlers, the `requirePlatformAdmin`
import if it becomes unused) and drop `reportRouter` from the module's exports.
Keep `projectReportsRouter` and `parseReportQuery` untouched.
**Why:** SLYK-16 retires the global cross-project surface; the project-scoped
router already serves every legitimate (non-PA-dashboard) use case and is what the
frontend calls.
**Code reference:** deprecated routes live around `report.routes.ts:68-88`
(comment block + two `reportRouter.get(...)` handlers); exports at the bottom of
the file. Confirm `requirePlatformAdmin` has no remaining caller in this file
before removing its import (grep-first).

#### 2. Unmount `/api/reports`

**File:** `backend/src/index.ts`
**What:** Remove the `app.use('/api/reports', reportRouter);` line (around
`index.ts:85`/`:91`) and the `reportRouter` symbol from the import drawn from
`./routes/report.routes.ts`. Keep any `projectReportsRouter`/`projectsRouter`
mount (`app.use('/api/projects', projectsRouter)`) untouched.
**Why:** Without the mount the routes are unreachable; this is the actual
removal. Leaving the symbol mounted would 404 anyway once the router is deleted —
clean it up explicitly.
**Code reference:** `index.ts:85` mount; the import block at the top of `index.ts`.

#### 3. Tighten `reportService` — make `projectId` required, delete global branches

**File:** `backend/src/services/reportService.ts`
**What:**
- Change both function signatures so `projectId` is **required**:
  `getTimeReport(args: { period; offset; projectId: string })` and the same for
  `getTicketSummary`. (Currently `projectId?: string`.)
- In `getTimeReport` (`:73-145`): delete the global/"no join" branch — the
  `timeEntries ← tickets` join (`withProject`, `:107`) and the
  `eq(tickets.projectId, args.projectId)` filter (`:104`, `:121`) become
  unconditional. The `args.projectId ? [...] : []` conditional in the WHERE
  collapses to always including the filter.
- In `getTicketSummary` (`:148-242`): delete the global Done-column scan branch
  (`:171-178` — the "scan all projects' last column" path) and keep only the
  single-project lookup (`projects.columns` for `args.projectId`,
  `:161-170`). Collapse the `args.projectId ? [...] : []` ticket WHERE filter
  (`:189-197`) to always `eq(tickets.projectId, args.projectId)`.
**Why:** This is the defense-in-depth the ticket demands ("no raw global SQL that
ignores `project_members`"). With `projectId` required and the global branches
gone, the service can never again produce a workspace-wide aggregation — even if a
future caller forgets the middleware, the service call won't compile without a
project. Membership itself stays enforced by `requireProjectMember` (the
middleware is the authorization boundary; the service filters by the already-
authorized `projectId`).
**Code reference:** existing scoped branches are the ones to keep verbatim —
they already join/ filter correctly. Only the `?:` branching and the optional
type need removing.

> Note on `project_members` in SQL: the ticket's "no raw global SQL ignoring
> `project_members`" is satisfied by (a) removing the global endpoints and (b)
> requiring `projectId`. The service filters by `tickets.projectId`, which is the
> resolved project; the membership decision itself is the middleware's job
> (consistent with every other project-scoped resource in the app). Adding a
> redundant `project_members` join inside the report SQL is **not** required and
> is out of scope — it would duplicate the middleware's authorization and risk
> hiding assignees who legitimately worked a ticket without a `project_members`
> row. This judgment is recorded here for reviewers.

### Frontend Changes

**None required.** Verified via investigation:

- `frontend/src/api/reports.ts` — both functions already hit
  `GET /projects/${projectSlug}/reports/{time,tickets}`; **no** call to
  `/api/reports/*`.
- `frontend/src/hooks/useReport.ts` — `useReport` / `useTicketSummary` already
  take `projectSlug` and feed it into the cache key + endpoint.
- `frontend/src/pages/ReportsPage.tsx` — reads `:slug` from the URL via
  `useParams`, drives the hooks off it, and redirects non-members (BE 403) via
  `isForbidden(...)` → `<Navigate to="/projects">`. No global-endpoint reference.

The only frontend action is a **grep verification** during implementation to
confirm nothing in `frontend/src` references the removed `/api/reports/` path
(none is expected; if any stale reference is found, remove it).

## Edge Cases & Risks

- **External API consumers of `/api/reports/*`.** Anyone still hitting the global
  endpoints will start receiving 404s. SLYK-01 already gated them to PA-only and
  shipped the deprecation `console.warn`s; the only known consumer (the frontend)
  is already migrated. Risk is low; mitigated by the deprecation window SLYK-01
  already provided.
- **TypeScript breakage from making `projectId` required.** The only callers are
  the two project-scoped route handlers (which pass `req.project!.id`) and the
  test suite (which mocks the service). A compile will surface any missed caller.
  The global handlers are deleted in the same change, so they can't trip the new
  required-arg type.
- **`requirePlatformAdmin` import cleanup.** If `reportRouter` was the only
  consumer of `requirePlatformAdmin` in `report.routes.ts`, leaving the import
  would trigger a lint/unused error. Grep the file before/after; remove the
  import only if unused. (`requirePlatformAdmin` itself stays — it's used
  elsewhere for genuine PA-only actions.)
- **Permission-matrix drift.** `permissionMatrix.routes.test.ts` is data-driven;
  the `PA_ONLY` rows for the global report routes (`:355-356`) must be removed or
  the matrix run will fail trying to hit a deleted route. This is expected and
  part of the work, not a hidden risk.
- **Soft regression: assignee/time-user not a project member.** A ticket's
  `assigneeId` (or a `timeEntries.userId`) could be a user with no
  `project_members` row for the project; they would still appear in that
  project's report. This is **pre-existing behavior** and **intentionally left as
  is** (see the service-layer note above) — SLYK-16 does not require joining
  `project_members` into the report SQL. Membership gates *access to the report*,
  not *appearance within it*.
- **No migration needed.** This is a pure routes/service/test refactor — no
  schema change, no Drizzle migration.

## Testing

*Follow project conventions — Vitest + supertest (backend); table-driven, one
behavior per test; co-located `*.test.ts`.*

- **Integration (`report.routes.test.ts`):**
  - **Delete** the cases that exercise `GET /api/reports/{time,tickets}` (the PA-
    only global path, around `report.routes.test.ts:278-356`) — these routes no
    longer exist.
  - **Keep** the project-scoped cases verbatim: member 200 with
    `getTimeReport`/`getTicketSummary` called as
    `{ period, offset, projectId: 'p1' }`; PA-bypass 200; non-member/unknown-slug
    → identical non-revealing 403 with the service **not** called; no-Bearer 401;
    invalid slug 400. These already prove the membership-scoped contract.
  - **Add** a regression: `GET /api/reports/time` and `GET /api/reports/tickets`
    return **404** (route removed) for every role (member, PA) — guards against
    accidental re-introduction of the global surface.
- **Service-level (new or extended `reportService.test.ts`, if one exists;
  otherwise add one):**
  - `getTimeReport` / `getTicketSummary` with a **missing** `projectId` are a
    **TypeScript error** (compile-time guard) — optionally assert at runtime that
    the function rejects/throws when `projectId` is absent, to lock the contract
    for JS callers.
  - Table-driven: scoped call forwards the exact `projectId` into the ticket join
    / WHERE (one case per function).
- **Permission matrix (`permissionMatrix.routes.test.ts`):**
  - Remove the `PA_ONLY` rows for `/api/reports/time` and `/api/reports/tickets`
    (`:355-356`). The project-scoped rows (`MEMBER_PLUS`) stay and continue to
    assert member-read + PA-bypass.
- **Frontend (no test change required):**
  - `ReportsPage` is already project-scoped; existing component tests (if any)
    remain valid. Optionally add a single assertion that the reports API client
    never constructs a `/api/reports/` URL (guard against regression), but this
    is optional.
- **Manual verification:**
  1. As a **Member** of project `SLYK`, hit
     `GET /api/projects/SLYK/reports/time?period=weekly` → 200, only `SLYK` data.
  2. As a **non-member**, hit the same → 403 `FORBIDDEN` "You do not have access
     to this project" (byte-identical to an unknown-slug 403).
  3. As a **Platform Admin** (not a member), hit the same → 200 (bypass).
  4. Hit `GET /api/reports/time` → 404 (removed).
  5. Open the frontend Reports page for a project → loads, scoped to that
     project, non-member redirects to `/projects`.

## Acceptance Criteria

- [ ] `GET /api/reports/time` and `GET /api/reports/tickets` are **removed**
      (return 404); no `/api/reports` mount remains.
- [ ] `reportService.getTimeReport` / `getTicketSummary` require `projectId`
      (required TS param; global/no-join branches deleted).
- [ ] Project members/admins view reports for **their own** project via
      `GET /api/projects/:slug/reports/{time,tickets}`; non-members get the
      non-revealing 403; Platform Admin bypasses.
- [ ] No cross-project data is exposed to non-PA users via any report endpoint
      (the only report endpoints are project-scoped and membership-gated).
- [ ] Frontend Reports page is project-scoped and calls no removed global
      endpoint (verified by grep; no code change needed).
- [ ] Integration tests assert: project-scoped access (member 200, PA bypass 200,
      non-member/unknown-slug identical 403 with service not called) **and** the
      removal of the global endpoints (404 for all roles).
- [ ] `permissionMatrix.routes.test.ts` no longer references the removed global
      report routes; the matrix run is green.

## Open Questions

- **PA cross-project dashboard?** The ticket allows repurposing the global
  endpoints as an explicit PA-only aggregated dashboard. There is no stated
  product need, so this plan **removes** them. If a PA dashboard is wanted later,
  it should be a separate, explicitly-named deliverable (see Out of Scope).
  Confirm "remove" is the right call before implementation — the ticket lists it
  as the preferred option, so this is a low-risk default.

## Out of Scope

- A rich Platform-Admin cross-project analytics dashboard (separate deliverable
  per the ticket).
- Audit logging of report access (explicitly out of scope per the ticket).
- Adding a `project_members` join into the report SQL (membership is enforced by
  middleware; report rows are scoped by `tickets.projectId`, which is the
  authorized project — see the Edge Cases / service-layer note).
- Any Drizzle schema change or migration (none required).
- Frontend UI changes (already project-scoped).
