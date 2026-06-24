# F22 — Time log list per ticket: Plan + Task Breakdown

> **Feature:** F22 — Time log list per ticket (Phase 5 — Time Tracking)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F20 (DONE ✅) · **PRD ref:** §8.4
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F20](../F20-server-authoritative-timer/F20-server-authoritative-timer-tasks.md)

---

## 1. F22 Recap

**Goal:** See all time logged against a ticket — including who tracked it.

**Ships:** Ticket modal shows every time entry (who, duration, type, note, time). Shows total time on the ticket.

**~90% already shipped via F20 + F21.** The `TimeLog` component (`frontend/src/components/TimeLog.tsx`) already renders: entries reverse-chrono, durations (timer + manual), Manual badge, descriptions, total. The `GET /api/tickets/:ticketId/timer/entries` endpoint returns all entries with computed durations + total.

**The only gap: "who"** — entries don't show the user name/avatar. The `TimeEntries` table has `userId` but `getTimeEntries` doesn't resolve it to a name. F22 closes this gap by joining `users` in the backend + rendering the name in TimeLog.

**Acceptance (definition of done):**
- Each TimeLog entry shows **who** tracked it (user name or "Unknown user" for deleted users).
- Timer + manual entries both show the tracker.
- Total + durations + type + note — all already shipped (F20/F21).
- Long-running open entry shown as "Running" — already shipped.

**Edge cases:**
- Names of since-removed users must render gracefully → "Unknown user" (FK `ON DELETE SET NULL` on `timeEntries.userId` → null → fallback).
- Permissions: can members see others' entries? PRD implies yes for reports — confirm + apply (already open: all entries visible via `GET /timer/entries`; no per-user filtering).

---

## 2. Codebase Analysis Summary

- **State:** F20 (DONE ✅) ships TimeLog + getTimeEntries. F21 (DONE ✅) ships manual entries + Manual badge. The ONLY missing piece: user name resolution.
- **Existing structure (citations):**
  - `timerService.getTimeEntries(ticketId)` (`timerService.ts:143-178`) — selects `{ id, startTime, endTime, manualEntryMinutes, description }` from `timeEntries`. Does NOT join `users`. The `userId` column exists on the table but isn't in the select or the response.
  - `TimeLog.tsx` — renders entries with Start/End (or "Logged:" for manual) + duration + badge. No user name/avatar.
  - The F19 activity-feed pattern (`activityService.ts`) already resolves actors via `leftJoin(users)` — F22 mirrors this pattern for TimeEntries.
- **Files F22 modifies:**
  - `backend/src/services/timerService.ts` — extend `getTimeEntries` select to leftJoin `users` + add `user: { id, fullName, avatarUrl } | null` to each entry.
  - `frontend/src/types/timer.ts` — add `user` field to `TimeEntryWithDuration`.
  - `frontend/src/components/TimeLog.tsx` — render the user name next to each entry.
- **Schema delta: NONE.** `timeEntries.userId` FK→Users `ON DELETE SET NULL` already exists (`schema.ts`). No migration.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | User resolution | **Backend leftJoin `users`** in `getTimeEntries` — mirror the F19 activity-feed actor pattern (`activityService.ts` leftJoin `users` for actor). Returns `user: { id, fullName, avatarUrl } \| null` per entry. | Repo convention: "backend hydrates, FE renders" (labels/boardService, creator/getTicket, actor/activityService). Null user = "Unknown user" (FK SET NULL). |
| D2 | Permissions | All entries visible (no per-user filtering). PRD implies members see all time entries (for reports F23). Already open today. | PRD §8.4 + F22 edge case: "can members see others' entries? PRD implies yes." |
| D3 | Schema delta | NONE. `userId` FK already exists. | F20 migration 0010. |
| D4 | Manual entries | Manual entries also show the tracker (the user who logged the manual time). | The `userId` is set from `req.user!.id` in `addManualEntry` (F21). |

---

## 4. Architecture Overview

```
backend/src/services/timerService.ts    # MODIFY — getTimeEntries leftJoin users + user field in response
frontend/src/types/timer.ts             # MODIFY — add user field to TimeEntryWithDuration
frontend/src/components/TimeLog.tsx     # MODIFY — render user name per entry
```

---

## 5. Tasks

### T1 — Backend: extend getTimeEntries with user resolution

**Batch:** 1 · **Depends on:** F20/F21 (DONE)

**Description:**
1. In `timerService.ts` `getTimeEntries`: add a `leftJoin(users, eq(users.id, timeEntries.userId))` to the query. Add to the select: `userId: users.id, userFullName: users.fullName, userAvatarUrl: users.avatarUrl`.
2. In the `entries.map(...)`: add a `user` field:
   ```typescript
   user: r.userId === null ? null : {
       id: r.userId,
       fullName: r.userFullName ?? 'Unknown user',
       avatarUrl: r.userAvatarUrl,
   }
   ```
3. Add `user: { id: string; fullName: string; avatarUrl: string | null } | null` to the `TimeEntryWithDuration` interface.

**Acceptance:**
- [ ] `getTimeEntries` leftJoins `users`; returns `user` per entry (null for deleted user).
- [ ] `TimeEntryWithDuration` has the `user` field.
- [ ] `rtk tsc` (BE) + `rtk vitest run` (BE) pass.

### T2 — FE: show user name in TimeLog

**Batch:** 2 · **Depends on:** T1

**Description:**
1. `frontend/src/types/timer.ts` — add `user` field to `TimeEntryWithDuration` (mirror the BE type).
2. `frontend/src/components/TimeLog.tsx` — for each entry, render the user name (or "Unknown user") + optional avatar (small img or initial). Show alongside the existing Start/End/Logged/duration layout.

**Acceptance:**
- [ ] Each TimeLog entry shows the tracker's name (or "Unknown user").
- [ ] Deleted user (null) → "Unknown user".
- [ ] `rtk tsc` (FE) + `rtk vitest run` (FE) pass.

### T3 — Verification

**Batch:** 3 · **Depends on:** T2

Typecheck/lint/format/test/build green. Live smoke: entries show who tracked them.

---

## 6. Final Acceptance Checklist

- [ ] Each TimeLog entry shows **who** tracked it (user name or "Unknown user").
- [ ] Timer + manual entries both show the tracker.
- [ ] Deleted user → "Unknown user" (FK SET NULL).
- [ ] All existing TimeLog features still work (durations, total, Manual badge, Start/End, Logged).
- [ ] All tests pass; typecheck/lint/format/build green.
- [ ] No schema/migration.

---

## 7. Schema deltas owned by this feature

**F22 owns NONE.** `timeEntries.userId` FK→Users `ON DELETE SET NULL` already exists (F20 migration 0010). No migration, no schema change.

---

## 8. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-24)

1. **User resolution:** backend leftJoin `users` (mirror F19 activity-feed pattern). CONFIRMED.
2. **Permissions:** all entries visible (no per-user filtering). CONFIRMED.
3. **No schema delta.** CONFIRMED.

---

**Sources:**
- PRD §8.4 (`TimeEntries` schema).
- F20 task doc (`F20-server-authoritative-timer-tasks.md` — TimeEntries table + getTimeEntries).
- F21 task doc (`F21-manual-time-entry-tasks.md` — addManualEntry + Manual badge).
- F19 activity-feed pattern (`activityService.ts` — leftJoin users for actor).
- Grounding: `backend/src/services/timerService.ts:143-178`; `frontend/src/components/TimeLog.tsx`; `frontend/src/types/timer.ts`.
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
