# PR Review — SLYK-F07 Session Lifecycle & Auth Guards

**Branch:** `feature/SLYK-F07-session-lifecycle-auth-guards` → `main`
**Date:** 2026-06-22
**Reviewer:** AI (pr-review skill, 3 parallel subagents: backend / frontend / cross-cutting)
**Scope:** 5 commits, 35 files, +3387 / −56. 0 behind / 5 ahead of `main` (fast-forward-able, no rebase needed).

> Sync note: review performed read-only against the local merge base (main HEAD). No `git reset --hard` / rebase was run (project sacred git rule). Branch is not behind main, so rebase is a no-op.

---

## 1. Summary of Changes

Full-stack session lifecycle with server-enforced JWT invalidation and frontend role gating.

**Backend**
- `users.token_version` column (default 0, NOT NULL) via migration `0002_brief_peter_quill.sql`.
- `ver` claim stamped into every signed JWT (`signJwt` now requires it).
- `authenticate` middleware compares `payload.ver` against the DB `token_version` on every protected request — mismatch → 401.
- `/logout` calls `bumpTokenVersion` (atomic SQL `+ 1`), hard-invalidating all outstanding tokens.
- `requireRole('ADMIN'|'MEMBER')` middleware emitting 403/401.

**Frontend**
- `client.ts` 401 interceptor: single refresh (`/auth/me`) attempt, then hard logout; `isLoggingOut` dedup; `/auth/*` exempt.
- `useAuthSync` (boot `fetchMe` + near-expiry refresh interval), `useCrossTabLogout` (BroadcastChannel + storage-event fallback), `useRequireRole`.
- `RequireRole` gate component, `CrossTabLogoutSync` mount, `TopNav` role-gated links, `AppLayout` wiring.
- `queryClient`: no retry on 401.

**Tests** — new/expanded: `auth.test.ts`, `requireRole.test.ts`, `tokenVersion.test.ts`, `jwt.test.ts`, `auth.routes.test.ts`, `client.test.ts`, `useAuthSync.test.tsx`, `useCrossTabLogout.test.tsx`, `useRequireRole.test.tsx`, `RequireRole.test.tsx`, `TopNav.test.tsx`.

---

## 2. Code Quality Assessment

**Strengths**
- Core invalidation mechanism is correct and race-safe: `token_version` bump is an atomic SQL increment; the DB-compare in `authenticate` is the authoritative gate.
- `ver` initial value (0) consistent across sign (`/google`, `/me`) and verify (strict `!==`); migration backfills 0 cleanly (metadata-only on PG, no rewrite).
- Layering respected end-to-end (route → service → Drizzle). No route→DB shortcuts. Controllers thin.
- Parameterized queries throughout (no SQL injection surface).
- Secrets via env only (`env.jwtSecret`, `env.jwtTtl`); prod error middleware sanitizes ≥500 messages.
- Express 5 native async-rejection forwarding — no `asyncHandler` wrapper needed.
- 401 interceptor dedup + single-refresh-then-logout + `/auth/*` exemption is the right shape.
- `tamperSignature` test fix (flip first base64url char, not last) is a genuine improvement with a correct comment.
- Types consistent backend↔frontend (same `'ADMIN'|'MEMBER'` union); type-only imports use `type` keyword; no `any` introduced.

**Weaknesses** — see findings below. Two high-severity correctness gaps in the 401 interceptor and one dead cross-tab fallback are the merge blockers.

---

## 3. Findings

### 🔴 Blockers / High

**H1 — 401 interceptor handler-registration gap**
`frontend/src/components/AppLayout.tsx:9`
`CrossTabLogoutSync` (→ `useAuthSync` → `registerLogoutHandlers`) is mounted *inside* `AppLayout`, which is inside `RequireAuth`. The interceptor's `logoutHandlers` is `null` until that subtree mounts. Any 401 before mount (a query kicked off during boot, or a race) hits the `logoutHandlers &&` guard and silently throws — no redirect, no state clear.
**Fix:** register logout handlers at the app root (above `RequireAuth`), or mount `CrossTabLogoutSync` there. A cold load of a server-invalidated-but-not-yet-expired token currently relies entirely on `RequireAuth`'s synchronous `isTokenExpired` check rather than the server.

**H2 — `isLoggingOut` dedup starves concurrent requests of retry**
`frontend/src/api/client.ts:76-88`
The dedup serializes concurrent 401s but, on refresh *success*, does not loop blocked requests back to retry. When request A wins the race (refreshes, retries, succeeds), concurrent B/C see `isLoggingOut === true`, skip the block, and throw 401 with the stale token. Net: N concurrent expired-token calls → 1 succeeds after refresh, N−1 fail spuriously. Existing test "N concurrent → logout once" only covers the logout branch, masking this.
**Fix:** gate only the refresh call, not the retry; after refresh resolves, let blocked requests retry once.

**H3 — Storage-event cross-tab fallback is dead in practice**
`frontend/src/hooks/useCrossTabLogout.ts:43-47` + `frontend/src/stores/useAuthStore.ts`
Zustand `persist` has no `removeOnNull`/`skipNull`, so `clear()` writes `{"state":{"user":null},"version":0}` — a **non-null** `newValue`. The hook fires only on `event.newValue === null`, which never happens. BroadcastChannel is therefore the *only* working cross-tab path; in browsers without it (older Safari, some private modes) cross-tab logout silently fails. The unit test passes only because it hand-dispatches a synthetic `newValue:null` event.
**Fix:** set `removeOnNull: true` (and `partialize` to drop null) on the persist config, **or** listen for any change to the key and check the parsed user for null. Verify in the pending T8 browser smoke with two real tabs.

**H4 — No end-to-end test for the full logout loop**
Unit coverage is strong per-piece, but nothing tests the chain: `logout → version bump → stale token 401 → interceptor fires → /me 401 → state cleared`. The seam "does the interceptor translate a version-mismatch 401 into a logout" is only covered by a synthetic mock. The pending browser smokes would close this; until run, the highest-risk integration path is unverified.

### 🟡 Medium

**M1 — Per-request DB hit in `authenticate`**
`backend/src/middleware/auth.ts:34`
Every protected request now does a PK lookup. Acceptable at this app's scale (sign-off D3 "DB-direct, PK sub-ms"), but any DB hiccup now 401s a *valid* session (previously only expired tokens failed), and a boot burst (board + reports + user) = N synchronous PG round-trips per tab.
**Fix:** short TTL in-memory cache keyed by `sub` (e.g. 5s), invalidated on bump — or accept loudly in an ADR.

**M2 — Redundant logout storm on multi-tab polling**
`frontend/src/hooks/useAuthSync.ts:71-92`
When Tab A logs out, Tab B's next-poll request 401s and re-triggers the logout handler even though the broadcast already cleared it — redundant `queryClient.clear()` + navigate.
**Fix:** make the interceptor's logout handler idempotent (guard on `user === null` or an `isLoggedOut` flag).

**M3 — `payload.ver` cast is type-dishonest**
`backend/src/utils/jwt.ts` / `auth.ts:34`
`verifyJwt` casts to `JwtUserClaims & JWTPayload`, but `ver` is `undefined` for any pre-F07 or malformed token. `undefined !== 0` → 401 happens to be correct, but the type lies at runtime. Also `jose` returns raw JSON values — a string `"0"` survives verification (non-exploitable — needs signing key — but masks bugs).
**Fix:** runtime guard `if (typeof payload.ver !== 'number') throw AppError(UNAUTHENTICATED)` before the DB compare; strict numeric equality.

**M4 — `/logout` comment/code mismatch**
`backend/src/routes/auth.routes.ts:77-83`
Comment says "best-effort; client swallows errors," but the server does **not** swallow — if `bumpTokenVersion` throws (DB down) the route returns 500 and the bump did not persist. Safer behavior, but the comment misleads the frontend integration.
**Fix:** update comment to: "Server reports failure if the version bump didn't persist; client must still clear locally for UX." Frontend should treat 401/500 from `/logout` as success-equivalent (already logged out), not an error.

**M5 — Interceptor path never bumps server-side**
`frontend/src/components/TopNav.tsx:27` vs `useAuthSync.ts:48-53`
Two sign-out paths with inconsistent behavior: TopNav awaits `logout()` (network bump) then clears; the interceptor clears **without** calling `/auth/logout`. So a 401-triggered logout never bumps `token_version` server-side — the design is self-consistent only because the broadcast reaches other tabs.
**Fix:** have the interceptor best-effort `POST /auth/logout` before clearing, or add a comment making the broadcast reliance explicit.

**M6 — Boot `fetchMe` fires unconditionally on every reload**
`frontend/src/hooks/useAuthSync.ts:58-68`
Every hard reload with a token fires `/me` immediately *and* starts the 60s interval, even when 7h59m remain.
**Fix:** gate the boot call through the same near-expiry threshold, or treat it as the single "session confirmation" call and drop the separate interval.

### 🟢 Low / Nit

- **L1** `requireRole` ships unmounted on any route — defense-in-depth for admin is currently frontend-only (by F07 design; first mount is F17/F25). Ensure those wire it. No `/settings` backend route exists yet — flag so a future `GET /api/settings` isn't added without `requireRole('ADMIN')`.
- **L2** `'slyk-auth'` hardcoded in two files (`useCrossTabLogout.ts` + `useAuthStore.ts`). Export one `AUTH_STORAGE_KEY` constant.
- **L3** `60 * 1000` interval is an unnamed magic number (`REFRESH_THRESHOLD_MS` is named, cadence isn't).
- **L4** `AuthMessage` type has a dead `{ type: 'login' }` variant nothing broadcasts.
- **L5** `tokenVersion.test.ts:72-80` asserts "truthy" not the atomic `+ 1` SQL shape — a hardcoded `.set({ tokenVersion: 1 })` would pass.
- **L6** `auth.routes.test.ts` has no `/logout` failure path (DB throws → 500).
- **L7** `queryClient.ts:11-16` retry predicate only short-circuits 401; 403 (role demotion) still retries 3×. Per spec acceptable; note it.
- **L8** Retry `doFetch(init ?? {})` does not re-pass the original request `signal` for abort-awareness.
- **L9** `useAuthSync.test.tsx:600` store mock returns a new object each call — can trigger React 19 `useSyncExternalStore` "getSnapshot should be cached" warnings.
- **L10** Migration `0002` emits no down migration (project convention; reversible manually via `DROP COLUMN`). Latent drizzle `$1` enum-partial-index bug lives only in `0002_snapshot.json` metadata, not applied SQL — not triggered now, but a future Users-table migration could re-emit it. Track separately.
- **L11** `bumpTokenVersion` has no upper bound (integer overflow at 2³¹) — theoretical; note for F25.

---

## 4. Performance Considerations

- **M1** is the main one: per-request PK lookup in `authenticate`. Add a short TTL cache if request volume grows.
- Migration backfill is metadata-only on PG (constant default, NOT NULL) — safe/fast on large tables.
- React Query `clear()` on logout does not abort in-flight queries (v5), but the interceptor prevents retries so no stale-data leak.

---

## 5. Security Implications

- **Invalidation is server-authoritative** — the right model. Forged tokens can't bypass `ver` (HMAC-signed); legitimately-issued tokens always carry it.
- Secrets env-only; no leakage to logs/errors; CORS unchanged.
- localStorage token is the accepted project decision (sign-off); XSS surface unchanged by this PR.
- Defense-in-depth gap: admin routes are frontend-gated only until `requireRole` is mounted in F17/F25 (L1). No current exposure (no admin backend route exists).
- `payload.ver` not runtime-validated (M3) — not exploitable today, but make the type honest.

---

## 6. Testing Coverage

- **Strong per-unit**: auth middleware ver-mismatch, `/logout` bumps, 401 interceptor dedup (6 scenarios), cross-tab broadcast, role gating both sides, `tamperSignature`.
- **Gaps**:
  - **H4** end-to-end logout loop untested.
  - **L6** `/logout` 500 path untested.
  - **L5** atomicity assertion too weak.
  - **H2** concurrent-refresh-success retry path untested (would currently fail).
  - **H3** real two-tab cross-tab (the storage-fallback failure mode) — pending browser smoke.

---

## 7. Recommendations

**Before merge (blockers):**
1. Fix **H1** — register logout handlers above `RequireAuth`.
2. Fix **H2** — let blocked requests retry once after refresh success.
3. Fix **H3** — `removeOnNull: true` (or listen for any key change) so the storage fallback works.
4. Run the **T8 browser smokes** (two-tab logout) — closes H3/H4.

**Strongly recommended (fast-follow, same PR preferred):**
5. M2 idempotent logout handler; M4 comment fix + frontend treats `/logout` 401/500 as clear-anyway; M3 runtime `ver` guard.
6. Add **H4** integration test for the full loop; **L6** `/logout` 500 test; **L5** atomicity assertion.

**Nice-to-have:** L1 (mount `requireRole` in F17/F25), L2/L3/L4/L8/L9 cleanups.

---

## 8. Verdict

**Not merge-ready as-is.** Backend is solid and merge-ready in isolation (core mechanism correct, race-safe, well-layered, well-tested per-unit). The blockers are on the frontend interceptor seam and the dead cross-tab fallback:

- **H1** leaves a real window where server-invalidated sessions don't trigger client logout.
- **H2** breaks concurrent-request handling after a successful refresh.
- **H3** makes the documented storage-event fallback a no-op, leaving BroadcastChannel as the only working cross-tab path.
- **H4** means the integration path tying backend invalidation to frontend logout is unverified.

Fix H1–H3, run the browser smokes (H4), and this is ready. Everything else is acceptable for an internal team tool and can ship as tracked follow-ups.
