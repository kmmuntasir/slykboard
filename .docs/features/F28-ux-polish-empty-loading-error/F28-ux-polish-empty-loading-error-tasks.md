# F28 — UX polish: empty / loading / error / 404 / 403: Plan + Task Breakdown

> **Feature:** F28 — UX polish: empty / loading / error / 404 / 403 (Phase 7 — Admin & Polish)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F07 (DONE ✅) · **PRD ref:** REQ-1.3, REQ-2.4, §1 (frictionless)
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F07](../F07-session-lifecycle-auth-guards/F07-session-lifecycle-auth-guards-tasks.md), cross-feature lines: F03 (error envelope), F04 (app shell + error boundary), F06 (domain mismatch → 403), F09 (empty column), F10 (poll pause + optimistic rollback), F11 (drop-reject toast), F17 (403 non-admin delete + confirm), F25 (removed entities render gracefully). Memory: `confirm-modals-for-destructive-actions`.

> **NOTE on PRD citation:** Feature spec cites "PRD §3 (frictionless UX)" but `basic-PRD.md` §3 is "Goals & Success Metrics" and contains no UX acceptance language. "Frictionless" appears once in §1 (line 12). Authoritative acceptance lives in `features.md:541-549`. This plan is built against the `features.md` bullets, not §3.

---

## 1. F28 Recap

**Goal:** Every state a user can hit is intentional — loading, empty, error, 404, 403, offline, and optimistic-rollback all have deliberate, accessible UI.

**Ships:** Loading skeletons for board + ticket modal; friendly empty states with clear CTAs (no project → "Create project"; empty board → "Add a ticket"); error boundaries with retry affordance on failed fetches; dedicated 404 (unknown routes / not-found tickets) and 403 (forbidden action) pages; toast notifications surfacing mutation failures and optimistic rollbacks; an offline/network-drop banner.

**Acceptance (definition of done):**
- Loading skeletons for board + modal.
- Empty states with clear CTAs (no project → "Create project"; empty board → "Add a ticket").
- Error boundaries + retry affordance on failed fetches.
- 404 for unknown routes/tickets; 403 for forbidden actions.

**Edge cases to resolve up front:**
- **Offline / network drop** → **Decision:** add `useOnlineStatus` hook (subscribe `navigator.onLine` + online/offline events) + render a top banner when offline in `AppLayout`; rely on TanStack Query `networkMode: 'online'` default to pause queries (no fail-storm) and queue mutations as `isPaused`; emit a "Back online" toast on reconnect. No env var; pure client-side detection. *(Note the known Chromium false-offline quirk — do not set `networkMode: 'always'` globally.)*
- **Optimistic-update rollbacks** → **Decision:** funnel all mutation errors through a single global `MutationCache.onError` in `lib/queryClient.ts` that emits a sonner toast with revert messaging (e.g. "Move reverted — try again"). Single seam covers all 8 mutations (`useMoveTicket`, `useUpdateTicket`, `useCreateTicket`, `useUpdateLabel`, `useDeleteLabel`, `useDeleteTicket`, `useUserManagement`, `useUpdateProject`). No per-hook `onError` needed; avoids drift.

---

## 2. Codebase Analysis Summary

- **State:** F07 (DONE ✅) ships session lifecycle, `RequireAuth`, `RequireRole`, `useRequireRole`, `apiFetch` 401 interceptor. Frontend is React 19 + Vite + TS + Tailwind + Zustand + TanStack Query v5 + react-router v7.18. `react-error-boundary@^5.0.0` is ALREADY a dependency.
- **Existing structure this feature builds on:**
  - Routing: `createBrowserRouter` at `routes/index.tsx:34`; authed subtree under `RequireAuth` + `AppLayout`; routes `/login`, `/`, `/projects`, `/projects/:slug` (BoardPage + nested `tickets/:ticketId` modal at `:55`), `/projects/:slug/settings`, `/reports`, `/settings` (`RequireRole ADMIN` at `:65`). **404 catch-all EXISTS:** `{path:'*', <NotFoundPage/>}` at `routes/index.tsx:68` but INSIDE the authed `AppLayout` subtree (unauthed stray URLs → login redirect). `NotFoundPage.tsx` is minimal.
  - **403/Forbidden page: DOES NOT EXIST.** Today forbidden = `RequireRole` redirects to `/` (`RequireRole.tsx:17`); `useDeleteTicket:21-28` silently no-ops on `FORBIDDEN`; `LoginPage:32-46` special-cases domain-restriction 403 into `<p role='alert'>` (only user-facing forbidden msg, login-specific).
  - Data fetching: `QueryClient` singleton `lib/queryClient.ts:4`; defaults `staleTime 30_000`, `refetchOnWindowFocus true`, custom `retry` (`:14`) — no-retry on 401, up to 3× otherwise (**403 DOES retry** — comment says "intentional-but-temporary pending F17/F25"). `useBoard` (`hooks/useBoard.ts:25`) returns `{data,isLoading,error}`.
  - Loading/error today are inline TEXT only: `BoardPage.tsx:27` 'Loading board…'; `:30` 'Project not found'; `:33` error string. `TicketDetailModal.tsx:45` `useQuery` inline, on `!ticket` returns `null` (`:86`) — NO skeleton, NO error state (failed fetch = blank modal). `ProjectsPage.tsx:36` 'Loading projects…' text; NO error branch; NO empty state (empty projects renders empty `<ul>` `:44`). `ProjectSettingsPage.tsx:31` 'Loading project…', `:34` 'Project not found.', no error branch. `useUsers.ts:10` `staleTime 60_000`. `HealthBadge` `staleTime 30_000`.
  - **ErrorBoundary EXISTS:** `components/ErrorBoundary.tsx` wraps `react-error-boundary`; mounted globally `main.tsx:20` (OUTSIDE `QueryClientProvider`/`RouterProvider`); fallback `ErrorFallback.tsx` (full-screen 'Something went wrong' + 'Try again' → `resetErrorBoundary`). GAP: only one top-level boundary; no per-route boundary; NOT integrated with `useQuery` errors (RQ errors aren't thrown into React, so the boundary never catches fetch failures).
  - Empty states: board empty handled — `isWholeBoardEmpty` → dashed 'No tickets yet. Create one to get started.' (`BoardPage.tsx:87-93`) but **NO CTA button** (`NewTicketButton` is in header, unconnected). Projects list empty: NOT handled. **Filtered-empty vs truly-empty conflated:** `BoardPage.tsx:73` counts all columns so a filter-zero board wrongly fires `isWholeBoardEmpty` → shows 'No tickets yet' instead of 'No tickets match your filters / Clear filters'. Column-level empty handled in `BoardColumn`/`UnsortedBucket`.
  - **Toast/notification: NONE.** No toast lib in `package.json`. Zero `toast()`/`notify` refs. No `window.alert`. NET-NEW infra required.
  - Optimistic updates + rollback (5 optimistic, all SILENT on failure): `useMoveTicket` (`:21-41`), `useUpdateTicket` (`:19-72`), `useCreateTicket` (`:12-29`), `useUpdateLabel`/`useDeleteLabel` (`useLabelMutations.ts:22-73`) — all roll back cache, no UI signal. Non-optimistic silent: `useDeleteTicket` (`:21`, comment "surfaced via mutation.error" but no consumer), `useUserManagement` (no `onError`), `useUpdateProject` (no `onError`; `ProjectSettingsPage:74` reads `updateMut.error` inline — the ONLY mutation error shown anywhere).
  - Shared primitives (reuse targets): `Loading.tsx` (spinner+label, `role=status`+`aria-live`, reusable base for skeletons); `Modal.tsx` (a11y portal: focus trap, Esc, scroll lock); `ConfirmDiscardDialog.tsx`, `DeleteTicketConfirm.tsx` (confirm pattern — ties to MEMORY rule); `AppLayout.tsx`, `TopNav.tsx` (shell where global `<Toaster>` mounts); `HealthBadge.tsx` (only live status UI; pattern ref for online/offline). NO `Button`/`Card`/`EmptyState`/`Skeleton`/`Retry`/`Toaster` component exists.
  - F07 seams this feature calls/extends: `useRequireRole(...allowedRoles: Role[]) => boolean` (`hooks/useRequireRole.ts:3,8`); `<RequireRole role={Role}>` renders `<Outlet/>` or `<Navigate to='/'/>` (`components/RequireRole.tsx:5,12`) — layout-route form, props only `{role}`, no children (currently silent-redirect; F28 adds forbidden feedback). `ApiClientError { status, code: ErrorCodeValue|'NETWORK_ERROR', message, details? }` (`api/client.ts:5-22`) — branch on `.code==='FORBIDDEN'` / `.status===403`. `apiFetch` 401 interceptor (`client.ts:76-103`) exempts `/auth/*`, coalesces refresh via `logoutHandlers`. `registerLogoutHandlers({refresh, logout})` (`client.ts:34`) — **PATTERN TO MIRROR** for a global error notifier OR centralize in `queryClient` `MutationCache`. `ErrorCode.FORBIDDEN` / `codeToStatus` closed vocab (`backend/utils/envelope.ts:8,21`) — reuse, NO new codes.
- **Prior art / partial work:** Global `ErrorBoundary` + `ErrorFallback` (F04); board empty state (F09); board polling pause on hidden tab + optimistic rollback (F10); `HealthBadge` (F07). F28 unifies + extends these rather than re-inventing.
- **File paths the plan references that do NOT exist yet (will be created):** `frontend/src/components/Skeleton.tsx`, `frontend/src/components/BoardSkeleton.tsx`, `frontend/src/components/TicketModalSkeleton.tsx`, `frontend/src/components/EmptyState.tsx`, `frontend/src/components/Retry.tsx`, `frontend/src/components/RouteErrorBoundary.tsx`, `frontend/src/components/Toaster.tsx`, `frontend/src/hooks/useToast.ts`, `frontend/src/hooks/useOnlineStatus.ts`, `frontend/src/pages/ForbiddenPage.tsx` (403). Plus co-located `*.test.tsx` for each.
- **Files F28 modifies:** `frontend/src/routes/index.tsx` (403 route + per-route boundaries + ticket-404), `frontend/src/main.tsx` (mount `<Toaster>` + `MutationCache`/`QueryCache` onError wired via queryClient), `frontend/src/lib/queryClient.ts` (`MutationCache`/`QueryCache` onError funnel; suppress 403 retries), `frontend/src/components/ErrorFallback.tsx` (align), `frontend/src/components/RequireRole.tsx` (render `<ForbiddenPage/>` not redirect), `frontend/src/pages/BoardPage.tsx`, `frontend/src/pages/ProjectsPage.tsx`, `frontend/src/pages/ProjectSettingsPage.tsx`, `frontend/src/pages/TicketDetailModal.tsx` (or its modal file), `frontend/src/components/CreateTicketModal.tsx`, `frontend/src/components/AppLayout.tsx` (offline banner + Toaster mount location decision), `frontend/src/pages/NotFoundPage.tsx`. `frontend/package.json` (add `sonner`).
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (SLYK-F28 prefix; `feature/SLYK-F28-ux-polish-empty-loading-error-states`; single-line commits; rebase-merge only), `.claude/rules/js-development-rules.md` (React Query for server state; Zustand for client/global UI; one component per file; co-located tests; explicit prop interfaces), `.claude/rules/js-style-guide.md` (Prettier printWidth 100, singleQuote, tabWidth 2/JSX 4; PascalCase components; camelCase `use`-prefix hooks; no `any`/`console.log`/inline styles/`useMemo`-unless-needed/magic-numbers/prop-drilling), `.claude/rules/js-testing-rules.md` (Vitest; table-driven; Testing Library priority `getByRole`>`getByLabelText`>`getByText`>`getByTestId`; coverage Components >70%).
- **Hidden coupling to plan for:**
  - `lib/queryClient.ts`, `main.tsx`, `routes/index.tsx` are touched by MULTIPLE tasks → must be sequenced (see §5 merge-order rules), not parallelized.
  - TanStack Query `MutationCache`/`QueryCache` are constructed in the `QueryClient` config — the global error funnel lives there, NOT in component trees.
  - `react-error-boundary` only catches errors THROWN into React. RQ errors do not throw by default → `throwOnError: true` on route-level queries + `<QueryErrorResetBoundary>` is the bridge for fatal errors; inline `isError` + `<Retry>` is the bridge for component-local.
  - `navigator.onLine` has a Chromium false-offline quirk; never set `networkMode: 'always'` globally.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Toast system | **`sonner`** (NEW dependency, owner sign-off) | 2026 standard for React 19; ~5-8 kB gzip; `role='status'` = `aria-live` polite = WCAG ARIA22-correct out of the box; `toast.promise()` maps cleanly to optimistic-revert flows; Tailwind-overridable; shadcn default. Alt `react-hot-toast` (~4.7 kB, last publish ~10 mo stale). Custom Zustand toaster is zero-dep but reinvents a11y + queue + animation. Research (Analysis D) recommends sonner. |
| D2 | Loading skeletons | **Tailwind `animate-pulse` primitives** (no lib) | `react-loading-skeleton` stale ~2 yr. Raw Tailwind `animate-pulse` over `bg-neutral-200 rounded` blocks is current best practice; container `aria-hidden`; `aria-busy` on the REAL data region (not the skeleton). |
| D3 | Error boundary + retry | **`react-error-boundary` (already dep) per-route + `<QueryErrorResetBoundary>` + `throwOnError` on route queries; inline `isError` + `<Retry>` for component-local** | Functional components CANNOT be error boundaries as of React 19.2 — class still required; `react-error-boundary` abstracts this and is already in `package.json`. `<QueryErrorResetBoundary>` gives `reset()` to pass to `<ErrorBoundary onReset={reset}>` → `fallbackRender` calls `resetErrorBoundary()` to retry — the documented TanStack Query v5 "error boundary + retry" pattern. |
| D4 | 404 / 403 pages | **404 = enhance existing `NotFoundPage` (keep catch-all `<Route path='*'>` as LAST child inside authed layout — owner sign-off on placement); 403 = NEW `ForbiddenPage` + `RequireRole` renders it as a guard component (NOT an error boundary)** | Spec: "404 for unknown routes/tickets; 403 for forbidden actions." react-router v7 best practice: terminal `path='*'` last (preserves layout); prefer a route GUARD component over data-mode error boundary for 403 (decoupled from loader semantics, declarative). `RequireRole` already the gate; flipping it from `<Navigate to='/'/>` → `<ForbiddenPage/>` is minimal. |
| D5 | Mutation failure funnel | **Global `MutationCache.onError` in `lib/queryClient.ts` → sonner toast** | Single seam covers ALL 8 mutations (5 optimistic + 3 non-optimistic); no per-hook `onError` drift; mirrors the existing `registerLogoutHandlers` single-choke-point pattern. Revert messaging distinguishes optimistic rollbacks. |
| D6 | 403 query retry suppression | **Suppress retry on 403** (extend `lib/queryClient.ts:14` `retry` fn to no-retry on `code==='FORBIDDEN'`) | Existing comment says 403 retry is "intentional-but-temporary pending F17/F25." Both are DONE; backend `requireRole` is live on tickets/labels/projects/users. Retrying a 403 is wasted requests and delays the forbidden UI. Behavior change → owner sign-off. |
| D7 | Offline / network drop | **`useOnlineStatus` hook (`navigator.onLine` + online/offline events) + top banner in `AppLayout` + "Back online" toast; rely on TanStack default `networkMode: 'online'`** | Spec edge case: "Offline / network drop → visible state, not silent failure." TanStack `onlineManager` already wraps `navigator.onLine` + pauses queries / queues `isPaused` mutations — no fail-storm. Banner is the visible state; toast signals recovery. |
| D8 | Accessibility bar | **Propose WCAG 2.1 AA** (no rule mandates a standard) | `role='alert'` (assertive) for errors/rollback toasts; `role='status'`/`aria-live='polite'` for success/skeletons; `aria-busy` on real data region; `aria-hidden` on decorative skeletons; focus management on 404/403. Reuses F16 `Modal` a11y primitive. Proposed (not mandated) → owner sign-off. |
| D9 | Empty states | **Reusable `<EmptyState>` component (icon/title/desc/CTA) + distinguish filtered-empty vs truly-empty on the board; add projects-list empty CTA ("Create project")** | Spec: "Empty states with clear CTAs." One component = consistency. Filtered-empty (`total tickets > 0` but `filtered count === 0`) shows "No tickets match your filters / Clear filters"; truly-empty shows "Add a ticket" CTA. |
| D10 | Schema / migration | **NONE** | F28 is pure frontend. No DB change. |

> **Out of F28 scope (explicitly deferred):** No Sentry/error-tracking integration (F28 boundaries are local UI only); no skeleton for every minor list (only board + ticket modal per acceptance); no i18n of messages (hardcoded English strings); no retry-on-mutation auto-retry (mutations stay retry 0 — failures must surface as toasts, per D5); no redesign of `HealthBadge` (F28 adds a separate offline banner, not a rewrite).

> **Owner sign-off needed:** (a) add `sonner` dependency (D1) vs zero-dep custom toaster; (b) propose WCAG 2.1 AA as the a11y bar (D8); (c) 404 catch-all route placement relative to `AppLayout` (D4) — keep inside authed subtree (current) vs hoist to top-level; (d) suppress 403 query retries globally (D6, behavior change).

---

## 4. Architecture Overview (Target Tree)

```
frontend/
├── package.json                                   # MODIFY — add "sonner"
├── src/
│   ├── main.tsx                                   # MODIFY — <Toaster/> mount; queryClient wires MutationCache/QueryCache
│   ├── lib/
│   │   └── queryClient.ts                         # MODIFY — MutationCache.onError + QueryCache.onError funnel → toast; suppress 403 retry
│   ├── routes/
│   │   └── index.tsx                              # MODIFY — /forbidden route? NO (guard-component form); per-route <RouteErrorBoundary>; ticket-404 in modal
│   ├── components/
│   │   ├── ErrorBoundary.tsx                      # (existing — leave as global fallback)
│   │   ├── ErrorFallback.tsx                      # MODIFY — align styling/wording
│   │   ├── RouteErrorBoundary.tsx                 # NEW — per-route wrapper using react-error-boundary + QueryErrorResetBoundary
│   │   ├── Toaster.tsx                            # NEW — wraps <Toaster/> from sonner, theme/position config
│   │   ├── Skeleton.tsx                           # NEW — base Skeleton + SkeletonShape primitives (animate-pulse, aria-hidden)
│   │   ├── BoardSkeleton.tsx                      # NEW — board-shaped skeleton (columns + cards)
│   │   ├── TicketModalSkeleton.tsx                # NEW — ticket-detail-modal-shaped skeleton
│   │   ├── EmptyState.tsx                         # NEW — reusable {icon, title, description, action?}
│   │   ├── Retry.tsx                              # NEW — inline error + retry button (role=alert + getByRole button)
│   │   ├── RequireRole.tsx                        # MODIFY — render <ForbiddenPage/> instead of <Navigate to="/"/>
│   │   ├── AppLayout.tsx                          # MODIFY — mount <OfflineBanner/> + (optionally) <Toaster/>
│   │   ├── OfflineBanner.tsx                      # NEW — top banner when !navigator.onLine
│   │   ├── CreateTicketModal.tsx                  # MODIFY — surface create failure (via global funnel; ensure not double-toasted)
│   │   └── *.test.tsx                             # NEW — co-located tests for each new component
│   ├── hooks/
│   │   ├── useToast.ts                            # NEW — thin wrapper re-exporting sonner's toast (centralizes the API; swap point)
│   │   └── useOnlineStatus.ts                     # NEW — subscribes navigator.onLine + online/offline events
│   ├── pages/
│   │   ├── BoardPage.tsx                          # MODIFY — skeleton on isPending; Retry on isError; EmptyState CTA; filtered-empty vs truly-empty; ticket-404
│   │   ├── ProjectsPage.tsx                       # MODIFY — skeleton; Retry; EmptyState "Create project"
│   │   ├── ProjectSettingsPage.tsx                # MODIFY — skeleton; Retry; shared primitives
│   │   ├── TicketDetailModal.tsx                  # MODIFY — TicketModalSkeleton on isPending; Retry/error on isError; not-found instead of null
│   │   ├── NotFoundPage.tsx                       # MODIFY — polish (h1, explanation, CTA link, role=alert region)
│   │   ├── ForbiddenPage.tsx                      # NEW — 403 page (h1, explanation, CTA, role=alert)
│   │   └── *.test.tsx                             # NEW/modify — co-located tests
```

**Request lifecycle (non-obvious flow):**
- Mutation fails → RQ rolls back optimistic cache (existing behavior) → `MutationCache.onError(err, _vars, _ctx)` in `lib/queryClient.ts` fires → calls `useToast`/`sonner` `toast.error(revertMessage(err))`. Single seam; no component code changes for rollback surfacing.
- Query fails (fatal, route-level) → query has `throwOnError: true` → error thrown into React → nearest `<RouteErrorBoundary>` (wrapping `<QueryErrorResetBoundary>`'s `<ErrorBoundary onReset={reset}>`) catches → `fallbackRender` renders `<Retry>` whose button calls `resetErrorBoundary()` → RQ refetches.
- Query fails (component-local, board) → `useBoard().isError` → inline `<Retry onRetry={refetch}/>` (no boundary).
- Offline → `useOnlineStatus` returns `false` → `OfflineBanner` shown in `AppLayout`; RQ `networkMode: 'online'` pauses queries + queues mutations as `isPaused` (no error storm).

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel.

Three shared files are touched across tasks: `lib/queryClient.ts`, `main.tsx`, `routes/index.tsx`. These are SEQUENCED (owned by exactly one task per batch; later batches branch from the merged result).

### Batch dependency diagram

```
Batch 1 (foundation, shared infra — MUST merge first)
  T1 sonner + Toaster + useToast + mount  ─┐
  T2 queryClient error funnel + 403 retry   │  (T1/T3 share main.tsx → sequence T1→T2 on main.tsx)
  T3 Skeleton primitives                     │
  T4 EmptyState + board/projects empty       │  (T4 touches BoardPage/ProjectsPage — also touched in Batch 2 T5/T6 → BARRIER)
  T8 useOnlineStatus + OfflineBanner         ┘

                        │  (Batch 1 merged to main before Batch 2 branches)
                        ▼
Batch 2 (per-page wiring + pages — parallel, disjoint)
  T5 RouteErrorBoundary + Retry + wire error branches (BoardPage/ProjectsPage/ProjectSettingsPage/TicketDetailModal)
  T6 ForbiddenPage + RequireRole renders it + routes/index.tsx
  T7 NotFoundPage polish + ticket-not-found in modal + catch-all placement
  T9 optimistic-rollback verification (read-only audit; minor hook tweaks)

                        │
                        ▼
Batch 3 (terminal)
  T10 tests (co-located *.test.tsx for each new component)
  T11 verification (tsc/vitest/lint/prettier/build + browser smoke)
```

- **Batch 1 → Batch 2** is a hard barrier: Batch 2 pages consume Batch 1 primitives (`<Skeleton>`, `<EmptyState>`, `<Retry>`, `<RouteErrorBoundary>`, `useToast`, the `queryClient` funnel). Batch 1 must be on `main` first.
- **Batch 2 → Batch 3** is a hard barrier: tests target the merged component set; verification runs against the fully wired feature.

### Merge order rules

1. **Batch 1 merges first.** Order within Batch 1: T1 (sonner/Toaster/useToast/main.tsx mount) → T2 (queryClient funnel — main.tsx already touched by T1, so T2 branches AFTER T1 merges; T2 owns `lib/queryClient.ts` + re-exports through main if needed) → T3, T4, T8 can parallelize once T1+T2 are on main (T4 owns `BoardPage`/`ProjectsPage` empty-state only — NOT error branches, which are T5's). What must be on main before Batch 2: sonner installed, `<Toaster/>` mounted, `queryClient` funnel live, `<Skeleton>`/`<EmptyState>`/`<OfflineBanner>`/`useOnlineStatus` available.
2. **Batch 2 merges second.** T5 owns error-branch edits on BoardPage/ProjectsPage/ProjectSettingsPage/TicketDetailModal (T4 already merged only the empty-state parts — disjoint edits but same files → T5 branches after T4 merges). T6 owns `RequireRole.tsx` + `routes/index.tsx` + `ForbiddenPage.tsx`. T7 owns `NotFoundPage.tsx` + ticket-not-found branch in `TicketDetailModal.tsx` (coordinate with T5 on that file → sequence T5 then T7, or assign both to one dev). T9 is read-mostly.
3. **Batch 3 (T10 tests, T11 verification) merges last.**

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `package.json`, `components/Toaster.tsx`, `hooks/useToast.ts`, `main.tsx`, `Toaster.test.tsx`, `useToast.test.ts` | F07 (DONE) | T3, T8 (not T2 — shared main.tsx) |
| **T2** | 1 | `lib/queryClient.ts` (MutationCache/QueryCache onError, suppress 403 retry) | T1 (for `useToast`) | T3, T4, T8 (after T1 merged) |
| **T3** | 1 | `components/Skeleton.tsx`, `BoardSkeleton.tsx`, `TicketModalSkeleton.tsx` + tests | — | T1, T2, T4, T8 |
| **T4** | 1 | `components/EmptyState.tsx` + test; `BoardPage.tsx` (empty CTA + filtered vs truly empty); `ProjectsPage.tsx` (empty "Create project") | T3 (none, but empty-state only) | T3, T8 |
| **T8** | 1 | `hooks/useOnlineStatus.ts`, `components/OfflineBanner.tsx`, `components/AppLayout.tsx` + tests | T1 (AppLayout near Toaster mount) | T3, T4 |
| **T5** | 2 | `components/RouteErrorBoundary.tsx`, `Retry.tsx` + tests; error-branch wiring in `BoardPage.tsx`, `ProjectsPage.tsx`, `ProjectSettingsPage.tsx`, `TicketDetailModal.tsx` | Batch 1 (all) | T6, T9 |
| **T6** | 2 | `pages/ForbiddenPage.tsx` + test; `components/RequireRole.tsx`; `routes/index.tsx` | Batch 1 | T5, T7, T9 |
| **T7** | 2 | `pages/NotFoundPage.tsx`; `TicketDetailModal.tsx` ticket-not-found branch; `routes/index.tsx` catch-all (coordinate w/ T6) | Batch 1 | T5 (after), T6 (coordinate routes/index.tsx), T9 |
| **T9** | 2 | audit: `useMoveTicket`, `useUpdateTicket`, `useCreateTicket`, `useLabelMutations`, `useDeleteTicket`, `useUserManagement`, `useUpdateProject`; minor revert-messaging tweaks | T2 (funnel live) | T5, T6, T7 |
| **T10** | 3 | co-located `*.test.tsx` for every new component/page; table-driven; a11y role assertions | Batches 1+2 | — |
| **T11** | 3 | full-repo `rtk tsc`/`vitest`/`lint`/`prettier`/`build`; manual browser smoke per state | T10 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → (T3 ‖ T4 ‖ T8) → T5 → (T6 ‖ T7) → T9 → T10 → T11.
- **2 devs:** Dev-A: T1 → T2 → T5 → T7 → T11. Dev-B: T3 → T4 → T8 → T6 → T9 → T10. (Hand off `BoardPage.tsx`/`TicketDetailModal.tsx` carefully — T4/T5/T7 all touch them; sequence within Dev-A.)
- **3 devs:** Dev-A foundation (T1, T2, T8); Dev-B primitives+empty (T3, T4); Dev-C pages (T5, T6, T7) — then converge T9/T10/T11.

---

## 6. Tasks

### T1 — Toast infra: install sonner, Toaster component, useToast hook, mount

**Batch:** 1 · **Depends on:** F07 (DONE) · **Parallel with:** T3, T8 (NOT T2 — shared `main.tsx`)

**Description:** Introduce the toast system that every other task's error/rollback surfacing depends on. `sonner` is the chosen lib (D1; owner sign-off). Centralize the API behind a `useToast` hook so the underlying lib is swappable.

Create / Modify:
- `frontend/package.json` — add `"sonner": "^1.5.0"` (or latest 1.x; React 19 compatible per Analysis D). Run `npm install`.
- `frontend/src/hooks/useToast.ts` — re-export `sonner`'s API: `export const toast = sonner.toast; export function useToast() { return sonner.toast; }`. Provides `toast.error`, `toast.success`, `toast.message`, `toast.promise`. Central swap-point (D1 rationale).
- `frontend/src/components/Toaster.tsx` — thin wrapper:
  ```tsx
  import { Toaster as SonnerToaster } from 'sonner'
  export function Toaster() {
    return <SonnerToaster position="top-right" richColors closeButton />
  }
  ```
- `frontend/src/main.tsx` — mount `<Toaster/>` INSIDE `<QueryClientProvider>` (so `toast` calls from `MutationCache`/`QueryCache` render within the provider tree) and below `<RouterProvider>`/global `<ErrorBoundary>`. Add `<Toaster />` adjacent to `<RouterProvider />`.
- `frontend/src/components/Toaster.test.tsx` + `frontend/src/hooks/useToast.test.ts` — render `<Toaster/>`, assert `role='region'`/aria attributes; assert `useToast()` returns `toast` with `error`/`success` fns.

**Acceptance Criteria:**
- [ ] `sonner` in `package.json`; `npm install` clean.
- [ ] `<Toaster/>` renders with `role='status'`/`aria-live` (sonner default) and `closeButton`.
- [ ] `useToast()`/`toast.error('x')` from any component displays a toast.
- [ ] `<Toaster/>` mounted in `main.tsx` inside `QueryClientProvider`.
- [ ] `rtk tsc` (FE) passes; `Toaster.test.tsx` + `useToast.test.ts` green.

**Dependencies:** F07 (DONE).

---

### T2 — Global error funnel in queryClient + suppress 403 retries

**Batch:** 1 · **Depends on:** T1 (for `useToast`) · **Parallel with:** T3, T4, T8

**Description:** Make mutation/query failures surface as toasts through a single seam (D5) and stop retrying 403s (D6). This is the load-bearing seam for spec edge case "Optimistic-update rollbacks surfaced as toasts."

Create / Modify:
- `frontend/src/lib/queryClient.ts` — modify the `QueryClient` constructor:
  ```ts
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError) {
            if (error.code === 'UNAUTHENTICATED') return false // existing
            if (error.code === 'FORBIDDEN') return false       // D6 — suppress (was retrying)
          }
          return failureCount < 3
        },
        // NOTE: do NOT set throwOnError globally — opt-in per route (T5).
      },
      mutations: { retry: 0 }, // failures must surface fast (D5)
    },
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        const msg = mutation.meta?.revertMessage ?? 'Action failed — please retry'
        toast.error(msg) // from useToast (T1)
      },
    }),
    queryCache: new QueryCache({
      onError: (error) => {
        // Only toast NON-recoverable / non-retried query errors that aren't handled inline.
        // Inline-<Retry> paths (board) call e.preventDefault-style guard via meta: { suppressGlobalToast: true }
        if ((error as any)?.meta?.suppressGlobalToast) return // pseudocode — actual guard via query.meta
        toast.error('Failed to load data')
      },
    }),
  })
  ```
  Real implementation: gate the `QueryCache.onError` on `query.meta?.suppressGlobalToast !== true` so component-local `<Retry>` paths (T5) don't double-toast. Import `ApiClientError` from `api/client.ts`; branch on `error.code`.
- Add `meta` typing support: extend the `QueryMeta`/`MutationMeta` declarations (module augmentation) for `revertMessage?: string` and `suppressGlobalToast?: boolean`. No `any`.

**Acceptance Criteria:**
- [ ] `MutationCache.onError` emits a `toast.error` for every failed mutation (verify with `useDeleteTicket` returning FORBIDDEN in a test).
- [ ] `revertMessage` from `mutation.meta` overrides the default message.
- [ ] Query 403s no longer retry (was 3× → now 0).
- [ ] Query 401s still no-retry; others still retry ≤3×.
- [ ] Queries with `meta.suppressGlobalToast=true` do NOT trigger the global toast (left to inline `<Retry>`).
- [ ] `rtk tsc` passes (module augmentation compiles); `queryClient.test.ts` (new) green.

**Dependencies:** T1.

---

### T3 — Loading skeleton primitives

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1, T2, T4, T8

**Description:** Build the skeleton primitives (D2) the board + modal loading states consume. Tailwind `animate-pulse`, `aria-hidden` decorative, `aria-busy` on real region.

Create:
- `frontend/src/components/Skeleton.tsx` — base `<Skeleton className/>` = `<div className={cn('animate-pulse rounded bg-neutral-200', className)} aria-hidden="true" />`. Export `SkeletonCard`, `SkeletonLine`, `SkeletonBlock` shape helpers. No `any`; explicit `SkeletonProps`.
- `frontend/src/components/BoardSkeleton.tsx` — composes `Skeleton` into a board layout (3-4 columns × N cards). Props: `{ columnCount?: number }`.
- `frontend/src/components/TicketModalSkeleton.tsx` — composes `Skeleton` into the ticket-detail-modal shape (title block, meta row, description block).
- Co-located `*.test.tsx` — assert `aria-hidden` on shapes; assert `BoardSkeleton` renders `columnCount` columns.

**Acceptance Criteria:**
- [ ] `<BoardSkeleton/>` + `<TicketModalSkeleton/>` render with `animate-pulse` blocks; containers `aria-hidden`.
- [ ] No inline styles; Tailwind classes only; no `any`.
- [ ] `rtk tsc` passes; tests green.

**Dependencies:** —.

---

### T4 — EmptyState primitive + board empty CTA + filtered-empty vs truly-empty + projects-list empty

**Batch:** 1 · **Depends on:** — (empty-state only; coordinate `BoardPage`/`ProjectsPage` with T5 error branches) · **Parallel with:** T3, T8

**Description:** Unified empty states (D9). Reusable component; fix the conflated filtered-empty vs truly-empty bug on the board (`BoardPage.tsx:73` counts all columns); add a "Create project" CTA on the empty projects list (`ProjectsPage.tsx:44` empty `<ul>`); wire the "Add a ticket" CTA to the existing `NewTicketButton` action.

Create / Modify:
- `frontend/src/components/EmptyState.tsx`:
  ```tsx
  interface EmptyStateProps {
    icon?: React.ReactNode
    title: string
    description?: string
    action?: { label: string; onClick: () => void } | React.ReactNode // CTA button or link
  }
  ```
  Dashed border container (match existing `BoardPage.tsx:87-93` style), `role="status"`.
- `frontend/src/components/EmptyState.test.tsx` — table-driven: with/without action; `getByRole('button', { name: /create/i })`.
- `frontend/src/pages/BoardPage.tsx` — REPLACE the inline dashed 'No tickets yet' block (`:87-93`) with `<EmptyState title="No tickets yet" action={<NewTicketButton/>}/>`. ADD a filtered-empty branch: if `totalTicketsAcrossColumns > 0 && filteredCount === 0` → render `<EmptyState title="No tickets match your filters" action={<ClearFiltersButton/>}/>`. The truly-empty check must consider FILTERED counts, not raw (`:73` bug fix).
- `frontend/src/pages/ProjectsPage.tsx` — when `projects.length === 0` render `<EmptyState title="No projects yet" description="Create your first project to get started." action={<Link to="/projects/new">Create project</Link>}/>` instead of empty `<ul>` (`:44`).

**Acceptance Criteria:**
- [ ] `<EmptyState>` renders title/desc/CTA; CTA is a real `<button>`/`<Link>` accessible by role.
- [ ] Board truly-empty shows "Add a ticket" CTA; filtered-empty shows "No tickets match your filters" + "Clear filters".
- [ ] Empty projects list shows "Create project" CTA (no longer empty `<ul>`).
- [ ] No inline styles; no `any`; `rtk tsc` passes; tests green.

**Dependencies:** — (disjoint from T5's error-branch edits but SAME files → merge T4 before T5 branches, or assign one dev both).

---

### T5 — Error boundary + retry: RouteErrorBoundary, Retry component, wire error branches

**Batch:** 2 · **Depends on:** Batch 1 (all) · **Parallel with:** T6, T9

**Description:** The "Error boundaries + retry affordance on failed fetches" acceptance bullet (D3). Two layers: (1) per-route `<RouteErrorBoundary>` using `react-error-boundary` + `<QueryErrorResetBoundary>` for fatal/thrown errors; (2) inline `<Retry>` driven by `useQuery().isError` for component-local.

Create / Modify:
- `frontend/src/components/Retry.tsx`:
  ```tsx
  interface RetryProps { message?: string; onRetry: () => void; }
  export function Retry({ message = 'Failed to load.', onRetry }: RetryProps) {
    return (
      <div role="alert" className="...">
        <p>{message}</p>
        <button onClick={onRetry}>Retry</button>
      </div>
    )
  }
  ```
  `role="alert"` (assertive) per D8.
- `frontend/src/components/RouteErrorBoundary.tsx` — wraps `react-error-boundary`'s `<ErrorBoundary>` inside `<QueryErrorResetBoundary>`; `fallbackRender={({ resetErrorBoundary }) => <Retry message="Something went wrong." onRetry={resetErrorBoundary} />}`. Used to wrap route elements in `routes/index.tsx` (T6/T7 coordinate the actual route wrapping to avoid conflict — T5 owns the COMPONENT; route wiring assigned to T6 to keep `routes/index.tsx` single-owner).
- Wire error branches (component-local `<Retry>` from `isError`):
  - `BoardPage.tsx` — on `useBoard().isError` render `<Retry message="Failed to load board." onRetry={refetch}/>` (replace inline error string `:33`). Set `meta: { suppressGlobalToast: true }` on the board query so T2's funnel doesn't double-toast.
  - `ProjectsPage.tsx` — add error branch: `<Retry message="Failed to load projects." onRetry={refetch}/>` (currently swallowed, no branch).
  - `ProjectSettingsPage.tsx` — add `<Retry>` branch (currently no error branch).
  - `TicketDetailModal.tsx` — on `isError` render `<Retry>` inside the modal instead of returning `null` (`:86`); on `!ticket && !isPending && !isError` render a not-found state (coordinate with T7's ticket-404 wording).
- `RouteErrorBoundary.test.tsx`, `Retry.test.tsx` — assert `getByRole('alert')`, `getByRole('button', { name: /retry/i })`; click retry → refetch called.

**Acceptance Criteria:**
- [ ] `<Retry>` renders `role="alert"` + a "Retry" button; click invokes `onRetry`.
- [ ] `<RouteErrorBoundary>` catches a thrown error and renders `<Retry>`; reset refetches (via `QueryErrorResetBoundary`).
- [ ] Board/Projects/Settings/TicketModal show `<Retry>` on `isError` (no more silent swallows / blank modal).
- [ ] Board query sets `meta.suppressGlobalToast` so no double-toast with T2.
- [ ] `rtk tsc` passes; tests green (Components >70%).

**Dependencies:** Batch 1 (T2 funnel, T3 skeleton not required but same files).

---

### T6 — ForbiddenPage (403) + RequireRole renders it

**Batch:** 2 · **Depends on:** Batch 1 · **Parallel with:** T5, T7 (coordinate `routes/index.tsx`), T9

**Description:** The "403 for forbidden actions" acceptance bullet (D4). Flip `RequireRole` from a silent redirect to rendering a real 403 page — this is the first end-to-end exercise of MEMBER-deny UI (F07 verification gap).

Create / Modify:
- `frontend/src/pages/ForbiddenPage.tsx`:
  ```tsx
  export function ForbiddenPage() {
    return (
      <section role="alert" className="...">
        <h1>403 — Forbidden</h1>
        <p>You don't have permission to do that.</p>
        <Link to="/">Back to board</Link>
      </section>
    )
  }
  ```
- `frontend/src/pages/ForbiddenPage.test.tsx` — assert `getByRole('heading', { name: /403/i })`, `getByRole('link', { name: /back/i })`, `role="alert"` region.
- `frontend/src/components/RequireRole.tsx` — change the deny branch from `<Navigate to="/" replace/>` (`:17`) to `<ForbiddenPage/>`. Keep `useRequireRole` hook unchanged (used imperatively elsewhere). This is a guard-component (NOT an error boundary) per D4.
- `frontend/src/routes/index.tsx` — NO new `/forbidden` route (guard-component form renders inline within the protected layout, preserving `AppLayout`). Single-owner of `routes/index.tsx` in Batch 2 — T7's catch-all edits coordinate via this task.

**Acceptance Criteria:**
- [ ] `<ForbiddenPage/>` renders `h1` 403, explanation, "Back to board" link, `role="alert"`.
- [ ] A MEMBER hitting an ADMIN route sees `<ForbiddenPage/>` (not a silent redirect to `/`).
- [ ] `useRequireRole` imperative callers unaffected.
- [ ] `rtk tsc` passes; test green.

**Dependencies:** Batch 1; coordinate `routes/index.tsx` with T7.

---

### T7 — NotFoundPage polish + ticket-not-found in modal + catch-all placement

**Batch:** 2 · **Depends on:** Batch 1 · **Parallel with:** T5 (after, on `TicketDetailModal`), T6 (coordinate `routes/index.tsx`), T9

**Description:** The "404 for unknown routes/tickets" acceptance bullet (D4). Polish the existing minimal `NotFoundPage`; add ticket-not-found inside the modal (currently `null`); confirm catch-all `<Route path='*'>` is the LAST child (placement owner sign-off).

Create / Modify:
- `frontend/src/pages/NotFoundPage.tsx` — enhance: `<h1>404 — Page not found</h1>`, short explanation, primary CTA `<Link to="/">Back to board</Link>`, `role="alert"` region. Reuse `<EmptyState>` if it fits (D9) — optional.
- `frontend/src/pages/NotFoundPage.test.tsx` — assert heading + link.
- `frontend/src/pages/TicketDetailModal.tsx` — when ticket genuinely not-found (`!ticket && !isPending && !isError` → 404 from API): render `<EmptyState title="Ticket not found" description="It may have been deleted." action={<button onClick={onClose}>Close</button>}/>` instead of returning `null` (`:86`). Coordinate with T5's error branch in the same file (sequence T5 → T7, or one dev owns both).
- `frontend/src/routes/index.tsx` — confirm `<Route path="*" element={<NotFoundPage/>}/>` is the LAST child of the authed `AppLayout` subtree (current placement `:68`). Owner sign-off: keep inside authed subtree (unauthed → login) vs hoist to top-level (unauthed stray URLs see 404). Default decision: KEEP current placement (least surprise — stray URL while logged out → login).

**Acceptance Criteria:**
- [ ] `<NotFoundPage/>` renders 404 `h1`, explanation, "Back to board" link, `role="alert"`.
- [ ] Opening a deleted/unknown ticket (`/projects/:slug/tickets/999`) shows "Ticket not found" + Close (not blank modal).
- [ ] Unknown route (`/nonexistent`) shows `<NotFoundPage/>`.
- [ ] `rtk tsc` passes; test green.

**Dependencies:** Batch 1; coordinate `TicketDetailModal` with T5, `routes/index.tsx` with T6.

---

### T8 — Offline banner: useOnlineStatus + OfflineBanner + AppLayout

**Batch:** 1 · **Depends on:** T1 (AppLayout near Toaster mount) · **Parallel with:** T3, T4

**Description:** The "Offline / network drop → visible state, not silent failure" edge case (D7).

Create / Modify:
- `frontend/src/hooks/useOnlineStatus.ts`:
  ```ts
  export function useOnlineStatus(): boolean {
    const [online, setOnline] = useState(() => navigator.onLine)
    useEffect(() => {
      const on = () => setOnline(true)
      const off = () => setOnline(false)
      window.addEventListener('online', on)
      window.addEventListener('offline', off)
      return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
    }, [])
    return online
  }
  ```
  (TanStack `onlineManager` already wraps this — hook is a thin UI-facing mirror; do not duplicate RQ internals.)
- `frontend/src/components/OfflineBanner.tsx` — `const online = useOnlineStatus(); if (online) return null; return <div role="alert" className="...">You're offline — changes will sync when you reconnect.</div>`.
- `frontend/src/components/AppLayout.tsx` — render `<OfflineBanner/>` at the top of the layout (above `<Outlet/>`). Optionally mount `<Toaster/>` here too if T1 deferred the exact location (coordinate — single owner of the Toaster mount).
- "Back online" toast: in `AppLayout` add an effect watching `useOnlineStatus()` transitions `false→true` → `toast.success('Back online')` (from T1's `useToast`). Guard against firing on mount.
- `useOnlineStatus.test.ts`, `OfflineBanner.test.tsx` — simulate offline event; assert banner appears with `role="alert"`; simulate online → banner hidden.

**Acceptance Criteria:**
- [ ] `useOnlineStatus()` flips on `online`/`offline` events.
- [ ] `<OfflineBanner/>` renders `role="alert"` when offline; hidden when online.
- [ ] Reconnect (`false→true`) emits a "Back online" toast (no toast on initial mount).
- [ ] RQ default `networkMode: 'online'` unmodified (queries pause offline, no fail-storm).
- [ ] `rtk tsc` passes; tests green.

**Dependencies:** T1.

---

### T9 — Optimistic-rollback toast verification + revert messaging

**Batch:** 2 · **Depends on:** T2 (funnel live) · **Parallel with:** T5, T6, T7

**Description:** Verify D5's global funnel covers all 8 mutations and that optimistic rollbacks produce a user-visible toast (spec edge case: "Optimistic-update rollbacks surfaced as toasts"). Read-mostly audit + minor `meta.revertMessage` tweaks.

Audit / Modify:
- Read `useMoveTicket`, `useUpdateTicket`, `useCreateTicket` (`hooks/useTicketMutations.ts` or wherever), `useUpdateLabel`/`useDeleteLabel` (`useLabelMutations.ts:22-73`), `useDeleteTicket`, `useUserManagement`, `useUpdateProject`.
- For each, confirm: no `onError` (single funnel handles it) AND set `meta: { revertMessage: '<specific>' }` so the toast is meaningful:
  - move → "Couldn't move ticket — reverted"
  - update ticket → "Couldn't save changes — reverted"
  - create ticket → "Couldn't create ticket"
  - update label → "Couldn't update label — reverted"
  - delete label → "Couldn't delete label — reverted"
  - delete ticket → "Couldn't delete ticket" (non-optimistic but still surfaced)
  - user role change → "Couldn't update role"
  - update project → "Couldn't save project settings"
- Remove the inline `ProjectSettingsPage.tsx:74` `updateMut.error` read (now redundant — global funnel toasts it) to avoid double-surfacing. Coordinate with T5 (same file).

**Acceptance Criteria:**
- [ ] Every mutation has a specific `meta.revertMessage`.
- [ ] No mutation has a competing `onError` toast (single funnel).
- [ ] `ProjectSettingsPage` no longer reads `updateMut.error` inline (no double-toast).
- [ ] Manual: trigger a rollback (e.g. move ticket while server returns 409/500) → revert toast appears.
- [ ] `rtk tsc` passes.

**Dependencies:** T2; coordinate `ProjectSettingsPage.tsx` with T5.

---

### T10 — Tests: co-located *.test.tsx for every new component, table-driven, a11y assertions

**Batch:** 3 · **Depends on:** Batches 1+2 · **Parallel with:** —

**Description:** Hit the Components >70% coverage target (`.claude/rules/js-testing-rules.md`). Table-driven where applicable. Testing Library priority `getByRole` > `getByLabelText` > `getByText` > `getByTestId`. Assert a11y roles per D8.

Create / augment:
- `Skeleton.test.tsx`, `BoardSkeleton.test.tsx`, `TicketModalSkeleton.test.tsx` — `aria-hidden`, shape counts.
- `EmptyState.test.tsx` — table-driven: `{ icon, title, description, action }` permutations; CTA discoverable by role.
- `Retry.test.tsx`, `RouteErrorBoundary.test.tsx` — `role="alert"`, retry button, reset → refetch.
- `ForbiddenPage.test.tsx`, `NotFoundPage.test.tsx` — headings + links + `role="alert"`.
- `Toaster.test.tsx`, `useToast.test.ts` — toast renders on `toast.error`.
- `useOnlineStatus.test.ts`, `OfflineBanner.test.tsx` — event-driven online/offline.
- `queryClient.test.ts` — `MutationCache.onError` toasts; 403 no-retry; 401 no-retry; retry ≤3 otherwise; `suppressGlobalToast` meta honored.
- Page-level integration tests: `BoardPage.test.tsx` (skeleton on pending, retry on error, empty CTA, filtered-empty); `ProjectsPage.test.tsx` (empty CTA); `TicketDetailModal.test.tsx` (skeleton, retry, not-found).

**Acceptance Criteria:**
- [ ] Every new component has a co-located `*.test.tsx`.
- [ ] Tests use `getByRole`/`getByRole('alert')`/`getByRole('button', { name: /retry/i })` (not `getByTestId`).
- [ ] `rtk vitest run` green; component coverage >70%.
- [ ] `rtk tsc` passes (test files typecheck).

**Dependencies:** Batches 1+2 merged.

---

### T11 — Integration verification & sign-off

**Batch:** 3 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof.

Steps:
1. `rtk tsc` (FE) — zero errors.
2. `rtk vitest run` — all green; coverage report >70% components.
3. `rtk lint` + `rtk prettier --check` — zero violations.
4. `npm run build` (Vite) — succeeds.
5. Manual browser smoke (covers every state):
   - **Loading:** throttle network → board + ticket modal show skeletons (not text).
   - **Empty:** new workspace → projects list shows "Create project"; empty board shows "Add a ticket".
   - **Filtered-empty:** apply a filter that matches 0 tickets → "No tickets match your filters" + "Clear filters".
   - **Error + retry:** kill backend → board shows `<Retry>`; click Retry → reloads on restore.
   - **404:** `/nonexistent` → 404 page; open deleted ticket `tickets/999` → "Ticket not found" + Close.
   - **403:** MEMBER visits `/settings` (ADMIN route) → `<ForbiddenPage/>` (not redirect).
   - **Offline:** DevTools → Offline → banner appears; go online → "Back online" toast; paused mutation resumes.
   - **Optimistic rollback:** move ticket while backend returns 409 → revert toast.
   - **Mutation failure:** delete ticket as non-admin → toast "Couldn't delete ticket".
   - **a11y:** axe/keyboard tab through 404/403/retry/toast — focus visible, roles announced.

**Acceptance Criteria:**
- [ ] All four feature Acceptance bullets satisfied (record observable proof per state).
- [ ] Both edge cases (offline, optimistic rollback) demonstrated.
- [ ] `rtk tsc`/`vitest`/`lint`/`prettier`/`build` exit codes `0`.
- [ ] Manual smoke checklist fully walked; screenshots/notes recorded below.

**Dependencies:** T1–T10.

---

## 7. Final F28 Acceptance Checklist

- [ ] Loading skeletons for board + modal (`<BoardSkeleton/>`, `<TicketModalSkeleton/>`).
- [ ] Empty states with clear CTAs: no project → "Create project"; empty board → "Add a ticket"; filtered-empty → "Clear filters".
- [ ] Error boundaries + retry affordance on failed fetches (`<RouteErrorBoundary>` + `<Retry>`).
- [ ] 404 for unknown routes/tickets; 403 for forbidden actions (`<NotFoundPage/>`, `<ForbiddenPage/>`, `RequireRole` renders it).
- [ ] Offline/network-drop → visible banner (not silent failure); "Back online" toast on reconnect.
- [ ] Optimistic-update rollbacks surfaced as toasts (global `MutationCache.onError` funnel).
- [ ] a11y (proposed WCAG 2.1 AA): `role="alert"` errors/403, `aria-live`/`role="status"` toasts/skeletons, `aria-hidden` decorative skeletons, `aria-busy` on real data regions, focus management on 404/403.
- [ ] No `any`; no `console.log`; no inline styles; no new schema/migration.
- [ ] Single-line `SLYK-F28:` commits; branch `feature/SLYK-F28-ux-polish-empty-loading-error-states`; rebase-merge only.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass (Components >70% coverage).

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- Loading skeleton screenshot path: `________`
- Empty-state CTA screenshot path: `________`
- 404 page screenshot path: `________`
- 403 page screenshot path: `________`
- Offline banner screenshot path: `________`
- Rollback toast screenshot path: `________`
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F28 owns NONE.** Pure frontend (React components, hooks, routing, `queryClient` config, one new npm dependency). No migration, no schema change, no backend change.

---

## 9. Cross-cutting decisions — NEEDING OWNER SIGN-OFF

1. **Add `sonner` dependency** (D1) — recommended over a zero-dep custom Zustand toaster. `sonner` gives correct a11y (`role="status"`/`aria-live`), `toast.promise()` for revert flows, Tailwind override, React 19 compat, ~5-8 kB. Custom toaster reinvents a11y + queue. **Recommend: sonner.** Sign-off required (new dep).
2. **Propose WCAG 2.1 AA as the accessibility bar** (D8) — no project rule mandates a standard. F28 PROPOSES `role="alert"`/`aria-live`/`aria-busy`/`aria-hidden`/focus-management. **Recommend: adopt WCAG 2.1 AA for F28 and future UX work.** Sign-off to set the precedent.
3. **404 catch-all route placement relative to `AppLayout`** (D4) — currently `<Route path="*">` is INSIDE the authed subtree (unauthed stray URLs → login redirect). **Decision: KEEP current placement** (least surprise — a logged-out user hitting a bad URL should land on login, not a 404). Owner to confirm or request hoisting to top-level.
4. **Suppress 403 query retries globally** (D6) — existing `lib/queryClient.ts:14` retries 403s (stale F07 deferral; F17/F25 now DONE, backend `requireRole` live). **Decision: suppress** (no-retry on `FORBIDDEN`). Behavior change. Owner to confirm.

**Sources:**
- `basic-PRD.md` REQ-1.3 (Admin/Member roles — basis for 403), REQ-2.4 (30s poll — interacts with loading/error/offline), §1 (frictionless).
- Dependency task doc: [F07](../F07-session-lifecycle-auth-guards/F07-session-lifecycle-auth-guards-tasks.md) (`RequireAuth`, `RequireRole`, `useRequireRole`, `apiFetch` 401 interceptor, `registerLogoutHandlers` single-choke-point pattern).
- Cross-feature lines: F03 (error envelope closed vocab `UNAUTHENTICATED`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION_FAILED`), F04 (global `ErrorBoundary` + `ErrorFallback` — F28 extends per-route), F06 (domain mismatch → 403 clear msg), F09 (column empty state — F28 unifies), F10 (poll pause on hidden tab + optimistic rollback — F28 toast target), F11 (drop-reject toast), F17 (403 non-admin delete + confirm dialog), F25 (removed entities render gracefully).
- Grounding: `frontend/src/routes/index.tsx:34-68`; `frontend/src/lib/queryClient.ts:4-19`; `frontend/src/main.tsx:20-21`; `frontend/src/components/ErrorBoundary.tsx`; `frontend/src/components/ErrorFallback.tsx`; `frontend/src/components/RequireRole.tsx:5-17`; `frontend/src/hooks/useRequireRole.ts:3,8`; `frontend/src/api/client.ts:5-22,34,76-103`; `frontend/src/hooks/useBoard.ts:25`; `frontend/src/pages/BoardPage.tsx:27,30,33,73,87-93`; `frontend/src/pages/ProjectsPage.tsx:36,44`; `frontend/src/pages/ProjectSettingsPage.tsx:31,34,74`; `frontend/src/pages/TicketDetailModal.tsx:45,86`; `frontend/src/components/AppLayout.tsx`; `frontend/src/components/HealthBadge.tsx`; `frontend/src/hooks/useLabelMutations.ts:22-73`; `backend/src/utils/envelope.ts:8,21`.
- External research (2026): TanStack Query v5 `isPending`/`isError`/`throwOnError` + `<QueryErrorResetBoundary>` + `react-error-boundary` `fallbackRender`/`resetKeys`; `sonner` a11y/size; Tailwind `animate-pulse` skeletons; `networkMode: 'online'` + `onlineManager` + `resumePausedMutations`; react-router v7 terminal `path='*'` + guard-component 403.
- Project rules: `.claude/rules/git-guidelines.md` (SLYK-F28; rebase-merge), `.claude/rules/js-development-rules.md` (React Query server state; Zustand client UI; one component per file; co-located tests; explicit prop interfaces), `.claude/rules/js-style-guide.md` (printWidth 100; singleQuote; no `any`/`console.log`/inline styles/`useMemo`-unless-needed/magic-numbers/prop-drilling), `.claude/rules/js-testing-rules.md` (Vitest; table-driven; `getByRole` priority; Components >70%).
- Memory: `confirm-modals-for-destructive-actions` (F28 surfaces forbidden destructive-action attempts via 403 + toast; existing confirm dialogs unchanged).
