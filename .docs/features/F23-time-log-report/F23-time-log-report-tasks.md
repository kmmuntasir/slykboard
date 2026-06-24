# F23 — Time log report (per-user, weekly/monthly): Plan + Task Breakdown

> **Feature:** F23 — Time log report (per-user, weekly/monthly) (Phase 6 — Reporting)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F22 (DONE ✅) · **PRD ref:** REQ-6.1, REQ-6.2, User Journey 2
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F22](../F22-time-log-list/F22-time-log-list-tasks.md)

---

## 1. F23 Recap

**Goal:** Workload visibility per team member.

**Ships:** A Reports page (`/reports`) showing total tracked hours per user, filterable by weekly or monthly window. Aggregates both timer durations (end_time - start_time) + manual minutes within the selected period. Weekly/Monthly toggle + current/previous period navigation. Totals formatted as hours/minutes.

**Acceptance (definition of done):**
- Time aggregated per user within the selected window (sum of timer durations + manual minutes).
- Weekly / Monthly toggle; current + previous periods navigable.
- Totals formatted as hours/minutes (reuse `formatDuration`).
- All authenticated users can view (PRD leaves "all users vs admin-only" open — DECISION: all authenticated users; REQ-6.1 implies visibility).

**Edge cases:**
- Week boundaries (Mon–Sun) and TZ — must match UTC storage (F02 convention). **Decision: compute window boundaries server-side in UTC** (avoid client-clock drift).
- Open timer (no end_time) — **exclude from the report** (still accruing; not yet "logged time"). Document.
- Access control — **all authenticated users** (DECISION: PRD REQ-6.1 is team visibility; no admin gate).
- Performance — index `TimeEntries` on `(user_id, start_time)` for windowed aggregation (already partially covered by `time_entries_one_active` on user_id; add a composite if needed — but the table is small for MVP; no index needed yet).

---

## 2. Codebase Analysis Summary

- **State:** F20 (DONE ✅) ships `TimeEntries` table + `timerService`. F21 (DONE ✅) ships manual entries. F22 (DONE ✅) ships user resolution. No report endpoint or Reports page content exists yet (the `/reports` ROUTE exists as a placeholder — `ReportsPage.tsx` renders a stub).
- **Existing structure (citations):**
  - `TimeEntries` table (`schema.ts`): `id, ticketId, userId, startTime, endTime, manualEntryMinutes, description, createdAt`. Timer entries have `startTime`/`endTime`; manual entries have `manualEntryMinutes` + `startTime`/`endTime` stamped to the same instant.
  - `timerService.ts` — `getTimeEntries(ticketId)` already resolves user names. F23 adds a **cross-ticket aggregation** query (per-user total within a window).
  - `ReportsPage` — exists at `frontend/src/pages/ReportsPage.tsx` (placeholder, routed at `/reports` in `routes/index.tsx`). Currently renders a stub.
  - `formatDuration` (`utils/formatDuration.ts`) — "1h 30m" formatting. F23 reuses.
  - Route: `/reports` is registered (`routes/index.tsx`), `authenticate` gated.
  - The board's `boardService.getBoard` pattern (Drizzle query + response shape) is the precedent for a read-only aggregation endpoint.
- **Files F23 creates:** `backend/src/services/reportService.ts` (aggregation query), `frontend/src/api/reports.ts`, `frontend/src/types/report.ts`, `frontend/src/hooks/useReport.ts`.
- **Files F23 modifies:** `backend/src/routes/` (new report route OR extend existing), `frontend/src/pages/ReportsPage.tsx` (the actual report UI).
- **Schema delta: NONE.** F23 is read-only over F20's `TimeEntries`.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Aggregation location | **Backend** — `reportService.getTimeReport({ period, offset })` returns per-user totals. One query groups by user + sums durations. | Keeps the FE thin (like all other read paths — boardService, activityService). Postgres aggregation is fast; avoids sending raw rows to the client. |
| D2 | Window computation | **Server-side UTC** — compute week/month boundaries from `new Date()` in the service. Week = Mon–Sun (locale-independent UTC). Monthly = calendar month. `offset` parameter: 0 = current, -1 = previous, etc. | F02 UTC convention. Avoids client-clock drift. PRD edge case: "must match UTC storage." |
| D3 | Duration computation | Timer entries: `end_time - start_time` (only where `end_time IS NOT NULL` — closed entries). Manual entries: `manual_entry_minutes * 60000`. Sum both per user. **Open timer excluded** (no end_time; still accruing). | REQ-6.1: "sum of timer durations + manual minutes." Open timer edge case: exclude. |
| D4 | Route | `GET /api/reports/time?period=weekly&offset=0` — returns `{ users: [{ id, fullName, avatarUrl, totalMs }], window: { start, end, label } }`. `authenticate` only (all users). | RESTful; query params for period/offset. No body. Consistent with the envelope. |
| D5 | FE toggle | Weekly/Monthly toggle (useState) + prev/next navigation (offset state). TanStack Query for the fetch. `formatDuration` for display. | PRD: "Weekly / Monthly toggle; current + previous periods selectable." |
| D6 | Access control | **All authenticated users.** PRD leaves it open (§7 cross-cutting #6). REQ-6.1 is "team visibility." No admin gate. | PRD §7 #6: "all users vs admin-only — PRD leaves open." Decision: all (visibility is the point). |
| D7 | No schema/migration | Read-only over F20's `TimeEntries`. No index needed for MVP (table is small). | F20 migration 0010 already shipped. |

---

## 4. Architecture Overview

```
backend/src/services/reportService.ts        # NEW — getTimeReport({ period, offset }) aggregation
backend/src/routes/                          # MODIFY — register GET /api/reports/time (in index.ts or a new report route file)
frontend/src/types/report.ts                 # NEW — TimeReportResponse, ReportUser types
frontend/src/api/reports.ts                  # NEW — fetchTimeReport(period, offset)
frontend/src/hooks/useReport.ts              # NEW — useQuery hook
frontend/src/pages/ReportsPage.tsx           # MODIFY — the actual report UI (table + toggle + nav)
```

---

## 5. Tasks

### T1 — Backend: reportService + GET /api/reports/time route

**Batch:** 1 · **Depends on:** F22 (DONE)

**Description:**
1. Create `backend/src/services/reportService.ts`:
   - `getTimeReport({ period: 'weekly' | 'monthly', offset: number })`:
     - Compute window: `start = computeWindowStart(period, offset)` (Monday 00:00 UTC for weekly; first day of month for monthly). `end = start + duration`.
     - Query: join `timeEntries` + `users` WHERE `start_time >= windowStart AND start_time < windowEnd AND end_time IS NOT NULL` (exclude open timers). For each user, sum:
       - Timer: `EXTRACT(EPOCH FROM (end_time - start_time)) * 1000` (ms) — OR compute in JS from the rows.
       - Manual: `COALESCE(manual_entry_minutes, 0) * 60000`.
     - Group by user. Return `{ users: [{ id, fullName, avatarUrl, totalMs }], window: { start: ISO, end: ISO, label: 'Week of Jun 24' / 'June 2026' } }`.
   - For MVP simplicity: fetch all entries in the window (group in JS, not SQL aggregation). The table is small. Avoids complex Drizzle raw-SQL.
2. Register route `GET /api/reports/time` in `backend/src/index.ts` (or a new `report.routes.ts`):
   - `authenticate` + Zod query validation (`period: z.enum(['weekly','monthly']).default('weekly'), offset: z.number().int().default(0)`).
   - Call `reportService.getTimeReport({ period, offset })` → `res.json(success(report))`.

**Acceptance:**
- [ ] `getTimeReport` returns per-user totals (ms) within the window.
- [ ] Open timers (end_time null) excluded.
- [ ] Window label human-readable ("Week of Jun 24, 2026" / "June 2026").
- [ ] `GET /api/reports/time?period=weekly&offset=0` returns 200 + the report; 401 no-token.
- [ ] `rtk tsc` (BE) passes.

### T2 — FE: types + api + hook + ReportsPage UI

**Batch:** 2 · **Depends on:** T1

**Description:**
1. `frontend/src/types/report.ts` — `ReportUser { id, fullName, avatarUrl, totalMs }`, `TimeReportResponse { users: ReportUser[], window: { start, end, label } }`.
2. `frontend/src/api/reports.ts` — `fetchTimeReport(period, offset)` → `apiFetch('/reports/time?period=...&offset=...')`.
3. `frontend/src/hooks/useReport.ts` — `useReport(period, offset)` → `useQuery`.
4. `frontend/src/pages/ReportsPage.tsx` — REPLACE the stub with:
   - Weekly/Monthly toggle (two buttons or a select).
   - ← Prev / Next → navigation (offset state).
   - Window label display ("Week of Jun 24, 2026").
   - Table: rows per user (avatar + name + total `formatDuration(totalMs)`). Sorted by totalMs DESC.
   - Empty state: "No time tracked in this period."
   - Loading state.

**Acceptance:**
- [ ] Weekly/Monthly toggle works.
- [ ] Prev/Next navigates periods.
- [ ] Per-user totals displayed (avatar + name + duration).
- [ ] Sorted by total DESC.
- [ ] Empty + loading states.
- [ ] `rtk tsc` (FE) passes.

### T3 — Verification

**Batch:** 3 · **Depends on:** T2

Typecheck/lint/format/test/build. Live smoke: navigate to `/reports` → toggle weekly/monthly → see per-user totals → navigate prev/next.

---

## 6. Final F23 Acceptance Checklist

- [ ] `GET /api/reports/time` returns per-user aggregated time within a weekly/monthly window.
- [ ] Timer + manual durations both summed per user.
- [ ] Open timer excluded (no end_time).
- [ ] Weekly/Monthly toggle + prev/next navigation.
- [ ] Totals formatted as hours/minutes (`formatDuration`).
- [ ] All authenticated users can view (no admin gate).
- [ ] Window computed server-side UTC (no client-clock drift).
- [ ] No schema/migration.
- [ ] All tests pass; typecheck/lint/format/build green.

---

## 7. Schema deltas owned by this feature

**F23 owns NONE.** Read-only over F20's `TimeEntries` table. No migration, no schema change.

---

## 8. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-25)

1. **Aggregation:** backend (reportService groups per user). CONFIRMED.
2. **Window:** server-side UTC (week = Mon–Sun; month = calendar). CONFIRMED.
3. **Open timer:** excluded from report (still accruing). CONFIRMED.
4. **Access control:** all authenticated users (no admin gate). CONFIRMED.
5. **No schema/migration.** CONFIRMED.

---

**Sources:**
- PRD REQ-6.1 ("Total tracked time per user within a selected window").
- PRD REQ-6.2 ("Weekly / Monthly toggle; current + previous periods selectable").
- PRD User Journey 2 (workload visibility).
- F20 task doc (`TimeEntries` table + timerService).
- F21 task doc (manual_entry_minutes).
- Grounding: `backend/src/db/schema.ts` (timeEntries); `backend/src/services/timerService.ts` (getTimeEntries); `frontend/src/pages/ReportsPage.tsx` (placeholder); `frontend/src/utils/formatDuration.ts`; `frontend/src/routes/index.tsx` (/reports route).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
