# Implementation Verification Report

**Source:** `docs/deliverables/SLYK-13-plan-tasks.md`
**Verified:** 2026-06-30
**Total Tasks:** 15
**Implemented:** 6 (40%)
**Partial:** 0
**Missing:** 0
**Modified:** 9 (60%)

> **Note on the high "Modified" count:** Every task is functionally complete — all
> files exist, no stubs/TODOs/empty handlers, and all co-located tests are present
> and assert the acceptance criteria. The "Modified" tasks diverge from the *letter*
> of the spec (e.g. error-message wording, positional vs object-form service args,
> `Date` vs ISO-string DTO types, an empty-string author-id sentinel, missing
> `aria-label`/`title` attributes) **without breaking observable behavior**. None
> are blocking. Items flagged for sign-off are detailed in the gap analysis.

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 6 | 6/15 = 40% |
| ⚠️ Partial | 0 | 0% |
| ❌ Missing | 0 | 0% |
| 🔄 Modified | 9 | 9/15 = 60% |

---

## Task-by-Task Results

### ✅ Implemented Tasks (exact spec match, fully complete)

| Task ID | Title | Files |
|---------|-------|-------|
| T1 | Backend schema: `comments` table + extend `activityActionEnum` | `backend/src/db/schema.ts` |
| T2 | Backend activity services: extend unions + enrichment | `backend/src/services/activityLogService.ts`, `backend/src/services/activityService.ts` |
| T4 | Frontend activity rendering: extend `ActivityAction` + `describeActivity` + test | `frontend/src/types/activity.ts`, `frontend/src/utils/describeActivity.ts`, `frontend/src/utils/describeActivity.test.ts` |
| T5 | Backend Drizzle migration: generate `0001_*.sql` | `backend/src/db/migrations/0001_nebulous_invaders.sql`, `meta/_journal.json`, `meta/0001_snapshot.json` |
| T11 | Frontend `CommentForm.tsx` + test | `frontend/src/components/CommentForm.tsx`, `CommentForm.test.tsx` |
| T15 | Backend tests: `commentService.test.ts` + `comments.routes.test.ts` | `backend/src/services/commentService.test.ts`, `backend/src/routes/comments.routes.test.ts` |

### ⚠️ Partial Tasks

| Task ID | Title | Missing | Notes |
|--------|-------|---------|-------|
| — | — | — | No partial tasks. |

### ❌ Missing Tasks

| Task ID | Title | Missing Files/Features |
|--------|-------|----------------------|
| — | — | — |

### 🔄 Modified Tasks (functional but diverges from spec letter)

| Task ID | Title | Files | Changes |
|--------|-------|-------|---------|
| T3 | Backend Zod schemas (`comments.schema.ts`) | `backend/src/routes/comments.schema.ts` | Zod error messages reworded: `'Comment body cannot be empty'` / `'Comment body cannot exceed 5000 characters'` instead of `'Comment cannot be empty'` / `'Comment is too long'`. Bounds (`min(1)`/`max(5000)`) and shape unchanged. |
| T6 | Backend `commentService.ts` | `backend/src/services/commentService.ts` | (a) Positional args instead of object-form (`createComment(ticketId, authorId, bodyRaw)` etc.). (b) `CommentDto.createdAt`/`updatedAt` are `Date`, not ISO `string`. (c) `CommentAuthorDto.id` is `string` (sentinel `''` for deleted author), not `string \| null`. (d) `deleteComment` returns `{ id }`, not `void`. |
| T7 | Backend `resolveCommentProject` middleware | `backend/src/middleware/resolveProject.ts:190-227` | Missing-ticket branch throws non-revealing `FORBIDDEN PROJECT_ACCESS_DENIED` instead of `NOT_FOUND 'Ticket not found'` (defensive path the FK should prevent). |
| T8 | Backend routes + app wiring | `backend/src/routes/tickets.routes.ts`, `backend/src/routes/comments.routes.ts`, `backend/src/index.ts` | Routes call the positional service signatures (consistent with T6). All route shapes, status codes (200/201/204/400/403/404), middleware chains, and the `/api/comments` mount match spec. |
| T9 | Frontend API client + types + query key | `frontend/src/types/comment.ts`, `frontend/src/api/comments.ts`, `frontend/src/api/queryKeys.ts` | (a) `CommentAuthorDto.id` typed `string`, not `string \| null` (mirrors BE sentinel). (b) `createTicketComment`/`updateTicketComment` take `body: string` and wrap `{ body }` internally, not `body: { body: string }`. (c) `queryKeys.comments(id)` param named `id`, not `ticketId`. |
| T10 | Frontend hooks: query + mutations | `frontend/src/hooks/useTicketComments.ts`, `frontend/src/hooks/useCommentMutations.ts` | `meta.revertMessage` strings reworded: `'Failed to post comment'` / `'Failed to update comment'` / `'Failed to delete comment'` instead of `'Comment post failed'` / `'Comment edit failed'` / `'Comment delete failed'`. Invalidation of both `comments` and `activity` keys verified correct. |
| T12 | Frontend `CommentItem.tsx` + test | `frontend/src/components/CommentItem.tsx`, `CommentItem.test.tsx` | (a) Inline `<img>`/`<div>` avatar fallback instead of shared `<Avatar>` primitive. (b) `isPlatformAdmin` read from `useAuthStore` instead of `useRequirePlatformAdmin()`. (c) `(edited)` marker lacks `title={formatDate(comment.updatedAt)}` tooltip. Authz matrix (`canEdit` author-only; `canDelete` author-or-admin) correct. |
| T13 | Frontend `CommentsSection.tsx` + test | `frontend/src/components/CommentsSection.tsx`, `CommentsSection.test.tsx` | `<section>` uses Tailwind classes but **lacks** `aria-label="Comments"` (test finds it by child text instead). Implements a `ConfirmDialog` for deletes (exceeds spec). |
| T14 | Wire `CommentsSection` into `TicketDetailModal.tsx` + update test | `frontend/src/components/TicketDetailModal.tsx`, `TicketDetailModal.test.tsx` | Wired with `disabled={!!ticket.deletedAt}`; "coming soon" assertion replaced with `findByText('No comments yet.')`. No modal-level `disabled` assertion added (deferred to T13's `disabled` test, which the task permitted). |

---

## Detailed Gap Analysis

### Backend Gaps

**No blocking backend gaps.** All backend files exist, are complete, and are wired correctly.

Verified correct:
- `activityActionEnum` extended with all 8 values in order; `comments` table matches spec exactly; `CommentRow` exported (T1).
- Activity unions extended; `enrichActivityRows` cases return `base` (null from/to/message) (T2).
- `comments.schema.ts` exports all 3 schemas + 3 types; only import is `{ z }` (T3).
- Migration `0001_nebulous_invaders.sql` contains both `ALTER TYPE ADD VALUE`, `CREATE TABLE "Comments"` with all 6 columns + FKs + index; `_journal.json` appended; `0001_snapshot.json` fresh; `0000_*` untouched (T5).
- `commentService.ts` — all 5 functions behaviorally correct: `listComments` single-join ASC + NOT_FOUND on missing; `getComment` null-safe; `createComment` blocks soft-deleted + trims/rejects-empty + no activity row; `updateComment` author-only + `COMMENT_EDITED` inside txn with null values; `deleteComment` author-or-admin + `COMMENT_DELETED` inside txn with null values (T6).
- `resolveCommentProject` reads `req.params.commentId`, loads comment → ticket → `resolveAndAuthorize`, sets `req.project`/`req.projectMember` (T7).
- Routes mounted; status codes correct; membership enforced via `resolveTicketProject`/`resolveCommentProject` (T8).
- Tests cover full authz matrices; every `recordActivity` assertion verifies null `oldValue`/`newValue` (no content leak) (T15).

Backend deviations (spec-letter only — flag for sign-off):
- **T6 DTO type contract:** `createdAt`/`updatedAt` as `Date`, `CommentAuthorDto.id` as `string` (`''` sentinel). The locked v1 default #7 specified ISO strings + `id: string | null` all-null author object. Internally FE/BE consistent; diverges from literal spec.
- **T6/T8 service signatures:** positional args instead of object-form. Internally consistent.
- **T7 missing-ticket branch:** non-revealing `FORBIDDEN` instead of `NOT_FOUND`. Defensive; the FK should prevent this path.
- **T3 Zod error wording.** Cosmetic; tests assert `VALIDATION_FAILED` code, not message text.

### Frontend Gaps

**No blocking frontend gaps.** All FE files exist, complete, with co-located tests asserting acceptance criteria.

Verified correct:
- `ActivityAction` extended; `describeActivity` returns exact clauses; 2 new test rows (T4).
- All four `api/comments.ts` functions via `apiFetch<T>`; `queryKeys.comments` registered (T9).
- `useTicketComments` (with harmless `enabled` guard) + three mutations each invalidating **both** `comments` and `activity` keys + `meta.revertMessage` set (T10).
- `CommentForm` — `maxLength={5000}`, submit disabled on empty/whitespace/pending, trims on submit, edit-mode Cancel restores + calls `onCancel`; all 6 test bullets covered (T11).
- `CommentItem` — author + avatar, "(edited)" marker, relative time + `title`, edit/delete gated; full 4-row permission matrix in tests (T12).
- `CommentsSection` — owns query + 3 mutations + edit state, empty/loading/error states, `disabled` hides post box, `ConfirmDialog` for deletes; all 6 test bullets covered (T13).
- `TicketDetailModal` — placeholder replaced with `<CommentsSection disabled={!!ticket.deletedAt} />`; import added; "coming soon" assertion replaced; **zero** remaining placeholder matches (T14).

Frontend deviations (spec-letter only — flag for sign-off):
- **T9 `CommentAuthorDto.id` typed `string`** (mirrors BE sentinel) instead of `string | null`.
- **T9 `createTicketComment`/`updateTicketComment` signature** `body: string` vs `body: { body: string }`. Hook layer is consistent.
- **T10 `revertMessage` wording** differs (semantically equivalent toast strings).
- **T12 avatar** rendered inline rather than via shared `<Avatar>` primitive.
- **T12 `isPlatformAdmin`** from `useAuthStore` rather than `useRequirePlatformAdmin()`.
- **T12 `(edited)` marker** lacks `title={formatDate(comment.updatedAt)}` tooltip.
- **T13 `<section>`** lacks `aria-label="Comments"`.

### Shared Gaps

**Cross-cutting v1-default compliance:**

| Locked default | Status |
|---|---|
| Max length 5000 (BE + FE) | ✅ Honored both sides |
| Server-side `body.trim()` before insert/update | ✅ Honored (rejects empty post-trim) |
| Soft-deleted ticket POST → `NOT_FOUND 'Ticket not found'` | ✅ Honored via `ticketIsLive` |
| Naming `authorId`/`author_id` | ✅ Consistent |
| `edited` derived `updatedAt > createdAt` | ✅ Honored |
| 2-tier architecture (controllers/repositories `.gitkeep`-only) | ✅ Honored |
| `commentsRouter` mounted at `/api/comments` | ✅ Honored |
| `recordActivity` null values for `COMMENT_EDITED`/`COMMENT_DELETED` | ✅ Honored, inside same txn |
| `apiFetch<T>` usage, no manual auth/unwrap | ✅ Honored |
| `isProjectAdmin` via `useCurrentProjectMembership(slug)` | ✅ Available + consumed |
| No leftover SLYK-13 placeholder | ✅ Confirmed |
| **`CommentDto.author` all-null object (`id: null`)** (default #7) | ⚠️ **Deviation** — uses `id: ''` sentinel instead. FE/BE consistent but diverges from literal spec. |

**Minor redundant `updatedAt`:** schema's `$onUpdate(() => new Date())` plus explicit `updatedAt: new Date()` in `updateComment`. Harmless (same value wins).

---

## Recommendations

1. **Sign-off item (most important):** The `CommentDto.author` shape uses an empty-string `id: ''` sentinel for deleted authors instead of the locked default #7's all-null object (`id: string | null`). The FE and BE agree, so the wire contract is internally consistent, but it diverges from the documented public DTO. **Confirm this interpretation is acceptable** or align it to the literal spec (change `CommentAuthorDto.id` to `string | null` on both tiers and emit `id: null`).
2. **Minor type-contract drift (T6):** `createdAt`/`updatedAt` are `Date` rather than ISO strings. Confirm the API serializes them to ISO on the wire (Express JSON serialization of `Date` does this by default) — no action needed if so; otherwise document.
3. **Accessibility nit (T12, T13):** Add `title={formatDate(comment.updatedAt)}` to the `(edited)` marker and `aria-label="Comments"` to the `CommentsSection` `<section>` for spec parity and screen-reader friendliness.
4. **Cosmetic (T3, T10):** Either align Zod error strings and `revertMessage` strings to spec wording, or amend the spec to match the (arguably better) implemented wording. No functional impact.
5. **Refactor opportunity (T12):** Swap the inline avatar for the shared `<Avatar>` primitive for consistency with the rest of the UI kit. Optional.
6. **No missing or stubbed work** — no implementation tasks are outstanding. Only the above review/sign-off items.

---

## Quick Reference: Task Status

```
T1:  ✅ Implemented
T2:  ✅ Implemented
T3:  🔄 Modified (Zod error-message wording)
T4:  ✅ Implemented
T5:  ✅ Implemented
T6:  🔄 Modified (positional args; Date DTO types; author-id '' sentinel; deleteComment returns {id})
T7:  🔄 Modified (missing-ticket → non-revealing FORBIDDEN, not NOT_FOUND)
T8:  🔄 Modified (uses positional service signatures; route shape/codes correct)
T9:  🔄 Modified (author.id typed string; API body signature; queryKeys param name)
T10: 🔄 Modified (revertMessage wording differs)
T11: ✅ Implemented
T12: 🔄 Modified (inline avatar; isPlatformAdmin from auth store; missing (edited) title)
T13: 🔄 Modified (section lacks aria-label="Comments")
T14: 🔄 Modified (no modal-level disabled assertion; deferred to T13)
T15: ✅ Implemented
```
