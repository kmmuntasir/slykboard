# Implementation Verification Report

**Source:** `docs/deliverables/SLYK-05-plan-tasks.md`
**Verified:** 2026-06-30
**Total Tasks:** 10
**Implemented:** 10 (100%)
**Partial:** 0
**Missing:** 0

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 10 | 100% |
| ⚠️ Partial | 0 | 0% |
| ❌ Missing | 0 | 0% |
| 🔄 Modified | 0 | 0% |

All ten SLYK-05 tasks are fully and correctly implemented across all three batches. Every acceptance criterion is satisfied with exact-line evidence. No stubs, TODOs, `it.skip`, or pass-through placeholder logic were found in any file. The implementation is **merge-ready**.

---

## Task-by-Task Results

### ✅ Implemented Tasks

| Task ID | Title | Files | Key Evidence |
|---------|-------|-------|--------------|
| Task-1 | `setUserBlocked` self-guard + last-PA-on-block + pre-fetch + no-op | `backend/src/services/userService.ts:172-215` | Sig `{targetUserId,blocked,actingUserId}`; self-FORBIDDEN `:181-184` (before pre-fetch `:185`); no-op `:195`; last-PA CONFLICT `:199-208`; bump only on write `:215` |
| Task-2 | `removeMember` + `setMemberRole` self-guards | `backend/src/services/membershipService.ts:149-167,190-209` | Both self-FORBIDDEN guards run before DB write (`:154-156`, `:196-198`); `promoteToProjectAdmin` untouched |
| Task-3 | Frontend verify-only audit (read-only) | `MemberTable.tsx`, `ProjectMembersPage.tsx`, `queryClient.ts`, `routes/index.tsx` | All cited facts confirmed with no drift; no files modified |
| Task-4 | Thread `actingUserId` into `users.routes.ts` | `backend/src/routes/users.routes.ts:54-57` | `actingUserId: req.user!.id` wired |
| Task-5 | Thread `req.user.id` into `projectMembers.routes.ts` | `backend/src/routes/projectMembers.routes.ts:164,179` | `req.user!.id` passed as 4th/3rd arg |
| Task-6 | Verify last-PA demote guard intact (read-only) | `backend/src/services/userService.ts:104-137`, `utils/envelope.ts:21`, `utils/httpStatus.ts:11` | CONFLICT `:127` verbatim; →409 confirmed; no code modified |
| Task-7 | `userService.test.ts` unit cases | `backend/src/services/userService.test.ts:288-425` | 6 net-new cases incl. self-FORBIDDEN, re-block-self-before-noop, last-PA CONFLICT, defensive count→[] |
| Task-8 | `membershipService.test.ts` unit cases | `backend/src/services/membershipService.test.ts:267-378` | Self-FORBIDDEN for both methods (both role values); regression cases |
| Task-9 | `users.routes.test.ts` supertest | `backend/src/routes/users.routes.test.ts:189-375` | Self-block→403, last-PA→409, self-unblock→200+`actingUserId`, non-PA 403 regression |
| Task-10 | `projectMembers.routes.test.ts` supertest | `backend/src/routes/projectMembers.routes.test.ts:44-56,271-395` | Mock factory extended; DELETE+PATCH suites incl. self→403, other→200+actingUserId, NOT_FOUND, 400-validation |

### ⚠️ Partial Tasks

None.

### ❌ Missing Tasks

None.

### 🔄 Modified Tasks

None — one intelligent, non-defect deviation noted below (Task-10).

---

## Detailed Gap Analysis

### Backend Gaps

**None blocking.** All service guards, route wiring, and tests are present and correct.

**Guard ordering (Task-1) — verified correct:** self-FORBIDDEN (`:181`) precedes pre-fetch (`:185`) precedes no-op short-circuit (`:195`) precedes last-PA guard (`:199`). Re-blocking an already-blocked self-row still rejects FORBIDDEN (the self-check throws before the no-op is reachable). This was the trickiest acceptance criterion and it passes.

**Intelligent deviation (Task-10, not a defect):** the implementer widened the acting user id to a real UUID (`ACTING_USER_ID = '911c0405-...'` at `:120`) instead of the plan's literal `'u1'`, because `memberUserIdParamSchema` validates `:userId` with `z.uuid()` (`projectMembers.schema.ts:74-77`). A non-UUID `sub` would have 400'd at the edge before reaching the handler. This is the correct call — self-target URLs now pass validation and reach the handler, so the `actingUserId` threading is actually exercised.

**Minor optional polish (non-blocking, Task-10):** the plan's Task-10 table listed a DELETE-with-bad-`:userId` → 400 validation case. It is not present as a dedicated case (every DELETE test uses valid UUIDs). The 400-validation case IS present in the PATCH suite (`:383-395`, bad role → 400 `VALIDATION_FAILED`). The schema enforces `z.uuid()` on `:userId`, so DELETE validation is implicitly covered. Optional: add one DELETE-with-non-UUID-`:userId` → 400 case for strict plan parity.

### Frontend Gaps

**None.** Task-3 audit confirmed all cited facts with **zero drift**:

- `MemberTable.tsx:72/75/110/142` — self-lock idiom present and wired to `currentUserId`.
- `ProjectMembersPage.tsx:53/54-55/60/61/79/174` — `currentUserId` derived and passed; mutations wired; removal confirm-gated; `canManage` threaded.
- `queryClient.ts:9-42` — global mutation error funnel surfaces `FORBIDDEN`/`CONFLICT` with no new string-mapping. (Citation `:20-39` is loose — funnel actually spans `:9-42` — but correctness is unaffected.)
- `routes/index.tsx:111-114` — `/settings` → `ComingSoonPage`; `useSetUserBlocked` (`hooks/useUserManagement.ts:16`) has **zero consumers**. F3 deferred status confirmed.

**Divergence flagged (as required by Task-3):** the UI role-lock (`selfLockedAdmin = isSelf && role === 'PROJECT_ADMIN'`, `:75`) is **narrower** than the Task-2 API guard (rejects all self role-changes). Consequence: a self-MEMBER changing their own role is client-enabled but server-rejected; the 403 surfaces via the toast funnel. Acceptable per the plan's "API is authoritative" stance. **Recommended follow-up (not a defect):** broaden the UI lock to `isSelf` for symmetric client/server locking.

### Shared Gaps

**None.** Signature consistency confirmed end-to-end: routes pass `actingUserId` (`req.user!.id`); tests assert `toHaveBeenCalledWith` carrying it; services accept and enforce it. Error vocabulary consistent throughout (`FORBIDDEN`→403, `CONFLICT`→409, `NOT_FOUND`→404, `VALIDATION_FAILED`→400, all via `AppError` + centralized error middleware).

**Bonus coverage (not required by plan):** `permissionMatrix.routes.test.ts:42-43,61-62,107,273,289-290` also mocks the new signatures — extra regression safety.

---

## Recommendations

1. **No priority fixes required** — all 10 tasks pass their acceptance criteria. The implementation is merge-ready.
2. **Optional polish (Task-10):** add a dedicated DELETE-with-non-UUID-`:userId` → 400 case for strict plan-table parity. Non-blocking; DELETE validation is implicitly covered by `z.uuid()` enforcement.
3. **Recommended follow-up ticket:** broaden the `MemberTable.tsx` UI role-lock from `selfLockedAdmin` (self PROJECT_ADMIN only) to `isSelf` (all self role-changes) so client and server locking are symmetric. Flagged by Task-3; not in scope for SLYK-05.
4. **Recommended follow-up ticket (out of scope, from plan Open Questions):** wrap the last-PA `count`+`update` in a locking transaction to close the TOCTOU race (cf. `projectSequences` FOR UPDATE at `schema.ts:202-204`).
5. **Final integration check:** re-run the ticket's manual reproduce steps end-to-end against a running stack (the 5-step gate in the tasks file) before closing the ticket.

---

## Quick Reference: Task Status

```
Task-1:  ✅ Implemented  (userService.setUserBlocked: self-guard + last-PA-on-block + pre-fetch + no-op, correct ordering)
Task-2:  ✅ Implemented  (membershipService removeMember + setMemberRole self-guards, before DB write)
Task-3:  ✅ Implemented  (Frontend read-only audit: all facts confirmed, no drift, no files modified)
Task-4:  ✅ Implemented  (users.routes.ts: actingUserId wired at :57)
Task-5:  ✅ Implemented  (projectMembers.routes.ts: req.user.id wired at :164, :179)
Task-6:  ✅ Implemented  (setPlatformAdmin demote guard intact at :127, CONFLICT→409 confirmed, read-only)
Task-7:  ✅ Implemented  (userService.test.ts: 6 net-new cases, verbatim messages, correct ordering assertions)
Task-8:  ✅ Implemented  (membershipService.test.ts: self-FORBIDDEN for both methods + regression cases)
Task-9:  ✅ Implemented  (users.routes.test.ts: self-block→403, last-PA→409, self-unblock→200, non-PA regression)
Task-10: ✅ Implemented  (projectMembers.routes.test.ts: mock factory + DELETE/PATCH suites; intelligent UUID deviation)
```
