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
  lastInsert: null as Record<string, unknown> | null, // captured .values() arg
  getProjectBySlug: vi.fn(), // mocked ./projectService
  // F13 T6: updateTicket (bare db.update path, no txn)
  updateReturn: [] as Array<Record<string, unknown>>, // db.update().returning() result
  sanitizeMock: vi.fn(
    (input: string | null | undefined): string => `<clean>${input ?? ''}</clean>`,
  ), // mocked sanitizeDescription
  // F14: replaceTicketLabels mock (from ./labelService)
  replaceTicketLabels: vi.fn(),
}));

vi.mock('../db/client', async () => {
  const { tickets, projects, projectSequences } = await import('../db/schema');
  // buildTxSelectChain branches on (table, projection):
  //  - projectSequences -> { where: () => ({ for: () => bag.seqRow }) }
  //  - tickets + maxPos projection -> terminal { where: () => bag.maxRow } (createTicket aggregate)
  //  - tickets otherwise -> moveTicket chain (orderBy -> loadColumn, limit -> loadTicketFinal)
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
          if (table === tickets) return { where: () => ({ limit: () => bag.loadTicket() }) };
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
            return { where: () => undefined };
          },
        }),
        insert: () => ({
          values: (vals: Record<string, unknown>) => {
            bag.lastInsert = vals;
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
  replaceTicketLabels: (args: { ticketId: string; labelIds: string[] }) =>
    bag.replaceTicketLabels(args),
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
  bag.lastInsert = null;
  bag.getProjectBySlug.mockReset();
  bag.updateReturn = [];
  bag.sanitizeMock.mockReset();
  bag.sanitizeMock.mockImplementation(
    (input: string | null | undefined) => `<clean>${input ?? ''}</clean>`,
  );
  bag.replaceTicketLabels.mockReset();
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

describe('ticketService moveTicket (F11)', () => {
  beforeEach(resetBag);

  it('404 NOT_FOUND when ticket absent', async () => {
    bag.loadTicket.mockResolvedValue([]);

    const error = await moveTicket({ ticketId: 'missing', statusColumn: 'c1', position: 1 }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.loadProject).not.toHaveBeenCalled();
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when project row absent (defensive)', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([]);

    const error = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 1 }).catch(
      (e) => e,
    );

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

    const result = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c2', position: 50 });

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

    await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 0 });

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

    await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 5 });

    expect(bag.updateSets.length).toBe(1);
  });

  it('atomicity: mid-txn failure propagates', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()]);
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }]);
    bag.loadColumn.mockRejectedValue(new Error('boom'));

    const error = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 0 }).catch(
      (e) => e,
    );

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

  it('returns the full TicketRow including description for an existing id', async () => {
    bag.loadTicket.mockResolvedValue([
      makeTicket({ id: TICKET_ID, description: '<p>hi</p>' }),
    ]);

    const result = await getTicket(TICKET_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(TICKET_ID);
    expect(result!.description).toBe('<p>hi</p>');
  });

  it('returns null when no ticket matches', async () => {
    bag.loadTicket.mockResolvedValue([]);

    const result = await getTicket('nope');

    expect(result).toBeNull();
  });
});

describe('ticketService updateTicket (F13 T6)', () => {
  beforeEach(resetBag);

  it('throws NOT_FOUND when the ticket is absent and does NOT call update', async () => {
    bag.loadTicket.mockResolvedValue([]);

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
    bag.loadTicket.mockResolvedValue([before]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID, description: '<p>x</p>' })]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID, priority: 'MEDIUM' })]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID, assigneeId: 'u2' })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, assigneeId: null })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { assigneeId: null },
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.assigneeId).toBeNull();
  });

  it('assigneeId: uuid patch sets the assigneeId', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID, assigneeId: null })]);
    bag.updateReturn = [makeTicket({ id: TICKET_ID, assigneeId: 'u9' })];

    await updateTicket({
      ticketId: TICKET_ID,
      patch: { assigneeId: 'u9' },
      actingUserId: 'u1',
    });

    expect(bag.updateSets[0]!.assigneeId).toBe('u9');
  });

  it('throws INTERNAL_ERROR when the update returns no row (defensive)', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
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
    bag.loadTicket.mockResolvedValue([before]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
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
    bag.loadTicket.mockResolvedValue([makeTicket({ id: TICKET_ID })]);
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
});
