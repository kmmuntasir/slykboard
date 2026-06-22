# Implementation Verification Report

**Source:** `.docs/features/F11-drag-drop-order-persistence/F11-drag-drop-order-persistence-tasks.md`
**Verified:** 2026-06-23
**Branch:** `feature/SLYK-F11-drag-drop-order-persistence` (5 commits, all `SLYK-F11:` prefixed)
**Total Tasks:** 6 (T1–T6)
**Implemented:** 5 (T1–T5)
**Partial:** 1 (T6 — automated gate ✅; live browser smoke deferred by design)
**Missing:** 0

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 5 | 83% |
| ⚠️ Partial | 1 | 17% |
| ❌ Missing | 0 | 0% |
| 🔄 Modified | 0 | 0% |

> **Net status:** All code/configuration tasks (T1–T5) are fully implemented and verified.
> T6's only gap is the **manual browser smoke** (step 6 of the task plan), which is not
> automatable in this gate and is recorded as deferred below. Every **automated** acceptance
> bullet passes; deterministic behavior is unit-tested (375 tests green across BE+FE).

**Automated gate (raw tooling — NOT via `rtk vitest`, which mis-reports):**

> ⚠️ `rtk vitest` was observed to print a compressed "PASS (N) FAIL (0)" / "[RTK:PASSTHROUGH]
> Output truncated" summary that **hides** load failures and real counts (same caveat T3/T4
> coders hit). All test runs below were executed raw via `rtk proxy npx vitest run` (no
> filtering) with full output parsed from log files. `rtk proxy npx tsc --noEmit` likewise.

- Backend `npx vitest run` → **25 test files / 225 tests passed**, exit `0` ✅
- Frontend `npx vitest run` → **32 test files / 150 tests passed**, exit `0` ✅
- `npx tsc --noEmit` (backend) → **0 errors**, exit `0` (0-byte output) ✅
- `npx tsc --noEmit` (frontend) → **0 errors**, exit `0` (0-byte output) ✅ (`@hello-pangea/dnd` types resolve under React 19)
- `npm run build` (frontend, `tsc -b && vite build`) → **198 modules transformed, built in 2.43s**, exit `0` ✅
- `lint` / `format:check` → **N/A** (no such scripts in `frontend/package.json` — project-wide tooling gap, same as F10; NOT an F11 regression)

---

## Task-by-Task Results

### ✅ Implemented Tasks

| Task ID | Title | Commit | Key files |
|---------|-------|--------|-----------|
| T1 | Backend `PATCH /api/tickets/:ticketId` move endpoint with rebalance | `81ad26b` | `backend/src/routes/tickets.routes.ts`, `backend/src/routes/tickets.schema.ts`, `backend/src/services/ticketService.ts`, `backend/src/routes/tickets.routes.test.ts`, `backend/src/services/ticketService.test.ts` |
| T2 | `@hello-pangea/dnd` dep + pure `boardReorder` util | `2b3a30c` | `frontend/src/utils/boardReorder.ts`, `frontend/src/utils/boardReorder.test.ts` |
| T3 | Ticket-move API client + optimistic `useMoveTicket` hook | `5acda79` | `frontend/src/api/tickets.ts`, `frontend/src/hooks/useMoveTicket.ts`, `frontend/src/hooks/useMoveTicket.test.ts`, `frontend/src/api/tickets.test.ts` |
| T4 | `TicketCard` Draggable + unsorted drop-disable contract | `9a412ed` | `frontend/src/components/TicketCard.tsx`, `frontend/src/components/BoardColumn.tsx`, `frontend/src/components/UnsortedBucket.tsx` |
| T5 | `DragDropContext` + `Droppable` columns + `onDragEnd` wiring | `ec3f772` | `frontend/src/pages/BoardPage.tsx` |

### ⚠️ Partial Tasks

| Task ID | Title | Missing | Notes |
|--------|-------|---------|-------|
| T6 | Integration verification & sign-off | Manual browser smoke (task doc T6 step 6: drag-within-column, cross-column, first/last position, concurrent LWW, simulated-500 rollback, drag-pause poll, keyboard a11y, unsorted rescue/reject, empty-column-remains) | Manual-only by design; not automatable in this headless gate. All **automated** checks pass (tests + tsc + build); deterministic behavior unit-tested. Integration-record fields in §7 left blank pending live smoke. |

### ❌ Missing Tasks

_(none)_

### 🔄 Modified Tasks

_(none)_

---

## Detailed Acceptance Verification (§7 Final F11 Checklist)

### Backend — atomic move + validation contract

| Acceptance bullet | Status | Evidence |
|---|---|---|
| `PATCH /api/tickets/:ticketId` writes `status_column` + `position` atomically in one Drizzle txn | ✅ | `ticketService.ts:75` `db.transaction(async (tx) => ...)` writes both fields + conditional rebalance inside the callback |
| PATCH atomicity asserted (forced mid-txn failure rolls back both fields) | ✅ | `ticketService.test.ts:215-227` ("atomicity: mid-txn failure propagates") — `loadColumn` rejects mid-txn, asserts error propagates + `txnInvoked` once → callback throw = rollback. **Note:** the route test (`tickets.routes.test.ts`) mocks `moveTicket` (`:30`), so atomicity is correctly asserted at the **service** layer where the transaction lives; the route test owns the HTTP contract instead. |
| Rebalance only when `next.position - prev.position < POSITION_EPSILON`; `computeDestinationPosition` + `needsRebalance` unit-tested | ✅ | `needsRebalance` (`ticketService.ts:21-29`, `:27` EPSILON guard); `ticketService.test.ts:183-199` rebalance test (`updateSets.length === 3`, re-numbered `index*GAP`) + `:201-213` no-rebalance test; FE `boardReorder.test.ts` (16 tests) |
| Unknown ticket → 404 | ✅ | `tickets.routes.test.ts:138-149` (NOT_FOUND); `ticketService.test.ts:104-115` |
| bad `statusColumn` → 400 | ✅ | `tickets.routes.test.ts:151-167` (VALIDATION_FAILED); service `:130-144` |
| `UNSORTED_BUCKET_ID` → 400 | ✅ | `tickets.routes.test.ts:169-184`; service `:146-159` |
| non-finite position → 400 | ✅ | `tickets.routes.test.ts:186-198` (raw `1e400` JSON body, `moveTicket` not called) |
| missing position → 400 | ✅ | `tickets.routes.test.ts:200-211` |
| no Bearer → 401 | ✅ | `tickets.routes.test.ts:226-234` (UNAUTHENTICATED) |
| `POSITION_GAP` / `POSITION_EPSILON` exported (no magic numbers) | ✅ | `ticketService.ts:10-11` (`GAP=65536`, `EPSILON=1e-6`); FE mirror `boardReorder.ts:9-10`; asserted `ticketService.test.ts:229-233` |
| `TODO(F17)` per-column-permission seam present | ✅ | `tickets.routes.ts:10` ("TODO(F17): add requireRole / per-column permission middleware + toast-on-deny") |

### Frontend — optimistic mutation + drag wiring

| Acceptance bullet | Status | Evidence |
|---|---|---|
| `useMoveTicket` `onMutate` (optimistic) / `onError` (rollback) / `onSettled` (invalidate) | ✅ | `useMoveTicket.ts:21` (cancel + snapshot + `applyMoveToBoard` optimistic write), `:33` (rollback `ctx.previousBoard`), `:38` (`invalidateQueries(boardKeys.all)`) |
| Rollback asserted | ✅ | `useMoveTicket.test.ts:142-181` ("rolls back the board cache to the previous snapshot on error") — `onError` restored cache **exactly** to seed snapshot; `onSettled` invalidate still fires |
| Exactly ONE `DragDropContext` | ✅ | `BoardPage.tsx:78` (single context, closes `:98`); no other prod occurrence |
| `Droppable type="CARD"`; no `type="COLUMN"` | ✅ | `BoardColumn.tsx:24` `type="CARD" direction="vertical" isDropDisabled={isUnsorted}`; zero `type="COLUMN"` anywhere |
| Placeholder rendered | ✅ | `BoardColumn.tsx:51` `{provided.placeholder}` |
| `onDragStart` → `setDragInProgress(true)` | ✅ | `BoardPage.tsx:33` (`handleDragStart`) |
| `onDragEnd` → `setDragInProgress(false)` **AFTER** mutate | ✅ | `BoardPage.tsx:54-57` — `computeDestinationPosition` → `mutate(...)` (`:55`) then `setDragInProgress(false)` (`:57`, comment "release the poll-pause AFTER kicking off the optimistic persist") |
| `useBoard.test.tsx:193-202` F10 drag-seam contract green | ✅ | `useBoard.test.tsx` 8 tests pass incl. "defers poll when dragInProgress is true" + "card appears in new column within one poll (acceptance #2)" (line ref is the F10 anchor; content green) |
| UNSORTED bucket `isDropDisabled` **IN** | ✅ | `BoardColumn.tsx:24` `isDropDisabled={isUnsorted}`; `UnsortedBucket.tsx:20-26` forwards `isUnsorted` |
| Cards draggable **OUT** | ✅ | `TicketCard.tsx:15` `<Draggable draggableId={ticket.id} index={index}>` — rendered inside the unsorted column too, so orphans can be rescued |
| `computeDestinationPosition` / `applyMoveToBoard` / `needsRebalance` exported + immutability | ✅ | `boardReorder.ts:23,54,98`; `boardReorder.test.ts:166-180` ("does not mutate the input board") — `board` equals snapshot (unchanged) + `result !== board` (new ref) |

### Cross-cutting

| Acceptance bullet | Status | Evidence |
|---|---|---|
| Schema delta | ✅ NONE | `Tickets.position` PRE-SATISFIED by F09 (`schema.ts:88`, migration `0004`); F11 adds no migration |
| Concurrent reorders (LWW, D7) | ✅ code | `onError` rollback + `onSettled` invalidate + next 30s poll reconcile; manual smoke deferred |
| Per-column permission denial | ✅ seam | `TODO(F17)` at `tickets.routes.ts:10`; deferred to F17/F25 (Owner Q2) |
| a11y keyboard reorder + live region | ✅ free | `@hello-pangea/dnd` ships keyboard + screen-reader support; manual smoke deferred |

---

## Exit-code summary

| Tool | Command (raw) | Exit | Result |
|---|---|---|---|
| Backend tests | `rtk proxy npx vitest run` (in `backend/`) | `0` | 25 files / 225 tests passed |
| Frontend tests | `rtk proxy npx vitest run` (in `frontend/`) | `0` | 32 files / 150 tests passed |
| Backend typecheck | `rtk proxy npx tsc --noEmit` (in `backend/`) | `0` | 0 errors |
| Frontend typecheck | `rtk proxy npx tsc --noEmit` (in `frontend/`) | `0` | 0 errors |
| Frontend build | `rtk proxy npm run build` (in `frontend/`) | `0` | 198 modules, 2.43s |
| Lint / format | `npm run lint` / `format:check` | N/A | no scripts in `frontend/package.json` (project tooling gap) |

> **Stderr noise (not failures):** FE test run emits `act(...)` warnings from
> `useBoard.test.tsx` (fake-timer polling state updates) and one "Cannot update a component
> while rendering" from `RequireAuth.test.tsx`. Both are pre-existing non-fatal warnings;
> all tests in those suites pass (8 / 5 respectively). No "failed to load" lines anywhere.

---

## Quick Reference: Task Status

```
T1: ✅ Implemented  (backend PATCH move endpoint + Drizzle txn rebalance; 20 BE tests)
T2: ✅ Implemented  (@hello-pangea/dnd dep + pure boardReorder util; 16 FE tests)
T3: ✅ Implemented  (ticket-move api client + optimistic useMoveTicket; 5 FE tests)
T4: ✅ Implemented  (TicketCard Draggable + unsorted isDropDisabled IN / draggable OUT)
T5: ✅ Implemented  (DragDropContext + Droppable columns + onDragEnd wiring)
T6: ⚠️ Partial      (automated gate ✅ 375 tests + tsc + build; live browser smoke deferred)
```

---

## Recommendations

1. **Live browser smoke (T6 manual remainder):** Before sign-off, run task-doc §T6 step-6 checklist against a running backend + seeded project (drag-within-column, cross-column, first/last position, concurrent LWW, simulated-500 rollback, drag-pause poll, keyboard a11y, unsorted rescue/reject, empty-column-remains). Unit tests already prove the deterministic behavior.
2. **Lint/format tooling (project-wide, not F11):** `frontend/package.json` has no `lint`/`format:check` scripts and no eslint/prettier config. Consider adding to satisfy the style-guide's Prettier/ESLint mandate across the project (carried from F10).
3. **F17 follow-up:** The `TODO(F17)` per-column-permission seam at `tickets.routes.ts:10` is the hook for F17/F25 role + column-ACL middleware; F11 wires `authenticate` only by design (Owner Q2).
4. **Position index:** The `position` column is non-unique by design (allows rebalance). Do NOT add a `(projectId, statusColumn, position)` unique index (explicitly out of scope per task doc §8).
5. **Ship-ready:** F11 is functionally complete and ship-ready pending the manual live smoke. No stubs, TODOs (other than the intended F17 seam), or incomplete code in any F11 file.

---

## Integration record (T6 — fill on live smoke)

- Feature commits: `81ad26b` (T1) · `2b3a30c` (T2) · `5acda79` (T3) · `9a412ed` (T4) · `ec3f772` (T5)
- Branch: `feature/SLYK-F11-drag-drop-order-persistence` (HEAD `ec3f772`)
- `PATCH /api/tickets/:ticketId` sample response (200 cross-column): `________` (expect `{ data: { ..., statusColumn, position } }`; asserted `tickets.routes.test.ts:73-94`)
- Frontend build artifact path: `frontend/dist/`
- typecheck/test/build exit codes: `0 / 0 / 0` (lint/format: N/A)
- Manual smoke results: `________` (per checklist in T6 step 6) — **deferred: manual browser smoke pending**
