import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock wiring ------------------------------------------------------------
//
// vi.mock is hoisted above all imports, so any binding it closes over must be
// created via vi.hoisted (also hoisted). We hold the mutable terminal fns and
// capture vars in one hoisted bag; the factory builds the fluent mock objects
// from it, and tests read/reset the same references.
//
// stopTimersForProject issues ONE statement on the caller's tx:
//   tx.update(timeEntries).set({ endTime }).where(and(isNull(...), inArray(ticketId, sub)))
// where the IN-subquery is:
//   db.select({ id: tickets.id }).from(tickets).where(eq(tickets.projectId, projectId))
//
// The tx is supplied by the test (it models the caller's transaction); the
// subquery's `db` is the mocked module. The subquery's terminal is `.where()`,
// whose return value is fed verbatim into the real `inArray` (drizzle-orm is
// NOT mocked) — so it only needs to be some opaque value, not a Promise.

const bag = vi.hoisted(() => ({
  // tx.update(timeEntries).set(...).where(...) terminal
  txUpdateWhere: vi.fn(),
  txUpdateSetArg: {} as Record<string, unknown>,
  txUpdateTarget: null as unknown,
  txUpdateCallCount: 0,
  // db.select({ id }).from(tickets).where(...) terminal
  dbSelectWhere: vi.fn(),
  dbSelectFromArg: null as unknown,
  dbSelectCallCount: 0,
}));

// Separate hoisted bag for the startTimer transaction. startTimer drives its
// own internal tx through `db.transaction(async tx => ...)`, so the terminals
// below live on a distinct mock tx object (not the caller-supplied tx used by
// stopTimersForProject). Keeping the bags separate means the existing two
// stopTimersForProject tests stay UNMODIFIED and green.
//
// startTimer issues three statements on its tx:
//   (a) tx.update(timeEntries).set({ endTime }).where(...).returning()  // auto-stop
//   (b) tx.select({ id }).from(tickets).where(...).limit(1)             // existence
//   (c) tx.insert(timeEntries).values({...}).returning()               // new entry
const startBag = vi.hoisted(() => ({
  // (a) auto-stop update terminal `.returning()` — resolves to the stopped
  // rows array (one row when a prior timer existed, empty when none).
  autoStopReturning: vi.fn(),
  autoStopSetArg: {} as Record<string, unknown>,
  autoStopTarget: null as unknown,
  // (b) ticket existence `.limit(1)` terminal — resolves to rows array.
  ticketLimit: vi.fn(),
  // (c) insert `.returning()` terminal — resolves to the inserted rows array.
  insertReturning: vi.fn(),
  insertValues: null as unknown,
  insertTarget: null as unknown,
  insertCallCount: 0,
  // The startTx mock object handed to the transaction callback.
  startTx: null as unknown,
}));

vi.mock('../db/client', () => {
  const db = {
    // subquery: db.select({ id: tickets.id }).from(tickets).where(...)
    select: vi.fn(() => {
      const chain = {
        from: (f: unknown) => {
          bag.dbSelectFromArg = f;
          bag.dbSelectCallCount += 1;
          return { where: () => bag.dbSelectWhere() };
        },
      };
      return chain;
    }),
  };

  // startTimer opens its own transaction and runs auto-stop + existence check
  // + insert on the tx. Build the mock tx once and hand it to the callback so
  // tests can wire each terminal independently per-case.
  const startTx = {
    // (a) auto-stop: tx.update(timeEntries).set(...).where(...).returning()
    update: vi.fn((table: unknown) => {
      startBag.autoStopTarget = table;
      return {
        set: (v: Record<string, unknown>) => {
          startBag.autoStopSetArg = v;
          return { where: () => ({ returning: () => startBag.autoStopReturning() }) };
        },
      };
    }),
    // (b) existence: tx.select({ id }).from(tickets).where(...).limit(1)
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ limit: () => startBag.ticketLimit() }) }),
    })),
    // (c) insert: tx.insert(timeEntries).values({...}).returning()
    insert: vi.fn((table: unknown) => {
      startBag.insertTarget = table;
      startBag.insertCallCount += 1;
      return {
        values: (v: unknown) => {
          startBag.insertValues = v;
          return { returning: () => startBag.insertReturning() };
        },
      };
    }),
  };
  startBag.startTx = startTx;

  (db as Record<string, unknown>).transaction = vi.fn(
    async (cb: (tx: typeof startTx) => unknown) => cb(startTx),
  );

  return { db };
});

import { timeEntries } from '../db/schema';
import { startTimer, stopTimersForProject } from './timerService';

// Build a fluent tx mock matching the caller's transaction client surface.
// Mirrors the chained-method style used by projectService.test.ts.
function makeTx(): {
  update: ReturnType<typeof vi.fn>;
} {
  const tx = {
    update: vi.fn((table: unknown) => {
      bag.txUpdateTarget = table;
      bag.txUpdateCallCount += 1;
      return {
        set: (v: Record<string, unknown>) => {
          bag.txUpdateSetArg = v;
          return { where: () => bag.txUpdateWhere() };
        },
      };
    }),
  };
  return tx;
}

function resetBag() {
  bag.txUpdateWhere.mockReset();
  bag.txUpdateSetArg = {};
  bag.txUpdateTarget = null;
  bag.txUpdateCallCount = 0;
  bag.dbSelectWhere.mockReset();
  bag.dbSelectFromArg = null;
  bag.dbSelectCallCount = 0;
}

function resetStartBag() {
  startBag.autoStopReturning.mockReset();
  startBag.autoStopSetArg = {};
  startBag.autoStopTarget = null;
  startBag.ticketLimit.mockReset();
  startBag.insertReturning.mockReset();
  startBag.insertValues = null;
  startBag.insertTarget = null;
  startBag.insertCallCount = 0;
}

describe('stopTimersForProject', () => {
  beforeEach(resetBag);

  it('issues a single UPDATE on timeEntries, setting only endTime, and resolves undefined', async () => {
    bag.txUpdateWhere.mockResolvedValueOnce(undefined);
    const tx = makeTx();

    const result = await stopTimersForProject(
      tx as unknown as Parameters<typeof stopTimersForProject>[0],
      'proj-1',
    );

    // Resolves to undefined (void).
    expect(result).toBeUndefined();

    // A single UPDATE was issued against the timeEntries table.
    expect(bag.txUpdateCallCount).toBe(1);
    expect(bag.txUpdateTarget).toBe(timeEntries);

    // Only endTime is set, and it is a Date instance.
    expect(bag.txUpdateSetArg).toEqual({ endTime: expect.any(Date) });
    expect(Object.keys(bag.txUpdateSetArg)).toEqual(['endTime']);

    // The UPDATE's terminal `.where()` is invoked exactly once.
    expect(bag.txUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it('emits the project tickets via a single IN-subquery (no per-ticket loop)', async () => {
    bag.txUpdateWhere.mockResolvedValueOnce(undefined);
    const tx = makeTx();

    await stopTimersForProject(
      tx as unknown as Parameters<typeof stopTimersForProject>[0],
      'proj-99',
    );

    // Exactly one subquery statement — independent of how many open timers
    // exist; the IN-subquery fans the project's N tickets out in SQL, not in app code.
    expect(bag.dbSelectCallCount).toBe(1);
    expect(bag.txUpdateCallCount).toBe(1);
    expect(bag.dbSelectWhere).toHaveBeenCalledTimes(1);
  });
});

describe('startTimer', () => {
  beforeEach(resetStartBag);

  it('returns the prior open timer as autoStoppedEntry (with its cross-ticket id) when one exists', async () => {
    // (a) auto-stop returns the single stopped row — it belongs to a DIFFERENT
    // ticket than the one we are starting, modelling the global per-user auto-stop.
    const stoppedRow = {
      id: 'te-old',
      ticketId: 'ticket-other',
      userId: 'user-1',
      startTime: new Date(1_700_000_000_000),
      endTime: null,
      manualEntryMinutes: null,
      description: null,
    };
    startBag.autoStopReturning.mockResolvedValueOnce([stoppedRow]);
    // (b) the new ticket exists.
    startBag.ticketLimit.mockResolvedValueOnce([{ id: 'ticket-1' }]);
    // (c) the new open timer row.
    const insertedRow = {
      id: 'te-new',
      ticketId: 'ticket-1',
      userId: 'user-1',
      startTime: new Date(1_700_000_001_000),
      endTime: null,
      manualEntryMinutes: null,
      description: null,
    };
    startBag.insertReturning.mockResolvedValueOnce([insertedRow]);

    const result = await startTimer({ ticketId: 'ticket-1', userId: 'user-1' });

    // autoStoppedEntry carries the cross-ticket row, including its ticketId.
    expect(result.autoStoppedEntry).toEqual(stoppedRow);
    expect(result.autoStoppedEntry?.ticketId).toBe('ticket-other');

    // The new entry is the inserted row.
    expect(result.entry).toEqual(insertedRow);

    // serverNow is an ISO string baseline captured post-commit.
    expect(result.serverNow).toEqual(expect.any(String));
    expect(new Date(result.serverNow).toString()).not.toBe('Invalid Date');

    // The auto-stop UPDATE targeted timeEntries and set only endTime (a Date).
    expect(startBag.autoStopTarget).toBe(timeEntries);
    expect(startBag.autoStopSetArg).toEqual({ endTime: expect.any(Date) });
    expect(Object.keys(startBag.autoStopSetArg)).toEqual(['endTime']);

    // Exactly one auto-stop attempt and one insert.
    expect(startBag.autoStopReturning).toHaveBeenCalledTimes(1);
    expect(startBag.insertCallCount).toBe(1);
    expect(startBag.insertTarget).toBe(timeEntries);
  });

  it('returns autoStoppedEntry === null when no prior open timer exists (auto-stop still attempted once)', async () => {
    // (a) auto-stop finds no open row — returns an empty array.
    startBag.autoStopReturning.mockResolvedValueOnce([]);
    // (b) the new ticket exists.
    startBag.ticketLimit.mockResolvedValueOnce([{ id: 'ticket-1' }]);
    // (c) the new open timer row.
    const insertedRow = {
      id: 'te-new',
      ticketId: 'ticket-1',
      userId: 'user-1',
      startTime: new Date(1_700_000_002_000),
      endTime: null,
      manualEntryMinutes: null,
      description: null,
    };
    startBag.insertReturning.mockResolvedValueOnce([insertedRow]);

    const result = await startTimer({ ticketId: 'ticket-1', userId: 'user-1' });

    // No prior timer → null, not undefined.
    expect(result.autoStoppedEntry).toBeNull();

    // The new entry is still returned.
    expect(result.entry).toEqual(insertedRow);

    // Exactly ONE auto-stop UPDATE was attempted (it simply matched no row).
    expect(startBag.autoStopReturning).toHaveBeenCalledTimes(1);
    expect(startBag.autoStopTarget).toBe(timeEntries);
    expect(startBag.insertCallCount).toBe(1);
  });
});
