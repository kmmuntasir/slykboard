# Task Breakdown — SLYK-12

**Plan:** `docs/deliverables/SLYK-12-plan.md`
**Ticket:** SLYK-12 — Timer Stale Update on Start/Stop (history list doesn't refresh until reopen)
**Generated:** 2026-06-30

> Breakdown of the SLYK-12 plan into small, self-contained, independently-pickupable
> tasks. Each task touches a tightly-coupled set of files (minimal merge-conflict
> surface) with explicit dependencies. Verification summaries (Phase 1) and task
> drafts (Phase 2) were produced via isolated `analyst` delegations; this document
> is the merged, reconciled synthesis.

---

## Parallelization Strategy

### Batches (merge order)

```
  BATCH 1 (foundation, dependency-free, fully parallel)
  ┌──────────────────────────────────────────────────────────────┐
  │  T1  backend timerService: capture auto-stopped row via      │
  │        .returning() + add autoStoppedEntry to return shape   │
  │        file: backend/src/services/timerService.ts            │
  │                                                              │
  │  T2  frontend types: add optional autoStoppedEntry to        │
  │        StartTimerResponse                                     │
  │        file: frontend/src/types/timer.ts                     │
  │        (disjoint files → safe to run concurrently)           │
  └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  BATCH 2 (depends on Batch 1)
  ┌──────────────────────────────────────────────────────────────┐
  │  T3  backend route: surface autoStoppedEntry in the start    │
  │        response envelope (widen the narrowing destructure)   │
  │        file: backend/src/routes/tickets.routes.ts   [T1]     │
  │                                                              │
  │  T4  frontend hook: invalidate timerKeys.entries(ticketId)   │
  │        on start & stop + prior-ticket branch on start        │
  │        file: frontend/src/hooks/useTimer.ts         [T2]     │
  │        (disjoint files → safe to run concurrently)           │
  └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  BATCH 3 (test layer, depends on Batch 1/2)
  ┌──────────────────────────────────────────────────────────────┐
  │  T5  frontend tests: create useTimer.test.ts (4 cases)       │
  │        file: frontend/src/hooks/useTimer.test.ts    [T4]     │
  │                                                              │
  │  T6  backend tests: add startTimer cases to                  │
  │        timerService.test.ts (prior present / absent)         │
  │        file: backend/src/services/timerService.test.ts [T1]  │
  │        (different repo halves → safe to run concurrently)    │
  └──────────────────────────────────────────────────────────────┘
```

- **Legend:** `├──▶` = "must merge before". Within each batch, tasks are file-disjoint
  and conflict-free → parallel-safe.
- **Merge-order rule:** Batch 1 must fully merge before Batch 2 starts; Batch 2 must
  fully merge before Batch 3 starts. (T6 technically only needs T1, so it can begin
  once T1 lands; the batch grouping is the safe default.)
- **Repo merge policy:** Rebase-and-merge only. No squash, no merge commits.

### Summary Table

| #  | Batch | Target File | Dependencies | Can Parallel With |
|----|-------|-------------|--------------|-------------------|
| T1 | 1 | `backend/src/services/timerService.ts` | None | T2 |
| T2 | 1 | `frontend/src/types/timer.ts` | None | T1 |
| T3 | 2 | `backend/src/routes/tickets.routes.ts` | T1 | T4 |
| T4 | 2 | `frontend/src/hooks/useTimer.ts` | T2 | T3 |
| T5 | 3 | `frontend/src/hooks/useTimer.test.ts` (new) | T4 | T6 |
| T6 | 3 | `backend/src/services/timerService.test.ts` (extend) | T1 | T5 |

### Suggested Developer Assignment Tracks

- **Track A — Frontend** (T2 → T4 → T5): owns the client-side arc — extend the type,
  wire the multi-key `onSuccess(data)` invalidation, then write the co-located test.
  Single owner avoids the `autoStoppedEntry?.ticketId` guard seam.
- **Track B — Backend** (T1 → T3 → T6): owns the server-side arc — add `.returning()`
  to the auto-stop UPDATE, widen the route envelope, then extend the service test
  (carefully preserving the existing `stopTimersForProject` cases).
- **Track C — Integration verifier** (parallel, after A+B merge): runs the manual
  verification checklist from the plan (start on A → history refreshes; stop on A →
  End stamp appears; start on B with A running → both histories refresh). The only
  cross-track coordination point.

Tracks A and B are **fully conflict-free** — different directories, different test
files, no shared runtime types. They proceed simultaneously; the only hard ordering is
within each track.

---

## Verified Codebase Facts (Phase 1 analysis digest)

All file paths confirmed. Key ground truth used by the tasks below:

- **`backend/src/services/timerService.ts`** — `startTimer` owns its own
  `db.transaction(cb)` (`:28-69`); the auto-stop UPDATE (`:36-40`) has **no
  `.returning()`**; return type at `:31` is `Promise<{ entry: TimeEntry; serverNow:
  string }>`; `serverNow` is captured **post-commit** via the outer `.then`. `TimeEntry`
  is the table's `$inferSelect` (incl. `ticketId`). `stopTimer` returns a bare
  `TimeEntry` and is **out of scope** (leave as-is).
- **`backend/src/routes/tickets.routes.ts`** — `POST /:ticketId/timer/start` handler
  (`:145-155`) currently **narrows** via `const { entry, serverNow } = await
  timerService.startTimer(...)` then `res.json(success({ entry, serverNow }))`. This
  destructure **actively drops** any new field — the route change is *required*, not a
  no-op. `POST /:ticketId/timer/stop` (`:158-170`) unchanged.
- **`frontend/src/hooks/useTimer.ts`** — `useTimer(ticketId)` returns combined
  `{ start, stop, isStarting, isStopping }`; both `onSuccess` (`:17-20` start, `:24-27`
  stop) invalidate **only** `timerKeys.active()` and ignore the response `data` arg.
- **`frontend/src/types/timer.ts`** — `StartTimerResponse` (`:12-15`) = `{ entry;
  serverNow }`; `TimeEntry` includes `ticketId`. `StopTimerResponse` unchanged.
- **`frontend/src/api/queryKeys.ts`** — `timerKeys.entries(id)` already exists
  (`:43`); reused as-is — **no new factory entry**.
- **`frontend/src/api/timer.ts`** — `startTimer(ticketId): Promise<StartTimerResponse>`,
  `stopTimer(ticketId): Promise<StopTimerResponse>`.
- **Consumers:** `timerKeys.entries(id)` is read by `TimeLog.tsx` (history list) and
  invalidated by `ManualEntryForm.tsx`; `timerKeys.active()` is read by
  `TimerControls.tsx`. `TimeLog` infers "Running" purely from `entry.endTime === null`
  in the payload — **not** from the active query — so the `entries` cache MUST be
  invalidated to refresh the history after start/stop.
- **Canonical invalidation pattern:** `frontend/src/hooks/useUpdateTicket.ts:62-72`
  (separate `invalidateQueries` call per key, scoped keys from vars/response).
- **Canonical frontend test harness:** `frontend/src/hooks/useMoveTicket.test.ts:75-83`
  — `createWrapper(queryClient)` + `newQueryClient()` with `{ retry: false, gcTime: 0 }`;
  assert via `vi.spyOn(queryClient, 'invalidateQueries')` with **factory-keyed**
  expectations.
- **Canonical backend tx-test pattern:** `backend/src/services/projectService.test.ts`
  — `vi.hoisted` bag + `vi.mock('../db/client')` with
  `db.transaction = vi.fn(async cb => cb(tx))` and a hand-built `tx` exposing fluent
  chains. The existing `timerService.test.ts` covers only `stopTimersForProject`
  (caller-supplied tx; its mock exposes only `db.select`, no `db.transaction`) — the new
  `startTimer` tests must **coexist** without breaking it.
- **No** `frontend/src/hooks/useTimer.test.ts` exists today — must be created.

---

## Task T1 — Backend: capture the auto-stopped prior entry in `startTimer` via `.returning()` and add `autoStoppedEntry` to the return shape

**Batch:** 1 · **Files:** `backend/src/services/timerService.ts` · **Dependencies:** None

### Description

`startTimer` auto-stops the user's prior open timer inside its own transaction (step a,
`:36-40`) but the auto-stop `UPDATE` has **no `.returning()`**, so the closed prior row
is discarded and unreachable by the client. The frontend hook (T4) needs the prior
ticket's `id`/`ticketId` to invalidate that ticket's `timerKeys.entries(id)` history
cache when a cross-ticket auto-stop occurs. This task is the **sole backend code change
needed to open that path**: capture the prior row and thread it into the service's
return shape.

Exact change — single file `backend/src/services/timerService.ts`:

1. **Return type** (`:31`) — add the new field:
   ```ts
   }): Promise<{ entry: TimeEntry; serverNow: string; autoStoppedEntry: TimeEntry | null }> {
   ```
2. **Auto-stop UPDATE** (`:36-40`) — append `.returning()` and capture the row:
   ```ts
   const [stopped] = await tx
     .update(timeEntries)
     .set({ endTime: new Date() })
     .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
     .returning();
   ```
   The WHERE is `userId + endTime IS NULL`; the partial unique index
   (`time_entries_one_active`) guarantees at most one row, so `stopped` is either the
   single closed prior row or `undefined`.
3. **Transaction body return** (`:59`) — carry `stopped` out:
   ```ts
   const [inserted] = await tx
     .insert(timeEntries)
     .values({ userId, ticketId, startTime: new Date() })
     .returning();
   return { entry: inserted!, autoStoppedEntry: stopped ?? null };
   ```
4. **Post-commit `.then`** (`:69`) — forward the new field:
   ```ts
   .then(({ entry, autoStoppedEntry }) => ({
     entry,
     autoStoppedEntry,
     serverNow: new Date().toISOString(),
   }));
   ```
5. **`stopTimer` and all sibling functions — DO NOT TOUCH.**

Out of scope here: the route envelope (T3) and the test additions (T6).

### Subtasks

1. Extend the `startTimer` return type (`:31`) with `autoStoppedEntry: TimeEntry | null`.
2. Add `.returning()` to the auto-stop UPDATE (`:36-40`) and capture into `const [stopped]`.
3. Change the transaction body's return (`:59`) to `{ entry: inserted!, autoStoppedEntry: stopped ?? null }`.
4. Update the post-commit `.then` (`:69`) to forward `autoStoppedEntry`.
5. `cd backend && npm run build && npm test`.

### Acceptance Criteria

- [ ] `:31` return type is `{ entry: TimeEntry; serverNow: string; autoStoppedEntry: TimeEntry | null }`.
- [ ] The auto-stop UPDATE (`:36-40`) appends `.returning()` and captures the closed prior row into `stopped`.
- [ ] When a prior open timer exists, `startTimer` resolves with `autoStoppedEntry` populated (a full `TimeEntry` row including its `ticketId`).
- [ ] When no prior open timer exists, `autoStoppedEntry` is `null` (not `undefined`).
- [ ] `serverNow` still captured post-commit via the `.then` (semantics unchanged).
- [ ] `stopTimer`, `getActiveTimer`, `stopTimerForTicket`, `stopTimersForProject`, `getTimeEntries`, `addManualEntry` untouched.
- [ ] No other file modified.
- [ ] `cd backend && npm run build` passes.
- [ ] Existing `timerService` tests stay green (new field defaults to `null`; existing start-response assertions on `entry`/`serverNow` unaffected).

---

## Task T2 — Frontend types: add optional `autoStoppedEntry?: TimeEntry | null` to `StartTimerResponse`

**Batch:** 1 · **Files:** `frontend/src/types/timer.ts` · **Dependencies:** None

### Description

`StartTimerResponse` (`:12-15`) today mirrors only `{ entry; serverNow }`. Once T1 and
T3 surface `autoStoppedEntry`, the start mutation hook (T4) must read
`data.autoStoppedEntry?.ticketId` to invalidate the prior ticket's `timerKeys.entries(id)`
cache. This task adds the type-safety **now**, as a purely additive, optional field — no
runtime behavior changes, backward/forward-compatible.

Exact change — single file `frontend/src/types/timer.ts`:

```ts
export interface StartTimerResponse {
    entry: TimeEntry;
    serverNow: string;
    autoStoppedEntry?: TimeEntry | null;
}
```

Keep it **optional** (`?`) so the field tolerates absence while the route still strips it
(until T3 lands) and the hook must guard with `?.` before reading `ticketId`.

Out of scope: `StopTimerResponse` (`:17-20`, unchanged), `useTimer.ts`, `api/timer.ts`,
`queryKeys.ts`, and any component. No new query-key factory entry — reuse
`timerKeys.entries(id)` as-is.

### Subtasks

1. Add `autoStoppedEntry?: TimeEntry | null;` as the third member of `StartTimerResponse`.
2. `cd frontend && npx tsc --noEmit && npx prettier --check src/types/timer.ts`.

### Acceptance Criteria

- [ ] `:12-15` `StartTimerResponse` includes `autoStoppedEntry?: TimeEntry | null`.
- [ ] Field is **optional** (`?`) and typed `TimeEntry | null`.
- [ ] `StopTimerResponse` unchanged.
- [ ] No other file modified.
- [ ] `cd frontend && npx tsc --noEmit` passes (optional field — no consumer breakage).
- [ ] `cd frontend && npm test` passes.
- [ ] `npx prettier --check frontend/src/types/timer.ts` passes (4-space TS indent, `printWidth: 100`, single quotes, trailing commas).

---

## Task T3 — Backend route: surface `autoStoppedEntry` in the start response envelope

**Batch:** 2 · **Files:** `backend/src/routes/tickets.routes.ts` · **Dependencies:** T1

### Description

The `POST /:ticketId/timer/start` handler (`:145-155`) currently **narrows** the service
result via `const { entry, serverNow } = await timerService.startTimer(...)`, which
actively **drops** the `autoStoppedEntry` field produced by T1 before it reaches
`res.json(success({ entry, serverNow }))`. The route is the API contract boundary, so
this is the critical link making the prior ticketId reachable client-side.

Fix — prefer widening the destructure for explicitness (Option A):

```ts
// Option A (preferred): widen the destructure, forward explicitly
async (req, res) => {
  const { ticketId } = req.params as TicketIdParam;
  const { entry, serverNow, autoStoppedEntry } = await timerService.startTimer({
    ticketId,
    userId: req.user!.id,
  });
  res.json(success({ entry, serverNow, autoStoppedEntry }));
},
```

```ts
// Option B (alternative): spread the whole result so future additions flow through
async (req, res) => {
  const { ticketId } = req.params as TicketIdParam;
  const result = await timerService.startTimer({
    ticketId,
    userId: req.user!.id,
  });
  res.json(success(result));
},
```

Either way, `autoStoppedEntry` (`TimeEntry | null`, plain JSON-serializable) must reach
the response. The `POST /:ticketId/timer/stop` handler (`:158-170`) is **unchanged** —
T1 leaves `stopTimer` as-is.

### Acceptance Criteria

- [ ] `POST /:ticketId/timer/start` response JSON contains `autoStoppedEntry` (`TimeEntry | null`) alongside `entry` and `serverNow`.
- [ ] When no prior timer was running, `autoStoppedEntry` is `null` in the response (not omitted/`undefined`).
- [ ] When a prior timer was auto-stopped (incl. on a different ticket), `autoStoppedEntry` is the closed prior row (with its `ticketId`).
- [ ] `POST /:ticketId/timer/stop` response shape unchanged.
- [ ] No destructure in this file silently drops `autoStoppedEntry`.
- [ ] Route-level test (supertest, stubbing the service if the suite avoids a live DB) asserts the envelope includes `autoStoppedEntry` for both prior-present and prior-absent cases. *(Optional; can fold into the manual/integration check if supertest infra is heavy.)*

---

## Task T4 — Frontend hook: invalidate `timerKeys.entries(ticketId)` on start & stop, plus prior-ticket branch on start

**Batch:** 2 · **Files:** `frontend/src/hooks/useTimer.ts` · **Dependencies:** T2

### Description

Both mutation `onSuccess` callbacks (`:17-20` start, `:24-27` stop) invalidate **only**
`timerKeys.active()` and ignore the response `data` arg. The history list reads
`timerKeys.entries(ticketId)` (consumed by `TimeLog.tsx`, which infers "Running" purely
from `entry.endTime === null`), so the `entries` cache is never refreshed — the root
cause of the stale-history bug. Additionally, starting a timer auto-stops a prior timer
that may sit on a **different** ticket, so start's `onSuccess` must read
`data.autoStoppedEntry?.ticketId` (made available by T2) and invalidate that ticket's
history too.

Fix — mirror the canonical multi-key per-id pattern from `useUpdateTicket.ts:62-72`. Reuse
the existing `timerKeys.entries(id)` factory as-is:

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

The `priorId !== ticketId` guard avoids a redundant double-invalidate when the prior
timer happened to be on the same ticket. The `?.` guard tolerates `autoStoppedEntry`
being `null`/`undefined` (optional per T2). `timerKeys.active()` stays invalidated in
both handlers so the elapsed readout and "Running" pill remain correct.

### Acceptance Criteria

- [ ] `start`'s `onSuccess` receives `data` and invalidates `timerKeys.active()` **and** `timerKeys.entries(ticketId)`.
- [ ] When `data.autoStoppedEntry` exists and its `ticketId !== ticketId`, `start` additionally invalidates `timerKeys.entries(priorId)`.
- [ ] When `data.autoStoppedEntry` is `null`/`undefined`, no extra per-ticket invalidate fires beyond the started ticket.
- [ ] `stop`'s `onSuccess` invalidates `timerKeys.active()` **and** `timerKeys.entries(ticketId)`.
- [ ] `timerKeys.active()` invalidation retained in **both** handlers.
- [ ] No `timerKeys.all` sweep / no new query-key factory entry — per-key invalidation only.
- [ ] Hook still returns `{ start, stop, isStarting, isStopping }` (no public API change).
- [ ] New co-located `useTimer.test.ts` (T5) asserts each invalidation.

---

## Task T5 — Frontend tests: create `frontend/src/hooks/useTimer.test.ts`

**Batch:** 3 · **Files:** `frontend/src/hooks/useTimer.test.ts` (new) · **Dependencies:** T4

### Description

No test exists today. Create a co-located Vitest spec pinning the multi-key invalidation
introduced in T4: both mutations must invalidate `timerKeys.active()` **and** the
started/stopped ticket's `timerKeys.entries(id)`, and `start` must additionally
invalidate the prior ticket's entries when the response carries a cross-ticket
`autoStoppedEntry`.

Follow the canonical harness from `useMoveTicket.test.ts:75-83` exactly:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTimer } from '@/hooks/useTimer';
import { startTimer, stopTimer } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import type { StartTimerResponse, TimeEntry } from '@/types/timer';

vi.mock('@/api/timer');

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}
function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function makeEntry(ticketId: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'e-' + ticketId,
    ticketId,
    userId: 'u1',
    startTime: '2026-06-30T00:00:00.000Z',
    endTime: null,
    manualEntryMinutes: null,
    description: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}
```

Mock `@/api/timer` at module scope; resolve `startTimer`/`stopTimer` per-test via
`vi.mocked(...).mockResolvedValueOnce(...)`. Assert via
`vi.spyOn(queryClient, 'invalidateQueries')` referencing keys **through the factory**
(never literals):

```ts
const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.active() });
expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.entries('t1') });
```

> **Hook invocation note:** `useTimer` calls `useServerTime()` which issues its own
> query; under `gcTime:0, retry:false` it stays pending — no mock required (matching
> `useMoveTicket.test.ts`). If the suite logs unhandled fetch noise, add a no-op
> `vi.mock` for the server-time module; keep it out of the assertions.

### Test cases (4)

1. **start invalidates active + the started ticket's entries.** Mock `startTimer` to
   resolve `{ entry: makeEntry('t1'), serverNow, autoStoppedEntry: null }`. Render
   `useTimer('t1')`, `await act(() => result.current.start())`. Assert invalidate called
   with `timerKeys.active()` **and** `timerKeys.entries('t1')`.
2. **start with a cross-ticket `autoStoppedEntry` additionally invalidates the prior
   ticket's entries.** Mock resolve with `autoStoppedEntry: makeEntry('t1', { endTime:
   '…' })` (prior on `t1`, new on `t2`). Render `useTimer('t2')`, start. Assert invalidate
   called with `timerKeys.active()`, `timerKeys.entries('t2')`, **and**
   `timerKeys.entries('t1')`.
3. **start with `autoStoppedEntry: null` does NOT invalidate any other ticket.** Assert
   `timerKeys.entries('t1')` and `timerKeys.active()` invalidated, but **not**
   `timerKeys.entries('t2')` (`expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey:
   timerKeys.entries('t2') })`).
4. **stop invalidates active + the stopped ticket's entries.** Mock `stopTimer` to
   resolve `{ entry: makeEntry('t1', { endTime: '…' }), serverNow }`. Render
   `useTimer('t1')`, `await act(() => result.current.stop())`. Assert invalidate called
   with `timerKeys.active()` and `timerKeys.entries('t1')` — and no third `entries` call.

### Acceptance Criteria

- [ ] File `frontend/src/hooks/useTimer.test.ts` created, co-located with `useTimer.ts`.
- [ ] Harness matches `useMoveTicket.test.ts:75-83` (`createWrapper`/`newQueryClient`, `gcTime:0`, `retry:false`).
- [ ] `@/api/timer` mocked at module scope; `startTimer`/`stopTimer` resolved per-test.
- [ ] All invalidation assertions reference `timerKeys.active()` / `timerKeys.entries(id)` from the factory — no literal key arrays.
- [ ] All 4 cases above pass; `npm test -- frontend/src/hooks/useTimer.test.ts` green.
- [ ] No production file under `frontend/src/` modified by this task.

---

## Task T6 — Backend tests: add `startTimer` cases to `backend/src/services/timerService.test.ts`

**Batch:** 3 · **Files:** `backend/src/services/timerService.test.ts` (extend) · **Dependencies:** T1

### Description

The existing `timerService.test.ts` mocks `../db/client` with **only** `db.select` (to
drive `stopTimersForProject`'s IN-subquery). It defines **no** `db.transaction`, and its
`makeTx()` only implements `tx.update(...).set(...).where(...)` (terminal `.where()`) —
no `.returning()`, no `tx.select`, no `tx.insert`. `startTimer` owns its transaction, so
the new tests must **extend** the mock factory to add `db.transaction` **and** a richer
`startTx` — **without breaking** the two existing `stopTimersForProject` tests (they pass
their own tx and never touch `db.transaction`).

Follow the `projectService.test.ts` pattern: `vi.hoisted` bag + `vi.mock('../db/client')`
whose factory builds a `db` with `transaction: vi.fn(async (cb) => cb(tx))`. Extend the
bag with terminals for the start path:

```ts
const bag = vi.hoisted(() => ({
  // existing stopTimersForProject terminals (unchanged)
  txUpdateWhere: vi.fn(),
  txUpdateSetArg: {} as Record<string, unknown>,
  txUpdateTarget: null as unknown,
  txUpdateCallCount: 0,
  dbSelectWhere: vi.fn(),
  dbSelectFromArg: null as unknown,
  dbSelectCallCount: 0,
  // NEW — startTimer path
  txAutoStopReturning: vi.fn(),   // tx.update(timeEntries).set({endTime}).where(...).returning()
  txAutoStopSetArg: {} as Record<string, unknown>,
  txTicketSelectLimit: vi.fn(),   // tx.select({id}).from(tickets).where(...).limit(1)
  txInsertReturning: vi.fn(),     // tx.insert(timeEntries).values({...}).returning()
}));
```

The start-path tx routes by terminal:

```ts
const startTx = {
  update: vi.fn(() => ({
    set: (v) => { bag.txAutoStopSetArg = v; return { where: () => ({ returning: () => bag.txAutoStopReturning() }) }; },
  })),
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ limit: () => bag.txTicketSelectLimit() }) }),
  })),
  insert: vi.fn(() => ({
    values: () => ({ returning: () => bag.txInsertReturning() }),
  })),
};
db.transaction = vi.fn(async (cb) => cb(startTx));
```

> **Coexistence guard:** the existing `stopTimersForProject` tests pass their **own**
> `makeTx()` into the function and never call `db.transaction`, so adding
> `db.transaction` to the factory cannot affect them. Keep the existing `makeTx()`
> exactly as-is (terminal `.where()`). Extend `resetBag()` to reset the new terminals.

### Test cases (2)

1. **`startTimer` returns `autoStoppedEntry` populated when a prior open timer exists.**
   - `bag.txAutoStopReturning.mockResolvedValueOnce([priorRow])` where `priorRow = { id:
     'e-old', ticketId: 'tA', userId: 'u1', endTime: <Date>, … }`.
   - `bag.txTicketSelectLimit.mockResolvedValueOnce([{ id: 'tB' }])` (new ticket exists).
   - `bag.txInsertReturning.mockResolvedValueOnce([newRow])` (inserted open timer on `tB`).
   - Call `startTimer({ ticketId: 'tB', userId: 'u1' })`.
   - Assert result shape: `{ entry: newRow, serverNow: <ISO string>, autoStoppedEntry: priorRow }`.
   - Assert `autoStoppedEntry.ticketId === 'tA'` (the cross-ticket id the frontend needs).
   - Optionally assert the auto-stop set only `endTime`: `expect(bag.txAutoStopSetArg).toEqual({ endTime: expect.any(Date) })`.
2. **`startTimer` returns `autoStoppedEntry: null` when no prior open timer exists.**
   - `bag.txAutoStopReturning.mockResolvedValueOnce([])` (no row matched `endTime IS NULL`).
   - `bag.txTicketSelectLimit.mockResolvedValueOnce([{ id: 'tB' }])`.
   - `bag.txInsertReturning.mockResolvedValueOnce([newRow])`.
   - Assert `result.autoStoppedEntry === null` and `result.entry === newRow`.
   - Assert exactly one auto-stop UPDATE issued (`bag.txAutoStopReturning` called once).

### Acceptance Criteria

- [ ] Tests added to `backend/src/services/timerService.test.ts`; the 2 existing `stopTimersForProject` tests remain green **unmodified**.
- [ ] `vi.mock('../db/client')` factory extended with `db.transaction = vi.fn(async cb => cb(startTx))`.
- [ ] `startTx` implements the three chains with `.returning()` / `.limit()` terminals matching `timerService.ts:36-63`.
- [ ] Both cases assert the `autoStoppedEntry` field on the resolved service return value (populated vs `null`).
- [ ] `npm test -- backend/src/services/timerService.test.ts` green.
- [ ] No production file under `backend/src/services/` modified by this task (T1 shipped the code).
