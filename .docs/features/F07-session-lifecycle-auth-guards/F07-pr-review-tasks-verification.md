# Implementation Verification Report

**Source:** `.docs/features/F07-session-lifecycle-auth-guards/F07-pr-review-tasks.md`
**Verified:** 2026-06-22
**Method:** 3 parallel read-only subagents (backend / frontend / docs+manual-gate) checking each task's acceptance criteria against current code + running the relevant test suites.
**Total Tasks:** 12
**Implemented:** 11 (91.7%)
**Partial:** 0
**Missing:** 1 (T12 — manual browser gate, not automatable)
**Modified:** 0

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 11 | 91.7% |
| ⚠️ Partial | 0 | 0% |
| ❌ Missing | 1 | 8.3% |
| 🔄 Modified | 0 | 0% |

**Test results at verification time**
- Backend: **42/42 pass** (jwt 10, auth 11, auth.routes 17, tokenVersion 4). `tsc --noEmit` clean.
- Frontend: **84/84 pass**, 0 fail. `tsc --noEmit` clean. No regressions.

---

## Task-by-Task Results

### ✅ Implemented

| Task | Finding(s) | Key files |
|------|-----------|-----------|
| T1 | H1 | `frontend/src/routes/index.tsx`, `frontend/src/components/AppLayout.tsx` |
| T2 | H2, L8 | `frontend/src/api/client.ts`, `client.test.ts` |
| T3 | H3, L2, L4 | `frontend/src/constants/auth.ts` (new), `stores/useAuthStore.ts`, `hooks/useCrossTabLogout.ts` + tests |
| T4 | M2, M5, M6, L3, L9 | `frontend/src/hooks/useAuthSync.ts`, `useAuthSync.test.tsx` |
| T5 | M3 | `backend/src/utils/jwt.ts`, `middleware/auth.ts` + tests |
| T6 | M4-backend, L6 | `backend/src/routes/auth.routes.ts`, `auth.routes.test.ts` |
| T7 | L5 | `backend/src/services/tokenVersion.test.ts` |
| T8 | M1, L1, L10, L11 | `.docs/adr/0001-per-request-auth-db-lookup.md`, `.docs/features/F07-…/F07-followups.md` |
| T9 | M4-frontend | `frontend/src/components/TopNav.tsx`, `TopNav.test.tsx` |
| T10 | L7 | `frontend/src/lib/queryClient.ts` |
| T11 | H4 | `frontend/src/api/auth.logout-loop.test.tsx` (new) |

### ❌ Missing

| Task | Finding(s) | Missing | Notes |
|------|-----------|---------|-------|
| T12 | H3, H4 | Live two-tab browser smoke (T8 steps 9–13 of master tasks doc) | Manual gate — cannot run headless. Code for both the storage-event fallback (T3) and the logout loop (T11) exists; only the human-run browser confirmation remains. |

---

## Detailed Gap Analysis

### Backend — no gaps

- **T5** `verifyJwt` (`jwt.ts:43-45`) runtime-throws `UNAUTHENTICATED` for missing/non-numeric/non-finite `ver`; whole-object cast removed; per-field narrowing instead. `auth.ts:34-37` comment reflects the numeric guarantee. Tests cover missing-`ver`, string-`ver` (jwt) and ver-less→401 with no DB hit (auth).
- **T6** `/logout` comment (`auth.routes.ts:77-81`) corrected (no "client swallows" claim); 500 failure-path test added (`auth.routes.test.ts:396-419`).
- **T7** `tokenVersion.test.ts:80-84` four-pronged guard (`typeof !== 'number'`, `queryChunks` array non-empty, `constructor.name === 'SQL'`) — a literal `{tokenVersion:1}` fails it. Production uses `sql\`${users.tokenVersion} + 1\``.

### Frontend — no gaps

- **T1** `RootLayout` (`routes/index.tsx:12-19`) wraps both `/login` and the `RequireAuth` subtree; `<CrossTabLogoutSync/>` removed from `AppLayout` (no dup). `useAuthSync.ts`/`client.ts` untouched by T1.
- **T2** `refreshPromise` coalescing (`client.ts:42-43,76-102`); concurrent waiters retry on success (init/signal preserved — L8), single `logout()` on failure (`logoutFired` guard). `LogoutHandlers.logout` widened to `() => void | Promise<void>`. Tests: concurrent-success, refreshPromise-clearing, retry-preserves-signal, failure-dedupe.
- **T3** `AUTH_STORAGE_KEY` constant single-source; `useAuthStore.ts:27-36` custom `authPersistStorage` removes the key on `user===null` (zustand 5 has no `removeOnNull` — documented equivalent); `useCrossTabLogout.ts:46-55` fires on both `newValue===null` and parsed `{state:{user:null}}`; dead `{type:'login'}` variant removed. `grep slyk-auth` → 2 hits only (constant def + 1 value assertion).
- **T4** `useAuthSync.ts` logout handler async + idempotent + best-effort `POST /auth/logout` before `clear()`; boot `fetchMe` gated through near-expiry (single session-confirmation path); `POLL_INTERVAL_MS` named. Test snapshot cached (L9).
- **T9** `TopNav.tsx:27-36` try/catch around `await logout()`; failure test + happy path both present.
- **T10** `queryClient.ts:9-13` documents 403-retry behavior; no logic change.
- **T11** `auth.logout-loop.test.tsx` uses REAL `apiFetch` + REAL `useAuthStore` (only `fetch`/`fetchMe`/`logout`/`jose`/`broadcastLogout` mocked); covers stale-401→logout, concurrent coalesce, refresh-success retry.

### Shared / Docs — no gaps

- **T8** ADR + followups exist with all required content; commit `da5e18a` touched only `.docs/` (525 insertions, 0 source changes).

### Manual gate — 1 gap

- **T12** `F07-session-lifecycle-auth-guards-tasks-verification.md` still records browser smokes as **pending** (lines 22, 99, 115) — correctly NOT flipped. The live two-tab smoke (sliding refresh, 401 dedup, cross-tab logout over BroadcastChannel **and** storage-event fallback, role-gate, `JWT_TTL=1m`) has not been executed.

---

## Recommendations

1. **T12 is the sole merge blocker remaining.** Run T8 steps 9–13 manually in a real browser (two tabs; test the storage-event fallback in a non-BroadcastChannel context such as private-mode Safari), then flip the three "pending" lines in `F07-session-lifecycle-auth-guards-tasks-verification.md` to passed with dates. Until then the two highest-risk paths (real cross-tab logout, live logout loop) are verified only by unit/integration tests, not by observation.
2. **No code gaps.** All 4 blockers (H1–H4) are fixed in code; H4 is additionally covered by the new integration test. The H3/H4 *browser* confirmation is what T12 provides.
3. **T3 note (not a gap):** the implemented cross-tab key-removal uses a custom `PersistStorage` rather than the literal `removeOnNull: true` from the task text, because zustand 5.0.14 has no such option. Functionally equivalent — `clear()` produces a real `storage` event with `newValue === null`. Acceptance intent met.

---

## Quick Reference: Task Status

```
T1  (H1)         ✅ Implemented
T2  (H2, L8)     ✅ Implemented
T3  (H3, L2, L4) ✅ Implemented  (PersistStorage equiv. of removeOnNull)
T4  (M2,M5,M6,L3,L9) ✅ Implemented
T5  (M3)         ✅ Implemented
T6  (M4b, L6)    ✅ Implemented
T7  (L5)         ✅ Implemented
T8  (M1,L1,L10,L11) ✅ Implemented (docs)
T9  (M4f)        ✅ Implemented
T10 (L7)         ✅ Implemented
T11 (H4)         ✅ Implemented
T12 (H3, H4)     ❌ Missing — manual browser gate (code ready, smoke not run)
```

---

## Feature Index

`.docs/features.md` line 45 already reads: `- [x] **F07** … DONE (T1-T7 ✅; backend live smoke passed 2026-06-22; frontend browser smokes pending)`. This remains accurate after remediation (all code blockers resolved; only the manual browser smoke outstanding). **No change** to the feature index — it was already marked done with the correct pending caveat, and the skill directs no change when a feature is already marked done.
