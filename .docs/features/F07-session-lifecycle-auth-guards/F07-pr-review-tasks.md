# Task Breakdown — SLYK-F07 PR Review Remediation

**Source:** `F07-pr-review.md` (PR review of `feature/SLYK-F07-session-lifecycle-auth-guards` → `main`)
**Scope:** 4 blockers (H1–H4), 6 medium (M1–M6), 11 low (L1–L11)
**Verdict driving this work:** Backend merge-ready in isolation; frontend interceptor seam + dead cross-tab fallback block merge. Fix H1–H3, verify H4 (browser smokes), land recommended fast-follows (M2–M6).

All file paths and line numbers below were verified against the working tree at review time. Tests follow existing conventions: backend = `vi.hoisted` + mock `../db/client`, routes via `supertest(app)`; frontend = `renderHook`/`render` + `<MemoryRouter>`, real `useAuthStore` + `localStorage.clear()` reset, mock `@tanstack/react-query` `useQueryClient`. No shared test-utils exist.

---

## 1. Parallelization Strategy

### 1.1 Batch model

- **Batch 1 — Remediation (12 tasks, fully parallel).** Every task owns a disjoint file set. Zero merge-conflict surface. All may branch from `feature/SLYK-F07-session-lifecycle-auth-guards` simultaneously and rebase independently.
- **Batch 2 — Integration verification (1 task).** Depends on the blocker fixes landing first (H1, H2, H3, M2). Writes a new test file — no conflict with Batch 1.
- **Batch 3 — Manual smoke + sign-off (1 task).** Gate. Depends on Batch 1 + Batch 2. No code; updates the verification doc.

### 1.2 Visual dependency flow

```
BATCH 1 (parallel, disjoint files) ─────────────────────────────────────────────
                                                                             │
 ┌─────────────── FRONTEND ───────────────┐  ┌──────── BACKEND ────────────┐ │
 │ T1  H1  root handler registration      │  │ T5  M3  runtime ver guard   │ │
 │ T2  H2  interceptor retry coalesce     │  │ T6  M4b /logout comment+500 │ │
 │ T3  H3  removeOnNull + key constant    │  │ T7  L5  atomicity assertion │ │
 │ T4  M2  useAuthSync hardening          │  │ T8  M1  ADR + tracking notes│ │
 │ T9  M4f TopNav /logout failure handling │  │ T10 L7  queryClient comment │ │
 └────────────────────────────────────────┘  └─────────────────────────────┘ │
                                             │                              │
                          ┌──────────────────┘                              │
                          ▼                                                 │
BATCH 2: T11 H4 integration test  (deps: T1, T2, T3, T4) ────────────────────┘
                          │
                          ▼
BATCH 3: T12 browser smokes + sign-off  (deps: T1–T4, T9, T11)
```

### 1.3 Merge order rules

1. All **Batch 1** tasks may merge in any order — disjoint files. No serialization required.
2. **Batch 2 (T11)** merges only after **T1, T2, T3, T4** are on the branch — its test asserts behavior those fixes introduce.
3. **Batch 3 (T12)** is the terminal gate; merges last. It records the two-tab browser smoke results that close H3/H4.

### 1.4 Summary table

| #  | Batch | Target File(s) | Deps | Can Parallel With |
|----|-------|----------------|------|-------------------|
| T1  | 1 | `routes/index.tsx`, `components/AppLayout.tsx` | None | T2–T10 |
| T2  | 1 | `api/client.ts`, `api/client.test.ts` | None | T1, T3–T10 |
| T3  | 1 | `stores/useAuthStore.ts`, `hooks/useCrossTabLogout.ts`, `hooks/useCrossTabLogout.test.tsx`, `constants/auth.ts` (new) | None | T1, T2, T4–T10 |
| T4  | 1 | `hooks/useAuthSync.ts`, `hooks/useAuthSync.test.tsx` | None | T1, T2, T3, T5–T10 |
| T5  | 1 | `utils/jwt.ts`, `middleware/auth.ts`, `utils/jwt.test.ts`, `middleware/auth.test.ts` | None | T1–T4, T6–T10 |
| T6  | 1 | `routes/auth.routes.ts`, `routes/auth.routes.test.ts` | None | T1–T5, T7–T10 |
| T7  | 1 | `services/tokenVersion.test.ts` | None | T1–T6, T8–T10 |
| T8  | 1 | `.docs/adr/0001-per-request-auth-db-lookup.md` (new), `.docs/features/F07-…/F07-followups.md` (new) | None | T1–T7, T9, T10 |
| T9  | 1 | `components/TopNav.tsx`, `components/TopNav.test.tsx` | None | T1–T8, T10 |
| T10 | 1 | `lib/queryClient.ts` | None | T1–T9 |
| T11 | 2 | `api/auth.logout-loop.test.ts` (new) | T1, T2, T3, T4 | — (Batch 2) |
| T12 | 3 | `.docs/features/F07-…/F07-session-lifecycle-auth-guards-tasks-verification.md` | T1–T4, T9, T11 | — (Batch 3) |

### 1.5 Developer assignment tracks

- **Track A — Interceptor & lifecycle (highest risk):** T2 → T1 → T4 → T11 → T12
- **Track B — State & cross-tab:** T3 → T9 → (join T11)
- **Track C — Backend hardening:** T5 → T6 → T7 ; T8 and T10 picked up anytime
- Recommended: one dev per track, 3 devs total. Track A owns all four blockers end-to-end.

---

## 2. Tasks

### T1 — Register logout handlers at app root (above `RequireAuth`)  ·  [H1] · Batch 1

**Severity:** 🔴 Blocker
**Depends on:** None

**Problem.** `CrossTabLogoutSync` (→ `useAuthSync` → `registerLogoutHandlers`) mounts inside `AppLayout` (`frontend/src/components/AppLayout.tsx:9`), which is a child of `RequireAuth` (`frontend/src/routes/index.tsx:17-21`). The interceptor's `logoutHandlers` is `null` (`frontend/src/api/client.ts:33`) until that subtree mounts. The guard at `client.ts:73` (`logoutHandlers &&`) silently no-ops any 401 that fires before mount — a boot query or race against a server-invalidated-but-not-yet-expired token clears no state and triggers no redirect.

**Fix.** Move `CrossTabLogoutSync` to a root layout mounted for **all** routes (including `/login`), so `registerLogoutHandlers` runs unconditionally inside Router context. `useAuthSync`'s effects are already self-guarding (`boot fetchMe` and the interval both check `user?.token`), so mounting at root is safe on `/login`.

**Changes:**
1. `frontend/src/routes/index.tsx` — introduce a pathless root layout that renders `<CrossTabLogoutSync />` then `<Outlet />`, and make it the parent of **both** the `/login` route and the existing `RequireAuth` subtree:
   ```tsx
   // Import CrossTabLogoutSync
   function RootLayout() {
     return (
       <>
         <CrossTabLogoutSync />
         <Outlet />
       </>
     )
   }
   // Restructure: RootLayout wraps { /login, RequireAuth > AppLayout > … }
   ```
2. `frontend/src/components/AppLayout.tsx` — remove the `<CrossTabLogoutSync />` line (currently line 9). Leave `TopNav` + `HealthBadge` + `Outlet`.

**Acceptance Criteria:**
- [ ] `CrossTabLogoutSync` renders for `/login` (verify via React DevTools or a root-level test).
- [ ] `registerLogoutHandlers` has run before any protected query can fire — i.e. a 401 dispatched during boot no longer silently no-ops.
- [ ] `/login` still renders `LoginPage` with no auth chrome; logged-out boot does not call `fetchMe` (guarded by `user?.token`).
- [ ] No duplicate mount of `CrossTabLogoutSync` (removed from `AppLayout`).
- [ ] `npm test -w frontend` green; existing `useAuthSync.test.tsx` / `useCrossTabLogout.test.tsx` unchanged and passing.

---

### T2 — Coalesce concurrent 401s: refresh once, retry all waiters  ·  [H2, L8] · Batch 1

**Severity:** 🔴 Blocker (H2); 🟢 Low (L8)
**Depends on:** None

**Problem.** `frontend/src/api/client.ts:76-88` gates the **entire** 401 block behind `isLoggingOut`. When request A wins the refresh race and retries, concurrent B/C observe `isLoggingOut === true`, skip the block, and throw 401 on the stale token. Net: N concurrent expired-token calls → 1 succeeds post-refresh, N−1 fail spuriously. The existing test "N concurrent → logout once" covers only the logout branch, masking this.

Additionally (L8): the retry `doFetch(init ?? {})` (`client.ts:81`) discards the caller's `AbortSignal`, breaking abort-awareness on retry.

**Fix.** Gate only the **refresh call**, not the retry. Introduce a module-level shared refresh promise so concurrent 401s await a single refresh; on success, **every** waiter retries once; on failure, the first loser triggers `logout()` once and all throw.

**Changes** (`frontend/src/api/client.ts`):
1. Replace the `isLoggingOut` boolean with a coalesced promise:
   ```ts
   let refreshPromise: Promise<boolean> | null = null
   ```
2. In the 401 block: if `refreshPromise` is null, assign it `logoutHandlers.refresh().finally(() => { refreshPromise = null })`. All concurrent 401s `await` the same `refreshPromise`.
   - On `refreshed === true`: retry once via `doFetch(path, init)` — pass `init` through (preserves `signal`, fixes L8).
   - On `refreshed === false`: call `logoutHandlers.logout()` exactly once (guard with a flag so only the first loser fires it), then throw an `ApiClientError` (401).
3. Preserve the existing `/auth/*` exemption (`client.ts:72`) and the `logoutHandlers &&` guard (now only relevant pre-T1; harmless after T1).

**Acceptance Criteria:**
- [ ] New test: N concurrent 401s with a refresh that **succeeds** → all N retry and succeed (1 refresh call, N retries). This is the case that currently fails.
- [ ] Existing test: N concurrent 401s with a refresh that **fails** → exactly 1 `logout()` call, all N reject.
- [ ] Retry re-passes the original `init` (incl. `signal`); add a test asserting an aborted retry does not hang.
- [ ] `refreshPromise` is cleared after resolution (no stuck singleton blocking the next failure cycle).
- [ ] `npm test -w frontend -- client.test` green.

---

### T3 — Make the storage-event cross-tab fallback live; extract auth storage key  ·  [H3, L2, L4] · Batch 1

**Severity:** 🔴 Blocker (H3); 🟢 Low (L2, L4)
**Depends on:** None

**Problem.** Zustand `persist` has no `removeOnNull` configured (`frontend/src/stores/useAuthStore.ts:27-30` — only `name` + `partialize`). On `clear()` it writes `{"state":{"user":null},"version":0}` — a **non-null** `newValue`. The storage handler (`frontend/src/hooks/useCrossTabLogout.ts:43-47`) fires only on `event.newValue === null`, which never happens. BroadcastChannel is therefore the only working cross-tab path; in browsers without it (older Safari, some private modes) cross-tab logout silently fails. The unit test passes only because it hand-dispatches a synthetic `newValue:null` event.

Also (L2): `'slyk-auth'` is hardcoded in `useCrossTabLogout.ts:6-7` (channel + storage key) and `useAuthStore.ts:28` (persist name) with no shared constant. And (L4): `AuthMessage` (`useCrossTabLogout.ts:9`) has a dead `{ type: 'login' }` variant nothing broadcasts or handles.

**Fix.**
1. **H3 —** Set `removeOnNull: true` on the `persist` config in `useAuthStore.ts` so `clear()` removes the key (producing a real `storage` event with `newValue === null`). **Additionally** harden the listener to handle browsers/versions that still write a non-null envelope: parse `event.newValue` and treat a parsed `user === null` as a remote logout. Belt-and-suspenders, because `removeOnNull` behavior has varied across `zustand` versions.
2. **L2 —** Create `frontend/src/constants/auth.ts` exporting `AUTH_STORAGE_KEY = 'slyk-auth'`. Import it in `useAuthStore.ts` (persist `name`) and `useCrossTabLogout.ts` (both `CHANNEL_NAME` and `STORAGE_KEY`). Follow the existing constants convention (SCREAMING_SNAKE_CASE).
3. **L4 —** Remove the dead `{ type: 'login' }` variant from `AuthMessage`; it becomes `{ type: 'logout' }`.

**Changes:**
- `frontend/src/constants/auth.ts` (new): `export const AUTH_STORAGE_KEY = 'slyk-auth'`
- `frontend/src/stores/useAuthStore.ts`: import the constant; add `removeOnNull: true` to persist options.
- `frontend/src/hooks/useCrossTabLogout.ts`: import the constant; replace `CHANNEL_NAME`/`STORAGE_KEY` literals; tighten the storage handler:
  ```ts
  const onStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_STORAGE_KEY) return
    if (event.newValue === null) return handleRemoteLogout()
    // Fallback for non-removing persist writes:
    try {
      const parsed = JSON.parse(event.newValue)
      if (parsed?.state?.user === null) handleRemoteLogout()
    } catch { /* ignore malformed */ }
  }
  ```
  Remove the `{ type: 'login' }` variant.
- `frontend/src/hooks/useCrossTabLogout.test.tsx`: replace the synthetic `newValue:null`-only assertion with a test that drives the **real store** `clear()` and asserts the handler fires (covers both the `null` and parsed-`user:null` paths).

**Acceptance Criteria:**
- [ ] `removeOnNull: true` present in persist config; `clear()` removes the `slyk-auth` localStorage key.
- [ ] Storage handler fires `handleRemoteLogout` on both `newValue === null` and a parsed `user === null` envelope.
- [ ] `AUTH_STORAGE_KEY` is the single source; grep shows zero remaining `'slyk-auth'` string literals in `src/` (tests may keep a literal only where asserting the constant's value).
- [ ] `AuthMessage` has no `login` variant.
- [ ] `npm test -w frontend` green.
- [ ] **Defer final sign-off to T12 two-tab smoke** (the real failure mode is browser behavior no unit test can reproduce).

---

### T4 — Harden `useAuthSync`: idempotent logout, best-effort server bump, boot-fetch gating, named cadence  ·  [M2, M5, M6, L3, L9] · Batch 1

**Severity:** 🟡 Medium (M2, M5, M6); 🟢 Low (L3, L9)
**Depends on:** None

**Problem.** Five issues concentrated in `frontend/src/hooks/useAuthSync.ts`:
- **M2** — When Tab A logs out, Tab B's next poll 401s and re-triggers the logout handler even though the broadcast already cleared it → redundant `queryClient.clear()` + navigate (`useAuthSync.ts:48-53`, `:71-92`).
- **M5** — The interceptor's logout path (this handler) clears **without** calling `/auth/logout`, so a 401-triggered logout never bumps `token_version` server-side. Self-consistent only because the broadcast reaches other tabs (`client.ts` ↔ `useAuthSync.ts:48-53`).
- **M6** — Boot `fetchMe` fires unconditionally on every reload even when 7h59m remain; also starts the 60s interval redundantly (`useAuthSync.ts:57-68`).
- **L3** — The `60 * 1000` poll cadence (`useAuthSync.ts:90`) is an unnamed magic number (`REFRESH_THRESHOLD_MS` is named, the cadence is not).
- **L9** — `useAuthSync.test.tsx:~600` store mock returns a new object each call → React 19 `useSyncExternalStore` "getSnapshot should be cached" warning.

**Changes** (`frontend/src/hooks/useAuthSync.ts`):
1. **M2 + M5 —** Rewrite the registered `logout` handler to be idempotent and to best-effort bump the server:
   ```ts
   logout: async () => {
     const wasLoggedIn = useAuthStore.getState().user !== null  // idempotency guard
     clear()
     queryClient.clear()
     broadcastLogout()
     navigate('/login', { replace: true })
     if (wasLoggedIn) {
       try { await apiPost('/auth/logout', {}) } catch { /* already logged out */ }
     }
   }
   ```
   - Idempotency: second invocation (already cleared) is a no-op for side effects beyond a harmless navigate.
   - M5: `POST /auth/logout` best-effort so the version bump is attempted even on interceptor-driven logout. Coordinate with T6 (backend comment) and T9 (TopNav).
   - Update the `LogoutHandlers` `logout` signature in `client.ts` to `() => void | Promise<void>` (T2 owns `client.ts` — flag in PR description; the signature widening is backward-compatible).
2. **M6 —** Gate the boot `fetchMe` through the near-expiry threshold: drop the unconditional boot call; instead let the interval's first tick (immediate or within `POLL_INTERVAL_MS`) perform the session-confirmation fetch only when near expiry. If the design wants exactly one boot confirmation call, document it and drop the separate interval — pick the simpler of the two and add a one-line comment. Goal: a token with hours left does not hit `/me` on every reload.
3. **L3 —** Extract `const POLL_INTERVAL_MS = 60 * 1000` near `REFRESH_THRESHOLD_MS` (`useAuthSync.ts:12`); use it at `:90`.
4. **L9 —** In `useAuthSync.test.tsx`, cache the mocked store snapshot so `getState()`/selector returns a stable reference across calls (React 19 `useSyncExternalStore` requirement).

**Acceptance Criteria:**
- [ ] Logout handler is idempotent: calling it twice produces one `clear`/`broadcast`/`navigate` and at most one `/auth/logout` POST.
- [ ] Interceptor-driven logout now attempts `POST /auth/logout` (best-effort) — M5 closed.
- [ ] Boot no longer fires `/me` when the token is far from expiry (M6).
- [ ] `POLL_INTERVAL_MS` named; no bare `60 * 1000` remains.
- [ ] Test store mock returns a cached snapshot; no `useSyncExternalStore` warning in test output.
- [ ] `npm test -w frontend` green.

---

### T5 — Runtime-validate the JWT `ver` claim  ·  [M3] · Batch 1

**Severity:** 🟡 Medium
**Depends on:** None

**Problem.** `backend/src/utils/jwt.ts:30-37` casts the verified payload to `JwtUserClaims & JWTPayload` (`:36`), but `ver` is `undefined` for any pre-F07 or malformed token. `undefined !== 0` happens to produce the correct 401 in `authenticate` (`backend/src/middleware/auth.ts:34-37`), but the type lies at runtime. Also `jose` returns raw JSON values — a string `"0"` would survive verification (non-exploitable — needs the signing key — but masks bugs).

**Fix.** Replace the cast with a runtime guard in `verifyJwt`; fail closed with `UNAUTHENTICATED` if `ver` is absent or not a number.

**Changes:**
1. `backend/src/utils/jwt.ts` — after `jwtVerify`, validate before returning:
   ```ts
   if (typeof payload.ver !== 'number' || !Number.isFinite(payload.ver)) {
     throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing numeric ver claim')
   }
   ```
   (Keep `AppError`/`ErrorCode` imports consistent with `middleware/auth.ts`.) Return the now-honestly-typed payload without a cast.
2. `backend/src/middleware/auth.ts` — the `!== payload.ver` compare (`:35`) is now strict-numeric by construction; leave as-is but confirm the comment reflects that `ver` is guaranteed numeric.
3. Tests:
   - `backend/src/utils/jwt.test.ts` — add: a token signed without `ver` (or with `ver: "0"`) → `verifyJwt` throws `UNAUTHENTICATED`.
   - `backend/src/middleware/auth.test.ts` — add: middleware rejects a `ver`-less payload with 401 (not a 500 or silent pass).

**Acceptance Criteria:**
- [ ] `verifyJwt` throws `UNAUTHENTICATED` for missing/non-numeric `ver`; no cast remains.
- [ ] Legitimate tokens (numeric `ver`) still verify and return the full claims.
- [ ] New unit tests cover the missing-`ver` and string-`ver` cases.
- [ ] `npm test -w backend` green.

---

### T6 — Fix `/logout` comment/code mismatch; add 500-path test  ·  [M4-backend, L6] · Batch 1

**Severity:** 🟡 Medium (M4); 🟢 Low (L6)
**Depends on:** None

**Problem.** `backend/src/routes/auth.routes.ts:77-79` comment says "Best-effort: client swallows errors," but the server does **not** swallow — if `bumpTokenVersion` throws (DB down) the route returns 500 and the bump did not persist. The comment misleads frontend integration. Also (L6) `auth.routes.test.ts` has no `/logout` failure path.

**Fix.**
1. Update the comment at `auth.routes.ts:77-79` to reflect actual behavior:
   ```text
   // POST /api/auth/logout — F07 D4: bump tokenVersion to hard-expire outstanding
   // JWTs for this user (defense-in-depth; client-side clear is authoritative for UX).
   // Server reports failure (500) if the version bump did not persist; the client
   // must still clear locally for UX regardless of the response. Google token
   // revocation deferred to F29.
   ```
2. Add a `/logout` failure test in `backend/src/routes/auth.routes.test.ts`: mock `bumpTokenVersion` to reject → `POST /api/auth/logout` returns 500 (assert status + error envelope). Follow the existing `supertest(app)` + `vi.mock` pattern (`auth.routes.test.ts:25-43`).

**Acceptance Criteria:**
- [ ] Comment accurately describes server behavior (no "swallows errors" claim).
- [ ] New test: `bumpTokenVersion` reject → 500 response with error envelope.
- [ ] Existing `/logout` success test still passes.
- [ ] `npm test -w backend -- auth.routes` green.

---

### T7 — Assert atomic `+ 1` SQL shape in `bumpTokenVersion` test  ·  [L5] · Batch 1

**Severity:** 🟢 Low
**Depends on:** None

**Problem.** `backend/src/services/tokenVersion.test.ts:72-80` asserts the bump is "truthy," not that it used the atomic `sql\`${users.tokenVersion} + 1\`` increment. A hardcoded `.set({ tokenVersion: 1 })` would pass — defeating the test's purpose (proving the race-safe increment).

**Fix.** Tighten the assertion to verify the `.set()` argument contains the `sql` increment expression against the `tokenVersion` column (not a literal `1`).

**Changes** (`backend/src/services/tokenVersion.test.ts`):
- Capture the `.set()` argument from the mocked update chain (extend the hoisted `bag` to record the `set` input) and assert:
  - The set object's `tokenVersion` is a Drizzle `SQL` wrapper (not a plain number).
  - Its `.queryChunks`/serialized form references `token_version + 1` (or assert the column symbol + `+ 1` operator are present per the existing mock idiom).
- Keep the existing success-case assertions.

**Acceptance Criteria:**
- [ ] Test fails if `bumpTokenVersion` is changed to `.set({ tokenVersion: 1 })` (a literal).
- [ ] Test passes against the current `sql\`...+ 1\`` implementation.
- [ ] `npm test -w backend -- tokenVersion` green.

---

### T8 — Record M1 decision as ADR; track deferred follow-ups  ·  [M1, L1, L10, L11] · Batch 1

**Severity:** 🟡 Medium (M1); 🟢 Low (L1, L10, L11)
**Depends on:** None

**Problem.** M1 (per-request PK lookup in `authenticate`, `backend/src/middleware/auth.ts:34`) is accepted at current scale (sign-off D3 "DB-direct, PK sub-ms") but has no durable record — and no ADR directory exists. L1 (`requireRole` not yet mounted on any admin route — defense-in-depth is frontend-only until F17/F25), L10 (no down-migration convention; latent drizzle `$1` enum-partial-index bug in `0002_snapshot.json` metadata), and L11 (`bumpTokenVersion` has no upper bound — integer overflow at 2³¹) are tracking items with no home.

**Fix.** Create the missing durable records (docs only — no code changes).
1. **M1 ADR** — create `.docs/adr/` and write `.docs/adr/0001-per-request-auth-db-lookup.md`:
   - Context: `authenticate` does a PK lookup per protected request to compare `payload.ver` against DB `token_version`.
   - Decision: accept DB-direct at current scale; reject an in-memory cache **for now**.
   - Consequences: any DB hiccup 401s a valid session; a boot burst (board + reports + user) = N synchronous PG round-trips per tab. Revisit (short-TTL cache keyed by `sub`, invalidated on bump) when request volume grows.
   - Link to sign-off D3.
2. **Follow-ups doc** — create `.docs/features/F07-session-lifecycle-auth-guards/F07-followups.md` tracking:
   - **L1:** mount `requireRole('ADMIN')` on the first admin backend route (F17/F25). Flag that no `GET /api/settings` (or similar) be added without it.
   - **L10:** no down-migration convention — rollback is manual `ALTER TABLE … DROP COLUMN`. Note the latent `$1` enum-partial-index bug lives in `0002_snapshot.json` metadata only (not applied SQL); a future Users-table migration could re-emit it — reconcile to literal per the `drizzle-partial-index-enum-dollar1` memory.
   - **L11:** `bumpTokenVersion` unbounded — theoretical integer overflow at 2³¹; track for F25.

**Acceptance Criteria:**
- [ ] `.docs/adr/0001-per-request-auth-db-lookup.md` exists with Context/Decision/Consequences.
- [ ] `F07-followups.md` enumerates L1, L10, L11 with the owning future feature (F17/F25/F25).
- [ ] No source code changed.

---

### T9 — TopNav: tolerate `/logout` failure; treat 401/500 as success-equivalent  ·  [M4-frontend] · Batch 1

**Severity:** 🟡 Medium
**Depends on:** None

**Problem.** `frontend/src/components/TopNav.tsx:27-31` `handleSignOut` calls `await logout()` then `clear()`/`broadcastLogout()`/`navigate()` — but with **no try/catch**. Per the corrected backend contract (T6), `/logout` can return 500 if the version bump fails to persist. If `logout()` rejects, the local clear + navigate never run — the user appears stuck despite being functionally signed out. (The interceptor path is covered by T4; this is the explicit button path.)

**Fix.** Wrap the network bump so a `/logout` rejection still clears local state.

**Changes** (`frontend/src/components/TopNav.tsx`):
```tsx
const handleSignOut = async () => {
  try {
    await logout()                  // best-effort server bump
  } catch {
    // 401/500 from /logout === already logged out; clear locally regardless
  }
  clear()
  broadcastLogout()
  navigate('/login', { replace: true })
}
```

**Acceptance Criteria:**
- [ ] `logout()` rejecting (mocked 500/401) still results in `clear()` + `broadcastLogout()` + navigate to `/login`.
- [ ] New test in `TopNav.test.tsx`: mock `logout` to reject → assert local clear + redirect occur.
- [ ] Happy path (logout resolves) unchanged and passing.
- [ ] `npm test -w frontend -- TopNav` green.

---

### T10 — Note 403 retry behavior in `queryClient`  ·  [L7] · Batch 1

**Severity:** 🟢 Low
**Depends on:** None

**Problem.** `frontend/src/lib/queryClient.ts:11-16` retry predicate short-circuits only 401; 403 (role demotion) still retries 3×. Per spec this is acceptable, but it is undocumented.

**Fix.** Add a one-line comment at `queryClient.ts:11` making the 403-retries behavior explicit (and the rationale: a role demotion is not transient, but spec accepts the retries until `requireRole` is backend-enforced in F17/F25).

**Acceptance Criteria:**
- [ ] Comment added; no behavior change.
- [ ] `npm test -w frontend` green (no test changes expected).

---

### T11 — Integration test: full logout loop  ·  [H4] · Batch 2

**Severity:** 🔴 Blocker (verification)
**Depends on:** T1, T2, T3, T4

**Problem.** Unit coverage is strong per-piece, but nothing tests the chain end-to-end: `logout → version bump → stale token 401 → interceptor fires → /me 401 → state cleared`. The seam "does the interceptor translate a version-mismatch 401 into a logout" is covered only by a synthetic mock (H4). No Playwright/e2e harness exists in the repo (T8 steps 9–13 are manual DevTools procedures), so this task adds a **vitest integration test** that wires the real pieces against a scripted fetch sequence.

**Fix.** New file `frontend/src/api/auth.logout-loop.test.ts` (or `hooks/` per convention — co-locate near the seam under test) driving the real `client.ts` interceptor + real `useAuthStore` + a `fetch` mock that returns a scripted sequence:
1. Request with a valid token → 200.
2. Server bumps version (simulate): subsequent request → 401 (ver mismatch).
3. Interceptor attempts refresh (`/auth/me`) → 401 (same stale token).
4. Assert: `logoutHandlers.logout()` fires, `useAuthStore.getState().user === null`, `queryClient.clear()` called, navigation to `/login` requested.

This is more realistic than the existing synthetic unit because it exercises the **registered handlers** (post-T1 they are registered at root) and the coalesced refresh (post-T2).

**Changes:**
- `frontend/src/api/auth.logout-loop.test.ts` (new):
  - Register handlers via a `renderHook(<RootLayout/>)` or by directly invoking `registerLogoutHandlers` with spies (mirror `useAuthSync.test.tsx` harness: `<MemoryRouter>`, mock `useQueryClient`, mock `fetchMe`, mock `@/api/client` fetch).
  - Script `global.fetch` (or the `doFetch` boundary) to return the 200 → 401 → 401 sequence.
  - Assert the end state + that exactly one logout occurred.
- Follow the existing test-setup conventions: `vi.hoisted` mocks, real `useAuthStore` + `localStorage.clear()` reset, `act`/`flushMicrotasks` helpers from `useAuthSync.test.tsx`.

**Acceptance Criteria:**
- [ ] Test exercises the full loop (valid → stale 401 → refresh 401 → cleared state + redirect) using the **real** interceptor + registered handlers (not a hand-stubbed `logout`).
- [ ] Test fails if T2's retry-coalesce regresses (multiple logouts) or if T4's idempotency regresses.
- [ ] Test passes after T1–T4 are applied.
- [ ] `npm test -w frontend` green.
- [ ] **Defer the real two-tab browser confirmation to T12** (no vitest can reproduce cross-tab `storage`/BroadcastChannel behavior).

---

### T12 — Run T8 browser smokes (two-tab logout) and record sign-off  ·  [H3, H4] · Batch 3

**Severity:** 🔴 Blocker (gate)
**Depends on:** T1, T2, T3, T4, T9, T11

**Problem.** The two failure modes that no unit/integration test can reproduce — real cross-tab logout via `storage` event (H3) and the live two-tab logout loop (H4) — are verified only by manual browser smoke. These are the items flagged "browser smokes pending" in commit `4e7a2fd` and `F07-session-lifecycle-auth-guards-tasks-verification.md`.

**Fix.** Execute the manual T8 steps 9–13 from `F07-session-lifecycle-auth-guards-tasks.md` (lines ~1516–1542) against the remediated branch and record results.

**Procedure (from T8):**
1. **Sliding refresh** — sign in via frontend, watch Network for `GET /me` returning a fresh token on window focus / near-expiry; confirm `slyk-auth` localStorage token updates.
2. **401 interceptor dedup** — tamper token via `useAuthStore.setState`, trigger an API call, observe **one** `/me` refresh attempt then a single logout + redirect (post-T2: concurrent calls share one refresh).
3. **Cross-tab logout** — Tab A signs out → Tab B redirects within ~1s via BroadcastChannel `'slyk-auth'`; **and** exercise the `storage`-event fallback (e.g. disable BroadcastChannel in DevTools / test a private-mode Safari) to confirm H3's `removeOnNull` + parsed-`user:null` fix actually fires.
4. **Role-gate** — ADMIN sees Settings; MEMBER hidden + redirected; backend `requireRole` verified by unit (no route mounted until F17).
5. **`JWT_TTL` env** — set `JWT_TTL=1m`, decode token, assert `exp - iat ≈ 60`, revert to `8h`.

**Changes:**
- Update `.docs/features/F07-session-lifecycle-auth-guards/F07-session-lifecycle-auth-guards-tasks-verification.md`:
  - Mark browser smokes 9–11 **✅ passed** with the date and a one-line note per step (esp. the `storage`-fallback confirmation closing H3).
  - Record the two-tab logout loop result closing H4.
  - Flip the overall "browser smokes pending" status from commit `4e7a2fd` to complete.

**Acceptance Criteria:**
- [ ] Two-tab logout works over BroadcastChannel **and** the `storage`-event fallback (H3 closed by observation, not just unit).
- [ ] The full logout loop (logout → stale 401 → interceptor → clear) confirmed live in the browser (H4 closed).
- [ ] Sliding-refresh, dedup, role-gate, `JWT_TTL` steps all pass.
- [ ] Verification doc updated with dates + per-step notes; "browser smokes pending" status cleared.
- [ ] PR unblocked for merge (H1–H4 all closed).

---

## 3. Out of Scope (explicitly deferred)

- **Cookie-based sessions + refresh-token rotation** — deferred to F29 per F07 §9a.
- **Mounting `requireRole` on real admin routes** — F17/F25 (tracked in T8's `F07-followups.md`).
- **Per-request auth cache (M1 optimization)** — recorded as ADR (T8); implement only if request volume grows.
- **Automating the browser smokes as Playwright** — net-new infra with no precedent; manual smoke (T12) is sufficient for an internal team tool. Revisit if the team adopts e2e.
- **`bumpTokenVersion` overflow guard (L11)** — F25.
