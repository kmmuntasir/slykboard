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
  return { db };
});

import { timeEntries } from '../db/schema';
import { stopTimersForProject } from './timerService';

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
