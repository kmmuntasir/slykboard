# F21 — Manual time entry: Plan + Task Breakdown

> **Feature:** F21 — Manual time entry (Phase 5 — Time Tracking)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F20 (DONE ✅) · **PRD ref:** REQ-4.4, PRD §8.4
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), dependency task doc: [F20](../F20-server-authoritative-timer/F20-server-authoritative-timer-tasks.md)

---

## 1. F21 Recap

**Goal:** Log time without running the timer — a user adds a manual entry with a duration + optional note + optional "worked on" date.

**Ships:** A "Log time" form in the ticket detail modal (alongside the TimeLog). User enters a duration like `2h 30m` or `90m`, an optional description ("Logged for research"), and an optional date. The backend creates a `TimeEntries` row with `manual_entry_minutes` set and `start_time`/`end_time` null (manual entries are distinguishable from timer entries). The TimeLog shows manual entries with a visual distinction (e.g. "Manual" badge). The total includes manual durations.

**Acceptance (definition of done):**
- Manual entry creates a `TimeEntries` row: `manual_entry_minutes` set (integer > 0), `start_time`/`end_time` null, `description` optional, `user_id` from the authenticated user.
- Duration input supports `2h 30m` / `90m` / `1.5h` style parsing + validation (non-negative, sane upper bound e.g. 24h = 1440 min).
- Manual entries are visually distinguishable from timer entries in the TimeLog (badge or label).
- The TimeLog total includes manual durations.
- Optional "worked on" date for correct reporting attribution (stored as `created_at` override OR a new `worked_on` date — decision below).

**Edge cases:**
- **Validation:** non-negative, sane upper bound (1440 min = 24h per entry). Reject 0 or negative.
- **Manual vs timer distinguishable:** `manual_entry_minutes IS NOT NULL` AND `start_time IS NULL` = manual; `start_time IS NOT NULL` = timer. The TimeLog already queries all entries — add a computed `type: 'manual' | 'timer'` per entry.
- **Date attribution:** manual entries need an optional "worked on" date for reporting (F23). Decision: use `created_at` as the entry date (no new column — F23 can filter by `created_at`). If the user needs a different date, they edit later. Keep it simple for MVP.

---

## 2. Codebase Analysis Summary

- **State:** F20 (DONE ✅) ships the `TimeEntries` table (`schema.ts` with `manual_entry_minutes` + `description` columns already nullable), `timerService.ts` (start/stop/getActive/getTimeEntries), routes (`POST /:ticketId/timer/start` + `/stop` + `GET /:ticketId/timer/entries`), `TimeLog.tsx` (entries list + total), `TimerControls.tsx`. No manual-entry endpoint/form exists yet.
- **Existing structure (citations):**
  - `TimeEntries` table (`schema.ts` after activityLogs): `id`, `ticketId` FK cascade, `userId` FK set null, `startTime` timestamptz, `endTime` timestamptz nullable, **`manualEntryMinutes` integer nullable**, **`description` text nullable**, `createdAt` timestamptz. The columns F21 needs ALREADY EXIST.
  - `timerService.ts` — `getTimeEntries(ticketId)` returns entries with `durationMs` + `totalMs`. Currently `durationMs` = `endTime - startTime` (null for manual entries where both are null). **F21 must extend**: manual entries have `manual_entry_minutes` → `durationMs = manual_entry_minutes * 60000`. The total must include manual durations.
  - Routes: `tickets.routes.ts` has nested `/:ticketId/timer/start` + `/stop` + `/entries`. F21 adds `POST /:ticketId/timer/manual`.
  - `TimeLog.tsx` — renders entries (start, end, duration). F21 adds a "Manual" badge for manual entries + a `ManualEntryForm` component.
  - `TicketDetailModal.tsx` — hosts `TimerControls` + `TimeLog` (gated on `!ticket.deletedAt`). F21 adds `ManualEntryForm` alongside.
- **Files F21 creates:** `frontend/src/utils/parseDuration.ts` (+ test), `frontend/src/components/ManualEntryForm.tsx` (+ test).
- **Files F21 modifies:** `backend/src/services/timerService.ts` (addManualEntry + extend getTimeEntries to compute manual durations + type), `backend/src/routes/tickets.routes.ts` (POST manual route + Zod schema), `frontend/src/components/TimeLog.tsx` (manual badge + total includes manual), `frontend/src/components/TicketDetailModal.tsx` (render ManualEntryForm), `frontend/src/types/timer.ts` (extend TimeEntryWithDuration with type field), `frontend/src/api/timer.ts` (addManualEntry fn).
- **Schema delta: F21 owns NONE.** The `manual_entry_minutes` + `description` columns already exist (F20 added them per §9 #6 "include now, nullable"). No migration, no schema change.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Storage shape | Manual entry = `manual_entry_minutes > 0` + `start_time IS NULL` + `end_time IS NULL`. Timer entry = `start_time IS NOT NULL`. Distinguishable via a computed `type` field. | Columns already exist (F20 §9 #6). No schema change. PRD §8.4: `manual_entry_minutes` Integer nullable. |
| D2 | Duration input | Parse `2h 30m` / `90m` / `1.5h` / `30` (minutes) into integer minutes. Validate: > 0, ≤ 1440 (24h cap). | PRD REQ-4.4: "Logged 2h 30m for research". Industry-standard parsing (Toggl/Clockify). |
| D3 | Route | `POST /api/tickets/:ticketId/timer/manual` — `authenticate` + Zod body (`minutes: number 1-1440`, `description?: string`). Returns the created entry. | Nested under ticketsRouter (consistent with `/timer/start` + `/timer/stop`). |
| D4 | Date attribution | Use `created_at` (server stamps `now()`). No separate "worked on" date for MVP — the entry is attributed to today. F23 (reports) can filter by `created_at`. | Simplest; no new column. A future enhancement can add a `worked_on` date. |
| D5 | TimeLog distinction | Each entry gets a computed `type: 'manual' | 'timer'` (from `manual_entry_minutes !== null`). TimeLog shows a "Manual" badge for manual entries. | The existing `getTimeEntries` already returns all entries; adding a `type` field is a one-liner. |
| D6 | Total computation | `getTimeEntries` totalMs includes manual durations (`manual_entry_minutes * 60000`). | Manual entries contribute to the ticket's total tracked time. |
| D7 | No new deps | `parseDuration` is a pure util (regex-based, no dep). | Rules: avoid unnecessary deps. |
| D8 | Schema delta | NONE. Columns exist. No migration. | F20 §9 #6 included them. |

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
├── backend/src/
│   ├── services/timerService.ts             # MODIFY — addManualEntry + extend getTimeEntries (type + manual duration)
│   └── routes/tickets.routes.ts             # MODIFY — POST /:ticketId/timer/manual + Zod schema
└── frontend/src/
    ├── types/timer.ts                        # MODIFY — add type field to TimeEntryWithDuration
    ├── api/timer.ts                          # MODIFY — addManualEntry fn
    ├── utils/parseDuration.ts                # NEW — parse "2h 30m" → minutes (180)
    │   └── parseDuration.test.ts             # NEW — table-driven
    ├── components/ManualEntryForm.tsx        # NEW — duration input + description + submit
    │   └── ManualEntryForm.test.tsx          # NEW — parse + submit + validation
    ├── components/TimeLog.tsx                # MODIFY — "Manual" badge + total includes manual
    └── components/TicketDetailModal.tsx      # MODIFY — render ManualEntryForm
```

---

## 5. Parallelization Strategy

3 batches. BE (T1) is the spine; FE utils (T2) is parallel; FE components (T3) depends on both.

```
 B1: T1 (BE: addManualEntry + extend getTimeEntries + route) ‖ T2 (FE: parseDuration util + tests)
     ↓
 B2: T3 (FE: types + api + ManualEntryForm + TimeLog manual badge + modal wiring + tests)
     ↓
 B4: T4 (verification)
```

| # | Batch | Target files | Depends on | Parallel with |
|---|-------|-------------|------------|---------------|
| T1 | 1 | timerService.ts, tickets.routes.ts | F20 (DONE) | T2 |
| T2 | 1 | parseDuration.ts (+test) | — | T1 |
| T3 | 2 | types/timer.ts, api/timer.ts, ManualEntryForm.tsx (+test), TimeLog.tsx, TicketDetailModal.tsx | T1, T2 | — |
| T4 | 3 | (verification) | T3 | — |

---

## 6. Tasks

### T1 — Backend: addManualEntry + extend getTimeEntries + POST manual route

**Batch:** 1 · **Depends on:** F20 (DONE) · **Parallel with:** T2

**Description:**
1. Add `addManualEntry({ ticketId, userId, minutes, description? })` to `timerService.ts`:
   ```typescript
   export async function addManualEntry(args: {
       ticketId: string;
       userId: string;
       minutes: number;
       description?: string;
   }): Promise<TimeEntryWithDuration> {
       const [row] = await db
           .insert(timeEntries)
           .values({
               ticketId: args.ticketId,
               userId: args.userId,
               startTime: null,
               endTime: null,
               manualEntryMinutes: args.minutes,
               description: args.description ?? null,
           })
           .returning({ id: timeEntries.id, startTime: timeEntries.startTime, endTime: timeEntries.endTime, manualEntryMinutes: timeEntries.manualEntryMinutes, description: timeEntries.description });
       // Compute durationMs from manualEntryMinutes
       return {
           id: row!.id,
           startTime: row!.startTime?.toISOString() ?? '',
           endTime: row!.endTime?.toISOString() ?? null,
           durationMs: (row!.manualEntryMinutes ?? 0) * 60_000,
           description: row!.description,
       };
   }
   ```
2. Extend `getTimeEntries` — add a `type: 'manual' | 'timer'` field per entry + include manual durations in `durationMs` + `totalMs`:
   ```typescript
   // In the map:
   const isManual = r.manualEntryMinutes !== null;
   const durationMs = isManual
       ? (r.manualEntryMinutes ?? 0) * 60_000
       : r.endTime ? r.endTime.getTime() - r.startTime.getTime() : null;
   return { ..., durationMs, type: isManual ? 'manual' : 'timer' };
   ```
   Import `manualEntryMinutes` from the schema select (add to the select list). Add `type` to `TimeEntryWithDuration` interface.
3. Add `POST /:ticketId/timer/manual` route in `tickets.routes.ts`:
   ```typescript
   const manualEntryBody = z.object({
       minutes: z.number().int().min(1).max(1440),
       description: z.string().max(500).optional(),
   });
   ticketsRouter.post('/:ticketId/timer/manual', authenticate, validateRequest({ params: ticketIdParam, body: manualEntryBody }), async (req, res) => {
       const { ticketId } = req.params as TicketIdParam;
       const body = req.body as z.infer<typeof manualEntryBody>;
       const entry = await timerService.addManualEntry({ ticketId, userId: req.user!.id, minutes: body.minutes, description: body.description });
       res.status(201).json(success(entry));
   });
   ```

**Acceptance Criteria:**
- [ ] `addManualEntry` inserts a row with `manual_entry_minutes` set, `start_time`/`end_time` null.
- [ ] `getTimeEntries` returns a `type` field ('manual' | 'timer') per entry.
- [ ] Manual entries have `durationMs = manual_entry_minutes * 60000`.
- [ ] `totalMs` includes manual durations.
- [ ] `POST /:ticketId/timer/manual` returns 201 + the created entry; validates minutes 1-1440; 401 no-token; 400 bad body.
- [ ] `rtk tsc` (BE) + `rtk vitest run` (BE) pass.

### T2 — FE utils: parseDuration + tests

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1

**Description:** Create `frontend/src/utils/parseDuration.ts` — parse `2h 30m` / `90m` / `1.5h` / `30` → integer minutes (180 / 90 / 90 / 30). Pure fn, table-driven test. Regex-based: `^(\d+(\.\d+)?h)?\s*(\d+(\.\d+)?m?)?$` or similar. Return `null` for unparseable input.

**Acceptance Criteria:**
- [ ] `parseDuration('2h 30m')` → 180.
- [ ] `parseDuration('90m')` → 90.
- [ ] `parseDuration('1.5h')` → 90.
- [ ] `parseDuration('30')` → 30.
- [ ] `parseDuration('')` / `parseDuration('abc')` → null.
- [ ] Table-driven tests. `rtk tsc` + `rtk vitest run` pass.

### T3 — FE: types + api + ManualEntryForm + TimeLog badge + modal wiring

**Batch:** 2 · **Depends on:** T1, T2

**Description:**
1. `types/timer.ts` — add `type: 'manual' | 'timer'` to `TimeEntryWithDuration`.
2. `api/timer.ts` — add `addManualEntry(ticketId, { minutes, description? }): Promise<TimeEntryWithDuration>` → `apiFetch('/tickets/${ticketId}/timer/manual', { method: 'POST', body: JSON.stringify({ minutes, description }) })`.
3. `ManualEntryForm.tsx` — a compact form: duration text input (uses `parseDuration` to convert → minutes; shows error if unparseable), optional description input, "Log" button. On submit → `addManualEntry` mutation → invalidates `timerKeys.entries(ticketId)` (refresh the TimeLog). Validation: parsed minutes > 0, ≤ 1440.
4. `TimeLog.tsx` — add a "Manual" badge (gray pill) for entries with `type === 'manual'`. The total already includes manual durations (from the BE extension in T1).
5. `TicketDetailModal.tsx` — render `<ManualEntryForm ticketId={ticketId} />` between `TimeLog` and the edit form (or above TimeLog). Gated on `!ticket.deletedAt`.

**Acceptance Criteria:**
- [ ] `ManualEntryForm` parses duration via `parseDuration` + validates.
- [ ] Submit creates a manual entry + the TimeLog refreshes (invalidation).
- [ ] `TimeLog` shows a "Manual" badge for manual entries.
- [ ] The total includes manual durations.
- [ ] `rtk tsc` (FE) + `rtk vitest run` (FE) pass.

### T4 — Integration verification

**Batch:** 3 · **Depends on:** T3

Run typecheck/lint/format/test/build. Live smoke: log `2h 30m` manually → entry appears in TimeLog with "Manual" badge + total updates. Timer entries still show without badge. Validation: `0` → error; `abc` → error; `25h` → error (>1440 min).

---

## 7. Final F21 Acceptance Checklist

- [ ] `POST /api/tickets/:ticketId/timer/manual` creates a manual entry (`manual_entry_minutes` set, `start_time`/`end_time` null).
- [ ] Duration input supports `2h 30m` / `90m` / `1.5h` parsing + validation (1-1440 min).
- [ ] Manual entries visually distinguishable in TimeLog ("Manual" badge).
- [ ] TimeLog total includes manual durations.
- [ ] Optional description stored + displayed.
- [ ] All tests pass (Vitest BE + FE); typecheck/lint/format/build green.
- [ ] No schema/migration (columns already exist from F20).

---

## 8. Schema deltas owned by this feature

**F21 owns NONE.** The `manual_entry_minutes` + `description` columns already exist on `TimeEntries` (F20 §9 #6 "include now, nullable" — added in migration 0010). No migration, no schema change.

---

## 9. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-24)

1. **Storage shape** — manual entry = `manual_entry_minutes` set + `start_time`/`end_time` null. Distinguishable via computed `type` field. CONFIRMED.
2. **Duration parsing** — `2h 30m` / `90m` / `1.5h` / bare minutes. Regex-based pure util. CONFIRMED.
3. **Date attribution** — use `created_at` (today). No separate "worked on" date for MVP. F23 can filter by `created_at`. CONFIRMED.
4. **Validation** — minutes 1-1440 (24h cap per entry). Reject 0/negative/over-cap. CONFIRMED.
5. **Route** — `POST /:ticketId/timer/manual` (nested under ticketsRouter, consistent with start/stop). CONFIRMED.
6. **TimeLog distinction** — "Manual" badge (gray pill) for manual entries. Timer entries unchanged. CONFIRMED.

---

**Sources:**
- PRD REQ-4.4 ("Users must be able to manually add time logs to a ticket (e.g., 'Logged 2h 30m for research').").
- PRD §8.4 (`TimeEntries` schema — `manual_entry_minutes` Integer nullable, `description` String nullable).
- F20 task doc (`F20-server-authoritative-timer-tasks.md` §9 #6: "include `manual_entry_minutes` + `description` columns now, nullable").
- Grounding: `backend/src/db/schema.ts` (timeEntries table); `backend/src/services/timerService.ts` (getTimeEntries); `backend/src/routes/tickets.routes.ts` (timer routes); `frontend/src/components/TimeLog.tsx`; `frontend/src/components/TicketDetailModal.tsx`.
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
