# Implementation Verification Report

**Source:** `.docs/features/F18-activity-log-capture/F18-activity-log-capture-tasks.md`
**Verified:** 2026-06-24
**Branch:** `feature/SLYK-F18-activity-log-capture`
**Total Tasks:** 7 (T1–T7)
**Implemented:** 7 (100%)
**Partial:** 0
**Missing:** 0

> All §9 sign-off decisions CONFIRMED before implementation. Independent audit performed against the plan's §6 per-task acceptance criteria + §7 final checklist (17/17 met). Automated gate green: BE typecheck/lint(0 errors)/format/build; **399 BE tests pass** (15 `activityLogService` + 59 `ticketService`, incl. 15 new activity assertions). Migration `0008` applied to dev DB.

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 7 | 100% |
| ⚠️ Partial | 0 | 0% |
| ❌ Missing | 0 | 0% |
| 🔄 Modified (cosmetic) | 0 blocking | — |

---

## Task-by-Task Results

### ✅ Implemented Tasks

| Task | Title | Key files |
|------|-------|-----------|
| T1 | Schema: ActivityLogs + enum + migration 0008 | `backend/src/db/schema.ts:190-220`, `backend/src/db/migrations/0008_familiar_proemial_gods.sql`, `meta/0008_snapshot.json`, `meta/_journal.json` |
| T2 | activityLogService (recordActivity + diffTicketChanges + formatLabelDiff) | `backend/src/services/activityLogService.ts`, `activityLogService.test.ts` (15 tests) |
| T3 | createTicket → CREATED in-txn | `backend/src/services/ticketService.ts:239` |
| T4 | moveTicket → actingUserId + STATUS_CHANGED in-txn + routes | `ticketService.ts:56-61,120-132`, `backend/src/routes/tickets.routes.ts:70,84` |
| T5 | updateTicket → wrap db.transaction + labelService tx refactor + diff → logs | `ticketService.ts:316-420`, `backend/src/services/labelService.ts:96-99,120-123` |
| T6 | Backend activity tests | `backend/src/services/ticketService.test.ts` (15 new activity tests; same-txn participation) |
| T7 | Integration verification | automated gate green (see below); live psql smoke = owner manual |

---

## Detailed Verification (per acceptance criterion)

### T1 — Schema + migration ✅
- `activityActionEnum` = 6 values incl. `LABELS_CHANGED` (`schema.ts:190-197`).
- `activityLogs` per PRD §8.5: `id` PK (`:204`), `ticket_id` FK **cascade** (`:205-207`), `user_id` FK **SET NULL** (`:208` — preserves audit history on user delete), `action_type` enum (`:209`), `old_value`/`new_value` text nullable (`:210-211`), `created_at` timestampestz defaultNow notNull (`:212-214`). NO `updatedAt`; NO jsonb metadata. ✅
- Index `activity_logs_ticket_id_idx` (`:218`). ✅
- Migration `0008_familiar_proemial_gods.sql`: **literal** enum values (no `$1` bug). ✅ Applied to dev DB — `\d "ActivityLogs"` confirms all columns + `enum_range(NULL::"ActivityAction")` = the 6 values; `confdeltype` `c` (ticket) / `n` (user). ✅

### T2 — activityLogService ✅
- `recordActivity(tx, {…})` mirrors `allocateTicketNumber(tx)`; takes `Tx` (`activityLogService.ts:39-50`). ✅
- PURE `diffTicketChanges(old, next, labelDiff)` → `ActivityLogEntry[]` (`:59-91`): emits PRIORITY/ASSIGNEE/CONTENT/LABELS_CHANGED; ONE `CONTENT_UPDATED` if title OR description; empty for no-op; never STATUS/CREATED; checklist NOT audited. ✅
- `formatLabelDiff` (`:94-103`). 15 table-driven tests pass. ✅
- **Note:** `Tx` is defined locally (`:6`) rather than imported (avoids circular import `activityLogService ↔ ticketService`); same derived type. Documented inline. Non-blocking.

### T3 — createTicket → CREATED ✅
- `recordActivity(tx, { ticketId: inserted!.id, actorId: input.creatorId, action: 'CREATED' })` inside `db.transaction` (`ticketService.ts:239`). ✅ Rollback-skips test: insert `[]` → `inserted!` throws before `recordActivity` → 0 rows. ✅

### T4 — moveTicket → STATUS_CHANGED ✅
- `MoveTicketInput.actingUserId` added (`ticketService.ts:56-61`). STATUS_CHANGED in-txn with `oldStatus !== statusColumn` guard (`:120-132`); same-column → zero. Both route sites thread `req.user!.id` (`tickets.routes.ts:70,84`). ✅

### T5 — updateTicket txn + labelService tx ✅
- Wrapped in `db.transaction` (`ticketService.ts:325-419`) — closes GAP #1. ✅
- OLD row loaded in-txn (`:327`); OLD labels hydrated via `hydrateLabelsForTickets([id], tx)` BEFORE `replaceTicketLabels` (`:340` < `:388`) — closes GAP #2. ✅
- NEW names via `tx.select({name}).from(labels).where(inArray)` (`:342-345`); `labelDiff` computed (`:347-352`). ✅
- `replaceTicketLabels({...}, tx)` inside txn (`:388`); `diffTicketChanges → recordActivity` per entry (`:393-416`); no-op → zero rows. ✅
- PRESERVES `{ old, new }` (`:418`); `TODO(F18)` removed (grep: 0 matches). ✅
- `labelService.ts` `hydrateLabelsForTickets`/`replaceTicketLabels` accept optional `tx` (default `db`) (`:96-99,120-123`); F14 callers unaffected. ✅
- **Note:** `labelService.ts:16` uses a different `Tx` alias (`NodePgDatabase`) than `ticketService`'s narrow PgTransaction — documented inline (narrow type can't default to `db`); functionally sound. Non-blocking; future cleanup could unify the two `Tx` aliases.

### T6 — Backend activity tests ✅
- CREATED + actor + rollback; STATUS_CHANGED (cross + same-column-zero + rollback); PRIORITY/ASSIGNEE/CONTENT_UPDATED; multi-change; no-op-zero; checklist-only-zero; LABELS_CHANGED (readable NAMES `added: Bug; removed: API`); label-set-identical-zero; **same-txn participation** (table-aware `tx.insert(activityLogs)` capture). All pass. ✅

### T7 — Integration gate ✅ (automated) / ⏳ (live smoke = owner)
- typecheck ✅ · lint 0 errors (1 pre-existing unrelated warning) · prettier ✅ · BE build ✅ · 399 tests ✅ · migration applied ✅ · **NO new HTTP route** (route diff = 2 `actingUserId` lines) · **NO frontend changes** (branch diff = 12 files, all `backend/` + `.docs/`). ✅
- ⏳ **Live psql smoke is the owner's manual step** (F18 is capture-only — no UI; verify by creating/editing tickets then `SELECT * FROM "ActivityLogs"`).

---

## Known caveats (acknowledged, non-blocking)

1. **moveTxn ordering / rollback assertion.** In `moveTicket`, the `STATUS_CHANGED` insert (`:120-132`) runs BEFORE the column re-read (`:135-139`). A mock therefore can't assert "zero activity rows on mid-txn throw" without reordering source. The test instead forces the re-read to reject and asserts the txn rejects → in real pg BOTH the ticket update AND the activity insert roll back (structural same-txn atomicity). **Not a defect** — pg rollback semantics guarantee atomicity; no source reorder needed.
2. **Two `Tx` type aliases** (`ticketService` narrow PgTransaction; `labelService`/`activityLogService` `NodePgDatabase`). Documented inline; avoids circular import + the narrow-type-can't-default-to-`db` issue. Functionally safe.
3. **Migration filename** is drizzle's auto-tag `0008_familiar_proemial_gods.sql`, not the plan's illustrative `0008_create_activity_logs.sql`. Content identical + correct.

---

## Recommendations

1. **Owner: run the live psql smoke** (T7 step 9): create a ticket → `CREATED` row; edit priority/title/labels/assignee → typed rows + readable label diff; no-op → zero; move across columns → `STATUS_CHANGED`; same-column → zero. Confirm `user_id` (acting user) + UTC `created_at` on every row.
2. **Optional cleanup (post-F18):** unify the two `Tx` aliases into one shared `db/types` module.
3. **F19 readiness:** the `activity_logs_ticket_id_idx` index + 6-value enum are in place for the activity-feed UI (F19).

---

## Quick Reference: Task Status

```
T1: ✅ Implemented (schema + enum + migration 0008, applied)
T2: ✅ Implemented (activityLogService + 15 tests)
T3: ✅ Implemented (createTicket → CREATED in-txn)
T4: ✅ Implemented (moveTicket → STATUS_CHANGED + actingUserId threaded)
T5: ✅ Implemented (updateTicket txn wrap + labelService tx + diff→logs)
T6: ✅ Implemented (15 activity test assertions + same-txn)
T7: ✅ Automated gate green / ⏳ live psql smoke = owner manual
```

**Feature index:** F18 left **unchecked** intentionally — the plan reserves the box for the owner after the live smoke; this verification confirms the automated implementation is complete (§7: 17/17).
