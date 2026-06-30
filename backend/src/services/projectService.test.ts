import { beforeEach, describe, expect, it, vi } from 'vitest';

import { START_TICKET_NUMBER } from '../db/schema';

// --- Mock wiring ------------------------------------------------------------
//
// vi.mock is hoisted above all imports, so any binding it closes over must be
// created via vi.hoisted (also hoisted). We hold the mutable terminal fns and
// capture vars in one hoisted bag; the factory builds the fluent mock objects
// from it, and tests read/reset the same references.
//
// Call shapes:
//   db.select().from(p).where(...).limit(1)   -> Promise<array>  [find-by-slug]
//   db.select().from(p).orderBy(...)           -> Promise<array>  [list]
//   db.insert(p).values(v).returning()         -> Promise<array>  [create]
//   db.transaction(async (tx) => ...)          -> invokes cb(txMock)        [create, F12]
//       tx.insert(p).values(v).returning()     -> projects insert: bag.dbInsertReturning
//                                                 projectSequences insert: [] (no-op)
// Find path's terminal is `.limit()`; list path's terminal is `.orderBy()`.

type InsertValues = Record<string, unknown>;

const bag = vi.hoisted(() => ({
  dbSelectLimit: vi.fn(),
  dbSelectOrderBy: vi.fn(),
  dbInsertReturning: vi.fn(),
  dbInsertValuesArg: {} as InsertValues,
  dbSelectCount: vi.fn(),
  // F27 updateProject: set(...) arg captured; returning() resolves to dbUpdateReturning
  dbUpdateReturning: vi.fn(),
  dbUpdateSetArg: {} as InsertValues,
  // listProjects member branch: captures the .where(...) predicate so the
  // isActive filter is observable through the fluent mock.
  dbSelectWhereArg: undefined as unknown,
  // F12: all in-tx inserts, captured in call order. Each entry is the values
  // object handed to tx.insert(...).values(...). The PROJECTS insert is also
  // mirrored into dbInsertValuesArg so existing assertions stay green.
  txInserts: [] as InsertValues[],
  // DEL-04: mocked stopTimersForProject from timerService.
  stopTimersForProject: vi.fn(),
}));

vi.mock('../db/client', () => {
  // tx mock: the projects insert (first in-tx insert) mirrors its values into
  // dbInsertValuesArg AND resolves .returning() to dbInsertReturning, so the
  // pre-existing dbInsertValuesArg / dbInsertReturning assertions still pass.
  // The projectSequences insert resolves to [] (createProject ignores it).
  let txInsertCount = 0;
  type TxClient = {
    insert: () => {
      values: (v: InsertValues) => { returning: () => Promise<unknown[]> };
    };
    select: (selectArg?: unknown) => unknown;
    update: () => {
      set: (v: InsertValues) => { where: () => { returning: () => Promise<unknown[]> } };
    };
  };
  const tx: TxClient = {
    insert: () => ({
      values: (v: InsertValues) => {
        bag.txInserts.push(v);
        if (txInsertCount === 0) {
          bag.dbInsertValuesArg = v; // mirror PROJECTS insert for existing assertions
        }
        txInsertCount += 1;
        const isFirst = txInsertCount === 1;
        return {
          returning: () => (isFirst ? bag.dbInsertReturning() : Promise.resolve([])),
        };
      },
    }),
    // F27/DEL-04: in-tx select. A shape arg is either a count(*) query
    // (terminal at .where()) or the member-list query (uses .innerJoin() then
    // .where().orderBy()). innerJoin disambiguates the two.
    select: (selectArg?: unknown) => {
      if (selectArg !== undefined) {
        const listPostJoin = {
          where: (arg?: unknown) => {
            bag.dbSelectWhereArg = arg;
            return listPostJoin;
          },
          orderBy: () => bag.dbSelectOrderBy(),
        };
        const shapeChain = {
          from: () => shapeChain,
          innerJoin: () => listPostJoin,
          where: () => bag.dbSelectCount(),
        };
        return shapeChain;
      }
      const chain = {
        from: () => chain,
        where: (arg?: unknown) => {
          bag.dbSelectWhereArg = arg;
          return chain;
        },
        limit: () => bag.dbSelectLimit(),
        orderBy: () => bag.dbSelectOrderBy(),
      };
      return chain;
    },
    // DEL-04: in-tx update drives updateProject's tx.update(projects).set(...).returning().
    update: () => ({
      set: (v: InsertValues) => {
        bag.dbUpdateSetArg = v;
        return { where: () => ({ returning: () => bag.dbUpdateReturning() }) };
      },
    }),
  };
  const db = {
    // F27/DEL-04: select() with a shape arg is either a count(*) query
    // (terminal at .where()) or the member-list query (.innerJoin() then
    // .where().orderBy()). select() with no arg is the slug lookup.
    select: vi.fn((selectArg?: unknown) => {
      if (selectArg !== undefined) {
        const listPostJoin = {
          where: (arg?: unknown) => {
            bag.dbSelectWhereArg = arg;
            return listPostJoin;
          },
          orderBy: () => bag.dbSelectOrderBy(),
        };
        const shapeChain = {
          from: () => shapeChain,
          innerJoin: () => listPostJoin,
          where: () => bag.dbSelectCount(),
        };
        return shapeChain;
      }
      const chain = {
        from: () => chain,
        where: (arg?: unknown) => {
          bag.dbSelectWhereArg = arg;
          return chain;
        },
        limit: () => bag.dbSelectLimit(),
        orderBy: () => bag.dbSelectOrderBy(),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (v: InsertValues) => {
        bag.dbInsertValuesArg = v;
        return { returning: () => bag.dbInsertReturning() };
      },
    })),
    // F27: drives updateProject's db.update(p).set(v).where(...).returning()
    update: vi.fn(() => ({
      set: (v: InsertValues) => {
        bag.dbUpdateSetArg = v;
        return { where: () => ({ returning: () => bag.dbUpdateReturning() }) };
      },
    })),
    // F12: drives the service's db.transaction(cb); resets the per-tx insert
    // counter so each test's "first insert = projects" assumption holds.
    transaction: vi.fn(async (cb: (txClient: TxClient) => Promise<unknown>) => {
      txInsertCount = 0;
      return cb(tx);
    }),
  };
  return { db };
});

// DEL-04: mock stopTimersForProject so tests can assert called/not-called
// without touching timeEntries. The factory closes over the hoisted bag.
vi.mock('./timerService', () => ({
  stopTimersForProject: (...args: unknown[]) => bag.stopTimersForProject(...args),
}));

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { createProject, getProjectBySlug, listProjects, updateProject } from './projectService';

function resetBag() {
  bag.dbSelectLimit.mockReset();
  bag.dbSelectOrderBy.mockReset();
  bag.dbInsertReturning.mockReset();
  bag.dbInsertValuesArg = {};
  bag.dbSelectCount.mockReset();
  bag.dbUpdateReturning.mockReset();
  bag.dbUpdateSetArg = {};
  bag.dbSelectWhereArg = undefined;
  bag.txInserts = [];
  bag.stopTimersForProject.mockReset();
}

describe('createProject', () => {
  beforeEach(resetBag);

  it('normalizes slug, inserts, returns row with default columns', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]); // slug not found
    const returningRow = {
      id: 'p1',
      name: 'Slyk',
      slug: 'SLYK',
      columns: [
        { id: 'a', name: 'To Do' },
        { id: 'b', name: 'In Progress' },
        { id: 'c', name: 'Done' },
      ],
      creatorId: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    bag.dbInsertReturning.mockResolvedValueOnce([returningRow]);

    const result = await createProject({ name: 'Slyk', slug: 'slyk', creatorId: 'u1' });

    expect(result.slug).toBe('SLYK');
    expect(bag.dbInsertValuesArg.slug as string).toBe('SLYK');
    expect(result.columns).toHaveLength(3);
    result.columns.forEach((column) => {
      expect(typeof column.id).toBe('string');
      expect(column.name).toBeTruthy();
    });
    // The insert VALUES captured must carry 3 columns with default names + non-empty ids.
    const insertedColumns = bag.dbInsertValuesArg.columns as Array<{ id: string; name: string }>;
    expect(insertedColumns).toHaveLength(3);
    insertedColumns.forEach((column) => {
      expect(column.id.length).toBeGreaterThan(0);
      expect(['To Do', 'In Progress', 'Done']).toContain(column.name);
    });
  });

  it('keeps caller columns + ids', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]);
    const returningRow = {
      id: 'p2',
      name: 'P',
      slug: 'CUSTOM',
      columns: [{ id: 'c1', name: 'Todo' }],
      creatorId: 'u2',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    bag.dbInsertReturning.mockResolvedValueOnce([returningRow]);

    const result = await createProject({
      name: 'P',
      slug: 'custom',
      creatorId: 'u2',
      columns: [{ id: 'c1', name: 'Todo' }],
    });

    expect(bag.dbInsertValuesArg.columns).toEqual([{ id: 'c1', name: 'Todo' }]);
    expect(result.columns).toEqual([{ id: 'c1', name: 'Todo' }]);
  });

  it('rejects with VALIDATION_FAILED on bad slug format (no db call)', async () => {
    const error = await createProject({ name: 'X', slug: '1abc', creatorId: 'u3' }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.dbSelectLimit).not.toHaveBeenCalled();
    expect(bag.dbInsertReturning).not.toHaveBeenCalled();
  });

  it('rejects with VALIDATION_FAILED on reserved slug (no db call)', async () => {
    const error = await createProject({ name: 'X', slug: 'API', creatorId: 'u4' }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.message.toLowerCase()).toContain('reserved');
    expect(bag.dbSelectLimit).not.toHaveBeenCalled();
    expect(bag.dbInsertReturning).not.toHaveBeenCalled();
  });

  it('rejects with CONFLICT on existing slug (no insert)', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([{ id: 'p9', slug: 'TAKEN' }]);

    const error = await createProject({ name: 'X', slug: 'taken', creatorId: 'u5' }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    const details = (error as AppError).details as { slug: string };
    expect(details.slug).toBe('TAKEN');
    expect(bag.dbInsertReturning).not.toHaveBeenCalled();
  });

  // F12: createProject must seed project_sequences (nextNumber = START_TICKET_NUMBER)
  // in the SAME transaction as the project insert.
  const seedCases = [
    { name: 'default columns', slug: 'seeddef', returningId: 'proj-seed-1' },
    { name: 'caller columns', slug: 'seedcus', returningId: 'proj-seed-2' },
  ];
  seedCases.forEach(({ name, slug, returningId }) => {
    it(`seeds project_sequences(nextNumber=START_TICKET_NUMBER) in-tx — ${name}`, async () => {
      bag.dbSelectLimit.mockResolvedValueOnce([]); // slug not found
      const returningRow = {
        id: returningId,
        name: 'Seed',
        slug: slug.toUpperCase(),
        columns: [{ id: 'c1', name: 'Todo' }],
        creatorId: 'u-seed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      bag.dbInsertReturning.mockResolvedValueOnce([returningRow]);

      const result = await createProject({
        name: 'Seed',
        slug,
        creatorId: 'u-seed',
        columns: [{ id: 'c1', name: 'Todo' }],
      });

      // Both inserts ran inside the single transaction, projects first.
      expect(bag.txInserts).toHaveLength(2);

      // First in-tx insert is the PROJECTS row.
      expect(bag.txInserts[0]).toMatchObject({
        name: 'Seed',
        slug: slug.toUpperCase(),
        creatorId: 'u-seed',
      });

      // Second in-tx insert seeds the counter at START_TICKET_NUMBER (SLYK-001).
      const seedInsert = bag.txInserts[1]!;
      expect(seedInsert).toMatchObject({
        projectId: returningId,
        nextNumber: START_TICKET_NUMBER,
      });
      expect(seedInsert.nextNumber).toBe(1); // START_TICKET_NUMBER === 1
      expect(result.id).toBe(returningId);
    });
  });
});

describe('listProjects', () => {
  beforeEach(resetBag);

  it('returns rows ordered by createdAt', async () => {
    const rows = [{ id: 'r1' }, { id: 'r2' }];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listProjects('uid', true);

    expect(result).toEqual(rows);
  });
});

describe('getProjectBySlug', () => {
  beforeEach(resetBag);

  it('returns row when found', async () => {
    const row = { id: 'r1', slug: 'FOUND' };
    bag.dbSelectLimit.mockResolvedValueOnce([row]);

    const result = await getProjectBySlug('found');

    expect(result).toEqual(row);
  });

  it('returns null when not found', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]);

    const result = await getProjectBySlug('missing');

    expect(result).toBeNull();
  });
});

describe('updateProject', () => {
  beforeEach(resetBag);

  const existingColumns = [
    { id: 'a', name: 'To Do' },
    { id: 'b', name: 'Done' },
  ];
  const projectRow = {
    id: 'p1',
    name: 'Slyk',
    slug: 'SLYK',
    columns: existingColumns,
    creatorId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('throws NOT_FOUND when the slug does not exist', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]); // slug not found

    const error = await updateProject({ slug: 'ghost', name: 'X' }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.dbUpdateReturning).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when a removed column still holds live (non-soft-deleted) tickets', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found
    bag.dbSelectCount.mockResolvedValueOnce([{ count: '2' }]); // column 'b' still in use

    const error = await updateProject({
      slug: 'SLYK',
      columns: [{ id: 'a', name: 'To Do' }],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    expect(error.message.toLowerCase()).toContain('cannot delete column');
    expect(bag.dbUpdateReturning).not.toHaveBeenCalled();
  });

  it('updates when a removed column only held soft-deleted tickets (count 0)', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found
    bag.dbSelectCount.mockResolvedValueOnce([{ count: '0' }]); // no live tickets in 'b'
    const updatedRow = { ...projectRow, columns: [{ id: 'a', name: 'To Do' }] };
    bag.dbUpdateReturning.mockResolvedValueOnce([updatedRow]);

    const result = await updateProject({
      slug: 'SLYK',
      columns: [{ id: 'a', name: 'To Do' }],
    });

    expect(result).toEqual(updatedRow);
    expect(bag.dbUpdateReturning).toHaveBeenCalled();
    expect((bag.dbUpdateSetArg.columns as unknown[]).length).toBe(1);
  });

  // NOTE: committed impl throws CONFLICT (not VALIDATION_FAILED) for an empty
  // columns array — tests follow the committed behaviour; flagged in task notes.
  it('rejects an empty columns array (a project needs >= 1 column)', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found

    const error = await updateProject({ slug: 'SLYK', columns: [] }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    expect(bag.dbUpdateReturning).not.toHaveBeenCalled();
  });

  it('persists name and leaves columns untouched when only name is provided', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found
    const updatedRow = { ...projectRow, name: 'Renamed' };
    bag.dbUpdateReturning.mockResolvedValueOnce([updatedRow]);

    const result = await updateProject({ slug: 'SLYK', name: 'Renamed' });

    expect(result.name).toBe('Renamed');
    expect(bag.dbUpdateSetArg.name).toBe('Renamed');
    expect(bag.dbUpdateSetArg.columns).toBeUndefined();
    expect(bag.dbSelectCount).not.toHaveBeenCalled();
  });

  it.each([
    { desc: 'falsy id', columns: [{ id: '', name: 'To Do' }] },
    { desc: 'empty name', columns: [{ id: 'a', name: '' }] },
    { desc: 'whitespace-only name', columns: [{ id: 'a', name: '   ' }] },
  ])('rejects a column with invalid shape ($desc) as VALIDATION_FAILED', async ({ columns }) => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found

    const error = await updateProject({ slug: 'SLYK', columns }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.dbUpdateReturning).not.toHaveBeenCalled();
  });

  it('rejects duplicate column ids as VALIDATION_FAILED', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found

    const error = await updateProject({
      slug: 'SLYK',
      columns: [
        { id: 'a', name: 'To Do' },
        { id: 'a', name: 'Also To Do' },
      ],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.message.toLowerCase()).toContain('unique');
    expect(bag.dbUpdateReturning).not.toHaveBeenCalled();
  });
});

// DEL-04 Task T3 (a): deactivating a project stops all running timers on its
// tickets via stopTimersForProject, called inside the same transaction and
// BEFORE the projects UPDATE. The update set carries isActive:false.
describe('updateProject — DEL-04 deactivation (isActive:false)', () => {
  beforeEach(resetBag);

  const projectRow = {
    id: 'p-deact',
    name: 'Slyk',
    slug: 'SLYK',
    columns: [{ id: 'a', name: 'To Do' }],
    creatorId: 'u1',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('calls stopTimersForProject(tx, project.id) and writes isActive:false', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]); // project found
    const updatedRow = { ...projectRow, isActive: false };
    bag.dbUpdateReturning.mockResolvedValueOnce([updatedRow]);

    const result = await updateProject({ slug: 'SLYK', isActive: false });

    expect(result.isActive).toBe(false);
    // stopTimersForProject invoked once, inside the tx, with the project id.
    expect(bag.stopTimersForProject).toHaveBeenCalledTimes(1);
    expect(bag.stopTimersForProject).toHaveBeenCalledWith(expect.anything(), projectRow.id);
    // The projects UPDATE carries isActive:false (and updatedAt).
    expect(bag.dbUpdateSetArg.isActive).toBe(false);
    // The projects UPDATE actually ran (deactivation is not a no-op).
    expect(bag.dbUpdateReturning).toHaveBeenCalledTimes(1);
  });

  it('does not touch isActive when it is omitted (undefined => no-op)', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]);
    const updatedRow = { ...projectRow, name: 'Renamed' };
    bag.dbUpdateReturning.mockResolvedValueOnce([updatedRow]);

    await updateProject({ slug: 'SLYK', name: 'Renamed' });

    expect(bag.dbUpdateSetArg.isActive).toBeUndefined();
    expect(bag.stopTimersForProject).not.toHaveBeenCalled();
  });
});

// DEL-04 Task T3 (b): reactivating a project must NOT stop timers.
describe('updateProject — DEL-04 reactivation (isActive:true)', () => {
  beforeEach(resetBag);

  const projectRow = {
    id: 'p-react',
    name: 'Slyk',
    slug: 'SLYK',
    columns: [{ id: 'a', name: 'To Do' }],
    creatorId: 'u1',
    isActive: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('does NOT call stopTimersForProject and writes isActive:true', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([projectRow]);
    const updatedRow = { ...projectRow, isActive: true };
    bag.dbUpdateReturning.mockResolvedValueOnce([updatedRow]);

    const result = await updateProject({ slug: 'SLYK', isActive: true });

    expect(result.isActive).toBe(true);
    expect(bag.stopTimersForProject).not.toHaveBeenCalled();
    expect(bag.dbUpdateSetArg.isActive).toBe(true);
  });
});

// DEL-04 Task T3 (c): listProjects member branch excludes inactive projects
// (the membership join is further gated by projects.isActive = true), while
// the Platform-Admin branch still includes them (no .where at all).
describe('listProjects — DEL-04 isActive filter', () => {
  beforeEach(resetBag);

  it('member branch applies a .where predicate (isActive gate present)', async () => {
    const rows = [{ id: 'r1', isActive: true }];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listProjects('uid', false);

    expect(result).toEqual(rows);
    // The member branch must filter; a .where predicate was captured.
    expect(bag.dbSelectWhereArg).toBeDefined();
  });

  it('Platform-Admin branch does NOT filter (sees inactive projects too)', async () => {
    const rows = [
      { id: 'r1', isActive: true },
      { id: 'r2', isActive: false },
    ];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listProjects('uid', true);

    expect(result).toEqual(rows);
    // PA branch is `select().from().orderBy()` — no .where clause at all.
    expect(bag.dbSelectWhereArg).toBeUndefined();
  });
});

// DEL-04 Task T3 (d): a non-PA caller probing a deactivated project gets the
// byte-identical non-revealing FORBIDDEN literal used by the membership deny.
// The membership probe must never run (no db.transaction for membership).
describe('getProjectBySlug — DEL-04 non-revealing deny on inactive project', () => {
  beforeEach(resetBag);

  const FORBIDDEN = 'You do not have access to this project';

  it('throws the byte-identical FORBIDDEN for a non-PA on an inactive project', async () => {
    const inactiveRow = { id: 'p-x', slug: 'GHOST', isActive: false };
    bag.dbSelectLimit.mockResolvedValueOnce([inactiveRow]);

    const error = await getProjectBySlug('ghost', 'uid', false).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.FORBIDDEN);
    expect((error as AppError).message).toBe(FORBIDDEN);
  });

  it('PA bypass still returns an inactive project (no deny)', async () => {
    const inactiveRow = { id: 'p-x', slug: 'GHOST', isActive: false };
    bag.dbSelectLimit.mockResolvedValueOnce([inactiveRow]);

    const result = await getProjectBySlug('ghost', 'uid', true);

    expect(result).toEqual(inactiveRow);
  });
});
