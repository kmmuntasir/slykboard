import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-16 T6: co-located service-layer lock for reportService.
//
// Scope: lock the T3 contract — both getTimeReport and getTicketSummary REQUIRE
// projectId and must forward it into the ticket-scoped WHERE
// (eq(tickets.projectId, args.projectId)) so the project filter is never
// silently dropped. No HTTP/supertest, no live DB — the Drizzle `db` client is
// mocked at the edge and the real Drizzle operators (and/eq/gte/lt/...) build
// the actual SQL predicate objects, whose bound parameters we introspect.

const bag = vi.hoisted(() => ({
  // Result rows returned by the mocked db client.
  projectRow: [] as Array<Record<string, unknown>>, // projects.where().limit() — column lookup
  timeRows: [] as Array<Record<string, unknown>>, // timeEntries terminal where
  ticketRows: [] as Array<Record<string, unknown>>, // tickets terminal where
  // Captured { fromTable, predicate } for every .where() invocation, in order.
  // fromTable is the schema table object passed to .from() so we can attribute
  // a predicate to the tickets chain specifically.
  whereCalls: [] as Array<{ fromTable: unknown; predicate: unknown }>,
}));

vi.mock('../db/client', async () => {
  // Import the real schema table objects so fromTable identity matches what the
  // service passes to .from() (=== comparison works on the shared reference).
  const { timeEntries, tickets, projects } = await import('../db/schema');

  // One chainable builder per resolved `from` table. leftJoin is a no-op that
  // preserves the originating table. where() records the predicate and resolves
  // to the appropriate fixture rows for that table's terminal query:
  //   - projects  → { limit: () => Promise }  (column lookup, .limit(1) then awaited)
  //   - tickets   → Promise<rows>              (terminal where, awaited directly)
  //   - timeEntries → Promise<rows>            (terminal where, awaited directly)
  const makeChain = (fromTable: unknown): Record<string, (...a: unknown[]) => unknown> => {
    const chain: Record<string, (...a: unknown[]) => unknown> = {
      leftJoin: () => chain,
      where: (predicate: unknown) => {
        bag.whereCalls.push({ fromTable, predicate });
        if (fromTable === projects) {
          return { limit: () => Promise.resolve(bag.projectRow) };
        }
        if (fromTable === tickets) return Promise.resolve(bag.ticketRows);
        if (fromTable === timeEntries) return Promise.resolve(bag.timeRows);
        return Promise.resolve([]);
      },
    };
    return chain;
  };

  const db = {
    select: () => ({
      from: (table: unknown) => makeChain(table),
    }),
  };
  return { db };
});

import * as reportService from './reportService';

// Walk a Drizzle SQL predicate (and/eq/gte/lt/isNull/...) collecting every
// bound parameter value. Bound values surface as chunks carrying a `.value`
// field (e.g. eq(tickets.projectId, 'p1') exposes 'p1'). This lets us assert
// the projectId value is actually embedded in the WHERE predicate without
// rendering SQL through a dialect.
function collectBoundValues(sql: unknown): string[] {
  const out: string[] = [];
  const visit = (s: unknown) => {
    if (!s || typeof s !== 'object') return;
    const obj = s as Record<string, unknown>;
    if ('value' in obj) out.push(String(obj.value));
    const chunks = obj.queryChunks;
    if (Array.isArray(chunks)) for (const c of chunks) visit(c);
  };
  visit(sql);
  return out;
}

function resetBag() {
  bag.projectRow = [{ columns: [{ id: 'c-done' }] }];
  bag.timeRows = [];
  bag.ticketRows = [];
  bag.whereCalls = [];
}

describe('reportService projectId forwarding (SLYK-16 T3/T6)', () => {
  beforeEach(resetBag);

  // Table-driven: BOTH report functions must forward projectId into the
  // ticket-scoped WHERE. getTimeReport scopes via timeEntriesâtickets join;
  // getTicketSummary scopes directly on tickets. In neither case may the
  // eq(tickets.projectId, projectId) term be silently dropped.
  const CASES = [
    {
      name: 'getTimeReport',
      fn: (a: unknown) => reportService.getTimeReport(a as never),
      args: { period: 'weekly', offset: 0, projectId: 'p1' },
    },
    {
      name: 'getTicketSummary',
      fn: (a: unknown) => reportService.getTicketSummary(a as never),
      args: { period: 'weekly', offset: 0, projectId: 'p1' },
    },
  ] as const;

  it.each(CASES)(
    '$name forwards projectId into the ticket-scoped WHERE predicate',
    async ({ fn, args }) => {
      await fn(args);

      // At least one .where() ran, and its predicate is a real Drizzle SQL
      // object (defined, non-null) â the scoping filter is present, not dropped.
      expect(bag.whereCalls.length).toBeGreaterThan(0);
      for (const call of bag.whereCalls) {
        expect(call.predicate).toBeTruthy();
      }

      // The projectId value 'p1' must be embedded in at least one captured
      // predicate (the eq(tickets.projectId, 'p1') term).
      const forwarded = bag.whereCalls.some((c) =>
        collectBoundValues(c.predicate).includes('p1'),
      );
      expect(forwarded).toBe(true);
    },
  );

  it('getTicketSummary: the tickets-chain WHERE specifically carries projectId', async () => {
    const { tickets } = await import('../db/schema');
    await reportService.getTicketSummary({
      period: 'weekly',
      offset: 0,
      projectId: 'p1',
    });

    const ticketsWhere = bag.whereCalls.find((c) => c.fromTable === tickets);
    expect(ticketsWhere).toBeDefined();
    expect(collectBoundValues(ticketsWhere!.predicate)).toContain('p1');
  });
});

describe('reportService rejects missing projectId at runtime (SLYK-16 T3)', () => {
  beforeEach(resetBag);

  // Table-driven: BOTH functions must throw before producing a result when
  // projectId is omitted/undefined. TS is bypassed via `as any` so the JS guard
  // path ('if (!args.projectId) throw') actually runs â defense-in-depth against
  // callers that bypass the type system.
  const MISSING = [
    {
      name: 'getTimeReport',
      fn: (a: unknown) => reportService.getTimeReport(a as never),
    },
    {
      name: 'getTicketSummary',
      fn: (a: unknown) => reportService.getTicketSummary(a as never),
    },
  ] as const;

  it.each(MISSING)(
    '$name throws "projectId is required" when projectId is omitted',
    async ({ fn }) => {
      // Omitting projectId entirely (cast through unknown to bypass TS).
      const args = { period: 'weekly', offset: 0 } as unknown as { projectId?: string };
      await expect(fn(args)).rejects.toThrow(/projectId is required/);

      // The guard fires before any DB query is built â no .where() should run.
      expect(bag.whereCalls).toHaveLength(0);
    },
  );

  it.each(MISSING)(
    '$name throws "projectId is required" when projectId is undefined',
    async ({ fn }) => {
      const args = { period: 'weekly', offset: 0, projectId: undefined } as unknown as {
        projectId?: string;
      };
      await expect(fn(args)).rejects.toThrow(/projectId is required/);
      expect(bag.whereCalls).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Self-documenting type-guard example (SLYK-16 T3).
//
// The following call shapes are now REJECTED by the service's runtime guard
// (and by TS at compile time). Kept as a comment so the contract is explicit:
//
//   // â rejected â projectId omitted
//   await reportService.getTimeReport({ period: 'weekly', offset: 0 });
//   await reportService.getTicketSummary({ period: 'monthly', offset: -1 });
//
//   // â rejected â projectId undefined
//   await reportService.getTimeReport({ period: 'weekly', offset: 0, projectId: undefined });
//
//   // â accepted â projectId is a non-empty string and forwarded into the WHERE
//   await reportService.getTimeReport({ period: 'weekly', offset: 0, projectId: 'p1' });
//   await reportService.getTicketSummary({ period: 'monthly', offset: 0, projectId: 'p1' });
// ---------------------------------------------------------------------------
