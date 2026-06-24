import { beforeEach, describe, expect, it, vi } from 'vitest';

const bag = vi.hoisted(() => ({
  loadTicket: vi.fn(), // db.select().from(tickets).where().limit()
  loadProject: vi.fn(), // db.select({columns}).from(projects).where().limit()
  loadColumn: vi.fn(), // tx.select().from(tickets).where(...).orderBy()  (destination column re-read)
  loadTicketFinal: vi.fn(), // tx.select().from(tickets).where(eq(id)).limit()  (returned row)
  updateSets: [] as Array<Record<string, unknown>>, // captured .set() args in order
  txnInvoked: vi.fn(),
  // createTicket / allocateTicketNumber slots
  seqRow: [] as Array<Record<string, unknown>>, // tx.select().from(projectSequences).for('update')
  maxRow: [] as Array<Record<string, unknown>>, // tx.select({maxPos}).from(tickets) bare aggregate
  insertReturn: [] as Array<Record<string, unknown>>, // tx.insert(tickets).values().returning()
  // F18 T5: tx.select({name}).from(labels).where(inArray(...)) — new-label-name
  // rows for updateTicket's activity label diff. Default [] (activity rows are
  // asserted in a later task; existing behavior tests only need this not to crash).
  labelNameRows: [] as Array<Record<string, unknown>>,
  lastInsert: null as Record<string, unknown> | null, // captured .values() arg
  getProjectBySlug: vi.fn(), // mocked ./projectService
  // F13 T6: updateTicket (bare db.update path, no txn)
  updateReturn: [] as Array<Record<string, unknown>>, // db.update().returning() result
  sanitizeMock: vi.fn(
    (input: string | null | undefined): string => `<clean>${input ?? ''}</clean>`,
  ), // mocked sanitizeDescription
  // F14: replaceTicketLabels mock (from ./labelService)
  replaceTicketLabels: vi.fn(),
  // F14: hydrateLabelsForTickets mock (from ./labelService) — getTicket hydration
  hydrateLabelsForTickets: vi.fn(),
}));

vi.mock('../db/client', async () => {
  const { labels, tickets, projects, projectSequences } = await import('../db/schema');
  // buildTxSelectChain branches on (table, projection):
  //  - projectSequences -> { where: () => ({ for: () => bag.seqRow }) }
  //  - tickets + maxPos projection -> terminal { where: () => bag.maxRow } (createTicket aggregate)
  //  - tickets otherwise -> moveTicket chain (orderBy -> loadColumn, limit -> loadTicketFinal)
  //  - labels (F18 T5) -> terminal { where: () => bag.labelNameRows } so updateTicket's
  //    new-label-name diff select resolves to an array (default [] -> no-op diff).
  const buildTxSelectChain = (projection?: Record<string, unknown>) => {
    const isMaxSelect = !!projection && 'maxPos' in projection;
    const chain = {
      from: (table: unknown) => {
        if (table === projectSequences) {
          return { where: () => ({ for: () => bag.seqRow }) };
        }
        if (table === tickets) {
          if (isMaxSelect) {
            return { where: () => bag.maxRow };
          }
          return {
            where: () => ({ orderBy: () => bag.loadColumn(), limit: () => bag.loadTicketFinal() }),
          };
        }
        // F18 T5: tx.select({name}).from(labels).where(inArray(...)) — new-label
        // name resolution for the activity label diff. Default [] keeps the diff
        // a no-op for existing behavior tests (activity rows are asserted in T6).
        if (table === labels) {
          return { where: () => Promise.resolve(bag.labelNameRows) };
        }
        return chain;
      },
      where: () => chain,
      orderBy: () => bag.loadColumn(),
      limit: () => bag.loadTicketFinal(),
    };
    return chain;
  };
  const db = {
    select: () => {
      const chain = {
        from: (table: unknown) => {
          if (table === tickets) {
            // F16: getTicket left-joins users twice before where/limit; moveTicket
            // calls where/limit directly. leftJoin is a no-op returning a fresh chain.
            const makeTicketChain = () => ({
              leftJoin: () => makeTicketChain(),
              where: () => ({ limit: () => bag.loadTicket() }),
            });
            return makeTicketChain();
          }
          if (table === projects) return { where: () => ({ limit: () => bag.loadProject() }) };
          return chain;
        },
        where: () => chain,
        limit: () => bag.loadTicket(),
      };
      return chain;
    },
    // F13 T6: bare db.update chain (no txn). Captures the set arg into updateSets
    // (same slot as tx.update) and returns updateReturn from .returning().
    update: () => ({
      set: (setArg: Record<string, unknown>) => {
        bag.updateSets.push(setArg);
        return { where: () => ({ returning: () => Promise.resolve(bag.updateReturn) }) };
      },
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      bag.txnInvoked();
      const tx = {
        select: (projection?: Record<string, unknown>) => buildTxSelectChain(projection),
        update: () => ({
          set: (setArg: Record<string, unknown>) => {
            bag.updateSets.push(setArg);
            // F18 T5: updateTicket now calls .returning() inside the txn. Mirror
            // the bare db.update mock so the INTERNAL_ERROR "no row" guard works
            // and the {old,new} test snapshots resolve from updateReturn.
            return {
              where: () => ({ returning: () => Promise.resolve(bag.updateReturn) }),
            };
          },
        }),
        insert: (table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            // F18 T3/T5: recordActivity now inserts activityLogs inside the txn.
            // Capture ONLY the tickets insert so the spy still reflects the
            // ticket row, not the clobbering activity-log insert. Activity inserts
            // resolve harmlessly (updateTicket never awaits .returning on them).
            if (table === tickets) {
              bag.lastInsert = vals;
            }
            return { returning: () => bag.insertReturn };
          },
        }),
      };
      return cb(tx);
    }),
  };
  return { db };
});

vi.mock('./projectService', () => ({
  getProjectBySlug: (slug: string) => bag.getProjectBySlug(slug),
}));

vi.mock('../utils/sanitizeHtml', () => ({
  sanitizeDescription: (input: string | null | undefined) => bag.sanitizeMock(input),
}));

vi.mock('./labelService', () => ({
  // F18 T5: both fns now take an optional tx (default db). Forward only the
  // leading arg(s) the spy asserts on so existing toHaveBeenCalledWith({ticketId,
  // labelIds}) / toHaveBeenCalledWith([ticketId]) assertions stay valid.
  replaceTicketLabels: (args: { ticketId: string; labelIds: string[] }) =>
    bag.replaceTicketLabels(args),
  hydrateLabelsForTickets: (ids: string[]) => bag.hydrateLabelsForTickets(ids),
}));

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import {
  allocateTicketNumber,
  createTicket,
  getTicket,
  POSITION_EPSILON,
  POSITION_GAP,
  moveTicket,
  updateTicket,
} from './ticketService';
import type { TicketPatch } from './ticketService';
import { UNSORTED_BUCKET_ID } from './boardService';

function resetBag() {
  bag.loadTicket.mockReset();
  bag.loadProject.mockReset();
  bag.loadColumn.mockReset();
  bag.loadTicketFinal.mockReset();
  bag.updateSets.length = 0;
  bag.txnInvoked.mockReset();
  bag.seqRow = [];
  bag.maxRow = [];
  bag.insertReturn = [];
  bag.labelNameRows = [];
  bag.lastInsert = null;
  bag.getProjectBySlug.mockReset();
  bag.updateReturn = [];
  bag.sanitizeMock.mockReset();
  bag.sanitizeMock.mockImplementation(
    (input: string | null | undefined) => `<clean>${input ?? ''}</clean>`,
  );
  bag.replaceTicketLabels.mockReset();
  bag.hydrateLabelsForTickets.mockReset();
  // getTicket hydrates labels; default to an empty map (no labels) unless a test
  // overrides it.
  bag.hydrateLabelsForTickets.mockResolvedValue(new Map<string, unknown[]>());
}

const TICKET_ID = 't1';
const PROJECT_ID = 'p1';

function makeTicket(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: TICKET_ID,
    projectId: PROJECT_ID,
    ticketNumber: 1,
    title: 'T1',
    description: null,
    statusColumn: 'c1',
    position: 10,
    assigneeId: null,
    creatorId: 'u1',
    priority: 'MEDIUM',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeColumns() {
  return [
    { id: 'c1', name: 'To Do' },
    { id: 'c2', name: 'Done' },
  ];
}

// Reusable project fixture for createTicket: slug-resolved, 2 columns.
function makeProject(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    name: 'Slyk',
    slug: 'SLYK',
    columns: makeColumns(),
    creatorId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// F16: getTicket now returns a joined row ({ticket, creatorId, creatorFullName,
// creatorAvatarUrl, assigneeId, ...}). Mirror that shape for the getTicket tests.
function makeJoinedTicket(over: {
  ticket?: Partial<Record<string, unknown>>;
  creatorId?: string | null;
  creatorFullName?: string | null;
  creatorAvatarUrl?: string | null;
  assigneeId?: string | null;
  assigneeFullName?: string | null;
  assigneeAvatarUrl?: string | null;
} = {}) {
  return {
    ticket: makeTicket(over.ticket ?? {}),
    creatorId: over.creatorId ?? null,
    creatorFullName: over.creatorFullName ?? null,
    creatorAvatarUrl: over.creatorAvatarUrl ?? null,
    assigneeId: over.assigneeId ?? null,
    assigneeFullName: over.assigneeFullName ?? null,
    assigneeAvatarUrl: over.assigneeAvatarUrl ?? null,
  };
}

describe('ticketService moveTicket (F11)', () => {
  beforeEach(resetBag);

  it('404 NOT_FOUND when ticket absent', async () => {
    bag.loadTicket.mockResolvedValue([]);

    const error = await moveTicket({
      ticketId: 'missing',
      statusColumn: 'c1',
      position: 1,
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.loadProject).not.toHaveBeenCalled();
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when project row absent (defensive)', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([]);

    const error = await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: 'c1',
      position: 1,
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED when statusColumn not in columns', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);

    const error = await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: 'ghost',
      position: 1,
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(((error as AppError).details as Record<string, unknown>).statusColumn).toBe(
      'Unknown column',
    );
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED when statusColumn === UNSORTED_BUCKET_ID', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);

    const error = await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: UNSORTED_BUCKET_ID,
      position: 1,
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('happy path writes statusColumn + position + updatedAt in ONE txn, no rebalance', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);
    // healthy gap (65536) between t1 and t2
    bag.loadColumn.mockResolvedValue([
      { id: 't1', position: 0 },
      { id: 't2', position: 65536 },
    ]);
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ statusColumn: 'c2', position: 50 })]);

    const result = await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: 'c2',
      position: 50,
      actingUserId: 'u1',
    });

    expect(bag.txnInvoked).toHaveBeenCalledTimes(1);
    expect(bag.updateSets.length).toBe(1);
    expect(bag.updateSets[0]!.statusColumn).toBe('c2');
    expect(bag.updateSets[0]!.position).toBe(50);
    expect(bag.updateSets[0]!.updatedAt).toBeInstanceOf(Date);
    expect(bag.loadColumn).toHaveBeenCalled();
    expect(result.statusColumn).toBe('c2');
    expect(result.position).toBe(50);
  });

  it('rebalance triggers when gap < EPSILON → whole column re-numbered index*GAP in same txn', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);
    // gap = 1e-7 < 1e-6 EPSILON → rebalance
    bag.loadColumn.mockResolvedValue([
      { id: 't1', position: 0 },
      { id: 't2', position: POSITION_EPSILON / 10 },
    ]);
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ position: 0 })]);

    await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: 'c1',
      position: 0,
      actingUserId: 'u1',
    });

    expect(bag.txnInvoked).toHaveBeenCalledTimes(1);
    expect(bag.updateSets.length).toBe(3); // 1 main + 2 rebalance
    expect(bag.updateSets[1]!.position).toBe(0); // index 0 * GAP
    expect(bag.updateSets[2]!.position).toBe(POSITION_GAP); // index 1 * GAP
  });

  it('no rebalance when gap healthy (asserted via updateSets.length === 1)', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);
    bag.loadColumn.mockResolvedValue([
      { id: 't1', position: 0 },
      { id: 't2', position: 65536 },
    ]);
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ statusColumn: 'c1', position: 5 })]);

    await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: 'c1',
      position: 5,
      actingUserId: 'u1',
    });

    expect(bag.updateSets.length).toBe(1);
  });

  it('atomicity: mid-txn failure propagates', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);
    bag.loadColumn.mockRejectedValue(new Error('boom'));

    const error = await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: 'c1',
      position: 0,
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
    expect(bag.txnInvoked).toHaveBeenCalledTimes(1);
  });

  it('POSITION_GAP / POSITION_EPSILON exported as numbers', () => {
    expect(typeof POSITION_GAP).toBe('number');
    expect(POSITION_GAP).toBe(65536);
    expect(POSITION_EPSILON).toBe(1e-6);
  });
});

describe('ticketService allocateTicketNumber (F12)', () => {
  beforeEach(resetBag);

  it('returns current nextNumber and increments the counter via a sql `+ 1` expression', async () => {
    bag.seqRow = [{ nextNumber: 5 }];

    // allocateTicketNumber runs inside a txn; invoke it through db.transaction
    // via the real createTicket path is heavy — call it directly with a tx from
    // the mocked transaction to keep the unit scoped to the allocator.
    const { db } = await import('../db/client');
    const result = await db.transaction(async (tx) => allocateTicketNumber(tx, PROJECT_ID));

    expect(result).toBe(5);
    // exactly one update set captured, targeting nextNumber with a raw SQL expression
    expect(bag.updateSets.length).toBe(1);
    const setArg = bag.updateSets[0]!;
    expect(setArg).toHaveProperty('nextNumber');
    // Drizzle's sql`...` template returns a SQL object; assert it is a non-plain object.
    expect(setArg.nextNumber).toBeTruthy();
    expect(typeof setArg.nextNumber).toBe('object');
  });

  it('throws NOT_FOUND when the counter row is missing', async () => {
    bag.seqRow = []; // no sequence row for this project

    const { db } = await import('../db/client');
    const error = await db
      .transaction(async (tx) => allocateTicketNumber(tx, 'no-such-project'))
      .catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
  });
});

describe('ticketService createTicket (F12)', () => {
  beforeEach(resetBag);

  it('404 NOT_FOUND on unknown slug and does NOT open a transaction', async () => {
    bag.getProjectBySlug.mockResolvedValue(null);

    const error = await createTicket({
      slug: 'ghost',
      creatorId: 'u1',
      title: 'T',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('409 CONFLICT when the project has no columns and does NOT open a transaction', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject({ columns: [] }));

    const error = await createTicket({
      slug: 'SLYK',
      creatorId: 'u1',
      title: 'T',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('defaults statusColumn to the first column id when none is provided', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 1 }];
    bag.maxRow = [{ maxPos: null }];
    bag.insertReturn = [makeTicket({ id: 't-new', ticketNumber: 1, statusColumn: 'c1' })];

    await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'New' });

    expect(bag.lastInsert).not.toBeNull();
    expect(bag.lastInsert!.statusColumn).toBe('c1');
  });

  it('400 VALIDATION_FAILED when statusColumn is not in project.columns', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());

    const error = await createTicket({
      slug: 'SLYK',
      creatorId: 'u1',
      title: 'T',
      statusColumn: 'ghost',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED when statusColumn === UNSORTED_BUCKET_ID', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());

    const error = await createTicket({
      slug: 'SLYK',
      creatorId: 'u1',
      title: 'T',
      statusColumn: UNSORTED_BUCKET_ID,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('places the ticket at POSITION_GAP when the resolved column is empty', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 1 }];
    bag.maxRow = [{ maxPos: null }]; // empty column -> max(position) is null
    bag.insertReturn = [makeTicket({ id: 't-new', position: POSITION_GAP })];

    await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'First' });

    expect(bag.lastInsert!.position).toBe(POSITION_GAP); // 0 + 65536
  });

  it('places the ticket at (max + POSITION_GAP) when the resolved column is non-empty', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 3 }];
    bag.maxRow = [{ maxPos: 131072 }]; // 2 * GAP existing max
    bag.insertReturn = [makeTicket({ id: 't-new', position: 131072 + POSITION_GAP })];

    await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'Third' });

    expect(bag.lastInsert!.position).toBe(131072 + POSITION_GAP); // 196608
  });

  it('returns the inserted row carrying the allocated ticket_number + creatorId', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 7 }];
    bag.maxRow = [{ maxPos: null }];
    bag.insertReturn = [
      makeTicket({
        id: 't7',
        ticketNumber: 7,
        creatorId: 'u1',
        statusColumn: 'c1',
        position: POSITION_GAP,
      }),
    ];

    const result = await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'Seventh' });

    expect(result.ticketNumber).toBe(7);
    expect(result.creatorId).toBe('u1');
  });
});

describe('ticketService getTicket (F13 T6)', () => {
  beforeEach(resetBag);

  it('returns the full TicketRow + resolved creator/assignee including description', async () => {
    bag.loadTicket.mockResolvedValue([
      makeJoinedTicket({
        ticket: { id: TICKET_ID, description: '<p>hi</p>' },
        creatorId: 'u1',
        creatorFullName: 'Muntasir',
        creatorAvatarUrl: 'http://x/a.png',
        assigneeId: 'u2',
        assigneeFullName: 'Ada',
        assigneeAvatarUrl: null,
      }),
    ]);

    const result = await getTicket(TICKET_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(TICKET_ID);
    expect(result!.description).toBe('<p>hi</p>');
    expect(result!.creator).toEqual({ id: 'u1', fullName: 'Muntasir', avatarUrl: 'http://x/a.png' });
    expect(result!.assignee).toEqual({ id: 'u2', fullName: 'Ada', avatarUrl: null });
  });

  it('returns null when no ticket matches', async () => {
    bag.loadTicket.mockResolvedValue([]);

    const result = await getTicket('nope');

    expect(result).toBeNull();
  });

  it('F14: hydrates labels onto the returned ticket', async () => {
    bag.loadTicket.mockResolvedValue([
      makeJoinedTicket({ ticket: { id: TICKET_ID }, creatorId: 'u1', creatorFullName: 'M' }),
    ]);
    const label = { id: 'lbl-1', name: 'Bug', color: '#EF4444' };
    bag.hydrateLabelsForTickets.mockResolvedValue(new Map([[TICKET_ID, [label]]]));

    const result = await getTicket(TICKET_ID);

    expect(result?.labels).toEqual([label]);
    expect(bag.hydrateLabelsForTickets).toHaveBeenCalledWith([TICKET_ID]);
  });

  it('F16: FK-dangle — missing creator/assignee user row → null actor (no crash)', async () => {
    bag.loadTicket.mockResolvedValue([
      makeJoinedTicket({ ticket: { id: TICKET_ID }, creatorId: null, assigneeId: null }),
    ]);

    const result = await getTicket(TICKET_ID);

    expect(result?.creator).toBeNull();
    expect(result?.assignee).toBeNull();
  });

  it('F16: null joined fullName → "Unknown user" fallback', async () => {
    bag.loadTicket.mockResolvedValue([
      makeJoinedTicket({
        ticket: { id: TICKET_ID },
        creatorId: 'u1',
        creatorFullName: null,
        assigneeId: 'u2',
        assigneeFullName: null,
      }),
    ]);

    const result = await getTicket(TICKET_ID);

    expect(result?.creator?.fullName).toBe('Unknown user');
    expect(result?.assignee?.fullName).toBe('Unknown user');
  });
});

describe('ticketService updateTicket (F13 T6)', () => {
  beforeEach(resetBag);

  it('throws NOT_FOUND when the ticket is absent and does NOT call update', async () => {
    // F18 T5: updateTicket now reads the OLD row inside the txn via
    // tx.select().from(tickets).where().limit() -> loadTicketFinal.
    bag.loadTicketFinal.mockResolvedValue([]);

    const error = await updateTicket({
      ticketId: 'missing',
      patch: { title: 'X' },
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.updateSets.length).toBe(0);
    expect(bag.sanitizeMock).not.toHaveBeenCalled();
  });

  it('title-only patch sets only title + updatedAt and returns {old, new} snapshots', async () => {
    const before = makeTicket({ id: TICKET_ID, title: 'Old' });
    const after = makeTicket({ id: TICKET_ID, title: 'New' });
    bag.loadTicketFinal.mockResolvedValue([before]);
    bag.updateReturn = [after];

    const result = await updateTicket({
      ticketId: TICKET_ID,
      patch: { title: 'New' },
      actingUserId: 'u1',
    });

    expect(result.old).toBe(before);
    expect(result.new).toBe(after);
    expect(bag.updateSets.length).toBe(1);
    const setArg = bag.updateSets[0]!;
    expect(setArg.title).toBe('New');
    expect(setArg.updatedAt).toBeInstanceOf(Date);
    // only title + updatedAt keys
    expect(Object.keys(setArg).sort()).toEqual(['title', 'updatedAt']);
    expect(bag.sanitizeMock).not.toHaveBeenCalled();
  });

  it('description patch routes through sanitizeDescription exactly once with the input', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, description: '<clean>raw</clean>' })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { description: 'raw' },
      actingUserId: 'u1',
    });

    expect(bag.sanitizeMock).toHaveBeenCalledTimes(1);
    expect(bag.sanitizeMock).toHaveBeenCalledWith('raw');
    expect(bag.updateSets[0]!.description).toBe('<clean>raw</clean>');
  });

  it('description: null patch sets description to null and does NOT invoke sanitizer', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID, description: '<p>x</p>' })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, description: null })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { description: null },
      actingUserId: 'u1',
    });

    expect(bag.sanitizeMock).not.toHaveBeenCalled();
    expect(bag.updateSets[0]!.description).toBeNull();
  });

  it('priority patch writes the typed Priority value', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID, priority: 'MEDIUM' })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, priority: 'URGENT' })];

    const patch: TicketPatch = { priority: 'URGENT' };

    await updateTicket({
      ticketId: TICKET_ID,
      patch,
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.priority).toBe('URGENT');
    expect(bag.sanitizeMock).not.toHaveBeenCalled();
  });

  it('assigneeId: null patch unassigns (writes null)', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID, assigneeId: 'u2' })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, assigneeId: null })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { assigneeId: null },
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.assigneeId).toBeNull();
  });

  it('assigneeId: uuid patch sets the assigneeId', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID, assigneeId: null })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, assigneeId: 'u9' })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { assigneeId: 'u9' },
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.assigneeId).toBe('u9');
  });

  it('throws INTERNAL_ERROR when the update returns no row (defensive)', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [];

    const error = await updateTicket({
      ticketId: TICKET_ID,
      patch: { title: 'X' },
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('multi-field patch carries every provided key through one update call', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, title: 'T2', priority: 'HIGH' })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { title: 'T2', priority: 'HIGH', assigneeId: 'u3' },
      actingUserId: 'u1',
    });

    expect(bag.updateSets.length).toBe(1);
    const setArg = bag.updateSets[0]!;
    expect(setArg.title).toBe('T2');
    expect(setArg.priority).toBe('HIGH');
    expect(setArg.assigneeId).toBe('u3');
    expect(setArg.updatedAt).toBeInstanceOf(Date);
  });
});

describe('ticketService updateTicket label patch (F14)', () => {
  beforeEach(resetBag);

  it('calls replaceTicketLabels with the new labelIds and returns {old, new}', async () => {
    const before = makeTicket({ id: TICKET_ID, title: 'T1' });
    const after = makeTicket({ id: TICKET_ID, title: 'T1' });
    bag.loadTicketFinal.mockResolvedValue([before]);
    bag.updateReturn = [after];
    bag.replaceTicketLabels.mockResolvedValue(undefined);

    const result = await updateTicket({
      ticketId: TICKET_ID,
      patch: { labelIds: ['l1', 'l2'] },
      actingUserId: 'u1',
    });

    expect(bag.replaceTicketLabels).toHaveBeenCalledTimes(1);
    expect(bag.replaceTicketLabels).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      labelIds: ['l1', 'l2'],
    });
    expect(result.old).toBe(before);
    expect(result.new).toBe(after);
  });

  it('foreign-project label surfaces VALIDATION_FAILED from replaceTicketLabels', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID })];
    bag.replaceTicketLabels.mockRejectedValue(
      new AppError(ErrorCode.VALIDATION_FAILED, 'One or more labels do not belong to this project'),
    );

    const error = await updateTicket({
      ticketId: TICKET_ID,
      patch: { labelIds: ['foreign'] },
      actingUserId: 'u1',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.replaceTicketLabels).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      labelIds: ['foreign'],
    });
  });

  it('empty labelIds array clears the set (calls replaceTicketLabels with [])', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID })];
    bag.replaceTicketLabels.mockResolvedValue(undefined);

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { labelIds: [] },
      actingUserId: 'u1',
    });

    expect(bag.replaceTicketLabels).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      labelIds: [],
    });
  });

  it('does NOT call replaceTicketLabels when labelIds is absent from patch', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, title: 'X' })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { title: 'X' },
      actingUserId: 'u1',
    });

    expect(bag.replaceTicketLabels).not.toHaveBeenCalled();
  });
});

describe('ticketService createTicket label linking (F14)', () => {
  beforeEach(resetBag);

  it('links labels via replaceTicketLabels after insert when labelIds provided', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 1 }];
    bag.maxRow = [{ maxPos: null }];
    const inserted = makeTicket({ id: 't-new', ticketNumber: 1, statusColumn: 'c1' });
    bag.insertReturn = [inserted];
    bag.replaceTicketLabels.mockResolvedValue(undefined);

    const result = await createTicket({
      slug: 'SLYK',
      creatorId: 'u1',
      title: 'New',
      labelIds: ['l1', 'l2'],
    });

    expect(result.id).toBe('t-new');
    expect(bag.replaceTicketLabels).toHaveBeenCalledTimes(1);
    expect(bag.replaceTicketLabels).toHaveBeenCalledWith({
      ticketId: 't-new',
      labelIds: ['l1', 'l2'],
    });
  });

  it('does NOT call replaceTicketLabels when labelIds is omitted', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 1 }];
    bag.maxRow = [{ maxPos: null }];
    bag.insertReturn = [makeTicket({ id: 't-new', ticketNumber: 1 })];

    await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'New' });

    expect(bag.replaceTicketLabels).not.toHaveBeenCalled();
  });

  it('F15: persists checklist in the insert when provided', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 1 }];
    bag.maxRow = [{ maxPos: null }];
    bag.insertReturn = [makeTicket({ id: 't-new', ticketNumber: 1, statusColumn: 'c1' })];
    const checklist = [
      { id: '11111111-1111-4111-8111-111111111111', text: 'Design', done: false },
    ];

    await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'New', checklist });

    expect(bag.lastInsert).not.toBeNull();
    expect(bag.lastInsert!.checklist).toEqual(checklist);
  });

  it('F15 fix: empty labelIds [] does NOT call replaceTicketLabels (no-op)', async () => {
    bag.getProjectBySlug.mockResolvedValue(makeProject());
    bag.seqRow = [{ nextNumber: 1 }];
    bag.maxRow = [{ maxPos: null }];
    bag.insertReturn = [makeTicket({ id: 't-new', ticketNumber: 1, statusColumn: 'c1' })];

    await createTicket({ slug: 'SLYK', creatorId: 'u1', title: 'New', labelIds: [] });

    expect(bag.replaceTicketLabels).not.toHaveBeenCalled();
  });
});

describe('ticketService updateTicket checklist patch (F15)', () => {
  beforeEach(resetBag);

  it('writes checklist into updateSet when patch.checklist is provided (full-array replace)', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID })];
    const checklist = [
      { id: '11111111-1111-4111-8111-111111111111', text: 'Build it', done: false },
    ];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { checklist },
      actingUserId: 'u1',
    });

    expect(bag.updateSets.length).toBe(1);
    expect(bag.updateSets[0]!.checklist).toEqual(checklist);
    // No sanitization or label linking on a checklist-only patch.
    expect(bag.sanitizeMock).not.toHaveBeenCalled();
    expect(bag.replaceTicketLabels).not.toHaveBeenCalled();
  });

  it('does NOT set checklist when patch omits it', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, title: 'X' })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { title: 'X' },
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.checklist).toBeUndefined();
  });

  it('replaces the checklist with [] when an empty array is provided', async () => {
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { checklist: [] },
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.checklist).toEqual([]);
  });
});
