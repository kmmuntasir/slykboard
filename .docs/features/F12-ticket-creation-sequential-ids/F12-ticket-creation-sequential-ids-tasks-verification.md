# Implementation Verification Report — F12 (Ticket creation with sequential IDs)

**Source:** `F12-ticket-creation-sequential-ids-tasks.md`
**Verified:** 2026-06-23
**Branch:** `feature/SLYK-F12-ticket-creation-sequential-ids`
**Total Tasks:** 9 (T1–T9)
**Implemented:** 9 (100%)
**Partial:** 0
**Missing:** 0

> Audit method: 3 parallel read-only analyst subagents (backend / frontend / integration+gates+DB), each reading source `file:line` against the task spec. Cross-checked against the F12 headless-coder results and the live backend API smoke in [`F12-verification.md`](./F12-verification.md).

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 9 | 100% |
| ⚠️ Partial | 0 | 0% |
| ❌ Missing | 0 | 0% |
| 🔄 Modified | 0 | 0% |

All 9 tasks fully implemented. No stubs, no empty handlers, no `throw new Error('not implemented')`. Two non-blocking deviations from spec prose (documented below). One pre-existing flaky test unrelated to F12 (flagged, not a blocker). Browser smoke is the only deferred item — by design (pangea DnD not drivable headless).

---

## Task-by-Task Results

| Task | Title | Status | Key evidence |
|------|-------|--------|--------------|
| T1 | project_sequences table + unique idx + migration 0005 + seed | ✅ | `schema.ts:17,82-87,125-128`; `0005_smart_kinsey_walden.sql` (no `$1`); `seed.ts:91-143` (1-based, nextNumber=4) |
| T2 | allocateTicketNumber + createTicket + tests | ✅ | `ticketService.ts:109-184` (`.for('update')`, no `noWait`, single txn, bottom math); `ticketService.test.ts:292-441` (10 scenarios) |
| T3 | createProject seeds counter in-tx | ✅ | `projectService.ts:63-81` (txn-wrapped seed, `START_TICKET_NUMBER`); F08 contract intact |
| T4 | POST /:slug/tickets route + Zod + supertest | ✅ | `projects.schema.ts:37-44`; `projects.routes.ts:51-65` (MW order, 201, `req.user!.id`, `TODO(F17):50`); `projects.routes.test.ts:288-414` (10 scenarios) |
| T5 | createTicket API client | ✅ | `api/tickets.ts:17-31` (`createTicket` + `CreateTicketDto`); moveTicket untouched |
| T6 | applyCreateToBoard pure util + tests | ✅ | `utils/boardInsert.ts:10-20` (immutable, isUnsorted guard, bottom-append); `boardInsert.test.ts` (table-driven + immutability) |
| T7 | useCreateTicket optimistic hook + tests | ✅ | `hooks/useCreateTicket.ts:10-30` (onMutate/onError/onSuccess/onSettled; `boardKeys` reused); `useCreateTicket.test.ts` (4 scenarios) |
| T8 | NewTicketButton + BoardPage wiring + test | ✅ | `NewTicketButton.tsx` (title-only form, 4-space JSX); `BoardPage.tsx:5,10,17,73,76-82` (wired + empty-state updated); `NewTicketButton.test.tsx` (5 RTL) |
| T9 | Integration verification + record | ✅ | `F12-verification.md` (gate matrix + live backend smoke + concurrency proof + DDL); gate closeout (lint=0, F12-format clean) |

---

## Acceptance-Criteria Cross-Check (§1 + §7)

| Acceptance bullet | Met? | Proof |
|---|---|---|
| `Tickets` table; `ticket_number` per-project, never global | ✅ | `project_sequences` counter + `allocateTicketNumber` (T1/T2); unique `(project_id, ticket_number)` backstop (T1) |
| ID format `[SLUG]-[NNN]` shown + stable | ✅ | `TicketCard.tsx:18` (zero-padded `SLYK-001`, D2); `ticketNumber` server-allocated (T2) |
| New card lands at bottom of first column | ✅ | `createTicket` position = `max(position)||0 + POSITION_GAP` for `columns[0].id` (T2); `applyCreateToBoard` appends (T6); smoke: #1=65536, #2=131072 |
| `creator_id` from authenticated user | ✅ | Route passes `creatorId: req.user!.id` (T4); stored by `createTicket` (T2); smoke: creatorId === JWT sub |
| `status_column` defaults to first column | ✅ | `input.statusColumn ?? project.columns[0].id` (T2); unit test confirms default |
| Concurrency: two creates never share a number | ✅ | `FOR UPDATE` on `project_sequences` (T2) + unique constraint (T1); smoke: parallel POSTs → distinct 3≠4 |
| Edge: starting number = 1, zero-pad | ✅ | `START_TICKET_NUMBER=1` (T1); zero-pad display (D2) |
| Edge: gap on delete — IDs never reused | ✅ | `nextNumber` monotonic; documented (D1); no delete endpoint (F14) |
| Edge: slug rename deferred to F27 | ✅ | Model A render-time shipped; no `TODO(F27)` schema comment added (minor — see deviations) |
| Lint / format / typecheck / test / build | ✅ | See gate matrix; lint=0, F12-owned format clean, typecheck/test/build 0 |
| Inherited F11 DnD regression-free | ✅ (unit) | F11 suites green; live DnD-after-create browser smoke deferred (manual) |

---

## Detailed Gap Analysis

### Backend gaps
None blocking. Two non-blocking deviations from spec prose:
1. **`TODO(F27)` schema seam comment not added** to `schema.ts` (§8 schema-deltas prose mentioned it as a future seam). Non-blocking — Model A is shipped and reversible; the seam is documented in the task plan + §8. Cosmetic follow-up if desired.
2. **Seed positions kept at 10/20/30** (spec allowed either keeping legacy or switching to `POSITION_GAP` multiples). Spec-permitted choice, documented. No functional impact (F11 rebalance handles gaps).

### Frontend gaps
None. T5–T8 + D2 all complete, no `any`, `boardKeys` reused, immutable util, RTL-priority tests, Tailwind-only, zero-pad implemented with a named constant (`TICKET_NUMBER_DISPLAY_WIDTH=3`).

### Shared / integration gaps
1. **Pre-existing flaky test** (NOT F12): `backend/src/utils/jwt.test.ts > "rejects a tampered token"` fails intermittently under full-suite parallel load but passes in isolation (10/10). Root cause: `tamperSignature()` flips the signature's last base64url char to `'a'`, which is itself a valid base64url char → occasionally produces another valid signature so `verifyJwt` succeeds. File is F05/F07 code, **not in the F12 diff**. This accounts for the one discrepancy with `F12-verification.md` (which records backend tests 247/247 exit 0 — reproducible in isolation; the flake only surfaces under load). **Recommend tracking separately as an F05/F07 fix** (e.g. flip to an invalid base64url char); not an F12 blocker.
2. **Browser smoke deferred** (by design): the FE optimistic-insert + DnD live smoke is not automatable headless (jsdom cannot drive `@hello-pangea/dnd`'s pointer sensor). Covered at the unit/component level (`useCreateTicket`, `NewTicketButton`, `applyCreateToBoard`, `TicketCard` zero-pad) + live backend API smoke. **Needs a human** to walk the create → bottom-card → reload → drag flow.

---

## Gate Matrix (independent re-run via `rtk proxy` for true exit codes)

| # | Gate | Exit | Notes |
|---|------|------|-------|
| 1 | Backend typecheck (`tsc --noEmit`) | 0 | |
| 2 | Frontend typecheck (`tsc --noEmit`) | 0 | |
| 3 | Backend tests (`vitest run`) | 0* | 247 passed in isolation; 1 pre-existing flaky `jwt.test.ts` under parallel load (see gaps) |
| 4 | Frontend tests (`vitest run`) | 0 | 35 files / 164 passed |
| 5 | Lint (`eslint .`, root) | 0 | 0 problems (post-closeout) |
| 6 | Format (`prettier --check .`, root) | 1† | †10 dirty files — **all pre-existing F09/F10/F11, zero F12-touched**. Advisory; repo does not enforce prettier in CI |
| 7 | Backend build (`tsc -p`) | 0 | |
| 8 | Frontend build (`vite build`) | 0 | |
| 9 | `db:migrate` | 0 | no-op (0005 applied in T1) |
| 10 | `db:seed` | 0 | idempotent (1-based, nextNumber=4) |

**Live backend API smoke (from `F12-verification.md`, independently cross-checked):** fresh-project sequential #1 (pos 65536) / #2 (pos 131072); seeded SLYK probe → #4 (T1 collision-fix proven); 7 error codes exact (401 / 400×5 / 404); **concurrency → distinct 3≠4** (F12 invariant). DDL confirmed live: `project_sequences` (2 cols, `next_number` default 1, FK→`Projects(id)`) + `tickets_project_number_uq` unique btree(`project_id`,`ticket_number`).

---

## Recommendations

1. **(Deferred, human)** Run the FE browser smoke: login → board → "+ New ticket" → card appears at bottom of first column as `SLYK-00X` → reload persists → drag persists. Confirms optimistic insert + inherited F11 DnD together.
2. **(Separate ticket, F05/F07)** Fix the flaky `jwt.test.ts` tamper test (flip to an invalid base64url char) — pre-existing, surfaces under parallel test load.
3. **(Optional, F12 housekeeping)** Add the `TODO(F27)` seam comment near the `tickets` table in `schema.ts` if the team wants the immutability-decision seam in-code (currently documented only in the task plan + §8).
4. **(Optional, repo-wide)** Add `@vitest/coverage-*` so the `>80%` business-logic coverage gate becomes machine-verifiable (currently assessed by inspection). And add a root prettier CI gate so the pre-existing format debt doesn't accumulate.

---

## Quick Reference: Task Status

```
T1: ✅ Implemented (project_sequences + unique idx + 0005 + 1-based seed)
T2: ✅ Implemented (allocateTicketNumber FOR UPDATE + createTicket + 10 tests)
T3: ✅ Implemented (createProject seeds counter in-tx)
T4: ✅ Implemented (POST /:slug/tickets + createTicketBody Zod + 10 supertest)
T5: ✅ Implemented (createTicket API client + CreateTicketDto)
T6: ✅ Implemented (applyCreateToBoard pure util + table-driven tests)
T7: ✅ Implemented (useCreateTicket optimistic hook + 4 tests)
T8: ✅ Implemented (NewTicketButton + BoardPage wiring + 5 RTL tests)
T9: ✅ Implemented (gate matrix + live backend smoke + concurrency proof + record)
```

**F12: 9/9 tasks implemented. Feature functionally complete + verified (automated gates + backend live smoke). FE browser smoke is the single deferred human item.**
