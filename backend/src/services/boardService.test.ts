import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock wiring ------------------------------------------------------------
//
// vi.mock is hoisted above all imports, so any binding it closes over must be
// created via vi.hoisted (also hoisted). We hold the mutable terminal fns in
// one hoisted bag; the factory builds the fluent mock objects from it, and
// tests read/reset the same references.
//
// Service call shapes:
//   db.select({...}).from(t).leftJoin(u, ...).where(...).orderBy(...) -> Promise<array>
// The chainable mock ignores the selection-object arg and terminates at orderBy.

const bag = vi.hoisted(() => ({
  dbSelectOrderBy: vi.fn(),
  getProjectBySlug: vi.fn(),
  loggerWarn: vi.fn(),
  // F14: hydrateLabelsForTickets mock (from ./labelService)
  hydrateLabels: new Map<string, Array<{ id: string; name: string; color: string }>>(),
}));

vi.mock('../db/client', () => {
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => bag.dbSelectOrderBy(),
      };
      return chain;
    }),
  };
  return { db };
});

vi.mock('./projectService', () => ({
  getProjectBySlug: bag.getProjectBySlug,
}));

vi.mock('../config/logger', () => ({
  logger: {
    warn: bag.loggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./labelService', () => ({
  hydrateLabelsForTickets: () => Promise.resolve(bag.hydrateLabels),
}));

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { BOARD_SOFT_CAP, UNSORTED_BUCKET_ID, getBoard } from './boardService';
import type { ChecklistItem } from '../db/schema';

function resetBag() {
  bag.dbSelectOrderBy.mockReset();
  bag.getProjectBySlug.mockReset();
  bag.loggerWarn.mockReset();
  bag.hydrateLabels = new Map();
}

// --- Fixtures ----------------------------------------------------------------

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';

// Explicit mock-row shape mirroring the service's select(...) selection object.
// No `any` — every field typed.
type Row = {
  id: string;
  ticketNumber: number;
  title: string;
  statusColumn: string;
  position: number;
  priority: Priority;
  checklist: ChecklistItem[];
  assigneeId: string | null;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
  assigneeFullName: string | null;
  assigneeAvatarUrl: string | null;
  assigneeRowId: string | null;
};

function makeTicket(
  over: Partial<Row> & {
    id: string;
    ticketNumber: number;
    statusColumn: string;
    position: number;
  },
): Row {
  return {
    title: `T${over.ticketNumber}`,
    priority: 'MEDIUM' as Priority,
    checklist: [] as ChecklistItem[],
    assigneeId: null,
    assigneeFullName: null,
    assigneeAvatarUrl: null,
    assigneeRowId: null,
    creatorId: 'creator1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeProject(columns: { id: string; name: string }[]) {
  return {
    id: 'p1',
    name: 'Slyk',
    slug: 'SLYK',
    columns,
    creatorId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('boardService getBoard', () => {
  beforeEach(resetBag);

  it('throws NOT_FOUND when project is absent', async () => {
    bag.getProjectBySlug.mockResolvedValue(null);

    const error = await getBoard('missing').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.dbSelectOrderBy).not.toHaveBeenCalled();
  });

  it('groups tickets by column id, preserving orderBy position', async () => {
    const project = makeProject([
      { id: 'c1', name: 'To Do' },
      { id: 'c2', name: 'Done' },
    ]);
    // DB returns these already sorted ascending by position; service does NOT
    // re-sort — it preserves row order while grouping. Feeding interleaved rows
    // so c1 ends up [pos20, pos30] and c2 ends up [pos10].
    const rows = [
      makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 20 }),
      makeTicket({ id: 't2', ticketNumber: 2, statusColumn: 'c2', position: 10 }),
      makeTicket({ id: 't3', ticketNumber: 3, statusColumn: 'c1', position: 30 }),
    ];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    expect(result.columns[0]!.tickets.map((t) => t.position)).toEqual([20, 30]);
    expect(result.columns[1]!.tickets.map((t) => t.position)).toEqual([10]);
  });

  it('routes orphan ticket into a trailing unsorted bucket', async () => {
    const project = makeProject([{ id: 'c1', name: 'To Do' }]);
    const rows = [
      makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 }),
      makeTicket({ id: 't9', ticketNumber: 9, statusColumn: 'ghost', position: 99 }),
    ];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    const last = result.columns[result.columns.length - 1]!;
    expect(last.id).toBe(UNSORTED_BUCKET_ID);
    expect(last.isUnsorted).toBe(true);
    expect(last.tickets.map((t) => t.id)).toContain('t9');
    expect(last.tickets.find((t) => t.id === 't9')?.title).toBe('T9');
  });

  it('omits the unsorted bucket when there are no orphans', async () => {
    const project = makeProject([
      { id: 'c1', name: 'To Do' },
      { id: 'c2', name: 'Done' },
    ]);
    const rows = [
      makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 }),
      makeTicket({ id: 't2', ticketNumber: 2, statusColumn: 'c2', position: 20 }),
    ];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    expect(result.columns.every((c) => c.isUnsorted === false)).toBe(true);
    expect(result.columns).toHaveLength(2);
  });

  it('maps an unassigned ticket to assignee: null', async () => {
    const project = makeProject([{ id: 'c1', name: 'To Do' }]);
    const rows = [
      makeTicket({
        id: 't1',
        ticketNumber: 1,
        statusColumn: 'c1',
        position: 10,
        assigneeId: null,
        assigneeFullName: null,
        assigneeAvatarUrl: null,
        assigneeRowId: null,
      }),
    ];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    expect(result.columns[0]!.tickets[0]!.assignee).toBeNull();
  });

  it('maps an assigned ticket to a populated assignee (incl. null avatar pass-through)', async () => {
    const project = makeProject([{ id: 'c1', name: 'To Do' }]);
    const rows = [
      makeTicket({
        id: 't1',
        ticketNumber: 1,
        statusColumn: 'c1',
        position: 10,
        priority: 'HIGH',
        assigneeId: 'u1',
        assigneeFullName: 'Jane Doe',
        assigneeAvatarUrl: 'http://x/a.png',
        assigneeRowId: 'u1',
      }),
      makeTicket({
        id: 't2',
        ticketNumber: 2,
        statusColumn: 'c1',
        position: 20,
        assigneeId: 'u2',
        assigneeFullName: 'No Face',
        assigneeAvatarUrl: null,
        assigneeRowId: 'u2',
      }),
    ];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    const ts = result.columns[0]!.tickets;
    expect(ts[0]!.assignee).toEqual({
      id: 'u1',
      fullName: 'Jane Doe',
      avatarUrl: 'http://x/a.png',
    });
    expect(ts[0]!.priority).toBe('HIGH'); // priority pass-through
    expect(ts[1]!.assignee).toEqual({
      id: 'u2',
      fullName: 'No Face',
      avatarUrl: null,
    });
  });

  it('preserves empty columns as tickets:[] (not omitted)', async () => {
    const project = makeProject([
      { id: 'c1', name: 'To Do' },
      { id: 'c3', name: 'Review' },
    ]);
    const rows = [makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 })];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    const review = result.columns.find((c) => c.id === 'c3');
    expect(review).toBeDefined();
    expect(review?.tickets).toEqual([]);
    expect(review?.tickets).toHaveLength(0);
  });

  it('warns at soft cap when ticket count exceeds 200 (no truncation)', async () => {
    const overCap = BOARD_SOFT_CAP.tickets + 1; // 201
    const project = makeProject([{ id: 'c1', name: 'To Do' }]);
    const rows: Row[] = Array.from({ length: overCap }, (_, i) =>
      makeTicket({
        id: `t${i + 1}`,
        ticketNumber: i + 1,
        statusColumn: 'c1',
        position: i,
      }),
    );
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    const result = await getBoard('SLYK');

    expect(bag.loggerWarn).toHaveBeenCalled();
    const logObj = bag.loggerWarn.mock.calls[0]![0] as Record<string, unknown>;
    expect(logObj.ticketCount).toBe(overCap);
    // No truncation: all tickets survive in the payload.
    const total = result.columns.reduce((sum, c) => sum + c.tickets.length, 0);
    expect(total).toBe(overCap);
  });

  it('warns at soft cap when column count exceeds 12', async () => {
    const overCap = BOARD_SOFT_CAP.columns + 1; // 13
    const project = makeProject(
      Array.from({ length: overCap }, (_, i) => ({ id: `c${i + 1}`, name: `Col${i + 1}` })),
    );
    const rows = [makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 0 })];
    bag.getProjectBySlug.mockResolvedValue(project);
    bag.dbSelectOrderBy.mockResolvedValue(rows);

    await getBoard('SLYK');

    expect(bag.loggerWarn).toHaveBeenCalled();
    const logObj = bag.loggerWarn.mock.calls[0]![0] as Record<string, unknown>;
    expect(logObj.columnCount).toBe(overCap);
  });

  describe('buildAssignee FK-dangle guard', () => {
    const project = makeProject([{ id: 'c1', name: 'To Do' }]);

    const cases = [
      {
        name: 'assigned ticket renders populated assignee',
        row: {
          id: 't1',
          ticketNumber: 1,
          statusColumn: 'c1',
          position: 10,
          assigneeId: 'u1',
          assigneeFullName: 'Jane Doe',
          assigneeAvatarUrl: 'http://x/a.png',
          assigneeRowId: 'u1',
        },
        expected: { id: 'u1', fullName: 'Jane Doe', avatarUrl: 'http://x/a.png' },
      },
      {
        name: 'unassigned ticket renders null',
        row: {
          id: 't2',
          ticketNumber: 2,
          statusColumn: 'c1',
          position: 20,
          assigneeId: null,
          assigneeFullName: null,
          assigneeAvatarUrl: null,
          assigneeRowId: null,
        },
        expected: null,
      },
      {
        name: 'FK-dangling assignee (id present, joined row null) renders Unknown user',
        row: {
          id: 't3',
          ticketNumber: 3,
          statusColumn: 'c1',
          position: 30,
          assigneeId: 'ghost',
          assigneeFullName: null,
          assigneeAvatarUrl: null,
          assigneeRowId: null,
        },
        expected: { id: 'ghost', fullName: 'Unknown user', avatarUrl: null },
      },
    ];

    cases.forEach(({ name, row, expected }) => {
      it(name, async () => {
        bag.getProjectBySlug.mockResolvedValue(project);
        bag.dbSelectOrderBy.mockResolvedValue([makeTicket(row)]);

        const result = await getBoard('SLYK');

        const assignee = result.columns[0]!.tickets[0]!.assignee;
        expect(assignee).toEqual(expected);
      });
    });

    it('FK-dangle path never throws (renders Unknown user, no 500)', async () => {
      bag.getProjectBySlug.mockResolvedValue(project);
      bag.dbSelectOrderBy.mockResolvedValue([
        makeTicket({
          id: 't3',
          ticketNumber: 3,
          statusColumn: 'c1',
          position: 30,
          assigneeId: 'ghost',
          assigneeFullName: null,
          assigneeAvatarUrl: null,
          assigneeRowId: null,
        }),
      ]);

      const result = await getBoard('SLYK').catch((e) => e);

      expect(result).not.toBeInstanceOf(Error);
      const assignee = (result as Awaited<ReturnType<typeof getBoard>>).columns[0]!.tickets[0]!
        .assignee;
      expect(assignee).toEqual({ id: 'ghost', fullName: 'Unknown user', avatarUrl: null });
    });
  });

  describe('F14 label hydration', () => {
    it('renders hydrated labels {id, name, color}[] per ticket', async () => {
      const project = makeProject([{ id: 'c1', name: 'To Do' }]);
      const rows = [
        makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 }),
      ];
      bag.getProjectBySlug.mockResolvedValue(project);
      bag.dbSelectOrderBy.mockResolvedValue(rows);
      bag.hydrateLabels = new Map([
        [
          't1',
          [
            { id: 'l1', name: 'bug', color: '#FF0000' },
            { id: 'l2', name: 'api', color: '#00FF00' },
          ],
        ],
      ]);

      const result = await getBoard('SLYK');

      const labels = result.columns[0]!.tickets[0]!.labels;
      expect(labels).toEqual([
        { id: 'l1', name: 'bug', color: '#FF0000' },
        { id: 'l2', name: 'api', color: '#00FF00' },
      ]);
    });

    it('renders labels: [] for a ticket with no label rows', async () => {
      const project = makeProject([{ id: 'c1', name: 'To Do' }]);
      const rows = [
        makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 }),
      ];
      bag.getProjectBySlug.mockResolvedValue(project);
      bag.dbSelectOrderBy.mockResolvedValue(rows);
      // No entry for 't1' in the hydrate map → defaults to [] at the read site.
      bag.hydrateLabels = new Map();

      const result = await getBoard('SLYK');

      expect(result.columns[0]!.tickets[0]!.labels).toEqual([]);
    });

    it('mixes labeled and unlabeled tickets in one batch', async () => {
      const project = makeProject([{ id: 'c1', name: 'To Do' }]);
      const rows = [
        makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 }),
        makeTicket({ id: 't2', ticketNumber: 2, statusColumn: 'c1', position: 20 }),
      ];
      bag.getProjectBySlug.mockResolvedValue(project);
      bag.dbSelectOrderBy.mockResolvedValue(rows);
      bag.hydrateLabels = new Map([
        ['t1', [{ id: 'l1', name: 'bug', color: '#FF0000' }]],
      ]);

      const result = await getBoard('SLYK');

      const ts = result.columns[0]!.tickets;
      expect(ts[0]!.labels).toEqual([{ id: 'l1', name: 'bug', color: '#FF0000' }]);
      expect(ts[1]!.labels).toEqual([]);
    });
  });

  describe('F15 checklist payload', () => {
    it('renders hydrated checklist items {id, text, done}[] per ticket', async () => {
      const project = makeProject([{ id: 'c1', name: 'To Do' }]);
      const checklist = [
        { id: 'i1', text: 'Design', done: true },
        { id: 'i2', text: 'Build', done: false },
      ];
      const rows = [
        makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10, checklist }),
      ];
      bag.getProjectBySlug.mockResolvedValue(project);
      bag.dbSelectOrderBy.mockResolvedValue(rows);

      const result = await getBoard('SLYK');

      expect(result.columns[0]!.tickets[0]!.checklist).toEqual(checklist);
    });

    it('renders checklist: [] for a ticket with no items', async () => {
      const project = makeProject([{ id: 'c1', name: 'To Do' }]);
      const rows = [
        makeTicket({ id: 't1', ticketNumber: 1, statusColumn: 'c1', position: 10 }),
      ];
      bag.getProjectBySlug.mockResolvedValue(project);
      bag.dbSelectOrderBy.mockResolvedValue(rows);

      const result = await getBoard('SLYK');

      expect(result.columns[0]!.tickets[0]!.checklist).toEqual([]);
    });
  });
});
