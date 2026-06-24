# F24 — Ticket summary report (resolved by priority): Plan + Task Breakdown

> **Feature:** F24 — Ticket summary report (resolved by priority) (Phase 6 — Reporting)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F12 (DONE ✅) · **PRD ref:** REQ-6.1, REQ-6.3, User Journey 2
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F23](../F23-time-log-report/F23-time-log-report-tasks.md)

---

## 1. F24 Recap

**Goal:** Throughput visibility per member.

**Ships:** Reports page (`/reports`) adds a ticket-summary section showing, per member in the selected window, count of tickets resolved broken down by priority. Reuses F23's weekly/monthly window toggle + period navigation.

**Acceptance (definition of done):**
- Counts per (user, priority) in the window.
- "Resolved" = ticket's `updated_at` falls within the window AND `status_column` is the project's **last column** (convention: the final column in `projects.columns` = "Done"). Document.
- Attribute to the ticket's **current assignee** at the time of resolution (the `assignee_id` on the ticket row — not historical assignees). Document.
- Window boundary: use `updated_at` (when the ticket was last modified = when it was moved to the last column). Consistent with F23's UTC windowing.
- Weekly/Monthly toggle (reuse F23's).

**Edge cases:**
- "Resolved" semantics — **DECISION: last column = resolved.** The project's `columns` JSONB is an ordered array; the LAST element is "Done." No explicit `isDone` flag exists (F27 could add one). For MVP, use `columns[columns.length - 1].id`.
- Ticket touched by multiple assignees — **DECISION: attribute to the CURRENT assignee** (`assignee_id` at query time). Historical reassignment is not tracked for reporting. Document.
- Window boundary — **DECISION: `updated_at` within the window.** A ticket moved to the last column has its `updated_at` stamped. F18 activity logs (STATUS_CHANGED) could also be used for precision, but `updated_at` is simpler + available. Document.
- Tickets with no assignee → counted under "Unassigned" (or excluded — **DECISION: include as "Unassigned"** for completeness).

---

## 2. Codebase Analysis Summary

- **State:** F23 (DONE ✅) ships the ReportsPage with weekly/monthly toggle + window nav + the time-report table. F24 adds a SECOND report section (ticket counts by priority) to the same page. No new page or route needed.
- **Existing structure (citations):**
  - `reportService.ts` — `getTimeReport({ period, offset })` + `computeWindowStart/End/Label`. F24 adds `getTicketSummary({ period, offset })`.
  - `report.routes.ts` — `GET /api/reports/time`. F24 adds `GET /api/reports/tickets`.
  - `ReportsPage.tsx` — renders the time report. F24 adds a ticket-summary table below it.
  - `projects.columns` JSONB (`schema.ts`) — ordered `{id, name}[]`. Last element = Done column.
  - `tickets` table — `status_column` (references a column id), `assignee_id`, `priority`, `updated_at`, `deleted_at`.
  - `useReport` hook — fetches the time report. F24 adds `useTicketSummary` (or extends `useReport`).
  - `PRIORITY_DISPLAY` (`types/ticket.ts`) — LOW→Low etc. for display.
- **Files F24 creates:** none new (extends existing report files).
- **Files F24 modifies:** `backend/src/services/reportService.ts` (add getTicketSummary), `backend/src/routes/report.routes.ts` (add GET /api/reports/tickets), `frontend/src/types/report.ts` (add TicketSummaryResponse), `frontend/src/api/reports.ts` (add fetchTicketSummary), `frontend/src/hooks/useReport.ts` (add useTicketSummary), `frontend/src/pages/ReportsPage.tsx` (add ticket-summary table).
- **Schema delta: NONE.** Read-only over `tickets` + `projects`.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | "Resolved" definition | Ticket's `status_column` = the project's LAST column id (`projects.columns[columns.length-1].id`). | PRD edge case: "which column is Done?" No `isDone` flag exists (F27 could add). MVP: last column convention. Document. |
| D2 | Attribution | Current `assignee_id` at query time. | Spec edge case: "final assignee, or all?" Decision: current assignee. Historical reassignment not tracked. |
| D3 | Window field | `tickets.updated_at` within the UTC window. | A ticket moved to Done has `updated_at` stamped. Consistent with F23's UTC windowing. |
| D4 | Aggregation | Backend — `getTicketSummary` queries tickets WHERE `updated_at` in window AND `deleted_at IS NULL`, groups by (assignee, priority). | Same backend-aggregation pattern as F23's `getTimeReport`. |
| D5 | No new page/route prefix | Extend `ReportsPage` (add a section) + `report.routes.ts` (add `GET /api/reports/tickets`). Reuse F23's period/offset/window. | F23 already shipped the page shell + toggle + nav. F24 is a second table on the same page. |
| D6 | Soft-delete filter | `deleted_at IS NULL` — soft-deleted tickets excluded from the report. | F17 soft-delete. |
| D7 | Access control | All authenticated users (same as F23). | REQ-6.1 team visibility. |
| D8 | No schema/migration | Read-only. | No new tables/columns. |

---

## 4. Architecture Overview

```
backend/src/services/reportService.ts        # MODIFY — add getTicketSummary
backend/src/routes/report.routes.ts          # MODIFY — add GET /api/reports/tickets
frontend/src/types/report.ts                 # MODIFY — add TicketSummaryResponse
frontend/src/api/reports.ts                 # MODIFY — add fetchTicketSummary
frontend/src/hooks/useReport.ts              # MODIFY — add useTicketSummary
frontend/src/pages/ReportsPage.tsx           # MODIFY — add ticket-summary table section
```

---

## 5. Tasks

### T1 — Backend: getTicketSummary + GET /api/reports/tickets

**Batch:** 1 · **Depends on:** F23 (DONE)

**Description:**
1. Add `getTicketSummary({ period, offset })` to `reportService.ts`:
   - Compute window (reuse `computeWindowStart/End` from F23).
   - For EACH project: get the last column id from `projects.columns` JSONB (the "Done" column).
   - Query: `tickets` WHERE `updated_at >= windowStart AND updated_at < windowEnd AND deleted_at IS NULL`. Join `users` for assignee name. For each ticket, check if `status_column` matches the project's last-column id (resolved).
   - Group resolved tickets by (assignee, priority). Return `{ users: [{ id, fullName, avatarUrl, counts: { LOW: n, MEDIUM: n, HIGH: n, URGENT: n, CRITICAL: n, total: n } }], window: { start, end, label } }`.
   - For MVP simplicity: fetch all projects + their last columns, then batch-query tickets. Or do a single query joining tickets → projects (to get columns JSONB) and filter in JS.
2. Add `GET /api/reports/tickets` to `report.routes.ts` (same period/offset query params as `/time`).

**Acceptance:**
- [ ] `getTicketSummary` returns per-user priority counts for resolved tickets in the window.
- [ ] "Resolved" = status_column = project's last column.
- [ ] Soft-deleted tickets excluded.
- [ ] `GET /api/reports/tickets?period=weekly&offset=0` returns 200.
- [ ] `rtk tsc` (BE) passes.

### T2 — FE: types + api + hook + ReportsPage ticket-summary table

**Batch:** 2 · **Depends on:** T1

**Description:**
1. `types/report.ts` — add `TicketSummaryUser { id, fullName, avatarUrl, counts: { LOW, MEDIUM, HIGH, URGENT, CRITICAL, total } }` + `TicketSummaryResponse`.
2. `api/reports.ts` — add `fetchTicketSummary(period, offset)`.
3. `hooks/useReport.ts` — add `useTicketSummary(period, offset)`.
4. `ReportsPage.tsx` — add a "Ticket Summary" section below the time-report table. Show a table: rows per user (avatar + name), columns per priority (LOW/MEDIUM/HIGH/URGENT/CRITICAL) + Total. Reuse the same period/offset/window toggle (shared state).

**Acceptance:**
- [ ] Ticket-summary table renders per-user priority counts.
- [ ] Uses the same period/offset as the time report (shared toggle + nav).
- [ ] `formatDuration` NOT used (these are counts, not durations — plain integers).
- [ ] `rtk tsc` (FE) passes.

### T3 — Verification

Typecheck/lint/format/test/build. Live smoke: `/reports` → ticket summary shows counts per user/priority.

---

## 6. Final F24 Acceptance Checklist

- [ ] Per-user ticket counts by priority in the selected window.
- [ ] "Resolved" = status_column = project's last column.
- [ ] Soft-deleted excluded.
- [ ] Weekly/Monthly toggle (shared with F23).
- [ ] All authenticated users.
- [ ] No schema/migration.
- [ ] All tests pass; typecheck/lint/format/build green.

---

## 7. Schema deltas owned by this feature

**F24 owns NONE.** Read-only over `tickets` + `projects`. No migration, no schema change.

---

## 8. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-25)

1. **"Resolved" = last column.** Convention: `projects.columns[columns.length-1].id`. No `isDone` flag (F27 could add). CONFIRMED.
2. **Attribution = current assignee.** Historical reassignment not tracked. CONFIRMED.
3. **Window field = `updated_at`.** UTC, consistent with F23. CONFIRMED.
4. **Soft-deleted excluded.** `deleted_at IS NULL`. CONFIRMED.
5. **All authenticated users.** No admin gate. CONFIRMED.
6. **No schema/migration.** CONFIRMED.

---

**Sources:**
- PRD REQ-6.1 ("Total tracked time per user within a selected window" — same windowing applies to ticket counts).
- PRD REQ-6.3 ("Counts per (user, priority) in the window").
- PRD User Journey 2 (workload visibility).
- F23 task doc (reportService pattern + window computation + ReportsPage shell).
- Grounding: `backend/src/services/reportService.ts`; `backend/src/routes/report.routes.ts`; `frontend/src/pages/ReportsPage.tsx`; `backend/src/db/schema.ts` (tickets + projects.columns).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
