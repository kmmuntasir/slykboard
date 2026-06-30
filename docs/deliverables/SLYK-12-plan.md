# Implementation Plan — SLYK-12

**Ticket:** `docs/deliverables/SLYK-12.md`
**Type:** Bug
**Title:** Timer Stale Update on Start/Stop (history list doesn't refresh until reopen)
**Generated:** 2026-06-30

---

## Summary

When a timer is running on a ticket, the time-tracking history list renders the
open entry as "End: Running". Clicking **Stop** updates the active-timer cache but
the history list does not reflect the new `endTime` until the modal is closed and
reopened. Symmetrically, clicking **Start** inserts a new entry server-side, but it
does not appear in the history list until reopen.

The history list is fed by a **per-ticket time-entries** TanStack Query
(`timerKeys.entries(ticketId)`), but the start/stop mutation hooks in
`useTimer.ts` invalidate **only** the active-timer query (`timerKeys.active()`).
Nothing ever refetches the time-entries cache, so it stays stale until the
component unmounts/remounts.

The fix is to invalidate the affected ticket(s)' `timerKeys.entries(id)` cache on
both start and stop. Because starting a timer auto-stops a prior timer that may be
on a **different** ticket, the frontend must learn which prior ticket was
auto-stopped. The backend currently discards that information (it auto-stops via an
UPDATE without `.returning()`), so a small backend + types change is required to
surface the auto-stopped entry, and the hooks must read the mutation response to
invalidate both tickets' histories.

## Root Cause

1. **Both timer mutations invalidate only the active-timer cache.**
   `frontend/src/hooks/useTimer.ts:17-20` (start) and `:24-27` (stop):
   ```ts
   // start
   onSuccess: () => {
     queryClient.invalidateQueries({ queryKey: timerKeys.active() });
   },
   // stop
   onSuccess: () => {
     queryClient.invalidateQueries({ queryKey: timerKeys.active() });
   },
   ```
   The `onSuccess` callbacks ignore the response `data` arg entirely.

2. **The history list reads a different cache key that is never invalidated.**
   The per-ticket time-entries query is keyed by `timerKeys.entries(id)`
   (`frontend/src/api/queryKeys.ts:31-35`):
   ```ts
   export const timerKeys = {
     all: ['timer'] as const,
     active: () => [...timerKeys.all, 'active'] as const,
     entries: (id: string) => [...timerKeys.all, 'entries', id] as const,
   };
   ```
   The history list subscribes to `timerKeys.entries(ticketId)`; since neither
   mutation invalidates it, the list shows stale data until remount.

3. **The frontend cannot today know which prior ticket was auto-stopped.**
   - `backend/src/services/timerService.ts:46-49` auto-stops the user's prior open
     timer via an `UPDATE ... WHERE endTime IS NULL` **without `.returning()`** —
     the closed prior row is discarded:
     ```ts
     // (a) Auto-stop the user's prior open timer (user-scoped, global — any ticket).
     await tx
       .update(timeEntries)
       .set({ endTime: new Date() })
       .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)));
     ```
   - The service return type is `{ entry: TimeEntry; serverNow: string }`
     (`timerService.ts:31`) — only the newly inserted row.
   - The route passes that through unchanged
     (`backend/src/routes/tickets.routes.ts:144-152`), and the frontend type
     `StartTimerResponse` mirrors it (`frontend/src/types/timer.ts:8-10`):
     ```ts
     export interface StartTimerResponse {
       entry: TimeEntry;
       serverNow: string;
     }
     ```
   So there is no end-to-end path for the prior ticketId to reach the hook. The
   fix must add one.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Frontend hook | `frontend/src/hooks/useTimer.ts` | Add per-ticket `timerKeys.entries(id)` invalidation on both start & stop; read response data for prior-ticket id. |
| Frontend types | `frontend/src/types/timer.ts` | Extend `StartTimerResponse` with the auto-stopped prior entry/ticketId. |
| Backend service | `backend/src/services/timerService.ts` | Capture the auto-stopped prior row via `.returning()` and return it. |
| Backend route | `backend/src/routes/tickets.routes.ts` | Pass the new field through in the start response envelope. |
| Frontend tests | `frontend/src/hooks/useTimer.test.ts` (new) | Cover the new invalidation behavior (no test exists today). |
| Reference (no edit) | `frontend/src/api/queryKeys.ts:31-35` | `timerKeys.entries(id)` already exists — reuse as-is. |
| Reference (no edit) | `frontend/src/hooks/useUpdateTicket.ts:62-64` | Gold-standard multi-key invalidation pattern to mirror. |

## Proposed Implementation

### Backend Changes

#### 1. Capture and return the auto-stopped prior entry from `startTimer`

- **File:** `backend/src/services/timerService.ts`
- **What:** In `startTimer` (transaction `:28-61`), change the auto-stop UPDATE to
  use `.returning()` and capture the prior row. Add it to the service's return
  value under a new field, e.g. `autoStoppedEntry: TimeEntry | null`.
- **Why:** The hook needs the prior ticket's id to invalidate that ticket's
  time-entries cache. Today the prior row is discarded, so the information is
  unreachable client-side.
- **Code reference:** Build on the existing auto-stop statement at
  `timerService.ts:46-49`. The returned row's shape matches the existing
  `TimeEntry` already inserted in step (b); `.returning()` on a Drizzle update
  returns the updated row(s). Since the WHERE is `userId + endTime IS NULL`, at
  most one row is returned; default to `null` when none.
  ```ts
  const [stopped] = await tx
    .update(timeEntries)
    .set({ endTime: new Date() })
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
    .returning();
  // ...after inserting the new entry...
  return { entry, serverNow, autoStoppedEntry: stopped ?? null };
  ```
  (Mirror the existing return shape at `timerService.ts:31`; keep `stopTimer`
  unchanged — it already operates on the known ticket and returns the closed
  entry.)

#### 2. Surface the new field in the start route envelope

- **File:** `backend/src/routes/tickets.routes.ts`
- **What:** At the `POST /tickets/:id/timer/start` handler (`:144-152`), pass
  `autoStoppedEntry` through in the JSON response alongside `entry` and
  `serverNow`.
- **Why:** The route is the API contract boundary; the service's new field must
  reach the client without being dropped.
- **Code reference:** The current handler spreads/returns the service result; keep
  that passthrough — only ensure the object isn't narrowed.

### Frontend Changes

#### 3. Extend `StartTimerResponse` with the auto-stopped entry

- **File:** `frontend/src/types/timer.ts`
- **What:** Add an optional `autoStoppedEntry` to `StartTimerResponse`
  (`:8-10`):
  ```ts
  export interface StartTimerResponse {
    entry: TimeEntry;
    serverNow: string;
    autoStoppedEntry?: TimeEntry | null;
  }
  ```
- **Why:** Type-safety for the hook reading the prior ticketId from the start
  response. Optional so the field is forward/backward-compatible.
- **Code reference:** `TimeEntry` already includes `ticketId`
  (`frontend/src/types/timer.ts`), so `autoStoppedEntry?.ticketId` is the prior
  ticket.

#### 4. Invalidate per-ticket time-entries cache in both mutations

- **File:** `frontend/src/hooks/useTimer.ts`
- **What:** Update the `onSuccess` handlers to invalidate the per-ticket
  `timerKeys.entries(id)` cache in addition to `timerKeys.active()`:
  - **start** (`:17-20`): receive `data` and invalidate
    `timerKeys.entries(ticketId)` (the started ticket) **and**, if
    `data.autoStoppedEntry` exists and its `ticketId !== ticketId`, invalidate
    `timerKeys.entries(data.autoStoppedEntry.ticketId)` (the auto-stopped prior
    ticket on another ticket).
  - **stop** (`:24-27`): invalidate `timerKeys.entries(ticketId)` (the stopped
    ticket) in addition to `timerKeys.active()`.
- **Why:** This is the core fix — the history list reads
  `timerKeys.entries(ticketId)`, which must be invalidated to refetch.
- **Code reference:** Mirror the multi-key, per-id convention from
  `frontend/src/hooks/useUpdateTicket.ts:62-64`
  (separate `invalidateQueries` call per key, scoped keys named explicitly from
  vars/response). Reuse the existing `timerKeys.entries(id)` factory
  (`api/queryKeys.ts:31-35`) — no new factory entry needed. Example:
  ```ts
  const startMutation = useMutation({
    mutationFn: () => startTimer(ticketId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
      queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
      const priorId = data.autoStoppedEntry?.ticketId;
      if (priorId && priorId !== ticketId) {
        queryClient.invalidateQueries({ queryKey: timerKeys.entries(priorId) });
      }
    },
  });
  const stopMutation = useMutation({
    mutationFn: () => stopTimer(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
      queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
    },
  });
  ```
  Note the active-timer display and elapsed readout already depend on
  `timerKeys.active()` (kept invalidated) and remain correct.

## Edge Cases & Risks

- **Cross-ticket auto-stop.** Starting a timer on ticket B that auto-stops a timer
  on ticket A must refresh **both** histories. Covered by the
  `data.autoStoppedEntry.ticketId` branch; the `priorId !== ticketId` guard avoids
  a redundant double-invalidate of the same key.
- **No prior timer running.** `autoStoppedEntry` is `null`/`undefined` → skip the
  prior-ticket invalidate. The started ticket's own history still refreshes.
- **Stop with no active timer.** If the backend permits a stop call with no running
  timer (returns null/empty), invalidating `timerKeys.entries(ticketId)` is still
  harmless (just refetches the same data).
- **Backend return-shape drift.** The route and service must both forward
  `autoStoppedEntry`; if only one side changes, the field silently disappears and
  cross-ticket history stays stale. Tests should pin both.
- **Frontend type optionality.** Keeping `autoStoppedEntry` optional means older
  clients/branches tolerate its absence, but the hook must guard with `?.` before
  reading `ticketId`.
- **Concurrency.** Two rapid starts could overlap; Drizzle's transactional
  auto-stop at `timerService.ts:46-49` already serializes the prior-row update, and
  `.returning()` returns exactly the row closed in this transaction — no extra
  race introduced.
- **Regression of active-timer display.** Keep `timerKeys.active()` invalidation in
  both handlers so the elapsed readout and "Running" state stay correct.
- **No query-key factory change.** Resist adding a `timeEntriesKeys` alias —
  `timerKeys.entries(id)` already exists and is what the history list uses;
  duplicating it would fragment the cache.

## Testing

*Follow project conventions — Vitest; co-locate `*.test.ts(x)` next to source;
`gcTime: 0` test harness; assert invalidation via
`vi.spyOn(queryClient, 'invalidateQueries')` with **factory-keyed** expectations,
one assertion per expected key (per `useUpdateTicket.test.ts:179-180` and
`useMoveTicket.test.ts:77-87`).*

- **Unit tests (frontend) — new `frontend/src/hooks/useTimer.test.ts`:**
  - `useStartTimer` invalidates `timerKeys.active()` AND
    `timerKeys.entries(startedTicketId)` on success.
  - `useStartTimer`, when the mocked `startTimer` response includes an
    `autoStoppedEntry` on a **different** ticket, additionally invalidates
    `timerKeys.entries(priorTicketId)`.
  - `useStartTimer` with `autoStoppedEntry: null` does NOT call invalidate for any
    other ticket.
  - `useStopTimer` invalidates `timerKeys.active()` AND
    `timerKeys.entries(stoppedTicketId)`.
  - Mock `@/api/timer` (`startTimer`/`stopTimer`) at module scope; use the
    canonical `createWrapper` + `newQueryClient` harness (`gcTime: 0`,
    `retry: false`); reference keys **via the factory**, never literals.
- **Unit tests (backend) — `timerService` start path:**
  - When a prior open timer exists on another ticket, `startTimer` returns
    `autoStoppedEntry` populated with the prior row (and its `ticketId`).
  - When no prior open timer exists, `autoStoppedEntry` is `null`.
  - Use the existing service test fixtures/transaction stub pattern from sibling
    service tests.
- **Integration / HTTP:** Optionally verify the `POST /tickets/:id/timer/start`
  response envelope includes `autoStoppedEntry` (supertest against the express
  app, stubbing the service if the suite avoids a live DB).
- **Manual verification:**
  1. Start a timer on ticket A → history shows the new "End: Running" entry
     immediately (no reopen).
  2. Click Stop on A → End field shows the stop timestamp immediately.
  3. With A running, open ticket B and click Start → A's history shows A's stop
     time, B's history shows B's new running entry, both without reopen.
  4. Active-timer pill and elapsed readout remain accurate across all three.

## Acceptance Criteria

- [ ] After clicking **Stop**, the entry's End field shows the stop timestamp
  immediately (no modal close/reopen).
- [ ] After clicking **Start**, the new running entry appears in the history list
  immediately.
- [ ] Starting a timer that auto-stops a timer on a **different** ticket updates
  **both** tickets' history lists immediately.
- [ ] Active-timer display and elapsed readout remain correct after the fix.
- [ ] `useTimer` is covered by a new co-located Vitest test asserting the
  multi-key invalidation (including the prior-ticket branch).
- [ ] Backend `startTimer` surfaces the auto-stopped prior entry in the response,
  and the route forwards it.

## Open Questions

- **Stop response enrichment?** This plan only enriches the **start** response
  (where the prior-ticket problem exists). If product wants the **stop** response
  to also return the closed entry explicitly, that is a trivial extension but is
  not required for the bug fix. Default: leave `stopTimer` as-is.
- **Partial-prefix invalidate?** Instead of naming `timerKeys.entries(id)`
  explicitly, one could `invalidateQueries({ queryKey: timerKeys.all })` to sweep
  all timer caches. The codebase convention is explicit per-key invalidation
  (see `useUpdateTicket.ts:62-64`), so this plan follows that. Confirm if a
  broader sweep is preferred.

## Out of Scope

- No changes to the active-timer query, the elapsed-time ticker, or the
  `TimerControls` component beyond what naturally refreshes from the kept
  `timerKeys.active()` invalidation.
- No schema/migration changes — the `timeEntries` table already stores everything
  needed; only the service return shape changes.
- No new query-key factory entries — `timerKeys.entries(id)` is reused.
- No backend `stopTimer` behavior changes (it already returns the closed entry and
  operates on the known ticket).
- No polling-interval changes.
