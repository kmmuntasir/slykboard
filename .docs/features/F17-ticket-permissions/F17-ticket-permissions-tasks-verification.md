# Implementation Verification Report

**Source:** `.docs/features/F17-ticket-permissions/F17-ticket-permissions-tasks.md`
**Verified:** 2026-06-24
**Branch:** `feature/SLYK-F17-admin-only-delete`
**Total Tasks:** 6 (T1–T6)
**Implemented:** 6 (100%)
**Partial:** 0
**Missing:** 0

> SOFT-delete design (owner override of hard-delete), §9 all CONFIRMED. Independent audit + defense-in-depth fix applied. Automated gate green: BE typecheck/lint(0 errors)/format/build; FE same; **BE 404 / FE 359 tests pass**. Migration `0009` applied to dev DB (`deleted_at timestamptz` nullable). All 6 ticket reads now filter `isNull(deletedAt)` (4 spine + 2 secondary defense-in-depth).

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 6 | 100% |
| ⚠️ Partial | 0 | 0% |
| ❌ Missing | 0 | 0% |

---

## Task-by-Task Results

| Task | Title | Key files |
|------|-------|-----------|
| T1 | Schema: `tickets.deletedAt` + migration 0009 | `backend/src/db/schema.ts:136`, `backend/src/db/migrations/0009_bored_nightcrawler.sql` |
| T2 | deleteTicket (soft) + read-filters + DELETE route (204) + tests | `ticketService.ts:422-433` (deleteTicket), `:83/283/327` + `boardService.ts:80` (filters), `tickets.routes.ts:91-101` (204 route), `tickets.routes.test.ts:725-782` |
| T3 | FE: apiFetch 204 guard + deleteTicket api + useDeleteTicket | `client.ts:121-124` (guard before `response.json`), `tickets.ts:53-55`, `useDeleteTicket.ts` |
| T4 | DeleteTicketConfirm + TicketDetailModal admin-only wiring | `DeleteTicketConfirm.tsx`, `TicketDetailModal.tsx:35,136,155` |
| T5 | FE tests: hook + confirm + modal gate + apiFetch 204 | `useDeleteTicket.test.ts` (4), `DeleteTicketConfirm.test.tsx` (5), `TicketDetailModal.test.tsx` (+3), `client.test.ts` (+1) |
| T6 | Integration verification | automated gate green; live browser smoke = owner manual |

---

## Detailed Verification

### T1 — Schema + migration ✅
- `deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })` — nullable, no default (`schema.ts:136`, after `updatedAt`).
- Migration `0009_bored_nightcrawler.sql`: `ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamp with time zone;` — literal (no `$1`). Applied to dev DB — `information_schema` confirms `deleted_at | YES | timestamp with time zone`. Existing rows `deleted_at IS NULL`.

### T2 — deleteTicket + filters + route + tests ✅
- `deleteTicket(ticketId): Promise<void>` — soft update: `db.update(tickets).set({ deletedAt: new Date() }).where(and(eq(id), isNull(deletedAt))).returning({ id })`; `NOT_FOUND` on empty returning (missing OR already-deleted → idempotent). Uses `db.update`, NOT `db.delete`.
- Read filters `isNull(tickets.deletedAt)` on **all 6 ticket reads**: `getTicket:283`, `updateTicket:327`, `moveTicket:83` (old-load), `moveTicket:138` (rebalance), `boardService.getBoard:80`, `labelService.replaceTicketLabels:124` (defense-in-depth). No soft-delete leak path remains.
- `DELETE /:ticketId` route: `authenticate → requireRole('ADMIN') → validateRequest(params)` → `res.status(204).end()` (no body). `TODO(F17)` replaced.
- Route tests: `deleteTicket: vi.fn()` in mock map; suite asserts **204** (empty body) / 401 / 403-member (service not called) / 404 / 400.

### T3 — FE data layer ✅
- `apiFetch` 204 guard at `client.ts:121-124`: `if (response.status === 204) return null as T` — placed AFTER `!response.ok` block, BEFORE `response.json()`. Load-bearing D10 change.
- `deleteTicket(ticketId): Promise<void>` api fn (`tickets.ts:53-55`).
- `useDeleteTicket` hook: invalidate-only (`removeQueries` detail + `invalidateQueries` boardKeys.all); `onError` recognizes `ApiClientError` `code === 'FORBIDDEN'`.

### T4 — UI ✅
- `DeleteTicketConfirm`: wraps `Modal`, `blockBackdropClose`, Cancel/Delete buttons, `isDeleting` disables.
- `TicketDetailModal`: "Delete ticket" rendered ONLY when `useRequireRole('ADMIN')` (member → absent); the `:121` F17 seam replaced; confirm → `useDeleteTicket().mutate({ ticketId, slug })` → `onClose`.

### T5 — FE tests ✅
- `useDeleteTicket.test.ts` (4): success invalidation/removal + 403 FORBIDDEN.
- `DeleteTicketConfirm.test.tsx` (5): render/cancel/delete/isDeleting.
- `TicketDetailModal.test.tsx` (+3): admin renders button + opens confirm; member does not.
- `client.test.ts` (+1): 204 → `null`, `response.json` NOT called.

### T6 + §7 — verification ✅
- typecheck BE+FE clean; lint 0 errors (1 pre-existing unrelated warning); format clean; build success.
- BE 404 / FE 359 tests pass. Migration applied. No new deps. Cascade FKs (`activityLogs`, `ticketLabels`) intact but inert under soft delete.

### §7 Final checklist (all met)
1. ✅ DELETE 403 member / **204** admin / 404 missing-or-deleted / 401 unauth / 400 bad uuid.
2. ✅ Server-side `requireRole('ADMIN')`; FE hide cosmetic.
3. ✅ `DeleteTicketConfirm` before delete.
4. ✅ Soft delete sets `deleted_at`; row + ActivityLogs + TicketLabels retained (archived).
5. ✅ Every read filters soft-deleted (4 spine + 2 secondary — all 6).
6. ✅ Re-delete → 404 (idempotent).
7. ✅ `ticket_number` never reused.
8. ✅ Delete button admin-only.
9. ✅ `apiFetch` 204 short-circuit before JSON parse.
10. ✅ ORM `db.update`, no `db.delete`, no string-concat SQL.
11. ✅ TimeEntries cascade deferred to F20.
12. ✅ Tests pass; coverage >80% on delete + 204 paths.

---

## Soft-delete leak analysis
Initial audit found 2 secondary reads without the filter (`moveTicket:138` rebalance re-read, `labelService:124` ticket-existence check) — both non-blocking (4 spine reads already filtered; no user-facing leak). **Both fixed in a follow-up commit** (`a5caa47` defense-in-depth) — all 6 ticket reads now filter `isNull(deletedAt)`. No soft-deleted ticket can surface to any read path.

---

## Recommendations
1. **Owner: live browser smoke.** Admin opens a ticket → "Delete ticket" → confirm → card vanishes + `SELECT id, deleted_at FROM "Tickets" WHERE id='<id>'` shows the row PRESENT with `deleted_at` set (NOT removed); `ActivityLogs`/`TicketLabels` counts UNCHANGED (archived); member sees no button; crafted member DELETE → 403; deleted ticket → board absent + detail/edit/move 404; re-delete → 404; new ticket gets NEXT number (not reused).
2. **features.md deltas-table:** add the `tickets.deletedAt` row (NEW delta; §8 notes it).
3. **F20 forward contract:** `TimeEntries.ticketId` FK MUST be `ON DELETE CASCADE`; F20 owns the running-timer-on-a-soft-deleted-ticket nuance.

---

## Quick Reference: Task Status

```
T1: ✅ Implemented (deletedAt + migration 0009, applied)
T2: ✅ Implemented (soft-delete service + 6 read-filters + 204 route + 5-case test suite)
T3: ✅ Implemented (apiFetch 204 guard + api fn + invalidate-only hook)
T4: ✅ Implemented (DeleteTicketConfirm + admin-only modal wiring)
T5: ✅ Implemented (4 FE test files: hook/confirm/modal-gate/204)
T6: ✅ Automated gate green / ⏳ live browser smoke = owner manual
```

**Feature index:** F17 left **unchecked** intentionally — the owner marks it after the live smoke; this verification confirms the automated implementation is complete (§7: 12/12) + defense-in-depth applied.
