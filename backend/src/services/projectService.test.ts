import { beforeEach, describe, expect, it, vi } from 'vitest';

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
// Find path's terminal is `.limit()`; list path's terminal is `.orderBy()`.

const bag = vi.hoisted(() => ({
  dbSelectLimit: vi.fn(),
  dbSelectOrderBy: vi.fn(),
  dbInsertReturning: vi.fn(),
  dbInsertValuesArg: {} as Record<string, unknown>,
}));

vi.mock('../db/client', () => {
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => bag.dbSelectLimit(),
        orderBy: () => bag.dbSelectOrderBy(),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        bag.dbInsertValuesArg = v;
        return { returning: () => bag.dbInsertReturning() };
      },
    })),
  };
  return { db };
});

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { createProject, getProjectBySlug, listProjects } from './projectService';

function resetBag() {
  bag.dbSelectLimit.mockReset();
  bag.dbSelectOrderBy.mockReset();
  bag.dbInsertReturning.mockReset();
  bag.dbInsertValuesArg = {};
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
    expect((bag.dbInsertValuesArg.slug as string)).toBe('SLYK');
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

    const error = await createProject({ name: 'X', slug: 'taken', creatorId: 'u5' }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    const details = (error as AppError).details as { slug: string };
    expect(details.slug).toBe('TAKEN');
    expect(bag.dbInsertReturning).not.toHaveBeenCalled();
  });
});

describe('listProjects', () => {
  beforeEach(resetBag);

  it('returns rows ordered by createdAt', async () => {
    const rows = [{ id: 'r1' }, { id: 'r2' }];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listProjects();

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
