# F07 — Session lifecycle & auth guards: Plan + Task Breakdown

> **Feature:** F07 — Session lifecycle & auth guards (Phase 1 — Identity & Access)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F05 (merged), F06 (merged) · **PRD ref:** REQ-1.1, REQ-1.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/{js-development-rules,js-style-guide,js-testing-rules,git-guidelines,persona}.md`, plus dependency task docs: [F05](../F05-google-sso-login-jwt-issuance/F05-google-sso-login-jwt-issuance-tasks.md), [F06](../F06-onboarding-workspace-roles/F06-onboarding-workspace-roles-tasks.md)

---

## 1. F07 Recap

**Goal:** Authenticated state is enforced end to end — protected routes redirect unauthenticated users to login; the API rejects requests without a valid JWT; logout invalidates the session; token refresh keeps users signed in across reloads.

**Ships:** A user who is logged in stays logged in across reloads and tab activity (sliding `/me` refresh on focus + near-expiry, single-logout on a hard 401); a user whose token is rejected is logged out exactly once globally; logging out on one tab logs out all tabs; admin-only routes and UI are gated by `requireRole('ADMIN')` backend + `<RequireRole role="ADMIN">` frontend; a role change that bumps `tokenVersion` hard-expires outstanding tokens for that user.

**Acceptance (definition of done):**

1. `authenticate` middleware rejects missing/expired/mismatched-version tokens with 401.
2. Frontend auth context exposes current user + role; gates UI by role.
3. Refresh strategy keeps sessions alive across reloads without forcing re-login every few minutes.
4. Logout clears server/client session state.
5. (Edge resolutions below are part of DoD.)

(All four bullets copied verbatim from `features.md` F07; tightened with the observable wiring each implies: `ver`-claim compare, `<RequireRole>` + `TopNav` role-gating, sliding `/me`, `/logout` bumps `tokenVersion`, cross-tab BroadcastChannel, single-logout 401 interceptor.)

**Edge cases — resolved up front:**

- **Role changed by an admin (F25) must take effect** → **Decision: ship `token_version` machinery now (D3).** `Users.tokenVersion int default 0 notNull` column + `ver` claim on the JWT + `authenticate` compares JWT `ver` to DB `tokenVersion` → 401 on mismatch. F07 ships the machinery and exposes `bumpTokenVersion(userId)`; **F25 is the consumer** that calls it on demotion. F06 deferred this explicitly (single-admin model has no live role transition); F07 owes it. Note: `/me` is already DB-authoritative (F06 D4) and F07 uses sliding `/me`, so role changes propagate on the next `/me` call anyway — `token_version` adds hard mid-window invalidation. Cite F06 tasks.md §9(c) (the prescriptive recipe), SO 21978658, Curity JWT best practices.
- **401 from any API call → global interceptor logs the user out once, not per-request** → **Decision: enhance `apiFetch` with a module-level `isLoggingOut` flag + single `/me` refresh attempt before hard-logout (D6).** Before logging out, attempt ONE `fetchMe()` (which mints a fresh 8h JWT via the F06 re-sign path). If `/me` itself 401s → broadcast logout + clear + `queryClient.clear()` + navigate. `isLoggingOut` dedupes N concurrent 401s into one logout. `/auth/*` paths are exempt from the interceptor to avoid infinite loops (supertokens #113). Cite D5 (Kent C. Dodds, Jason Watmore, supertokens #113).
- **Concurrent tabs: logout in one tab should reflect in others** → **Decision: BroadcastChannel primary + storage event fallback (D5).** New `useCrossTabLogout` hook mounted in `AppLayout`; channel `'slyk-auth'`; on `{type:'logout'}` → `clear()` + `queryClient.clear()` + `navigate('/login')`. Storage-event fallback listens for the `slyk-auth` localStorage key removal (fires when another tab clears). Cite D5 (MDN BroadcastChannel, Chrome blogs).

**Scope boundary (explicit deferrals):**

- **HttpOnly-cookie token storage + opaque refresh-token rotation + reuse detection** → **F29** (or a dedicated hardening feature). F07 RECOMMENDS staying on the F05 localStorage + Zustand persist transport (D1). This is the #1 owner sign-off question (§9a). HttpOnly migration is a large rewrite (apiFetch, useAuthStore, new `refresh_tokens` table, cookie wiring, CORS `SameSite` tuning) better scoped to a dedicated feature.
- **Google token revocation on logout** → **F29** (deferred from F05 tasks.md line 101, same as F05 did). F07 ships app-level invalidation (`tokenVersion` bump on `/logout`).
- **Multi-admin demotion (the role-change trigger)** → **F25.** F07 ships `bumpTokenVersion(userId)`; F25 calls it.
- **Third role (e.g. `VIEWER`)** → F25 may introduce; F07 keeps the 2-value `pgEnum` (F06 D5).

---

## 2. Codebase Analysis Summary

- **State:** **Partial — F05/F06 plumbing complete, F07 lifecycle absent.** F05 (SSO + JWT issuance) and F06 (onboarding gate + first-admin) are merged on `main`. F07 builds the session-lifecycle layer on top. All files F07 touches confirmed to exist on `main`.
- **Existing structure F07 builds on (with path citations):**
  - **JWT signer/verifier:** `backend/src/utils/jwt.ts:1-35`. Constants `JWT_TTL = '8h'` (`:6`), `JWT_CLOCK_TOLERANCE = '30s'` (`:7`). `JwtUserClaims { sub, email, role }` at `:11-15` — **NO `ver` claim** (F07 adds it). Secret via `new TextEncoder().encode(env.jwtSecret)`. `signJwt` sets `iss:'slykboard'`, `aud:'slykboard-web'`, `exp` via `JWT_TTL`. `verifyJwt` returns `JwtUserClaims & JWTPayload`. F07 passes `ver` through both.
  - **Auth routes:** `backend/src/routes/auth.routes.ts` (mounted `app.use('/api/auth', authRouter)` at `index.ts:48`):
    - `POST /api/auth/google` (`:15-40`): exchange + `assertDomainAllowed` + upsert + sign. **No F07 change.**
    - `GET /api/auth/me` (`:46-64`): behind `authenticate`; **already re-fetches DB row via `findUserById` and re-signs a fresh 8h JWT on every call** (`:51`). This is the natural anchor for sliding refresh (D2). F07's `/me` change: also pass `ver` into `signJwt`.
    - `POST /api/auth/logout` (`:67-69`): **stateless stub / no-op**, comment "D10: stateless JWT, logout is client-side. No denylist." Returns `{ success: true }`. F07 makes it meaningful: call `bumpTokenVersion(req.user.id)` (D4).
  - **`authenticate` middleware:** `backend/src/middleware/auth.ts:8-31`. Reads `Authorization: Bearer` (case-insensitive scheme via `/^Bearer\s+(.+)$/i`), `verifyJwt`, attaches `req.user = { id, email, role }`, throws `AppError(UNAUTHENTICATED)` on missing/malformed/expired. **NO DB read today** — F07 adds the `tokenVersion` compare (loads the row F06's `findUserById` already provides). **NO `requireRole('ADMIN')` guard exists** — F07 adds it.
  - **Token transport:** response BODY (`{ data: { token, user } }`), NOT cookie. Frontend persists token in **localStorage via Zustand `persist`** (key `'slyk-auth'`), `frontend/src/stores/useAuthStore.ts:1-32`. `:19` comment: "Accepted XSS tradeoff — F07 hardens." `AuthUser` shape `{ token, id, email, name, role, avatarUrl }` (`:4-11`). F07 KEEPS this transport (D1) but hardens the lifecycle around it.
  - **`apiFetch`:** `frontend/src/api/client.ts:26-76`. Reads `useAuthStore.getState().user?.token` (`:28`), injects `Authorization: Bearer` (`:35-37`). Throws `ApiClientError({ code: 'UNAUTHENTICATED' })` on 401 (`:57`). **NO global 401 interceptor / dedupe** — F07 adds it (D6). `ApiClientError.code` typed `ErrorCodeValue | 'NETWORK_ERROR'` (`:7`).
  - **`<RequireAuth>`:** `frontend/src/components/RequireAuth.tsx:1-25`. Uses `jose decodeJwt` (UNVERIFIED — client-side `exp` check only, `:5-13`); redirects to `/login` with `state={{ from: location }}` (`:22`); `clear()` on expired (`:21`). Tested at `RequireAuth.test.tsx`. F07 keeps this as the unauthenticated gate; `<RequireRole>` is a separate role gate (D7).
  - **Router:** `frontend/src/routes/index.tsx:10-29`. `createBrowserRouter`; `/login` public; everything else under `<RequireAuth>` layout → `<AppLayout>` → children (`/`, `/reports`, `/settings`, `*`). F07 gates `/settings` (admin-only) with `<RequireRole role="ADMIN">` (D7).
  - **TanStack Query:** `frontend/src/lib/queryClient.ts:1-11`. `staleTime: 30_000`, `retry: 3`, `refetchOnWindowFocus: true`. Mounted at `main.tsx:21`. **NO global `onError`/401 handler** — F07 wires the 401 path (D6) and a `/me` boot query for rehydration (D2). `refetchOnWindowFocus: true` already provides the "slide on activity" behavior for any `/me` query.
  - **Logout wiring:** `frontend/src/components/TopNav.tsx:23-27`. `handleSignOut`: `await logout()` (best-effort POST, swallows errors per `api/auth.ts:28-34`) → `clear()` → `navigate('/login', {replace:true})`. All 3 nav links render for everyone (`NAV_LINKS` `:6-10`) — **no role-gated nav**; F07 gates the Settings link (D7).
  - **AppLayout:** `frontend/src/components/AppLayout.tsx:1-15`. Renders `<TopNav/>`, `<HealthBadge/>`, `<Outlet/>`. F07 mounts `<CrossTabLogoutSync/>` (the `useCrossTabLogout` hook) here (D5).
  - **Schema (Drizzle 0.45 + pg):** `backend/src/db/schema.ts:9-30`. `Users`: `id uuid PK`, `googleId`, `email`, `fullName`, `avatarUrl`, `role (roleEnum 'ADMIN'|'MEMBER', default 'MEMBER' notNull)`, `createdAt`, `updatedAt`. `usersOneAdminIdx` partial unique index (`:26-29`, F06). **NO `tokenVersion` column** — F07 adds it (§8). Migrations applied: `0000` + `0001`. Migration runner `backend/src/db/migrate.ts`; Makefile `make migrate` / `make migrate-generate` / `make migrate-push`.
  - **Backend env:** `backend/src/config/env.ts:1-51`. Typed frozen `Config`; keys `port, frontendUrl, nodeEnv, databaseUrl, jwtSecret, googleClientId, googleClientSecret, googleCallbackUrl, allowedDomain?`. **NO JWT TTL / refresh TTL env var** — F07 adds `jwtTtl` (default `'8h'`) (D2). Env validation pattern: required→throw, optional→`|| undefined` (see `allowedDomain` `:47`).
  - **Frontend env:** `frontend/src/config/env.ts:1-18`. `apiBaseUrl`, `googleClientId` via `VITE_*`. No F07 change.
  - **Error-code vocabulary:** `backend/src/utils/envelope.ts:5-12`. Closed `ErrorCode`: `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR`. `codeToStatus` (`:18-25`): **FORBIDDEN → 403 ALREADY mapped** (`:21`) — F06 added it. F07 uses `UNAUTHENTICATED` (401) for token-version mismatch + missing/expired. Error middleware at `errorMiddleware.ts` maps `AppError` → envelope. **No new codes** (D-pattern; closed vocab, owner sign-off required for additions per F03).
  - **CORS:** cookie-ready (`credentials: true` at `index.ts:25`) but F07 does not migrate to cookies (D1).
  - **F05 contracts inherited:** JWT shape (HS256 jose, claims `sub`/`email`/`role`/`exp`/`iss`/`aud`), 8h TTL, token in JSON body (NOT cookie), `/me` re-signs fresh 8h JWT, `/logout` stateless client-side clear, frontend storage = localStorage + Zustand persist (`'slyk-auth'`), `apiFetch` Bearer injection.
  - **F06 contracts inherited:** `pgEnum` role model (`ADMIN`/`MEMBER`), `users_one_admin` partial index (F07 must NOT touch it), `assertDomainAllowed` domain gate, `/me` is DB-authoritative (re-reads row, re-signs role via `findUserById`).
- **Net-new logic F07 creates (no files yet):**
  - `backend/src/services/tokenVersion.ts` — `bumpTokenVersion(userId)` + `findUserTokenVersion(userId)` helpers (D3, D4). Co-located test.
  - `backend/src/middleware/requireRole.ts` — `requireRole(...roles)` (D7). Co-located test.
  - `backend/src/db/migrations/0002_*.sql` — `ALTER TABLE "Users" ADD COLUMN token_version integer NOT NULL DEFAULT 0`.
  - `frontend/src/hooks/useAuthSync.ts` — boot rehydrate + near-expiry refresh + focus refresh (D2). Co-located test.
  - `frontend/src/hooks/useCrossTabLogout.ts` — BroadcastChannel + storage-event logout sync (D5). Co-located test.
  - `frontend/src/hooks/useRequireRole.ts` — client role gate hook (D7). Co-located test.
  - `frontend/src/components/RequireRole.tsx` — `<RequireRole role="ADMIN">` wrapper (D7). Co-located test.
  - `frontend/src/components/CrossTabLogoutSync.tsx` — mounts `useCrossTabLogout` (D5). Co-located test (thin shell; main coverage in the hook test).
- **Prior art / partial work:** F05/F06 shipped the entire auth plumbing (JWT, `/me` re-sign, store, `apiFetch`, `<RequireAuth>`, role claim). F07 is the lifecycle + role-gate layer.
- **File paths the plan references that do NOT exist yet (will be created):** listed above.
- **File paths the plan MODIFIES (exist on `main`):**
  - `backend/src/config/env.ts` (add `jwtTtl`).
  - `backend/src/utils/jwt.ts` (add `ver` to `JwtUserClaims`, read `JWT_TTL` from env).
  - `backend/src/db/schema.ts` (add `tokenVersion` column).
  - `backend/src/middleware/auth.ts` (`ver` compare via `findUserTokenVersion`).
  - `backend/src/routes/auth.routes.ts` (`/logout` bumps `tokenVersion`; `/me` + `/google` pass `ver` into `signJwt`).
  - `backend/.env.example` (document `JWT_TTL`).
  - `frontend/src/api/client.ts` (401 interceptor with `isLoggingOut` dedupe + single `/me` refresh + `/auth/*` exemption).
  - `frontend/src/api/auth.ts` (typed `fetchMe` already exists — confirm; no change expected).
  - `frontend/src/lib/queryClient.ts` (global 401 → interceptor reuse; or rely on `apiFetch` path).
  - `frontend/src/components/AppLayout.tsx` (mount `<CrossTabLogoutSync/>`).
  - `frontend/src/components/TopNav.tsx` (role-gate Settings link; sign-out broadcasts logout).
  - `frontend/src/routes/index.tsx` (wrap `/settings` in `<RequireRole role="ADMIN">`).
  - Co-located test files (`*.test.ts(x)`) for each modified/created source.
- **Project rules this plan must satisfy:** `js-development-rules.md` (RESTful routes, env table, closed `ErrorCode`, layering routes→services→repositories, middleware security, roles via permission middleware, parameterized queries via Drizzle), `js-style-guide.md` (PascalCase components, camelCase hooks, SCREAMING_SNAKE_CASE constants, 4-space JSX / 2-space TS, `import type`, `any` banned, no inline styles, no magic numbers, import order external→internal→type→relative), `js-testing-rules.md` (Vitest, co-located `*.test.ts(x)`, table-driven preferred, `vi.fn`/`vi.mock`, Testing Library priority `getByRole > getByLabelText > getByText > getByTestId`, coverage >80% business / >70% components), `git-guidelines.md` (branch `feature/SLYK-F07-session-lifecycle-auth-guards`, single-line commits `SLYK-F07: <msg>`, rebase-and-merge only, no squash, `.gitignore` intact), `persona.md` (React 19 + Express 5 + Postgres + Google OAuth + Vercel + Render).
- **Hidden coupling to plan for:**
  - **`/me` is the refresh endpoint.** `auth.routes.ts:46-64` already re-signs a fresh 8h JWT. F07 does NOT add a separate refresh endpoint (D2). The interceptor's "attempt one `/me` before logout" (D6) and the boot/focus rehydrate (D2) both call `fetchMe()`. Keep this single-path — simpler, no refresh-token table.
  - **`/me` re-sign path must carry `ver`.** After F07, `signJwt` takes `ver`. Both `/google` and `/me` pass `user.tokenVersion` into it. A stale JWT missing `ver` (issued pre-F07) will fail the new `authenticate` `ver` compare — **migration impact**: all existing tokens invalidate on F07 deploy. Document as expected (deploy = force re-login once).
  - **`authenticate` must load the DB row.** Today `authenticate` only `verifyJwt`s (no DB hit). F07 adds a `findUserTokenVersion(req.user.id)` call to compare `ver`. This is ONE extra indexed `SELECT` per protected request. To bound cost: the query is `SELECT token_version FROM "Users" WHERE id = $1` (PK lookup, sub-ms). Optional Redis cache (TTL ~30s) is F29 scope; F07 does the DB hit directly. Cite D4 (SO canonical tokenVersion answer; Curity).
  - **`/me` already calls `findUserById`.** The interceptor's `/me` refresh attempt (D6) and the `authenticate` `ver` compare (D3) both hit the user row — acceptable (different code paths, different request lifecycles). Do NOT merge them.
  - **`isLoggingOut` dedupe + Promise singleton.** Multiple concurrent requests 401ing must trigger exactly ONE logout. Module-level `let isLoggingOut = false` (or a `Promise` singleton for the refresh attempt) gates the side-effects. Reset in `finally`. Always `return Promise.reject(err)` so downstream callers see the failure (Kent C. Dodds). Exempt `/auth/*` to avoid the interceptor calling itself (supertokens #113).
  - **BroadcastChannel vs storage event.** BroadcastChannel is primary (modern, purpose-built, no echo to sender). Storage-event is a zero-cost fallback for browsers lacking BroadcastChannel (rare in 2026) — listen for `slyk-auth` key removal. Both call the same `handleRemoteLogout()` path. Cite D5 (MDN, Chrome blogs).
  - **`decodeJwt` in `<RequireAuth>` is UNVERIFIED.** This is a client-side UX optimization (redirect before the JWT is actually rejected server-side). The REAL gate is `authenticate` on the server. F07 does not change this; the `useAuthSync` hook (D2) complements it by proactively refreshing near-expiry tokens.
  - **`codeToStatus` already maps FORBIDDEN → 403** (`envelope.ts:21`). F07's `requireRole('ADMIN')` throws `AppError(FORBIDDEN, 'Admin access required')` → 403. No status-map change needed (verify in T6).
  - **`users_one_admin` must not be touched.** F07's only schema delta is the `tokenVersion` column. MEMORY warning `drizzle-partial-index-enum-dollar1`: `drizzle-kit generate` emits unapplyable `$1` SQL for the enum partial index — F07 must reconcile to literal `'ADMIN'` if regeneration re-emits it (T2 step: inspect generated SQL for the `$1` regression).
  - **Express 5 async middleware catches rejected promises automatically.** `throw new AppError(...)` inside `async` middleware/route → `errorHandler`. No try/catch wrapper needed for control-flow throws.
  - **`verbatimModuleSyntax`** — all type-only imports use `import type`. Applies to `JwtUserClaims`, `AuthenticatedUser`, `UserRow`, role types.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | **Token storage** | **STAY on localStorage + Zustand persist (`'slyk-auth'`) for F07. Defer HttpOnly-cookie migration to F29.** | F05 already invested in localStorage transport (`useAuthStore.ts:19`); F07 acceptance does NOT mandate cookies ("refresh across reloads" is satisfiable via sliding `/me`). HttpOnly + opaque-refresh-token rotation + reuse detection is a large rewrite (apiFetch, useAuthStore, new `refresh_tokens` table, cookie wiring, CORS SameSite) better scoped to a dedicated feature. F07 hardens the lifecycle (refresh, invalidation, interceptors, role-gate) on the existing transport. **Surfaced as #1 owner sign-off question (§9a).** Cite F05 D2 (accepted XSS tradeoff), OWASP/Auth0 consensus (in-memory OR `__Host-` HttpOnly — research D1). |
| D2 | **Refresh strategy** | **Sliding `/me` + proactive refresh on boot + window focus + near-expiry. No separate refresh-token endpoint.** | `/me` already re-signs a fresh 8h JWT (`auth.routes.ts:51`, F06 D4). F07 wires: (a) boot-time `fetchMe()` rehydrate if a token exists; (b) TanStack Query `/me` query with `refetchOnWindowFocus: true` (already global, `queryClient.ts:8`) slides the 8h window on activity; (c) `useAuthSync` hook calls `/me` before client-side `exp` fires; (d) interceptor attempts ONE `/me` refresh before hard-logout on 401 (D6). `JWT_TTL` becomes env-driven (default `'8h'`). Cite F06 D4, research D2 (sliding sessions; WorkOS SPA auth 2026). |
| D3 | **Role-invalidation mechanism** | **Ship `token_version` (`ver` claim + `Users.tokenVersion int default 0 notNull` + `bumpTokenVersion(userId)` + `findUserTokenVersion(userId)` + `authenticate` compare → 401 on mismatch).** | This is the F06-deferred deliverable F07 owes (F06 tasks.md §9(c) prescriptive recipe). Schema delta: `Users.tokenVersion`. `authenticate` loads DB `tokenVersion` and 401s on mismatch (already loads user via F06 `findUserById` path — extend with a focused `findUserTokenVersion` PK lookup). F07 exposes `bumpTokenVersion`; **F25 calls it on demotion**. `/me` is DB-authoritative so role changes propagate on next `/me` anyway; `token_version` adds hard mid-window invalidation. Cite F06 §9(c), SO 21978658, OneUptime 2026-02, Curity. |
| D4 | **Logout session invalidation** | **`POST /api/auth/logout` calls `bumpTokenVersion(req.user.id)`.** Client-side `clear()` remains authoritative for UX; the bump is defense-in-depth (outstanding JWTs hard-expire). Google token revocation → F29.** | Makes the `/logout` stub (`auth.routes.ts:66-69`) meaningful server-side. The bump invalidates any other tab/session's token for that user (the cross-tab logout D5 handles the UX in the current tab; the bump handles a stolen/other-device token). Consistent with F05's deferral of Google revocation to F29. |
| D5 | **Cross-tab logout sync** | **BroadcastChannel `'slyk-auth'` primary + storage-event fallback.** `useCrossTabLogout` hook mounted in `AppLayout`.** | BroadcastChannel is the modern purpose-built API (MDN/Chrome blogs 2026); storage event is a zero-cost safety net (fires on `slyk-auth` key removal). Both behave consistently (no echo to sender). Pattern: `postMessage({type:'logout'})` / `{type:'login'}`; other tabs → `clear()` + `queryClient.clear()` + `navigate('/login')`. Cite research D5. |
| D6 | **Global 401 interceptor** | **Enhance `apiFetch` with module-level `isLoggingOut` dedupe + single `/me` refresh attempt before hard-logout + `/auth/*` exemption. Also reuse the logout path from `queryClient` for `useQuery` failures.** | N concurrent 401s must fire ONE logout (not N). Before logout: attempt ONE `fetchMe()` (which mints a fresh JWT via F06 re-sign). If `/me` itself 401s → `broadcastLogout()` + `clear()` + `queryClient.clear()` + `navigate('/login', {replace:true})`. `isLoggingOut` gates the side-effects; reset in `finally`. Always `return Promise.reject(err)`. Exempt `/auth/*` to avoid infinite loops. Cite research D5 (Kent C. Dodds, Jason Watmore, supertokens #113). |
| D7 | **Role-gated UI + `requireRole('ADMIN')`** | **New backend middleware `requireRole(...roles)` (sibling to `authenticate`, `middleware/requireRole.ts`) throwing `AppError(FORBIDDEN, 'Admin access required')` → 403. New frontend `<RequireRole role="ADMIN">` component + `useRequireRole` hook. Gate `/settings` route + hide Settings nav link for MEMBERS.** | PRD §REQ-1.3 ("Two user roles: Admin... and Member"), REQ-3.3 ("Only Admins can delete tickets"). `js-development-rules.md` security: "roles (Admin/Member) via a permission middleware". F06 explicitly deferred `requireRole` to F07/F17/F25. FORBIDDEN→403 already mapped (`envelope.ts:21`). Client `<RequireRole>` is a UX guard; the server middleware is the real gate. |
| D8 | **`JWT_TTL` env-driven** | **Add `JWT_TTL` env var (default `'8h'`), read in `jwt.ts` via `env.jwtTtl`. Document in `.env.example`.** | F05 hardcoded `'8h'` (`jwt.ts:6`). F07's refresh strategy depends on TTL; making it env-driven lets owners tune (e.g. `'15m'` for stricter security, `'12h'` for longer sessions) without code change. Matches `js-development-rules.md` env-table convention. Default `'8h'` preserves F05/F06 behavior. |
| D9 | **`bumpTokenVersion` triggers** | **F07 bumps `tokenVersion` ONLY on `POST /api/auth/logout`. Role-change bumps are F25's responsibility (F07 ships the helper, does not call it on role change).** | F07 owns the machinery; F25 owns the multi-admin demotion trigger. F06's single-admin model has no mid-session role change. Bumping on logout gives session invalidation (D4) without coupling to F25. |
| D10 | **Error code reuse** | **Reuse `UNAUTHENTICATED` (401) for missing/expired/version-mismatch tokens; `FORBIDDEN` (403) for role-gate failure. No new error codes.** | Closed vocab per F03 D-pattern (owner sign-off required for additions). Both already mapped (`envelope.ts:20-21`). Cite F06 D7. |

> **Out of F07 scope (explicitly deferred):**
> - **HttpOnly-cookie token storage + opaque refresh-token rotation + reuse detection** → **F29** (or a dedicated hardening feature). F07 stays on localStorage (D1). Surfaced as #1 owner sign-off question (§9a).
> - **Google token revocation on logout** → **F29** (deferred from F05 line 101). F07 ships app-level `tokenVersion` invalidation.
> - **Multi-admin demotion (the `bumpTokenVersion` role-change consumer)** → **F25.** F07 ships `bumpTokenVersion(userId)`; F25 calls it.
> - **Redis `tokenVersion` cache** → **F29.** F07 does the DB PK lookup directly (sub-ms, acceptable for MVP volume).
> - **Third role (`VIEWER`)** → F25 may introduce; F07 keeps the 2-value `pgEnum`.

> **Owner sign-off needed:** D1 (stay on localStorage vs migrate to HttpOnly-cookie now). All other decisions are binding per the evidence above. See §9 for the full sign-off list.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   ├── .env.example                                        # MODIFY (T1) — document JWT_TTL
│   └── src/
│       ├── config/
│       │   └── env.ts                                      # MODIFY (T1) — add jwtTtl (default '8h')
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T2) — add Users.tokenVersion int default 0 notNull
│       │   └── migrations/
│       │       └── 0002_<auto>.sql                         # NEW (T2) — ALTER TABLE ADD COLUMN token_version
│       ├── utils/
│       │   └── jwt.ts                                      # MODIFY (T1) — add `ver` to JwtUserClaims + signJwt; read env.jwtTtl
│       ├── services/
│       │   ├── tokenVersion.ts                             # NEW (T3) — bumpTokenVersion(userId) + findUserTokenVersion(userId)
│       │   └── tokenVersion.test.ts                        # NEW (T3)
│       ├── middleware/
│       │   ├── auth.ts                                     # MODIFY (T3) — ver compare via findUserTokenVersion → 401 on mismatch
│       │   ├── auth.test.ts                                # MODIFY (T3) — ver mismatch scenario
│       │   ├── requireRole.ts                              # NEW (T4) — requireRole(...roles) → FORBIDDEN
│       │   └── requireRole.test.ts                         # NEW (T4)
│       └── routes/
│           ├── auth.routes.ts                              # MODIFY (T4) — /logout bumps tokenVersion; /me + /google pass ver
│           └── auth.routes.test.ts                         # MODIFY (T4) — /logout invalidation + ver-in-JWT scenarios
└── frontend/
    └── src/
        ├── api/
        │   ├── client.ts                                   # MODIFY (T5) — 401 interceptor (isLoggingOut dedupe + single /me refresh + /auth/* exempt)
        │   └── client.test.ts                              # MODIFY (T5)
        ├── hooks/
        │   ├── useAuthSync.ts                              # NEW (T6) — boot rehydrate + focus refresh + near-expiry refresh
        │   ├── useAuthSync.test.ts                         # NEW (T6)
        │   ├── useCrossTabLogout.ts                        # NEW (T6) — BroadcastChannel + storage-event
        │   ├── useCrossTabLogout.test.ts                   # NEW (T6)
        │   ├── useRequireRole.ts                           # NEW (T7) — client role guard hook
        │   └── useRequireRole.test.ts                      # NEW (T7)
        ├── components/
        │   ├── RequireRole.tsx                             # NEW (T7) — <RequireRole role="ADMIN"> wrapper
        │   ├── RequireRole.test.tsx                        # NEW (T7)
        │   ├── CrossTabLogoutSync.tsx                      # NEW (T6) — mounts useCrossTabLogout (thin shell)
        │   ├── AppLayout.tsx                               # MODIFY (T6) — mount <CrossTabLogoutSync/>
        │   └── TopNav.tsx                                  # MODIFY (T7) — role-gate Settings link; sign-out broadcasts logout
        ├── routes/
        │   └── index.tsx                                   # MODIFY (T7) — wrap /settings in <RequireRole role="ADMIN">
        └── lib/
            └── queryClient.ts                              # MODIFY (T5) — global 401 handler reuses the apiFetch logout path
```

**Request lifecycle (authenticated request, post-F07):**

1. Client `apiFetch('/tickets')` → `Authorization: Bearer <jwt>` injected (`client.ts:35-37`).
2. Backend `authenticate` (`middleware/auth.ts`): `verifyJwt` (checks `exp`/`iss`/`aud` via jose, `clockTolerance:'30s'`). If valid, reads `payload.ver` (NEW F07). Calls `findUserTokenVersion(payload.sub)` (NEW F07, T3) — PK lookup `SELECT token_version FROM "Users" WHERE id=$1`. If `payload.ver !== dbTokenVersion` → `throw AppError(UNAUTHENTICATED, 'Token version mismatch')` → 401. Else `req.user = {id, email, role}` → `next()`.
3. (If route is admin-only) `requireRole('ADMIN')` (NEW F07, T4): `req.user.role !== 'ADMIN'` → `throw AppError(FORBIDDEN, 'Admin access required')` → 403.
4. Handler runs.

**Refresh lifecycle (sliding `/me`, post-F07):**

1. Boot: `useAuthSync` (T6) — if `useAuthStore.user?.token` exists, call `fetchMe()` → `/me` re-signs fresh 8h JWT (F06 `auth.routes.ts:51`) → `setUser({token, ...freshUser})`.
2. Window focus: TanStack Query's global `refetchOnWindowFocus: true` (`queryClient.ts:8`) re-runs the `/me` query → slides the 8h window.
3. Near-expiry: `useAuthSync` interval checks `decodeJwt(token).exp`; if within a threshold (e.g. 5 min) of expiry, calls `fetchMe()` to mint a fresh token.
4. On 401 (token expired between refreshes): `apiFetch` interceptor (T5) — if NOT `/auth/*`, attempt ONE `fetchMe()`. On success, retry the original request with the fresh token. On failure, `broadcastLogout()` + `clear()` + `queryClient.clear()` + `navigate('/login', {replace:true})`, gated by `isLoggingOut`.

**Logout lifecycle (post-F07):**

1. User clicks "Sign out" in `TopNav` → `handleSignOut`.
2. `logout()` POST `/api/auth/logout` (best-effort). Backend `auth.routes.ts` (T4): `bumpTokenVersion(req.user.id)` → `UPDATE "Users" SET token_version = token_version + 1 WHERE id = $1`. Returns `{success:true}`.
3. Frontend `clear()` (Zustand → localStorage `slyk-auth` removed) → `broadcastLogout()` via BroadcastChannel (T6) → other tabs' `useCrossTabLogout` fires → `clear()` + `queryClient.clear()` + `navigate('/login')`.
4. Any outstanding JWT for that user is now version-mismatched → next `authenticate` → 401 (defense-in-depth).

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently. **B1 (backend) and B2 (frontend) touch disjoint trees → two developers, zero conflicts.**

### Batch dependency diagram

```
                  ┌─────────────────────────────────────────────────────────────┐
   Batch B1       │ T1  env.jwtTtl + JWT_TTL env + ver claim in jwt.ts            │
   (backend core: │     [config/env.ts, utils/jwt.ts, .env.example]               │
    parallel)     │ T2  tokenVersion column + migration 0002                       │
                  │     [db/schema.ts, db/migrations/0002_*.sql]                  │
                  │     (T1 & T2 disjoint: config+jwt vs db — zero file overlap)  │
                  └──────────────┬──────────────────────────────────────────────┘
                                 │ (jwt.ver shape + tokenVersion column exist)
                                 ▼
                  ┌─────────────────────────────────────────────────────────────┐
   Batch B1 cont. │ T3  tokenVersion service + authenticate ver compare           │
   (backend seq)  │     [services/tokenVersion.ts (NEW)+test, middleware/auth.ts] │
                  │     (consumes T1's ver claim + T2's column)                   │
                  │ T4  requireRole middleware + /logout invalidation + route     │
                  │     wiring                                                   │
                  │     [middleware/requireRole.ts (NEW)+test, routes/auth.routes │
                  │      .ts+test]                                               │
                  │     (T3 & T4 disjoint: tokenVersion+auth.ts vs requireRole+   │
                  │      auth.routes — zero file overlap)                         │
                  └──────────────┬──────────────────────────────────────────────┘
                                 │ (backend complete; /api/auth/* + middleware live)

   Batch B2       ┌─────────────────────────────────────────────────────────────┐
   (frontend core:│ T5  apiFetch 401 interceptor + queryClient global 401        │
    parallel,     │     [api/client.ts+test, lib/queryClient.ts]                 │
    runs ALONGSIDE│ T6  useAuthSync + useCrossTabLogout + CrossTabLogoutSync +   │
    B1)           │      AppLayout mount                                          │
                  │     [hooks/useAuthSync.ts, hooks/useCrossTabLogout.ts,        │
                  │      components/CrossTabLogoutSync.tsx, components/AppLayout  │
                  │      .tsx + co-located tests]                                 │
                  │ T7  <RequireRole> + useRequireRole + TopNav role-gate +       │
                  │      /settings route guard                                    │
                  │     [components/RequireRole.tsx, hooks/useRequireRole.ts,     │
                  │      components/TopNav.tsx, routes/index.tsx + co-located     │
                  │      tests]                                                   │
                  │     (T5/T6/T7 disjoint: client+queryClient vs hooks+AppLayout │
                  │      vs RequireRole+TopNav+routes — zero file overlap)        │
                  └──────────────┬──────────────────────────────────────────────┘
                                 │ (frontend complete)
                                 ▼
                  ┌─────────────────────────────────────────────────────────────┐
   Batch B3       │ T8  Integration verification & sign-off (terminal)             │
   (terminal)     │     (no files; runs lint/typecheck/test/build + curl smoke +  │
                  │      cross-tab manual check + role-gate smoke)                │
                  └─────────────────────────────────────────────────────────────┘
```

- **B1 (backend) and B2 (frontend) run in PARALLEL** — disjoint trees (`backend/**` vs `frontend/**`). Two developers, zero merge conflicts. Merge order between them is free.
- **Within B1: T1 ‖ T2 (disjoint), then T3 ‖ T4 (disjoint, both depend on T1+T2).** T3 and T4 touch different files (`tokenVersion.ts`+`auth.ts` vs `requireRole.ts`+`auth.routes.ts`).
- **Within B2: T5 ‖ T6 ‖ T7 (all disjoint).** T5 = `api/client.ts`+`queryClient.ts`; T6 = hooks + `AppLayout` + `CrossTabLogoutSync`; T7 = `RequireRole` + `useRequireRole` + `TopNav` + `routes`.
- **B3 (T8) is the terminal gate** — needs both B1 and B2 merged.

### Merge order rules

1. **B1: (T1 ‖ T2) merge first, any order.** Both branch off `main`; disjoint files. T3 + T4 branch off the post-T1/T2 `main`.
2. **B1: (T3 ‖ T4) merge second, any order.** Disjoint files. Both consume T1's `ver` claim + T2's column.
3. **B2: (T5 ‖ T6 ‖ T7) merge in parallel with B1, any order.** Disjoint frontend trees. T5's tests mock `fetch`; T6's tests mock BroadcastChannel + `fetchMe`; T7's tests mock `useAuthStore`. None need the backend live for unit tests.
4. **B3 (T8) merges last.** Terminal verification; owns no files.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | B1 | `backend/src/config/env.ts`, `backend/src/utils/jwt.ts`, `backend/.env.example` | F05, F06 | T2 (and all B2) |
| **T2** | B1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0002_*.sql` | F06 | T1 (and all B2) |
| **T3** | B1 | `backend/src/services/tokenVersion.ts` (NEW), `backend/src/services/tokenVersion.test.ts` (NEW), `backend/src/middleware/auth.ts`, `backend/src/middleware/auth.test.ts` | T1, T2 | T4 (and all B2) |
| **T4** | B1 | `backend/src/middleware/requireRole.ts` (NEW), `backend/src/middleware/requireRole.test.ts` (NEW), `backend/src/routes/auth.routes.ts`, `backend/src/routes/auth.routes.test.ts` | T1, T2, T3 | (and all B2) |
| **T5** | B2 | `frontend/src/api/client.ts`, `frontend/src/api/client.test.ts`, `frontend/src/lib/queryClient.ts` | F05 | T6, T7 (and all B1) |
| **T6** | B2 | `frontend/src/hooks/useAuthSync.ts` (NEW), `frontend/src/hooks/useAuthSync.test.ts` (NEW), `frontend/src/hooks/useCrossTabLogout.ts` (NEW), `frontend/src/hooks/useCrossTabLogout.test.ts` (NEW), `frontend/src/components/CrossTabLogoutSync.tsx` (NEW), `frontend/src/components/AppLayout.tsx` | F05, T5 (apiFetch) | T7 (and all B1) |
| **T7** | B2 | `frontend/src/components/RequireRole.tsx` (NEW), `frontend/src/components/RequireRole.test.tsx` (NEW), `frontend/src/hooks/useRequireRole.ts` (NEW), `frontend/src/hooks/useRequireRole.test.ts` (NEW), `frontend/src/components/TopNav.tsx`, `frontend/src/routes/index.tsx` | F06 | T5, T6 (and all B1) |
| **T8** | B3 | (no files — terminal verification) | T4, T7 | — |

### Developer assignment tracks

- **Solo (recommended):** (T1 ‖ T2) → (T3 ‖ T4) → (T5 ‖ T6 ‖ T7) → T8. ~2 days.
- **2 devs (max parallelism):**
  - **Dev-A (backend):** (T1 ‖ T2) → (T3 ‖ T4) → help T8.
  - **Dev-B (frontend):** (T5 ‖ T6 ‖ T7) → help T8.
  - Merge order: B1 (T1/T2 then T3/T4) ‖ B2 (T5/T6/T7) → B3 (T8). Dev-A and Dev-B never touch the same tree.
- **3 devs:**
  - **Dev-A (backend core):** T1 → T3.
  - **Dev-B (backend routes):** T2 → T4.
  - **Dev-C (frontend):** (T5 ‖ T6 ‖ T7) → T8.
  - Merge coordination: T1+T2 land, then T3+T4 land; frontend lands independently; T8 gates.

---

## 6. Tasks

### T1 — Backend: env.jwtTtl + `ver` claim in jwt.ts

**Batch:** B1 · **Depends on:** F05, F06 (merged) · **Parallel with:** T2, T5, T6, T7

**Description:** Make `JWT_TTL` env-driven (D8) and add the `ver` (token version) claim to the JWT shape (D3). Two coupled changes in the config + JWT util. `env.ts` gains a `jwtTtl` key (default `'8h'`); `jwt.ts` reads `env.jwtTtl` instead of the hardcoded constant, and `JwtUserClaims` gains a `ver: number` field that `signJwt` embeds as a private claim. This is the foundation task — T3 (authenticate compare) and T4 (`/me` + `/google` pass `ver`) both depend on the new claim shape.

Create / Modify:

- **`backend/src/config/env.ts`** (MODIFY). Add `jwtTtl` to `Config` + `loadConfig`.

  Current `:3-13` `Config` interface — add after `allowedDomain?`:
  ```typescript
  export interface Config {
    port: number;
    frontendUrl: string;
    nodeEnv: string;
    databaseUrl: string;
    jwtSecret: string;
    jwtTtl: string; // F07 D8: env-driven JWT TTL (jose setExpirationTime string, e.g. '8h', '15m')
    googleClientId: string;
    googleClientSecret: string;
    googleCallbackUrl: string;
    allowedDomain?: string;
  }
  ```

  In `loadConfig` return object (`:38-48`), add:
  ```typescript
  return {
    // ...existing fields...
    jwtTtl: envSource.JWT_TTL || '8h', // F07 D8: default preserves F05/F06 behavior
    // ...
  };
  ```

  Notes: (a) No validation beyond presence — jose's `setExpirationTime` validates the format (`'8h'`, `'15m'`, `'1d'`); an invalid value throws at first `signJwt` call, surfacing as 500 (acceptable; misconfig). (b) `|| '8h'` (not `??`) — empty string falls back too (empty TTL is invalid). (c) `jwtTtl` is required on the interface but optional in env (default applied at load) — this matches `port`'s pattern (`Number(envSource.PORT ?? 3000)`).

- **`backend/src/utils/jwt.ts`** (MODIFY). Add `ver` claim + read `env.jwtTtl`.

  Current `:4-15`:
  ```typescript
  const JWT_ISSUER = 'slykboard';
  const JWT_AUDIENCE = 'slykboard-web';
  const JWT_TTL = '8h';
  const JWT_CLOCK_TOLERANCE = '30s';

  const secretKey = new TextEncoder().encode(env.jwtSecret);

  export interface JwtUserClaims {
    sub: string; // user.id (uuid)
    email: string;
    role: 'ADMIN' | 'MEMBER';
  }
  ```

  F07 change:
  ```typescript
  const JWT_ISSUER = 'slykboard';
  const JWT_AUDIENCE = 'slykboard-web';
  const JWT_CLOCK_TOLERANCE = '30s';
  // F07 D8: TTL is env-driven (env.jwtTtl, default '8h'). Read at sign time so
  // config is the single source of truth. Removed the hardcoded JWT_TTL constant.

  const secretKey = new TextEncoder().encode(env.jwtSecret);

  export interface JwtUserClaims {
    sub: string; // user.id (uuid)
    email: string;
    role: 'ADMIN' | 'MEMBER';
    ver: number; // F07 D3: token version. Compared to Users.tokenVersion in authenticate.
  }
  ```

  `signJwt` (`:17-26`) — embed `ver` + read `env.jwtTtl`:
  ```typescript
  export function signJwt(claims: JwtUserClaims): Promise<string> {
    return new SignJWT({ email: claims.email, role: claims.role, ver: claims.ver })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime(env.jwtTtl)
      .sign(secretKey);
  }
  ```

  `verifyJwt` (`:28-35`) — no change to the signature, but the returned payload now includes `ver`:
  ```typescript
  export async function verifyJwt(token: string): Promise<JwtUserClaims & JWTPayload> {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: JWT_CLOCK_TOLERANCE,
    });
    return payload as JwtUserClaims & JWTPayload;
  }
  ```

  Notes: (a) `ver` is a private claim (number) — jose serializes it as a JSON number. `verifyJwt` returns it via the cast. (b) **BREAKING for existing tokens:** any JWT issued pre-F07 lacks `ver`; the new `authenticate` (T3) will 401 them. This is EXPECTED — F07 deploy = one-time force re-login. Document in `.env.example` + the T8 smoke. (c) Callers of `signJwt` (F06 `auth.routes.ts:26` and `:51`) will break typecheck until T4 adds `ver: user.tokenVersion` — **T1 and T4 are coupled by the `JwtUserClaims` shape**. Since T1 is in B1 and T4 is in B1 (after T3), the typecheck breakage is resolved within B1 before merge. If T1 and T4 are split across devs, coordinate: T1 ships the new interface; T4 ships the call-site updates. **The intermediate commit (T1-only) will NOT typecheck** — this is acceptable ONLY if T1 and T4 land in the same PR/batch. Alternatively, T1 makes `ver` optional (`ver?: number`) and T4 makes it required — DECISION: make `ver` REQUIRED from the start (cleaner; the batch lands together). (d) `import { env } from '../config'` already present (`:2`). (e) Remove the now-unused `JWT_TTL` constant.

- **`backend/.env.example`** (MODIFY). Document `JWT_TTL`.

  Add near the `JWT_SECRET` block:
  ```
  # F07 D8: JWT time-to-live. jose setExpirationTime string ('8h', '15m', '1d').
  # Default '8h' preserves F05/F06 behavior. Shorter = stricter (re-login more often);
  # longer = fewer re-logins. The /me endpoint re-signs on every call (sliding window),
  # so an active user stays signed in well beyond this TTL.
  JWT_TTL=8h
  ```

**Acceptance Criteria:**
- [ ] `Config` interface includes `jwtTtl: string`; `loadConfig` returns `jwtTtl: envSource.JWT_TTL || '8h'`.
- [ ] `JwtUserClaims` includes `ver: number`; `signJwt` embeds `ver` as a private claim + reads `env.jwtTtl` for `setExpirationTime`.
- [ ] `verifyJwt` return type carries `ver`; the hardcoded `JWT_TTL` constant removed.
- [ ] `backend/.env.example` documents `JWT_TTL` (default, format, sliding-window note).
- [ ] Existing `jwt.test.ts` scenarios still pass; NEW scenario: `signJwt` with `ver: 5` produces a token whose `verifyJwt` payload has `ver === 5`. NEW scenario: `env.jwtTtl = '1m'` produces a token expiring in ~1 min (assert `payload.exp - payload.iat ≈ 60`).
- [ ] `npm run typecheck -w backend` passes ONLY after T4 updates the `signJwt` call sites (coordinate within B1). T1's own commit may temporarily not typecheck — flag in PR description.
- [ ] `npm run lint`, `npm run format:check` pass.

**Dependencies:** F05 (`signJwt`/`verifyJwt`), F06 (`env` module). No dependency on T2.

---

### T2 — Backend: `Users.tokenVersion` column + migration 0002

**Batch:** B1 · **Depends on:** F06 (merged) · **Parallel with:** T1, T5, T6, T7

**Description:** Add the `tokenVersion` column to the `Users` table (D3, schema delta §8) and generate migration `0002`. This is the storage half of the token-version mechanism; T3 adds the service helpers + `authenticate` compare. The column is `integer NOT NULL DEFAULT 0` so every existing row starts at version 0 (no data migration needed).

Create / Modify:

- **`backend/src/db/schema.ts`** (MODIFY). Add `tokenVersion` column.

  Current `users` table (`:9-30`) — add the column after `role`:
  ```typescript
  export const users = pgTable(
    'Users',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      googleId: text('google_id').notNull().unique(),
      email: text('email').notNull().unique(),
      fullName: text('full_name').notNull(),
      avatarUrl: text('avatar_url'),
      role: roleEnum('role').default('MEMBER').notNull(),
      // F07 D3: token version for hard session invalidation. authenticate compares
      // the JWT `ver` claim to this column; bumpTokenVersion increments it.
      // Default 0 so existing rows need no data migration.
      tokenVersion: integer('token_version').default(0).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
    },
    (table) => ({
      usersOneAdminIdx: uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN')),
    }),
  );
  ```

  Add `integer` to the `drizzle-orm/pg-core` import (`:2`):
  ```typescript
  import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex, integer } from 'drizzle-orm/pg-core';
  ```

  Notes: (a) `integer('token_version')` — snake_case column name, camelCase access key (matches the table's convention). (b) `.default(0).notNull()` — existing rows get 0 on `ALTER TABLE ... ADD COLUMN ... DEFAULT 0` (PG backfills the default for all rows). (c) **DO NOT touch `usersOneAdminIdx`** (F06's partial unique index). (d) **DO NOT regenerate the whole schema** — MEMORY warning `drizzle-partial-index-enum-dollar1`: `drizzle-kit generate` re-emits unapplyable `$1` SQL for the enum partial index. Use `drizzle-kit generate` (incremental diff), then INSPECT the generated SQL for the `$1` regression and reconcile to literal `'ADMIN'` if present.

- **Generate the migration** via `drizzle-kit generate` from `backend/`:
  ```bash
  npm run db:generate -w backend
  ```

  This produces `backend/src/db/migrations/0002_<auto-name>.sql`. Verify the generated SQL contains ONLY the new column (no spurious index changes):
  ```sql
  ALTER TABLE "Users" ADD COLUMN "token_version" integer NOT NULL DEFAULT 0;
  ```

  **CRITICAL — inspect for the `$1` regression:** open `0002_*.sql` and confirm there is NO `WHERE "role" = $1` (the drizzle-kit enum-partial-index bug). If present, hand-edit to `WHERE "role" = 'ADMIN'` (literal). Cite MEMORY `drizzle-partial-index-enum-dollar1`.

  Apply locally to verify:
  ```bash
  npm run db:migrate -w backend
  psql "$DATABASE_URL" -c '\d "Users"'
  ```
  Confirm `token_version | integer | not null default 0` appears in the column list.

**Acceptance Criteria:**
- [ ] `schema.ts` declares `tokenVersion: integer('token_version').default(0).notNull()` on `users`; `integer` imported.
- [ ] `0002_*.sql` generated via `drizzle-kit generate`; contains `ALTER TABLE "Users" ADD COLUMN "token_version" integer NOT NULL DEFAULT 0;` and NO `$1` regression (or hand-reconciled to `'ADMIN'` literal if the bug fired).
- [ ] `make migrate` (or `npm run db:migrate -w backend`) applies cleanly; `\d "Users"` shows `token_version` column.
- [ ] `usersOneAdminIdx` declaration UNCHANGED (F06 not regressed).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F06 (schema, migration runner). No dependency on T1.

---

### T3 — Backend: tokenVersion service + `authenticate` `ver` compare

**Batch:** B1 · **Depends on:** T1, T2 · **Parallel with:** T4, T5, T6, T7

**Description:** Ship the token-version service (D3) + the `authenticate` middleware compare. New `backend/src/services/tokenVersion.ts` exports `bumpTokenVersion(userId)` (increments the column) and `findUserTokenVersion(userId)` (PK lookup). `authenticate` (`middleware/auth.ts`) gains a `ver` compare: after `verifyJwt` succeeds, load the DB `tokenVersion` and 401 on mismatch. This is the hard mid-session invalidation mechanism F06 deferred.

Create / Modify:

- **`backend/src/services/tokenVersion.ts`** (NEW). Token-version helpers.

  ```typescript
  import { eq, sql } from 'drizzle-orm';
  import { db } from '../db/client';
  import { users } from '../db/schema';

  // F07 D3: PK lookup of the user's current token version. Used by authenticate
  // to compare against the JWT `ver` claim. Indexed by PK (sub-ms).
  export async function findUserTokenVersion(userId: string): Promise<number | undefined> {
    const [row] = await db
      .select({ tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.tokenVersion;
  }

  // F07 D3 + D4: increment the user's token version, hard-expiring all outstanding
  // JWTs for that user (authenticate 401s on ver mismatch). Called by:
  //  - POST /api/auth/logout (T4) — session invalidation.
  //  - F25 (future) — on role demotion. F07 ships the helper; F25 calls it.
  // Uses SQL-side increment (atomic, concurrency-safe).
  export async function bumpTokenVersion(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId));
  }
  ```

  Notes: (a) `sql\`${users.tokenVersion} + 1\`` — Drizzle raw SQL increment (atomic; avoids read-modify-write race). (b) `findUserTokenVersion` returns `undefined` if the user doesn't exist — `authenticate` treats this as 401 (user deleted). (c) Single-responsibility: `tokenVersion.ts` = session invalidation policy; `userService.ts` = persistence (unchanged). (d) `bumpTokenVersion` does NOT also `updatedAt` — the `$onUpdate` hook on `updatedAt` fires automatically on `update`.

- **`backend/src/services/tokenVersion.test.ts`** (NEW). Table-driven.

  - **findUserTokenVersion: returns the column value when found** — mock `db.select().from().where().limit()` → `[{tokenVersion: 3}]`; assert result === 3.
  - **findUserTokenVersion: returns undefined when not found** — mock → `[]`; assert result === undefined.
  - **bumpTokenVersion: increments via SQL** — mock `db.update().set().where()`; assert `set` called with `{ tokenVersion: sql\`token_version + 1\` }` (use `expect.objectContaining` or stringify the SQL). Assert `where` called with `eq(users.id, userId)`.
  - **bumpTokenVersion: no-throw on success** — mock resolves; assert no throw.

  Notes: Drizzle mock pattern from F06 `userService.test.ts:22-40` (fluent chain stub). `sql` template literal comparison is tricky — assert the `queryChunks` or use `expect(db.update).toHaveBeenCalled()` + snapshot the `.set` argument.

- **`backend/src/middleware/auth.ts`** (MODIFY). Add `ver` compare.

  Current `:8-31`:
  ```typescript
  export async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }
    const token = match[1]!;

    try {
      const payload = await verifyJwt(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      next();
    } catch {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }
  }
  ```

  F07 change — add `ver` compare after `verifyJwt`:
  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import { verifyJwt } from '../utils/jwt';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import { findUserTokenVersion } from '../services/tokenVersion';

  export async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }

    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }
    const token = match[1]!;

    let payload;
    try {
      payload = await verifyJwt(token);
    } catch {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }

    // F07 D3: compare JWT `ver` to DB tokenVersion. Mismatch → 401 (hard
    // mid-session invalidation). Covers: logout (bumped), future F25 role demotion.
    const dbTokenVersion = await findUserTokenVersion(payload.sub);
    if (dbTokenVersion === undefined || dbTokenVersion !== payload.ver) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token version mismatch');
    }

    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  }
  ```

  Notes: (a) The `ver` compare is a SINGLE PK lookup per protected request (`findUserTokenVersion` = `SELECT token_version FROM "Users" WHERE id = $1`). Sub-ms on PG. Optional Redis cache is F29 scope (cite D4). (b) `dbTokenVersion === undefined` → user deleted → 401 (consistent with F06 `/me` behavior). (c) The `verifyJwt` + `findUserTokenVersion` are sequential (can't compare ver before verifying the signature). (d) `payload.ver` is now guaranteed present (T1 made it required on `JwtUserClaims`). Pre-F07 tokens fail `verifyJwt`'s cast OR the compare — either way 401. (e) Error message "Token version mismatch" is deliberately generic (do not leak whether the user exists). (f) The catch on `verifyJwt` is narrowed to only wrap the JWT verification (not the DB lookup) — a DB failure should surface as 500, not 401.

- **`backend/src/middleware/auth.test.ts`** (MODIFY — add ver scenarios).

  - **attaches req.user when ver matches** — sign a real JWT with `ver: 0`; mock `findUserTokenVersion` → `0`; assert `req.user = {id, email, role}` + `next()` called.
  - **throws UNAUTHENTICATED when ver mismatches** — sign JWT with `ver: 0`; mock `findUserTokenVersion` → `1`; assert `AppError` w/ `code: 'UNAUTHENTICATED'`, `message: 'Token version mismatch'`; assert `next` NOT called.
  - **throws UNAUTHENTICATED when user not found (dbTokenVersion undefined)** — mock `findUserTokenVersion` → `undefined`; assert UNAUTHENTICATED.
  - **existing scenarios still pass** (regression) — missing header, malformed scheme, expired token (jose), invalid signature. Note: the expired/invalid-signature cases throw in `verifyJwt`'s try/catch BEFORE the `findUserTokenVersion` call — assert `findUserTokenVersion` NOT called for those (early exit).

  Notes: The "ver matches" test signs a real JWT via `signJwt` (import directly; don't mock) so `verifyJwt` passes. Mock `findUserTokenVersion` via `vi.mock('../services/tokenVersion', () => ({findUserTokenVersion: vi.fn()}))`. Pattern from F06 `auth.test.ts`.

**Acceptance Criteria:**
- [ ] `tokenVersion.ts` exports `bumpTokenVersion(userId: string): Promise<void>` (SQL-side increment) + `findUserTokenVersion(userId: string): Promise<number | undefined>` (PK lookup).
- [ ] `authenticate` calls `findUserTokenVersion(payload.sub)` after `verifyJwt`; 401 `UNAUTHENTICATED` `'Token version mismatch'` on mismatch OR user-not-found; `next()` + `req.user` set only on match.
- [ ] `findUserTokenVersion` NOT called when `verifyJwt` fails (expired/invalid) — early exit preserved.
- [ ] All 4 new + existing regression scenarios pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`JwtUserClaims.ver`), T2 (`Users.tokenVersion` column).

---

### T4 — Backend: `requireRole` middleware + `/logout` invalidation + route wiring

**Batch:** B1 · **Depends on:** T1, T2, T3 · **Parallel with:** T5, T6, T7

**Description:** Ship the role-gate middleware (D7) + make `/logout` meaningful (D4) + wire `ver` into the `signJwt` call sites. New `middleware/requireRole.ts` exports `requireRole(...roles)` throwing `AppError(FORBIDDEN)` → 403. `auth.routes.ts` changes: `/me` + `/google` pass `ver: user.tokenVersion` into `signJwt`; `/logout` calls `bumpTokenVersion(req.user.id)`. This task resolves the T1 typecheck breakage (the `signJwt` call sites).

Create / Modify:

- **`backend/src/middleware/requireRole.ts`** (NEW). Role-gate middleware.

  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import type { AuthenticatedUser } from '../types/express';

  // F07 D7: role-gate middleware. Must run AFTER authenticate (which sets req.user).
  // Throws FORBIDDEN (403) if req.user.role is not in the allowed set.
  // Usage: router.delete('/tickets/:id', authenticate, requireRole('ADMIN'), handler)
  export function requireRole(...allowedRoles: AuthenticatedUser['role'][]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      if (!req.user) {
        // Defensive — requireRole must be mounted after authenticate.
        throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
      }
      if (!allowedRoles.includes(req.user.role)) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          `This action requires ${allowedRoles.join(' or ')} role`,
        );
      }
      next();
    };
  }
  ```

  Notes: (a) Returns a middleware factory (curried) so call sites read `requireRole('ADMIN')` (not `requireRole`). (b) `req.user` is set by `authenticate` (F05 `types/express.d.ts:1-5`). (c) FORBIDDEN → 403 already mapped (`envelope.ts:21`). (d) F07 ships the middleware but does NOT yet attach it to any route (no admin-only route exists until F17/F25). T8 verifies the middleware via a test-only mount. F17/F25 will mount it on `DELETE /tickets/:id` etc.

- **`backend/src/middleware/requireRole.test.ts`** (NEW). Table-driven.

  - **calls next when role is allowed** — stub `req.user = {id, email, role: 'ADMIN'}`; `requireRole('ADMIN')`; assert `next` called, no throw.
  - **throws FORBIDDEN when role not allowed** — `req.user.role = 'MEMBER'`; `requireRole('ADMIN')`; assert `AppError` w/ `code: 'FORBIDDEN'`, message includes 'ADMIN'.
  - **throws UNAUTHENTICATED when req.user absent** — `req.user = undefined`; `requireRole('ADMIN')`; assert `UNAUTHENTICATED` (defensive guard).
  - **allows multiple roles** — `requireRole('ADMIN', 'MEMBER')`; `req.user.role = 'MEMBER'`; assert `next` called.

- **`backend/src/routes/auth.routes.ts`** (MODIFY). `/logout` invalidation + `ver` in `signJwt`.

  Current `:26` (`/google`):
  ```typescript
  const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
  ```

  F07 change — add `ver`:
  ```typescript
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    role: user.role,
    ver: user.tokenVersion,
  });
  ```

  Current `:51` (`/me`):
  ```typescript
  const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
  ```

  F07 change — add `ver`:
  ```typescript
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    role: user.role,
    ver: user.tokenVersion,
  });
  ```

  Current `:66-69` (`/logout`):
  ```typescript
  // POST /api/auth/logout — D10: stateless JWT, logout is client-side. No denylist.
  authRouter.post('/logout', (_req, res): void => {
    res.json(success({ success: true }));
  });
  ```

  F07 change — bump tokenVersion (D4):
  ```typescript
  // POST /api/auth/logout — F07 D4: bump tokenVersion to hard-expire outstanding
  // JWTs for this user (defense-in-depth; client-side clear is authoritative for UX).
  // Google token revocation deferred to F29. Best-effort: client swallows errors.
  authRouter.post('/logout', authenticate, async (req, res): Promise<void> => {
    await bumpTokenVersion(req.user!.id);
    res.json(success({ success: true }));
  });
  ```

  Notes: (a) `/logout` now requires `authenticate` (was unauthenticated before — `(_req, res)`). This is correct: to bump the version we need `req.user.id`, which requires a valid token. If the token is already expired, logout is a no-op server-side anyway (the client clears). (b) `bumpTokenVersion` imported from `../services/tokenVersion` (T3). (c) `findUserById` already returns the full row including `tokenVersion` (T2 added the column) — so `/me` and `/google` have `user.tokenVersion` available. (d) Import order: add `bumpTokenVersion` to the existing `../services/...` imports. (e) The `/google` handler's `user` comes from `upsertByGoogleId` (returns `UserRow` which now includes `tokenVersion`). (f) This task resolves T1's typecheck breakage — after T4, all `signJwt` calls pass `ver`.

- **`backend/src/routes/auth.routes.test.ts`** (MODIFY — add F07 scenarios).

  - **POST /google returns token whose decoded JWT has ver === user.tokenVersion** — mock `upsertByGoogleId` → `{..., tokenVersion: 2}`; POST `{code}`; decode the returned token (via `jose decodeJwt` in the test); assert `decoded.ver === 2`.
  - **GET /me returns token whose decoded JWT has ver === user.tokenVersion** — sign a real JWT w/ `ver: 0`; mock `findUserById` → `{..., tokenVersion: 3}`; GET `/me`; decode returned token; assert `decoded.ver === 3` (DB-authoritative ver, not the request JWT's ver).
  - **POST /logout bumps tokenVersion + returns success** — sign a real JWT; mock `bumpTokenVersion` → resolves; POST `/logout` w/ Bearer; assert `200`, `body.data.success === true`; assert `bumpTokenVersion` called with `req.user.id`.
  - **POST /logout returns 401 without Bearer** — POST `/logout` w/o auth header; assert `401` (authenticate gate).
  - **Existing scenarios still pass** (regression) — `/google` domain FORBIDDEN, `/google` validation, `/me` user-not-found.

**Acceptance Criteria:**
- [ ] `requireRole.ts` exports `requireRole(...roles)` factory; 403 FORBIDDEN when role not allowed; 401 UNAUTHENTICATED defensive guard when `req.user` absent.
- [ ] `/google` + `/me` pass `ver: user.tokenVersion` into `signJwt`; decoded JWTs carry `ver`.
- [ ] `/logout` requires `authenticate`, calls `bumpTokenVersion(req.user.id)`, returns `{success: true}`.
- [ ] `/logout` 401 without Bearer.
- [ ] All 4 new + existing regression scenarios pass.
- [ ] `npm run typecheck -w backend` passes (resolves T1's breakage), `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`signJwt` ver param), T2 (`UserRow.tokenVersion`), T3 (`bumpTokenVersion`).

---

### T5 — Frontend: `apiFetch` 401 interceptor + queryClient global 401

**Batch:** B2 · **Depends on:** F05 (`apiFetch`, `useAuthStore`) · **Parallel with:** T6, T7, all B1

**Description:** Add the global 401 interceptor to `apiFetch` (D6): on 401 (not `/auth/*`), attempt ONE `fetchMe()` refresh; on success, retry the original request with the fresh token; on failure, log out once (deduped via module-level `isLoggingOut`) — `broadcastLogout()` + `clear()` + `queryClient.clear()` + `navigate('/login', {replace:true})`. Also wire `queryClient`'s global 401 path so `useQuery` failures go through the same logout. `/auth/*` paths are exempt to avoid infinite loops.

Create / Modify:

- **`frontend/src/api/client.ts`** (MODIFY). 401 interceptor.

  Add module-level dedupe state + a logout callback registration mechanism (the client cannot import the router/store directly without a circular dep — register callbacks).

  ```typescript
  import { env } from '@/config/env';
  import { useAuthStore } from '@/stores/useAuthStore';
  import type { ApiErrorBody, Envelope, ErrorCodeValue } from '@/types/api';

  export class ApiClientError extends Error {
    readonly status: number;
    readonly code: ErrorCodeValue | 'NETWORK_ERROR';
    readonly details?: unknown;
    constructor(
      message: string,
      status: number,
      code: ErrorCodeValue | 'NETWORK_ERROR',
      details?: unknown,
    ) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

  // F07 D6: 401 interceptor callbacks. Registered by the app shell (main.tsx or a
  // provider) to break the circular dep between client (low-level) and the
  // router/store/queryClient (high-level). The client calls these on a hard 401.
  interface LogoutHandlers {
    refresh: () => Promise<boolean>; // attempt /me refresh; true if a fresh token landed
    logout: () => void; // clear + broadcast + queryClient.clear + navigate
  }
  let logoutHandlers: LogoutHandlers | null = null;
  export function registerLogoutHandlers(handlers: LogoutHandlers): void {
    logoutHandlers = handlers;
  }

  // F07 D6: dedupe — N concurrent 401s fire ONE logout.
  let isLoggingOut = false;

  export async function apiFetch<T>(path: string, init?: FetchInit): Promise<T> {
    const url = `${env.apiBaseUrl}${path}`;

    const doFetch = async (currentInit: FetchInit): Promise<Response> => {
      const user = useAuthStore.getState().user;
      const headers = new Headers(currentInit.headers);
      headers.set('Accept', 'application/json');
      if (currentInit.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (user?.token) {
        headers.set('Authorization', `Bearer ${user.token}`);
      }
      try {
        return await fetch(url, { ...currentInit, headers });
      } catch (err) {
        throw new ApiClientError(
          err instanceof Error ? err.message : 'Network request failed',
          0,
          'NETWORK_ERROR',
        );
      }
    };

    let response = await doFetch(init ?? {});

    // F07 D6: 401 interceptor. Exempt /auth/* to avoid infinite loops (supertokens #113).
    // Attempt ONE refresh before hard-logout. Deduped via isLoggingOut.
    if (
      response.status === 401 &&
      !path.startsWith('/auth/') &&
      logoutHandlers &&
      !isLoggingOut
    ) {
      const refreshed = await logoutHandlers.refresh();
      if (refreshed) {
        // Fresh token in store — retry the original request once.
        response = await doFetch(init ?? {});
      } else {
        // Refresh failed → single hard logout.
        if (!isLoggingOut) {
          isLoggingOut = true;
          try {
            logoutHandlers.logout();
          } finally {
            isLoggingOut = false;
          }
        }
      }
    }

    if (!response.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // Non-JSON error (e.g. proxy 502). Synthesize a generic body.
      }
      const code = body?.error?.code ?? 'INTERNAL_ERROR';
      throw new ApiClientError(
        body?.error?.message ?? `Request failed: ${response.status}`,
        response.status,
        code,
        body?.error?.details,
      );
    }

    const body = (await response.json()) as Envelope<T> | ApiErrorBody;
    if ('error' in body) {
      throw new ApiClientError(
        body.error.message,
        response.status,
        body.error.code,
        body.error.details,
      );
    }
    return body.data;
  }
  ```

  Notes: (a) `doFetch` is a closure that re-reads the token from the store on each call — so the retry after refresh picks up the fresh token automatically. (b) `logoutHandlers` is registered by the app shell (T6 mounts `useAuthSync` which calls `registerLogoutHandlers`); this breaks the circular dep (client → store is fine; client → router/queryClient is not). (c) `isLoggingOut` is module-level — dedupes across concurrent requests. Reset in `finally`. (d) Always reach the `!response.ok` throw AFTER the interceptor (so the caller sees the 401 via `ApiClientError` if refresh failed and we didn't retry). (e) `/auth/*` exemption: `/auth/google`, `/auth/me`, `/auth/logout` never trigger the interceptor (avoids `/me` refresh calling itself, supertokens #113). (f) The single retry is bounded — no infinite loop (refresh either succeeds → retry → return/throw, or fails → logout → throw).

- **`frontend/src/api/client.test.ts`** (MODIFY — add 401 scenarios).

  - **on 401: refresh succeeds → retries request with fresh token** — mock `fetch` → 401 first call, 200 second call; mock `logoutHandlers.refresh` → `true`; assert `fetch` called twice; assert second call's `Authorization` header uses the fresh token (mock `useAuthStore.getState().user.token` to change after refresh).
  - **on 401: refresh fails → calls logout once** — mock `fetch` → 401; mock `refresh` → `false`; mock `logout` (vi.fn); assert `logout` called exactly once; assert the call still throws `ApiClientError` w/ status 401.
  - **on 401: N concurrent requests → logout called ONCE** — fire 3 `apiFetch` calls in parallel; mock `refresh` → `false`; assert `logout` called once (dedupe via `isLoggingOut`).
  - **/auth/* paths exempt: no refresh, no logout** — `apiFetch('/auth/me')` → 401; assert `refresh` NOT called, `logout` NOT called; throws `ApiClientError` 401.
  - **no handlers registered: 401 throws without side-effects** — `logoutHandlers = null`; `apiFetch('/tickets')` → 401; assert throws 401, no logout.
  - **non-401 errors unaffected** — `apiFetch` → 403 FORBIDDEN; assert throws `ApiClientError` w/ `code: 'FORBIDDEN'`; `refresh`/`logout` NOT called.

- **`frontend/src/lib/queryClient.ts`** (MODIFY). Global 401 for `useQuery` paths.

  `useQuery` calls `apiFetch` internally (via the query fn), so the interceptor already fires for query 401s. Add a `defaultOptions.queries.retry` function that suppresses retries on 401 (the interceptor already handled it):

  ```typescript
  import { QueryClient } from '@tanstack/react-query';
  import { ApiClientError } from '@/api/client';

  export const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // F07 D6: don't retry 401s (the apiFetch interceptor handles refresh/logout).
        // Other errors retry up to 3 times (default).
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status === 401) {
            return false;
          }
          return failureCount < 3;
        },
      },
    },
  });
  ```

  Notes: (a) `retry` as a function overrides the global count. (b) The `/me` boot query (T6) uses `useQuery` — it benefits from `refetchOnWindowFocus: true` (already set) for sliding refresh. (c) Importing `ApiClientError` into `queryClient.ts` creates a dependency edge but NOT a cycle (client → store; queryClient → client; no client → queryClient).

**Acceptance Criteria:**
- [ ] `apiFetch` on 401 (non-`/auth/*`): attempts ONE refresh; success → retries with fresh token; failure → single logout (deduped via `isLoggingOut`).
- [ ] `/auth/*` paths exempt from the interceptor.
- [ ] `registerLogoutHandlers` exported; app shell (T6) registers `refresh` + `logout`.
- [ ] `queryClient` `retry` function suppresses 401 retries (interceptor handles them).
- [ ] All 6 client + queryClient scenarios pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F05 (`apiFetch`, `useAuthStore`). Does NOT depend on T6/T7 (the handlers are registered by T6, but T5's tests mock them directly). Manual smoke (T8) needs T6's handler registration live.

---

### T6 — Frontend: `useAuthSync` + `useCrossTabLogout` + AppLayout mount

**Batch:** B2 · **Depends on:** F05, T5 (`apiFetch` interceptor, `registerLogoutHandlers`) · **Parallel with:** T7, all B1

**Description:** Ship the session-sync hooks (D2 refresh, D5 cross-tab logout). `useAuthSync` handles boot rehydration (`fetchMe` if a token exists) + window-focus refresh + near-expiry proactive refresh, AND registers the logout handlers that `apiFetch` (T5) calls. `useCrossTabLogout` handles BroadcastChannel `'slyk-auth'` + storage-event fallback. Both mount via `<CrossTabLogoutSync/>` in `AppLayout`.

Create / Modify:

- **`frontend/src/hooks/useAuthSync.ts`** (NEW). Boot/focus/expiry refresh + handler registration.

  ```typescript
  import { useEffect, useRef } from 'react';
  import { useNavigate } from 'react-router';
  import { useQueryClient } from '@tanstack/react-query';
  import { decodeJwt } from 'jose';
  import { fetchMe } from '@/api/auth';
  import { registerLogoutHandlers } from '@/api/client';
  import { useAuthStore } from '@/stores/useAuthStore';

  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if <5min to expiry

  // F07 D2: session sync. (a) boot — if a token exists, rehydrate via /me (slides
  // the 8h window + refreshes user/role from DB). (b) focus — TanStack Query's
  // global refetchOnWindowFocus handles /me query refetch. (c) near-expiry —
  // interval checks decodeJwt(token).exp; if within threshold, call fetchMe.
  // Also registers the logout handlers that apiFetch's 401 interceptor calls (D6).
  export function useAuthSync(): void {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);
    const clear = useAuthStore((s) => s.clear);
    const channelRef = useRef<BroadcastChannel | null>(null);

    // Register logout handlers once (apiFetch imports these).
    useEffect(() => {
      if (!channelRef.current) {
        channelRef.current = new BroadcastChannel('slyk-auth');
      }
      const channel = channelRef.current;

      registerLogoutHandlers({
        refresh: async () => {
          try {
            const fresh = await fetchMe();
            setUser({
              token: fresh.token,
              id: fresh.user.id,
              email: fresh.user.email,
              name: fresh.user.fullName,
              role: fresh.user.role,
              avatarUrl: fresh.user.avatarUrl,
            });
            return true;
          } catch {
            return false;
          }
        },
        logout: () => {
          clear();
          queryClient.clear();
          channel.postMessage({ type: 'logout' }); // tell other tabs
          navigate('/login', { replace: true });
        },
      });

      return () => {
        channel.close();
        channelRef.current = null;
      };
    }, [clear, navigate, queryClient, setUser]);

    // Boot rehydration: if a token exists, refresh it on mount (slides window).
    useEffect(() => {
      if (user?.token) {
        void fetchMe()
          .then((fresh) => {
            setUser({
              token: fresh.token,
              id: fresh.user.id,
              email: fresh.user.email,
              name: fresh.user.fullName,
              role: fresh.user.role,
              avatarUrl: fresh.user.avatarUrl,
            });
          })
          .catch(() => {
            // boot refresh failed — token may be invalid; clear + redirect.
            clear();
            navigate('/login', { replace: true });
          });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // boot only

    // Near-expiry proactive refresh.
    useEffect(() => {
      if (!user?.token) return;
      const interval = setInterval(() => {
        try {
          const payload = decodeJwt(user.token);
          if (!payload.exp) return;
          const msToExpiry = payload.exp * 1000 - Date.now();
          if (msToExpiry <= REFRESH_THRESHOLD_MS) {
            void fetchMe()
              .then((fresh) =>
                setUser({
                  token: fresh.token,
                  id: fresh.user.id,
                  email: fresh.user.email,
                  name: fresh.user.fullName,
                  role: fresh.user.role,
                  avatarUrl: fresh.user.avatarUrl,
                }),
              )
              .catch(() => {
                clear();
                navigate('/login', { replace: true });
              });
          }
        } catch {
          // malformed token — clear.
          clear();
          navigate('/login', { replace: true });
        }
      }, 60 * 1000); // check every minute
      return () => clearInterval(interval);
    }, [user?.token, clear, navigate, setUser]);
  }
  ```

  Notes: (a) The hook owns the BroadcastChannel (shared between the logout handler and the cross-tab listener in `useCrossTabLogout` — DECISION: `useCrossTabLogout` creates its OWN channel to avoid coupling; the logout handler here creates a transient channel only for posting). (b) Boot rehydration runs once on mount (empty dep array). (c) Near-expiry interval is 60s — checks `decodeJwt(token).exp` (unverified, client-side optimization). (d) The `refresh` handler returns `boolean` so `apiFetch` knows whether to retry. (e) `logout` handler posts to the channel BEFORE navigating — other tabs receive the message via their `useCrossTabLogout`. (f) `queryClient.clear()` wipes all cached queries (logged-out user shouldn't see stale data).

- **`frontend/src/hooks/useAuthSync.test.ts`** (NEW).

  - **boot: rehydrates via fetchMe when token exists** — render hook with `user.token = 'old'`; mock `fetchMe` → `{token: 'new', user: {...}}`; assert `setUser` called with fresh token.
  - **boot: clears + redirects when fetchMe fails** — mock `fetchMe` → rejects; assert `clear` called + `navigate('/login')`.
  - **boot: no-op when no token** — render with `user = null`; assert `fetchMe` NOT called.
  - **registers logout handlers** — after render, simulate `apiFetch` calling the registered `refresh`/`logout` (import the handlers via a test seam); assert `refresh` returns true on fetchMe success, false on failure; assert `logout` clears + broadcasts + navigates.
  - **near-expiry: refreshes when within threshold** — mock `decodeJwt` to return `exp` 2min in the future; advance timers; assert `fetchMe` called.

  Notes: Mock `react-router`'s `useNavigate`, `@tanstack/react-query`'s `useQueryClient`, `@/api/auth`'s `fetchMe`, `@/api/client`'s `registerLogoutHandlers`, `@/stores/useAuthStore`. Use `@testing-library/react-hooks` `renderHook` (or `renderHook` from `@testing-library/react` v13+). Use `vi.useFakeTimers()` for the near-expiry test.

- **`frontend/src/hooks/useCrossTabLogout.ts`** (NEW). Cross-tab logout listener.

  ```typescript
  import { useEffect } from 'react';
  import { useNavigate } from 'react-router';
  import { useQueryClient } from '@tanstack/react-query';
  import { useAuthStore } from '@/stores/useAuthStore';

  const CHANNEL_NAME = 'slyk-auth';
  const STORAGE_KEY = 'slyk-auth';

  type AuthMessage = { type: 'logout' } | { type: 'login' };

  // F07 D5: cross-tab logout sync. Listens on BroadcastChannel 'slyk-auth' for
  // {type:'logout'} from other tabs → clears state + query cache + redirects.
  // Storage-event fallback: if another tab removes the 'slyk-auth' localStorage
  // key, treat it as a logout (zero-cost safety net for browsers w/o BroadcastChannel).
  export function useCrossTabLogout(): void {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const clear = useAuthStore((s) => s.clear);

    useEffect(() => {
      const handleRemoteLogout = () => {
        clear();
        queryClient.clear();
        navigate('/login', { replace: true });
      };

      // Primary: BroadcastChannel.
      const channel = new BroadcastChannel(CHANNEL_NAME);
      const onMessage = (event: MessageEvent<AuthMessage>) => {
        if (event.data?.type === 'logout') {
          handleRemoteLogout();
        }
      };
      channel.addEventListener('message', onMessage);

      // Fallback: storage event (fires when another tab removes the key).
      const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY && event.newValue === null) {
          handleRemoteLogout();
        }
      };
      window.addEventListener('storage', onStorage);

      return () => {
        channel.removeEventListener('message', onMessage);
        channel.close();
        window.removeEventListener('storage', onStorage);
      };
    }, [clear, navigate, queryClient]);
  }
  ```

  Notes: (a) BroadcastChannel does NOT echo to the sender (so the tab that posts `{type:'logout'}` doesn't re-handle it). (b) Storage event fires ONLY in OTHER tabs (not the one that made the change) — perfect for cross-tab sync. (c) `event.newValue === null` — Zustand persist removing the key fires `storage` with `newValue: null`. (d) Both listeners call the same `handleRemoteLogout` for consistency.

- **`frontend/src/hooks/useCrossTabLogout.test.ts`** (NEW).

  - **BroadcastChannel {type:'logout'} → clears + redirects** — mock `BroadcastChannel`; emit `{type:'logout'}`; assert `clear` + `queryClient.clear` + `navigate('/login')`.
  - **BroadcastChannel {type:'login'} → no-op** — emit `{type:'login'}`; assert nothing called.
  - **storage event with key removed → clears + redirects** — dispatch `window.dispatchEvent(new StorageEvent('storage', {key: 'slyk-auth', newValue: null}))`; assert logout.
  - **storage event with different key → no-op** — `key: 'other'`; assert nothing.

  Notes: Mock `BroadcastChannel` via `vi.stubGlobal('BroadcastChannel', class { ... })`. The mock needs `addEventListener`, `postMessage`, `close`, and a way to emit (a test-only `emit` method or spy on `addEventListener` to capture the handler).

- **`frontend/src/components/CrossTabLogoutSync.tsx`** (NEW). Thin mount.

  ```tsx
  import { useCrossTabLogout } from '@/hooks/useCrossTabLogout';
  import { useAuthSync } from '@/hooks/useAuthSync';

  // F07 D5 + D6: mounts the session-sync hooks. Rendered once in AppLayout
  // (inside RequireAuth, so only mounted when authenticated).
  export function CrossTabLogoutSync() {
      useAuthSync();
      useCrossTabLogout();
      return null;
  }
  ```

- **`frontend/src/components/AppLayout.tsx`** (MODIFY). Mount the sync.

  ```tsx
  import { Outlet } from 'react-router';
  import { TopNav } from './TopNav';
  import { HealthBadge } from './HealthBadge';
  import { CrossTabLogoutSync } from './CrossTabLogoutSync';

  export function AppLayout() {
      return (
          <div className="flex min-h-screen flex-col bg-background text-foreground">
              <CrossTabLogoutSync />
              <TopNav />
              <HealthBadge />
              <main className="flex-1">
                  <Outlet />
              </main>
          </div>
      );
  }
  ```

  Notes: `<CrossTabLogoutSync/>` renders `null` — it only mounts the hooks. Placed at the top of AppLayout so the BroadcastChannel listener + handler registration are active for the whole authenticated session. (AppLayout is inside `<RequireAuth>`, so the hooks mount only when authenticated.)

**Acceptance Criteria:**
- [ ] `useAuthSync` boot: rehydrates via `fetchMe` when token exists; clears + redirects on failure.
- [ ] `useAuthSync` registers `refresh` + `logout` handlers via `registerLogoutHandlers` (consumed by T5's `apiFetch`).
- [ ] `useAuthSync` near-expiry: refreshes when token within 5min of expiry.
- [ ] `useCrossTabLogout`: BroadcastChannel `{type:'logout'}` → clear + redirect; storage-event key removal → clear + redirect; ignores other messages/keys.
- [ ] `<CrossTabLogoutSync/>` renders null + mounts both hooks.
- [ ] `AppLayout` renders `<CrossTabLogoutSync/>`.
- [ ] All hook scenarios pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T5 (`registerLogoutHandlers`, `apiFetch` interceptor). F05 (`fetchMe`, `useAuthStore`).

---

### T7 — Frontend: `<RequireRole>` + `useRequireRole` + TopNav role-gate + `/settings` guard

**Batch:** B2 · **Depends on:** F06 (`AuthUser.role`) · **Parallel with:** T5, T6, all B1

**Description:** Ship the client-side role gate (D7). New `useRequireRole(role)` hook + `<RequireRole role="ADMIN">` component (redirects MEMBERS away from admin-only routes). Gate the `/settings` route by wrapping it in `<RequireRole>`. Hide the Settings nav link in `TopNav` for MEMBERS. The server-side `requireRole('ADMIN')` (T4) is the real gate; this is the UX guard.

Create / Modify:

- **`frontend/src/hooks/useRequireRole.ts`** (NEW). Client role guard.

  ```typescript
  import { useAuthStore } from '@/stores/useAuthStore';

  export type Role = 'ADMIN' | 'MEMBER';

  // F07 D7: client-side role check. Returns true if the current user's role is
  // in the allowed set. The server-side requireRole middleware is the real gate;
  // this hook is for UX (hide/show UI elements, redirect away from admin routes).
  export function useRequireRole(...allowedRoles: Role[]): boolean {
    const role = useAuthStore((s) => s.user?.role);
    if (!role) return false;
    return allowedRoles.includes(role);
  }
  ```

- **`frontend/src/hooks/useRequireRole.test.ts`** (NEW). Table-driven.

  - **returns true when role allowed** — stub `user.role = 'ADMIN'`; `useRequireRole('ADMIN')` → true.
  - **returns false when role not allowed** — `user.role = 'MEMBER'`; `useRequireRole('ADMIN')` → false.
  - **returns false when no user** — `user = null`; → false.
  - **allows multiple roles** — `user.role = 'MEMBER'`; `useRequireRole('ADMIN', 'MEMBER')` → true.

- **`frontend/src/components/RequireRole.tsx`** (NEW). Route guard wrapper.

  ```tsx
  import { Navigate, Outlet, useLocation } from 'react-router';
  import { useRequireRole } from '@/hooks/useRequireRole';
  import type { Role } from '@/hooks/useRequireRole';

  interface RequireRoleProps {
    role: Role;
  }

  // F07 D7: route guard. If the current user lacks the required role, redirect to
  // '/' (board). The server-side requireRole middleware is the authoritative gate;
  // this component prevents the flash of an admin-only page for MEMBERS.
  export function RequireRole({ role }: RequireRoleProps) {
      const allowed = useRequireRole(role);
      const location = useLocation();

      if (!allowed) {
          return <Navigate to="/" replace state={{ from: location }} />;
      }
      return <Outlet />;
  }
  ```

  Notes: (a) `<RequireRole>` wraps a route's children via `<Outlet/>` (same pattern as `<RequireAuth>`). (b) Redirects to `/` (board) — a safe page for all roles. (c) Uses `useLocation` for symmetry with `<RequireAuth>` (though we don't currently redirect back to `/settings` after a role change).

- **`frontend/src/components/RequireRole.test.tsx`** (NEW).

  - **renders Outlet when role matches** — stub `user.role = 'ADMIN'`; render `<RequireRole role="ADMIN">` w/ a child; assert child rendered.
  - **redirects to / when role mismatch** — stub `user.role = 'MEMBER'`; render `<RequireRole role="ADMIN">`; assert `<Navigate to="/">` (use a `MemoryRouter` + assert location via `useLocation` in a test child).
  - **redirects when no user** — stub `user = null`; assert redirect.

- **`frontend/src/components/TopNav.tsx`** (MODIFY). Hide Settings for MEMBERS + broadcast logout.

  Current `NAV_LINKS` (`:6-10`) renders all 3 links unconditionally. F07 gates the Settings link by role:

  ```tsx
  import { useState } from 'react';
  import { NavLink, useNavigate } from 'react-router';
  import { useAuthStore } from '@/stores/useAuthStore';
  import { logout } from '@/api/auth';
  import { useRequireRole } from '@/hooks/useRequireRole';

  const PUBLIC_NAV_LINKS = [
      { to: '/', label: 'Board', end: true },
      { to: '/reports', label: 'Reports', end: false },
  ] as const;

  const ADMIN_NAV_LINKS = [
      { to: '/settings', label: 'Settings', end: false },
  ] as const;

  function getInitials(name: string, email: string): string {
      const source = name || email.split('@')[0] || '?';
      return source.slice(0, 2).toUpperCase();
  }

  export function TopNav() {
      const [open, setOpen] = useState(false);
      const user = useAuthStore((s) => s.user);
      const clear = useAuthStore((s) => s.clear);
      const navigate = useNavigate();
      const isAdmin = useRequireRole('ADMIN');

      const handleSignOut = async () => {
          await logout(); // F07 D4: backend bumps tokenVersion
          clear();
          navigate('/login', { replace: true });
      };

      return (
          <header className="border-b border-border bg-background">
              <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                  <span className="text-lg font-semibold">Slykboard</span>
                  <div className="flex items-center gap-4">
                      <button
                          type="button"
                          className="md:hidden"
                          aria-expanded={open}
                          aria-label="Toggle navigation"
                          onClick={() => setOpen((v) => !v)}
                      >
                          <span aria-hidden="true">{open ? 'Close' : 'Menu'}</span>
                      </button>
                      <ul
                          className={`${
                              open ? 'flex' : 'hidden'
                          } flex-col gap-2 md:flex md:flex-row md:items-center md:gap-6`}
                      >
                          {PUBLIC_NAV_LINKS.map((link) => (
                              <li key={link.to}>
                                  <NavLink
                                      to={link.to}
                                      end={link.end}
                                      onClick={() => setOpen(false)}
                                      className={({ isActive }) =>
                                          `text-sm ${isActive ? 'text-primary' : 'text-muted'}`
                                      }
                                  >
                                      {link.label}
                                  </NavLink>
                              </li>
                          ))}
                          {isAdmin &&
                              ADMIN_NAV_LINKS.map((link) => (
                                  <li key={link.to}>
                                      <NavLink
                                          to={link.to}
                                          end={link.end}
                                          onClick={() => setOpen(false)}
                                          className={({ isActive }) =>
                                              `text-sm ${isActive ? 'text-primary' : 'text-muted'}`
                                          }
                                      >
                                          {link.label}
                                      </NavLink>
                                  </li>
                              ))}
                      </ul>
                      {/* ...avatar + Sign out unchanged... */}
                  </div>
              </nav>
          </header>
      );
  }
  ```

  Notes: (a) `PUBLIC_NAV_LINKS` (Board, Reports) + `ADMIN_NAV_LINKS` (Settings) — Settings only renders when `useRequireRole('ADMIN')` is true. (b) The cross-tab broadcast happens via the `apiFetch` logout handler (T6) — `TopNav.handleSignOut` calls `clear()` which removes the localStorage key; the `useAuthSync` logout handler posts `{type:'logout'}` to the channel. **IMPORTANT**: `handleSignOut` calls `logout()` (the API call) THEN `clear()`. The `clear()` triggers the Zustand persist write (removes the key) but does NOT itself broadcast — the broadcast happens in the `useAuthSync`-registered `logout` handler (which is called by `apiFetch` on 401, NOT by manual `clear()`). **DECISION**: to ensure cross-tab logout on manual sign-out, `handleSignOut` should also post to the channel. Add a dedicated `broadcastLogout()` export from `useCrossTabLogout` or post directly:
  ```tsx
  const handleSignOut = async () => {
      await logout();
      clear();
      // F07 D5: notify other tabs.
      new BroadcastChannel('slyk-auth').postMessage({ type: 'logout' });
      navigate('/login', { replace: true });
  };
  ```
  Cleaner: export a `broadcastLogout()` from `useCrossTabLogout.ts` (module-level, no hook needed) and call it here. **Update T6** to export `broadcastLogout()`. (c) The avatar/Sign-out block is unchanged.

- **`frontend/src/routes/index.tsx`** (MODIFY). Wrap `/settings` in `<RequireRole>`.

  Current `:20-25`:
  ```tsx
  {
      element: <AppLayout />,
      children: [
          { path: '/', element: <BoardPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
      ],
  },
  ```

  F07 change — nest `/settings` under `<RequireRole role="ADMIN">`:
  ```tsx
  {
      element: <AppLayout />,
      children: [
          { path: '/', element: <BoardPage /> },
          { path: '/reports', element: <ReportsPage /> },
          {
              path: '/settings',
              element: (
                  <RequireRole role="ADMIN">
                      <SettingsPage />
                  </RequireRole>
              ),
          },
          { path: '*', element: <NotFoundPage /> },
      ],
  },
  ```

  Notes: (a) `<RequireRole>` uses `<Outlet/>`, so it can be a pathless layout route OR wrap a single element. Here we wrap `<SettingsPage/>` directly (simpler for a single route). Alternatively, make `/settings` a pathless layout route with `<RequireRole>` as `element` and `<SettingsPage/>` as a child — both work; the wrapper form is more explicit. (b) Import `RequireRole` + the `Role` type. (c) The redirect target is `/` (board) — a MEMBER who manually navigates to `/settings` lands on the board (not an error page; UX choice).

- **`frontend/src/components/TopNav.test.tsx`** (MODIFY — add role-gate scenarios). Scenario names:

  - **renders Settings link when role is ADMIN** — stub `user.role = 'ADMIN'`; render; assert `getByRole('link', {name: 'Settings'})` present.
  - **hides Settings link when role is MEMBER** — stub `user.role = 'MEMBER'`; render; assert `queryByRole('link', {name: 'Settings'})` is null.
  - **always renders Board + Reports** — for both roles, assert Board + Reports links present.
  - **existing scenarios still pass** (regression) — avatar render, initials fallback, sign-out handler.

**Acceptance Criteria:**
- [ ] `useRequireRole(...roles)` returns `boolean` (true if current role in set).
- [ ] `<RequireRole role="ADMIN">` renders `<Outlet/>` (children) when allowed; `<Navigate to="/">` when not.
- [ ] `TopNav` renders Settings link only when `useRequireRole('ADMIN')` is true; Board + Reports always render.
- [ ] `/settings` route wrapped in `<RequireRole role="ADMIN">`; MEMBERS redirect to `/`.
- [ ] `handleSignOut` broadcasts logout to other tabs (via `broadcastLogout()` or direct channel post).
- [ ] All scenarios pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F06 (`AuthUser.role`). T6's `broadcastLogout` (optional — if used in TopNav).

---

### T8 — Integration verification & sign-off

**Batch:** B3 (terminal) · **Depends on:** T4, T7 (all prior) · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, exercise the F07-specific behaviors via curl + manual cross-tab check, verify the schema delta, fill the integration record in §7. This task owns no files — it's pure verification + documentation.

**Steps:**

1. **Clean tree check:**
   ```bash
   git status  # clean — all F07 commits on main
   git log --oneline | grep SLYK-F07
   ```

2. **Lint + format + typecheck + test (all workspaces):**
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm test -ws
   ```
   All exit 0. Note any F02 pre-existing `db.test.ts` Postgres auth failures as non-regressions.

3. **Build both workspaces:**
   ```bash
   npm run build -w backend
   npm run build -w frontend
   ```

4. **Apply migration 0002 against live Postgres:**
   ```bash
   docker compose up -d
   npm run db:migrate -w backend
   psql "$DATABASE_URL" -c '\d "Users"'
   ```
   Expect: `token_version | integer | not null default 0` column present.

5. **Inspect 0002_*.sql for the `$1` regression** (MEMORY `drizzle-partial-index-enum-dollar1`):
   ```bash
   grep -n '\$1' backend/src/db/migrations/0002_*.sql
   ```
   Expect: no match (or hand-reconciled to `'ADMIN'` literal if the bug fired).

6. **`ver` in JWT smoke:**
   ```bash
   npm run dev:api
   # Obtain a real Google auth code via the GIS popup (F05 T13 steps 1-4).
   curl -X POST http://localhost:3000/api/auth/google \
     -H 'Content-Type: application/json' \
     -d '{"code": "<real-google-auth-code>"}'
   ```
   Capture the `token` from the response. Decode it (paste into jwt.io or use `jose decodeJwt` in a node REPL):
   ```bash
   node -e "const {decodeJwt} = require('jose'); console.log(decodeJwt('<token>').ver)"
   ```
   Expect: `ver` present (0 for a fresh user). Paste into integration record.

7. **`authenticate` `ver` compare smoke:**
   ```bash
   # Using the token from step 6:
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/auth/me
   # Expect: 200, fresh token returned.
   # Now bump the version via direct SQL:
   psql "$DATABASE_URL" -c "UPDATE \"Users\" SET token_version = token_version + 1 WHERE email = '<your-email>';"
   # Retry /me with the OLD token:
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/auth/me
   # Expect: 401 {error: {code: 'UNAUTHENTICATED', message: 'Token version mismatch'}}
   ```
   Paste both responses into the integration record. Clean up: re-login to mint a fresh token.

8. **`/logout` invalidation smoke:**
   ```bash
   # Sign in fresh → capture token A.
   curl -X POST -H "Authorization: Bearer <tokenA>" http://localhost:3000/api/auth/logout
   # Expect: 200 {data: {success: true}}
   # Confirm tokenA is now invalid:
   curl -H "Authorization: Bearer <tokenA>" http://localhost:3000/api/auth/me
   # Expect: 401 'Token version mismatch'
   ```

9. **Sliding refresh smoke (manual):**
   - Sign in via the frontend (`http://localhost:5173`).
   - Open DevTools → Application → Local Storage → `slyk-auth` → note the token.
   - Wait for a window blur/focus (or wait ~5min if testing near-expiry).
   - Observe (Network tab) a `GET /api/auth/me` 200 with a NEW token in the response.
   - Confirm the localStorage token updated.
   - Paste the network capture into the integration record.

10. **Global 401 interceptor smoke (manual):**
    - Sign in. Tamper with the token in DevTools (change one char) → `useAuthStore.setState({...user, token: 'tampered'})`.
    - Trigger any API call (e.g. navigate to board → `/projects/.../board` or whatever polls).
    - Observe: ONE `GET /api/auth/me` attempt (refresh) → 401 → single logout → redirect to `/login`.
    - Confirm only ONE `/me` call + ONE redirect (not N for N concurrent requests). Paste network capture.

11. **Cross-tab logout smoke (manual):**
    - Sign in on Tab A. Open a second tab (`http://localhost:5173`) → Tab B (same session).
    - On Tab A, click "Sign out".
    - Expect: Tab B redirects to `/login` within ~1s (BroadcastChannel). Confirm via DevTools Console (no errors) + the URL bar.
    - Repeat with BroadcastChannel disabled (DevTools → can't easily disable; instead test the storage-event fallback by checking Tab B still redirects — both paths fire).

12. **Role-gate smoke (manual):**
    - Sign in as ADMIN → Settings nav link visible; `/settings` renders.
    - Sign in as MEMBER (or demote via SQL: `UPDATE "Users" SET role='MEMBER' WHERE email='...'`) → Settings nav link hidden; manual nav to `/settings` redirects to `/`.
    - **Backend gate smoke:** directly call an admin-only route with a MEMBER token → 403 FORBIDDEN. (F07 ships `requireRole` but mounts it on no route until F17; T8 verifies via a test-only mount in `requireRole.test.ts` — confirm the unit test passes. Document that the first real mount is F17.)

13. **`JWT_TTL` env smoke:**
    - Set `JWT_TTL=1m` in `backend/.env`. Restart. Sign in. Decode the token → `exp - iat ≈ 60`. Revert to `8h`.

14. **FORBIDDEN → 403 emits** (verify the status map):
    - `grep -n 'FORBIDDEN' backend/src/utils/envelope.ts` → confirm `[ErrorCode.FORBIDDEN]: 403`. (Already confirmed in §2; this is a regression check.)

15. **Error code vocabulary unchanged:**
    - `envelope.ts:5-12` still lists exactly the 6 F03 codes. F07 uses `UNAUTHENTICATED` (401, for token-version mismatch + missing/expired) + `FORBIDDEN` (403, for role-gate). No new codes.

16. **Fill the integration record** in §7 with commit SHAs, curl outputs, network captures, screenshots.

**Acceptance Criteria:**
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test -ws` all exit 0.
- [ ] `npm run build -w backend` + `-w frontend` produce `dist/`.
- [ ] Migration `0002_*.sql` applied; `\d "Users"` shows `token_version` column; no `$1` regression.
- [ ] JWT `ver` claim present after sign-in.
- [ ] `authenticate` 401s on `ver` mismatch (after SQL bump).
- [ ] `/logout` bumps `tokenVersion`; old token 401s after.
- [ ] Sliding refresh: window focus / near-expiry triggers `/me` → fresh token.
- [ ] Global 401 interceptor: single refresh attempt + single logout (deduped).
- [ ] Cross-tab logout: Tab A sign-out → Tab B redirects.
- [ ] Role-gate: ADMIN sees Settings; MEMBER hidden + redirected; server `requireRole` unit test passes.
- [ ] `JWT_TTL` env drives the token expiry.
- [ ] FORBIDDEN → 403 confirmed; no new error codes.
- [ ] §7 integration record filled.

**Dependencies:** T4 (backend live), T7 (frontend live). T6 (cross-tab + sync hooks) must be merged for the cross-tab smoke.

---

## 7. Final F07 Acceptance Checklist

- [ ] **`authenticate` rejects missing/expired/version-mismatch tokens with 401.** `middleware/auth.ts` (T3, D3) calls `findUserTokenVersion(payload.sub)` after `verifyJwt`; mismatch → `AppError(UNAUTHENTICATED, 'Token version mismatch')` → 401. Missing header / malformed scheme / expired (jose) → existing UNAUTHENTICATED paths. Verified via T8 step 7. (Acceptance bullet 1.)
- [ ] **Frontend auth context exposes current user + role; gates UI by role.** `useAuthStore` already exposes `user.role` (F05). `<RequireRole role="ADMIN">` (T7, D7) gates `/settings`; `TopNav` (T7) hides the Settings link for MEMBERS; `useRequireRole` hook available for any component. Server-side `requireRole('ADMIN')` (T4) is the authoritative gate. Verified via T8 step 12. (Acceptance bullet 2.)
- [ ] **Refresh strategy keeps sessions alive across reloads.** `useAuthSync` (T6, D2) rehydrates via `/me` on boot; TanStack Query `refetchOnWindowFocus` (global, `queryClient.ts:8`) slides the 8h window on activity; near-expiry interval proactively refreshes. `/me` re-signs a fresh 8h JWT (F06 `auth.routes.ts:51`). Verified via T8 step 9. (Acceptance bullet 3.)
- [ ] **Logout clears server/client session state.** `POST /api/auth/logout` (T4, D4) calls `bumpTokenVersion(req.user.id)` → outstanding JWTs hard-expire. Client `clear()` + broadcast (T6/T7) → all tabs redirect. Verified via T8 steps 8 + 11. (Acceptance bullet 4.)
- [ ] **Role change takes effect (edge case).** `token_version` machinery (T1-T4, D3): `Users.tokenVersion` column + `ver` claim + `authenticate` compare + `bumpTokenVersion` helper. F25 (multi-admin demotion) calls `bumpTokenVersion`; F07 ships the helper. `/me` is DB-authoritative (F06 D4) so role changes also propagate on next `/me`. Verified via T8 step 7 (simulated bump). (Edge case 1.)
- [ ] **401 global interceptor logs out once, not per-request (edge case).** `apiFetch` (T5, D6) dedupes via `isLoggingOut`; single `/me` refresh attempt before hard-logout; `/auth/*` exempt. Verified via T8 step 10. (Edge case 2.)
- [ ] **Concurrent tabs logout sync (edge case).** `useCrossTabLogout` (T6, D5) BroadcastChannel `'slyk-auth'` + storage-event fallback; `<CrossTabLogoutSync/>` mounted in `AppLayout`. Verified via T8 step 11. (Edge case 3.)
- [ ] **`JWT_TTL` env-driven (D8).** `env.jwtTtl` (T1) default `'8h'`; documented in `.env.example`. Verified via T8 step 13.
- [ ] **`ver` claim in JWT.** `JwtUserClaims.ver` (T1); `signJwt` embeds it (T1); `/google` + `/me` pass `user.tokenVersion` (T4); `verifyJwt` returns it (T1). Verified via T8 step 6.
- [ ] **Schema delta: `Users.tokenVersion`.** `schema.ts` column + `0002_*.sql` migration (T2). No `$1` regression. Verified via T8 steps 4-5. (§8.)
- [ ] **`requireRole('ADMIN')` middleware exists (D7).** `middleware/requireRole.ts` (T4); FORBIDDEN → 403. Not mounted on any route yet (first mount is F17). Unit-tested. Verified via T8 step 12.
- [ ] **No new error codes.** F03's 6-code vocabulary unchanged. F07 uses `UNAUTHENTICATED` (401) + `FORBIDDEN` (403, already mapped). (D10.)
- [ ] **HttpOnly-cookie migration deferred (D1, owner sign-off).** F07 stays on localStorage + Zustand persist. Surfaced in §9a.
- [ ] **Google token revocation deferred (D4).** F07 ships app-level `tokenVersion` invalidation; Google revocation → F29.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass (`npm run typecheck && npm test -ws` exit 0; F02 pre-existing `db.test.ts` failures noted as non-F07).
- [ ] `npm run build -w backend` + `-w frontend` produce `dist/`.
- [ ] Commits land on `main` as `SLYK-F07: <msg>` (single-line); rebase-and-merge only (no squash, no merge commits) per `git-guidelines.md`.
- [ ] `.gitignore` retains `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store` (no F07 change).
- [ ] Security mandates: no `console.log` in prod, no raw SQL (Drizzle query builder + `sql` template for the atomic increment), no secrets in code, CORS locked to `FRONTEND_URL`, `Bearer` enforced on `/me` + `/logout` (T4), `JWT_SECRET` ≥32 chars (F05), `ver` compare server-side (T3).

**Integration record (fill during T8):**
- Feature commit SHAs: `________` (list all `SLYK-F07:` commits)
- `\d "Users"` showing `token_version`: `________`
- `0002_*.sql` `$1` regression check (grep output): `________`
- Decoded JWT `ver` claim (post-sign-in): `________`
- `authenticate` 401 on `ver` mismatch (curl response after SQL bump): `________`
- `/logout` invalidation (old token 401 after logout): `________`
- Sliding refresh network capture (`/me` 200 with fresh token on focus): `________`
- Global 401 interceptor network capture (single refresh + single logout): `________`
- Cross-tab logout screenshot (Tab B redirected after Tab A sign-out): `________`
- Role-gate: MEMBER `/settings` redirect screenshot: `________`
- `JWT_TTL=1m` token expiry (`exp - iat`): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0` (F02 `db.test.ts` failures noted: ___ of ___)
- `npm run build -w backend` exit code + `dist/` produced: `________`
- `npm run build -w frontend` exit code + `dist/` produced: `________`
- Migration `0002_*.sql` applied + committed: `________`

**Out-of-scope caveats (carried forward to F17/F25/F29):**
- HttpOnly-cookie token storage + opaque refresh-token rotation + reuse detection → **F29** (or dedicated hardening feature). F07 stays on localStorage (D1). Owner sign-off pending (§9a).
- Google token revocation on logout → **F29** (deferred from F05 line 101). F07 ships app-level `tokenVersion` invalidation.
- Multi-admin demotion (`bumpTokenVersion` role-change consumer) → **F25**. F07 ships `bumpTokenVersion`; F25 calls it on demotion.
- First real mount of `requireRole('ADMIN')` on a route → **F17** (delete tickets) / F25. F07 ships the middleware + client guard; no route mounted yet.
- Redis `tokenVersion` cache → **F29**. F07 does the DB PK lookup directly.
- Third role (`VIEWER`) → **F25** may introduce; F07 keeps the 2-value `pgEnum` (F06 D5).

---

## 8. Schema deltas owned by this feature

**One schema delta: the `Users.tokenVersion` column** — the token-version mechanism (D3). The `users_one_admin` partial unique index (F06) is unchanged; F07 adds only the column.

| Delta | Detail | Migration |
| --- | --- | --- |
| `Users.tokenVersion` | `integer NOT NULL DEFAULT 0`. Stores the user's current token version. `authenticate` compares the JWT `ver` claim to this; `bumpTokenVersion` increments it. Default 0 so existing rows need no data migration. Declared in `schema.ts` via `integer('token_version').default(0).notNull()`; generated by `drizzle-kit generate` into `backend/src/db/migrations/0002_<auto>.sql`. | `ALTER TABLE "Users" ADD COLUMN "token_version" integer NOT NULL DEFAULT 0;` |

**Drizzle schema declaration** (`backend/src/db/schema.ts`, T2):

```typescript
import { eq } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex, integer } from 'drizzle-orm/pg-core';

// ...existing roleEnum...

export const users = pgTable(
  'Users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleId: text('google_id').notNull().unique(),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: roleEnum('role').default('MEMBER').notNull(),
    // F07 D3: token version for hard session invalidation.
    tokenVersion: integer('token_version').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    usersOneAdminIdx: uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN')),
  }),
);
```

**Generated SQL** (`backend/src/db/migrations/0002_<auto-name>.sql`, produced by `npm run db:generate -w backend`):

```sql
-- F07 D3: token version for hard session invalidation. Default 0 backfills existing rows.
ALTER TABLE "Users" ADD COLUMN "token_version" integer NOT NULL DEFAULT 0;
```

**Application:** `npm run db:migrate -w backend` (runs `tsx src/db/migrate.ts` → `drizzle-orm/node-postgres/migrator.migrate` against `migrationsFolder: './src/db/migrations'`). Verified via `\d "Users"` in psql (T8 step 4).

**`$1` regression guard (MEMORY `drizzle-partial-index-enum-dollar1`):** `drizzle-kit generate` is known to emit unapplyable `$1` SQL for the `users_one_admin` enum partial index when regenerating. F07 uses incremental `drizzle-kit generate` (diff-based, not full regen), so the bug should NOT fire — but T2 MUST inspect `0002_*.sql` and confirm no `WHERE "role" = $1` appears. If it does, hand-edit to `WHERE "role" = 'ADMIN'` (literal) before committing. The bug is specific to the enum partial index; the new `token_version` column (`ALTER TABLE ADD COLUMN`) is unaffected.

**Atomic increment:** `bumpTokenVersion` uses `sql\`${users.tokenVersion} + 1\`` (Drizzle raw SQL) for a concurrency-safe server-side increment — avoids a read-modify-write race where two concurrent logout/role-change calls could both read `0` and both write `1`.

---

## 9. Cross-cutting decisions needing owner sign-off

The following are irreversible or cross-cutting choices that F07 cannot silently pick. Surfaced here for explicit owner approval BEFORE T1/T2 merge. The recommended default is non-binding until the owner confirms.

### (a) Token storage: stay on localStorage vs migrate to HttpOnly-cookie now

- **Question:** F05 shipped token storage in `localStorage` via Zustand persist (`useAuthStore.ts:19`, accepted XSS tradeoff). F07's acceptance ("refresh across reloads") is satisfiable on the current transport via sliding `/me` (D2). Should F07 migrate to HttpOnly-cookie + opaque refresh-token rotation + reuse detection (the OWASP/Auth0 gold-standard pattern), or stay on localStorage?
- **F07 recommended default: STAY on localStorage (D1).** Rationale:
  - F05 already invested in the localStorage transport; `apiFetch`, `useAuthStore`, and all callers assume body-delivered tokens.
  - F07 acceptance does NOT mandate cookies — "refresh across reloads without forcing re-login" is achievable via sliding `/me` (D2).
  - HttpOnly migration is a large rewrite: (i) `apiFetch` drops `Authorization` header, relies on cookie `credentials: 'include'`; (ii) `useAuthStore` no longer holds the token (only user metadata); (iii) NEW `refresh_tokens` table (opaque SHA-256-hashed tokens, `family_id`, rotation + reuse detection); (iv) NEW `POST /api/auth/refresh` endpoint with cookie read/write + SameSite tuning; (v) CORS `SameSite`/`Secure`/`__Host-` prefix configuration per environment. This is ~5-7 tasks — better scoped to a dedicated hardening feature or F29.
  - The accepted XSS tradeoff (F05 D2) is mitigated by: CSP (F28), short-ish 8h TTL, sliding refresh (active users get fresh tokens), and `token_version` invalidation (F07 D3 — a stolen token can be hard-expired via logout/role-change bump).
  - F07 hardens the SESSION LIFECYCLE (refresh, invalidation, interceptors, role-gate) on the existing transport — delivering the F07 acceptance criteria without a transport rewrite.
- **If owner wants HTTPONLY NOW:** this becomes a much larger feature — pull F29 forward or split into F07a (lifecycle on localStorage, this plan) + F07b (cookie migration). The refresh-token-rotation + reuse-detection pattern (Auth0 family pattern) requires the new table + endpoint + cookie wiring. Recommend deferring.
- **Status: PENDING SIGN-OFF (confirm D1 acceptable).** T1-T8 proceed with D1.

### (b) `JWT_TTL` default value

- **Question:** F07 makes `JWT_TTL` env-driven (D8), default `'8h'` (F05 behavior). Is 8h acceptable, or should the default be shorter (e.g. `'15m'` with refresh, the OWASP access-token recommendation)?
- **F07 recommended default: `'8h'`.** Rationale:
  - F05/F06 shipped 8h; changing the default would alter session UX for all existing users.
  - The sliding `/me` refresh (D2) means active users get fresh tokens continuously — the 8h is the INACTIVE-expiry (how long after last activity before re-login).
  - 8h inactive-expiry is reasonable for an internal team tool (Slykboard is a Trello-like board for a single workspace). A 15m TTL would force re-login every 15min of inactivity — hostile UX for the target user.
  - Owners who want stricter security set `JWT_TTL=15m` via env (no code change).
- **If owner wants `'15m'` default:** change `env.ts` default to `'15m'`; document the UX impact (more frequent re-login for inactive sessions).
- **Status: PENDING SIGN-OFF (confirm `'8h'` acceptable, or pick a different default).** T1 proceeds with `'8h'`.

### (c) `authenticate` DB-lookup-per-request cost

- **Question:** F07's `authenticate` `ver` compare (D3) adds ONE PK lookup (`SELECT token_version FROM "Users" WHERE id = $1`) per protected request. Is this acceptable for MVP volume, or should F07 ship a Redis cache (TTL ~30s) to avoid the DB hit?
- **F07 recommended default: NO REDIS — DB PK lookup directly.** Rationale:
  - PK lookups on PG are sub-ms; for MVP volume (single workspace, dozens of users) the cost is negligible.
  - Adding Redis introduces infrastructure (a cache to deploy/operate), cache-invalidation complexity (the cache must invalidate on `bumpTokenVersion`), and a new failure mode (cache down → fallback to DB).
  - F29 can add Redis if/when volume warrants.
- **If owner wants REDIS NOW:** add a Redis client + a `getCachedTokenVersion(userId)` with TTL 30s + invalidation in `bumpTokenVersion`. ~2 extra tasks. Recommend deferring to F29.
- **Status: PENDING SIGN-OFF (confirm DB-direct acceptable).** T3 proceeds with DB-direct.

---

**End of F07 task breakdown.**
