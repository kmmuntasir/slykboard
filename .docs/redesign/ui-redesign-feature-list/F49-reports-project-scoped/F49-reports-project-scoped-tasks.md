# F49 — Move Reports FE to project-scoped route + 403/loading/empty surfaces: Plan + Task Breakdown

> **Feature:** F49 — Move Reports route + API client + hook to `/projects/:slug/reports`, add 403/loading/empty surfaces (Phase 5 — Frontend: project-scoped Reports)
> **Feature index:** [`../ui-redesign-features.md`](../ui-redesign-features.md) (lines 368-385)
> **Slug:** `SLYK` · **Depends on:** F48 (done — scoped BE endpoints + membership gate), F42 (done — nav scaffolding, Reports item tentatively disabled) · **PRD ref:** §4.6, §6 (ReportsPage), §5 (T6.1–T6.4)
> **Sources:** [`../ui-redesign-features.md`](../ui-redesign-features.md), [`../../ui-redesign-plan.md`](../../ui-redesign-plan.md) (§5.2), the project rules (`js-style-guide.md`, `js-testing-rules.md`, `js-development-rules.md`, `git-guidelines.md`, `persona.md`), and direct codebase analysis of `ReportsPage.tsx`, `useReport.ts`, `api/reports.ts`, `api/queryKeys.ts`, `routes/index.tsx`, `TopNav.tsx`, F48's `report.routes.ts`, and `client.ts`.

---

## 1. F49 Recap

**Goal:** Make the Reports FE project-scoped end-to-end and ship the error/loading/empty surfaces the PRD under-specifies. Reports lives at `/projects/:slug/reports`; `ReportsPage` reads `:slug`, calls the F48 scoped endpoints via `useReport(period, offset, projectSlug)`; the old `/reports` redirects (query dropped, per D6); a non-member direct-nav hits a backend 403 from F47's `requireProjectMember` and the FE redirects to `/projects` (D7 decided — not a rendered 403 surface); tables are wrapped in `Card`; the period toggle is a `Button` variant group; empty states use lucide icons; loading uses the shared `Skeleton`/`SkeletonBlock`; errors use `Retry`.

**Ships:**
- `api/reports.ts` — `fetchTimeReport(period, offset, projectSlug)` and `fetchTicketSummary(period, offset, projectSlug)` call `/projects/${projectSlug}/reports/time|tickets`.
- `api/queryKeys.ts` — `reportKeys.time(period, offset, slug)` and `.tickets(...)` include the slug so cache does not leak across projects.
- `hooks/useReport.ts` — `useReport(period, offset, projectSlug)` and `useTicketSummary(period, offset, projectSlug)` thread slug through to API + key.
- `routes/index.tsx` — Reports mounted at `/projects/:slug/reports`; a new `/reports` route element redirects to `/projects/:slug/reports` (last-selected slug) or `/projects` (no slug), **dropping `?period`/`?offset`** (D6).
- `pages/ReportsPage.tsx` — reads `useParams<{ slug }>()`; 403 → `Navigate` to `/projects` (D7); `isLoading` → `SkeletonBlock`; `isError` → `Retry`; empty → lucide icon + message; both tables inside `Card`; period toggle reuses `Button` (variant group); prev/next reuse `Button size="sm" variant="outline"`.
- `components/TopNav.tsx` — Reports nav item flipped from F42's "always-disabled" to **enabled when a project is present**, routing to `/projects/${projectSlug}/reports`; disabled-only-when-no-project (hint: "Select a project first").
- Tests: `ReportsPage.test.tsx` (slug route renders, 403 → redirect, loading/error/empty), `TopNav.test.tsx` (Reports link present + enabled when project selected).

**Acceptance (definition of done):**
- Route moved to `/projects/:slug/reports`; `/reports` redirects to last-selected project's reports or `/projects`, **dropping `?period`/`?offset`** (D6).
- `fetchTimeReport`/`fetchTicketSummary` take `projectSlug` and hit the scoped endpoints only.
- `useReport(period, offset, projectSlug)` and `useTicketSummary(period, offset, projectSlug)` thread the slug; `reportKeys` includes slug.
- D7: BE 403 (`requireProjectMember`) → FE redirects to `/projects` (a `Navigate`, not a rendered 403 page).
- Loading skeleton, error + retry, empty-state (lucide icons) present for BOTH tables.
- Both tables wrapped in `Card`; period toggle is a `Button` variant group.
- `ReportsPage` tests updated; `TopNav` Reports-enabled behaviour asserted.
- Gates green: `npm run typecheck -w frontend`, `npm run test -w frontend`, `npm run build -w frontend`.

**Edge cases resolved up front:**
- **D6 redirect query preservation:** default **drop** `?period`/`?offset`. They are project-relative and the new URL has a different scope; preserving them is meaningless. (Owner-confirmed default.)
- **D7 non-member direct-nav:** the backend's `requireProjectMember` returns 403 (`FORBIDDEN`). The FE catches `ApiClientError` with `code === 'FORBIDDEN'` (or `status === 403`) and `Navigate`s to `/projects` — **not** a rendered 403 surface (we already have `/forbidden` for role-based denial; membership denial = bounce to the chooser).
- **D9 routing change scope:** this is the **only** routing/auth change in this feature (§10). No other route tweaks piggybacked in.
- **Cache-key slug:** without the slug in `reportKeys`, switching projects shows stale cross-project data. Slug is mandatory in the key.
- **`window`/payload shape unchanged:** F48 guarantees the scoped response shape equals the old shape (`{ users, window }`), so F49's `useReport` swap is a URL + key change, not a payload change. No type edits.
- **`?period`/`?offset` not in the URL:** the FE continues to keep period/offset in component state (not query params) — unchanged from F23/F24. The redirect therefore has nothing to preserve even if we wanted to.

---

## 2. Codebase Analysis Summary

- **State:** Reports is fully wired (F23/F24) but **global**: `/reports` route, `fetchTimeReport(period, offset)` → `/reports/time`, no slug in cache keys. F42 left the Reports nav item always-disabled with hint "Reports coming soon". F48 shipped the scoped BE endpoints (`/api/projects/:slug/reports/{time,tickets}`) and the membership gate; F49 is the FE consumer.

- **Existing structure this feature builds on:**
  - **`api/reports.ts`** — `fetchTimeReport`/`fetchTicketSummary` each build a querystring `?period=&offset=` and call `apiFetch`. Two-arg `(period, offset)` signatures.
  - **`api/queryKeys.ts`** — `reportKeys.all = ['reports']`, `.time(period, offset)`, `.tickets(period, offset)`. No slug dimension.
  - **`hooks/useReport.ts`** — `useReport(period, offset)` + `useTicketSummary(period, offset)`; thin `useQuery` wrappers over the API functions and keys.
  - **`routes/index.tsx`** — flat route `{ path: '/reports', element: <ReportsPage /> }` inside the `AppLayout`/`RouteErrorBoundary` subtree. `IndexRedirect` already demonstrates the last-selected-slug → `/projects/:slug` pattern (reuse for the redirect).
  - **`pages/ReportsPage.tsx`** — local `period`/`offset` state; bare `<button>` period toggle (custom `PeriodButton`); bare `<table>` (no `Card`); plain `<p>` loading/error/empty; no slug; no 403 handling.
  - **`components/TopNav.tsx`** — `PUBLIC_NAV_LINKS` hardcodes `{ to: '/reports', label: 'Reports' }`; the render loop special-cases `isReports` to force `DisabledNavItem` with hint "Reports coming soon". `useParams<{ slug }>()` + `useProjectStore` already resolve `projectSlug`/`hasProject`.
  - **`components/RequireRole.tsx`** — renders `ForbiddenPage` for role denial. (Membership denial is intentionally different — D7 routes to `/projects`.)
  - **`pages/ProjectSettingsPage.tsx`** — the precedent for a `:slug`-reading page: `useParams<{ slug }>()`, guard `if (!slug)`, then a `SettingsBody` child that owns the queries. F49 mirrors this shape (`ReportsBody` child owns `useReport`).
  - **`components/ui/Button.tsx`** — variants `primary|secondary|ghost|destructive|outline`, sizes `sm|md|lg`. Period toggle = two `Button variant="outline"` with the active one promoted to `variant="primary"` (or `secondary`); prev/next = `Button size="sm" variant="outline"`.
  - **`components/ui/Card.tsx`** — surface-only `bg-card border border-border rounded-lg`. Tables go inside with `overflow-hidden` (Card supplies the border; drop the table's own border wrapper).
  - **`components/Retry.tsx` + `components/Skeleton.tsx`** — shared error/retry + loading primitives already used by `ProjectSettingsPage`. Reuse verbatim.

- **Prior art:** `ProjectSettingsPage` (`:slug` read + body split), `IndexRedirect` (last-selected-slug redirect), F48's scoped endpoints (response shape parity).

- **File paths this feature touches:**
  - `frontend/src/api/reports.ts` — EDIT: add `projectSlug` param; call scoped endpoints.
  - `frontend/src/api/queryKeys.ts` — EDIT: add `slug` to `reportKeys.time`/`.tickets`.
  - `frontend/src/hooks/useReport.ts` — EDIT: add `projectSlug` param; thread to API + key.
  - `frontend/src/routes/index.tsx` — EDIT: move Reports route to `/projects/:slug/reports`; replace `/reports` with a redirect element.
  - `frontend/src/pages/ReportsPage.tsx` — EDIT (large): read `:slug`; split into `ReportsPage` + `ReportsBody`; add 403/loading/error/empty; `Card`; `Button` toggle.
  - `frontend/src/components/TopNav.tsx` — EDIT: flip Reports nav from always-disabled to enabled-when-project; route to scoped URL; fix `PUBLIC_NAV_LINKS` Reports `to`.
  - `frontend/src/pages/ReportsPage.test.tsx` — EDIT/EXPAND: slug route, 403 redirect, surfaces.
  - `frontend/src/components/TopNav.test.tsx` — EDIT/NEW: assert Reports link enabled + scoped target when a project is selected.

- **Project rules:**
  - `js-style-guide.md` — 2-space indent `.ts`/`.tsx`, PascalCase components, early returns, async/await, no `any`, import order (external → internal → types).
  - `js-testing-rules.md` — Vitest, co-located `*.test.tsx`, `vi.fn()` mocks, `MemoryRouter` + `QueryClientProvider`, `getByRole` priority.
  - `js-development-rules.md` — RESTful, React Query for server state, Zustand for client state.
  - `git-guidelines.md` — `SLYK-F49:` commit prefix, single-line message, rebase-and-merge only.

- **Hidden coupling:**
  - **F42 left Reports tentatively disabled.** F49 is the feature F42 deferred — it flips the disable-off and finalizes the target. F42's D3 "Reports coming soon" tooltip is replaced by the real link.
  - **`useProjectStore.lastSelectedSlug`** is the source for the `/reports` redirect target — same store `IndexRedirect` reads. No new store.
  - **`ApiClientError`** from `api/client.ts` carries `.status` + `.code`; membership denial is `code === 'FORBIDDEN'`. The 401 interceptor in `apiFetch` is upstream of this and does not swallow 403.
  - **`useReport` is consumed only by `ReportsPage`** today — widening its signature is safe; no other call sites to update.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | API signature | **`(period, offset, projectSlug: string)`** on both functions; required slug (no optional/global fallback on the FE). | FE only ever calls scoped now. The deprecated global BE routes are reached by nothing in the FE after F49. A required param makes it impossible to accidentally call global. |
| D2 | Endpoint path | **`/projects/${projectSlug}/reports/time|tickets?period=&offset=`** (the F48 scoped routes). | F48 ships exactly these. `apiFetch` prepends `env.apiBaseUrl`. |
| D3 | Cache key | **`reportKeys.time(period, offset, slug)`** and `.tickets(period, offset, slug)` — slug as a 4th key segment. | Without slug, switching projects shows stale data (the F49 edge case). Slug in the key gives per-project cache isolation + correct refetch on project switch. |
| D4 | Hook signature | **`useReport(period, offset, projectSlug)`** and **`useTicketSummary(period, offset, projectSlug)`** — required slug, threaded to API + key. | Mirrors the API. Callers (only `ReportsPage`) always have a slug (route guard). |
| D5 | Route shape | **`/projects/:slug/reports`** mounted in the existing `AppLayout`/`RouteErrorBoundary` subtree (sibling of `/projects/:slug/settings`). | Spec §5 T6.1. Keeps the slug-param family together. No auth-level change — already behind `RequireAuth`. |
| D6 | Old `/reports` redirect | **`<Navigate>` to `/projects/${lastSelectedSlug}/reports` (if a slug) else `/projects`**, **dropping `?period`/`?offset`**. | Owner-confirmed default. Period/offset are component state, not URL params — there is nothing to carry. `replace` so the redirect doesn't pollute history. |
| D7 | Non-member (BE 403) | **FE `Navigate`s to `/projects`** on `ApiClientError` with `code === 'FORBIDDEN'` (or `status === 403`). NOT a rendered 403 surface. | Decided. Membership denial = "you can't see this project" → bounce to the chooser. `RequireRole`'s `ForbiddenPage` is for role denial (admin-only pages), a different concern. |
| D8 | Loading surface | **`SkeletonBlock` (+ a couple `SkeletonLine`s)** for each table while `isLoading`. | Reuse the shared primitive `ProjectSettingsPage` already uses. Consistent loading language across pages. |
| D9 | Error surface | **`Retry`** (icon + message + retry button) per table; reads `refetch` from each `useQuery`. | Reuse the shared primitive. `Retry` already wraps a `<button>` that calls `onRetry`. |
| D10 | Empty surface | **lucide `Inbox`** (time) / **`CheckCircle2`** (tickets) + a muted sentence, centered, inside the `Card`. | Spec names lucide icons (`Inbox`/`BarChart3`); `Inbox` for "no time entries", `CheckCircle2` for "no resolved tickets" reads better than two `BarChart3`s. |
| D11 | Table chrome | **Wrap each `<table>` in `<Card className="overflow-hidden">`**; drop the bespoke `rounded-lg border` wrapper. | F35 `Card` is the surface primitive; the table keeps `w-full text-sm`, header `bg-muted`, `divide-y`. |
| D12 | Period toggle | **Two `<Button>` elements**: active = `variant="primary"`, inactive = `variant="outline"`, both `size="sm"`; group via a `inline-flex rounded-md` wrapper. Prev/next = `Button size="sm" variant="outline"`. | Spec: "period toggle = Button variant group". Replaces the custom `PeriodButton`. |
| D13 | TopNav Reports item | **Enabled when `hasProject`**, routing to `/projects/${projectSlug}/reports`; disabled (tooltip "Select a project first") when no project. Remove the F42 "Reports coming soon" special-case. | F42 left this tentatively disabled; F49 is the unblock. The disabled-when-no-project matches the Board link's existing `!hasProject` disable. |
| D14 | TypeScript | **`.ts`/`.tsx`** throughout; no `any`. | Repo convention. |

---

## 4. Architecture Overview (Target Tree)

```
frontend/
  src/
    api/
      reports.ts               [EDIT] add projectSlug; scoped endpoints
      queryKeys.ts             [EDIT] slug in reportKeys.time/.tickets
    hooks/
      useReport.ts             [EDIT] add projectSlug param (both hooks)
    routes/
      index.tsx                [EDIT] /projects/:slug/reports; /reports redirect
    pages/
      ReportsPage.tsx          [EDIT] read :slug; ReportsBody; 403/loading/error/empty; Card; Button toggle
      ReportsPage.test.tsx     [EDIT] slug route, 403 redirect, surfaces
    components/
      TopNav.tsx               [EDIT] Reports: enabled-when-project; scoped target
      TopNav.test.tsx          [EDIT/NEW] Reports enabled assertion
```

No backend changes. No new files except the optional `TopNav.test.tsx` (if absent) and this doc.

---

## 5. Tasks

### T1 — Project-scope the API client + cache keys
**Files:** `frontend/src/api/reports.ts`, `frontend/src/api/queryKeys.ts`
**Steps:**
1. `reports.ts`: change both signatures to `(period, offset, projectSlug: string)`; build path `/projects/${projectSlug}/reports/time?period=${period}&offset=${offset}` (and `.../tickets`). Update the doc comments to reference F48 scoped routes + deprecate-old note.
2. `queryKeys.ts`: extend `reportKeys.time` and `.tickets` to `(period, offset, slug)` → `[...reportKeys.all, 'time', period, offset, slug]` / `[..., 'tickets', period, offset, slug]`.
**Done when:** both functions take + use `projectSlug`; keys include slug; `tsc` clean.

### T2 — Project-scope the hook
**Files:** `frontend/src/hooks/useReport.ts`
**Steps:**
1. Add `projectSlug: string` as the 3rd param of `useReport` and `useTicketSummary`.
2. Pass it to the API function and the cache key.
**Done when:** signatures are `(period, offset, projectSlug)`; both `queryFn` and `queryKey` use it.

### T3 — Move the route + redirect + TopNav flip
**Files:** `frontend/src/routes/index.tsx`, `frontend/src/components/TopNav.tsx`
**Steps:**
1. `routes/index.tsx`: replace `{ path: '/reports', element: <ReportsPage /> }` with `{ path: '/projects/:slug/reports', element: <ReportsPage /> }`. Add a new `{ path: '/reports', element: <ReportsRedirect /> }` where `ReportsRedirect` reads `useProjectStore.lastSelectedSlug` and `<Navigate to={slug ? /projects/:slug/reports : /projects} replace />` (D6: no query).
2. `TopNav.tsx`: in `PUBLIC_NAV_LINKS` set Reports `to: '/projects/:slug/reports'` (template-built at render). In the render loop, drop the `isReports` special-case; compute `disabled = !hasProject`; the enabled branch routes to `/projects/${projectSlug}/reports`; hint becomes "Select a project first".
**Done when:** scoped route mounts; `/reports` redirects; nav link enabled with a project.

### T4 — Rewrite ReportsPage surfaces
**Files:** `frontend/src/pages/ReportsPage.tsx`
**Steps:**
1. `ReportsPage` reads `useParams<{ slug }>()`; if no slug, `Navigate` to `/projects`. Else render `<ReportsBody slug={slug} />`.
2. `ReportsBody`: `useReport(period, offset, slug)` + `useTicketSummary(period, offset, slug)`. For each, derive a 403 check: `error instanceof ApiClientError && (error.code === 'FORBIDDEN' || error.status === 403)` → `Navigate to="/projects" replace` (D7).
3. Loading → `SkeletonBlock`/`SkeletonLine` (both tables). Error → `Retry` (per table, wired to `refetch`). Empty → lucide icon + message inside `Card`.
4. Wrap both tables in `<Card className="mt-4 overflow-hidden">`; drop the old `rounded-lg border` wrapper.
5. Period toggle → two `Button` (active `primary`, inactive `outline`, `size="sm"`) in an `inline-flex rounded-md` group. Prev/next → `Button size="sm" variant="outline"`.
**Done when:** all acceptance surfaces present; no bespoke toggle/table chrome; 403 bounces.

### T5 — Update tests
**Files:** `frontend/src/pages/ReportsPage.test.tsx`, `frontend/src/components/TopNav.test.tsx` (create if absent)
**Steps:**
1. `ReportsPage.test.tsx`: mount under `MemoryRouter initialEntries={['/projects/SLYK/reports']}` with `<Route path="/projects/:slug/reports">`; mock `fetchTimeReport`/`fetchTicketSummary` (`vi.mock('@/api/reports')`) → assert heading renders. Add a 403 case: mock rejects with `ApiClientError('...', 403, 'FORBIDDEN')` → assert a redirect to `/projects` (render `<Routes>` with a catch-all that records navigation, or assert `Navigate` via `useLocation`). Add loading + empty assertions.
2. `TopNav.test.tsx`: render with a `:slug` route + seeded `useProjectStore` → assert the Reports link is an `<a href="/projects/SLYK/reports">` (not a disabled span).
**Done when:** new tests pass; old `/reports`-route test updated to the scoped path.

### T6 — Run gates
**Steps:** `npm run typecheck -w frontend && npm run test -w frontend && npm run build -w frontend`.
**Done when:** all three green.

---

## 6. Roll-out / Sequencing

T1 → T2 (hook depends on API + key signatures). T3 (route+nav) and T4 (page) can proceed in parallel after T2. T5 after T4. T6 last. Single PR for the whole feature (rebase-and-merge).

## 7. Out of Scope (follow-ups)

- Removing the deprecated global `/api/reports/*` BE routes (F50 follow-up — F48 D2 keeps them one release).
- URL-synced `?period`/`?offset` (not in PRD; period/offset stay in component state).
- A rendered 403 page for membership denial (D7 chose redirect-to-chooser).
