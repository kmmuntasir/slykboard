import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleUserInfo } from './googleOAuth';

// --- Fixtures ---------------------------------------------------------------

const MOCK_ADMIN_ROW = {
  id: 'u-admin',
  googleId: 'g-admin',
  email: 'admin@b.com',
  fullName: 'Admin',
  avatarUrl: null,
  role: 'ADMIN' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_MEMBER_ROW = {
  id: 'u-member',
  googleId: 'g-member',
  email: 'member@b.com',
  fullName: 'Member',
  avatarUrl: null,
  role: 'MEMBER' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// --- Mock wiring ------------------------------------------------------------
//
// vi.mock is hoisted above all imports, so any binding it closes over must be
// created via vi.hoisted (also hoisted). We hold the mutable terminal fns and
// capture vars in one hoisted bag; the factory builds the fluent mock objects
// from it, and tests read/reset the same references.
//
// Service call shapes inside the transaction:
//   tx.select().from(users).where(...).limit(1)     -> Promise<array>  [existing]
//   tx.select({rowCount}).from(users)               -> Promise<array>  [count]
//   tx.update(users).set(...).where(...).returning()  -> Promise<array>
//   tx.insert(users).values(...).returning()        -> Promise<array>  [may throw]
// Top-level (findUserById):
//   db.select().from(users).where(...).limit(1)     -> Promise<array>
//
// Count path's terminal is `.from()`; row-select terminal is `.limit()`.
// `db.transaction` invokes the real callback with mockTx — this is what
// exercises the first-admin / retry logic under test.

const bag = vi.hoisted(() => ({
  txRowSelectLimit: vi.fn(),
  txCountFrom: vi.fn(),
  txInsertReturning: vi.fn(),
  txUpdateReturning: vi.fn(),
  dbSelectLimit: vi.fn(),
  dbSelectOrderBy: vi.fn(),
  txUpdateSetArg: {} as Record<string, unknown>,
  txInsertValuesArg: {} as Record<string, unknown>,
}));

vi.mock('../db/client', () => {
  const mockTx = {
    select: vi.fn((arg?: unknown) => {
      if (arg !== undefined) {
        // count-style: select({rowCount}).from(users) — .from is the terminal
        return { from: () => bag.txCountFrom() };
      }
      // row-select: select().from().where().limit() — .limit is the terminal
      const rowChain = {
        from: () => rowChain,
        where: () => rowChain,
        limit: () => bag.txRowSelectLimit(),
      };
      return rowChain;
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        bag.txInsertValuesArg = v;
        return { returning: () => bag.txInsertReturning() };
      },
    })),
    update: vi.fn(() => ({
      set: (s: Record<string, unknown>) => {
        bag.txUpdateSetArg = s;
        return {
          where: () => ({ returning: () => bag.txUpdateReturning() }),
        };
      },
    })),
  };

  const db = {
    transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
    select: vi.fn((arg?: unknown) => {
      if (arg !== undefined) {
        // F13 T5: select({id, fullName, avatarUrl}).from(users).orderBy(...)
        // — .orderBy is the terminal.
        return { from: () => ({ orderBy: () => bag.dbSelectOrderBy() }) };
      }
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => bag.dbSelectLimit(),
      };
      return chain;
    }),
  };

  return { db };
});

import { findUserById, findUserByGoogleId, listUsers, upsertByGoogleId } from './userService';

function resetBag() {
  bag.txRowSelectLimit.mockReset();
  bag.txCountFrom.mockReset();
  bag.txInsertReturning.mockReset();
  bag.txUpdateReturning.mockReset();
  bag.dbSelectLimit.mockReset();
  bag.dbSelectOrderBy.mockReset();
  bag.txUpdateSetArg = {};
  bag.txInsertValuesArg = {};
}

describe('upsertByGoogleId', () => {
  beforeEach(resetBag);

  const input: GoogleUserInfo = {
    googleId: 'g-admin',
    email: 'admin@b.com',
    fullName: 'Admin',
    avatarUrl: null,
  };

  it('inserts ADMIN when table is empty (first user)', async () => {
    bag.txRowSelectLimit.mockResolvedValueOnce([]); // no existing googleId
    bag.txCountFrom.mockResolvedValueOnce([{ rowCount: 0 }]); // first user
    bag.txInsertReturning.mockResolvedValueOnce([{ ...MOCK_ADMIN_ROW, role: 'ADMIN' }]);

    const result = await upsertByGoogleId(input);

    expect(result.role).toBe('ADMIN');
    expect(bag.txInsertValuesArg.role).toBe('ADMIN');
  });

  it('inserts MEMBER when table is non-empty (subsequent user)', async () => {
    bag.txRowSelectLimit.mockResolvedValueOnce([]);
    bag.txCountFrom.mockResolvedValueOnce([{ rowCount: 1 }]);
    bag.txInsertReturning.mockResolvedValueOnce([{ ...MOCK_MEMBER_ROW, role: 'MEMBER' }]);

    const result = await upsertByGoogleId(input);

    expect(result.role).toBe('MEMBER');
    expect(bag.txInsertValuesArg.role).toBe('MEMBER');
  });

  it('updates profile on conflict (existing googleId)', async () => {
    const existing = { ...MOCK_ADMIN_ROW, role: 'ADMIN' };
    const updated = { ...MOCK_ADMIN_ROW, email: 'new@b.com', fullName: 'New' };
    bag.txRowSelectLimit.mockResolvedValueOnce([existing]);
    bag.txUpdateReturning.mockResolvedValueOnce([updated]);

    const result = await upsertByGoogleId({
      googleId: 'g-admin',
      email: 'new@b.com',
      fullName: 'New',
      avatarUrl: 'http://avatar',
    });

    expect(result.email).toBe('new@b.com');
    expect(bag.txUpdateSetArg.email).toBe('new@b.com');
    expect(bag.txUpdateSetArg.fullName).toBe('New');
    expect(bag.txUpdateSetArg.avatarUrl).toBe('http://avatar');
    expect(bag.txUpdateSetArg.updatedAt).toBeInstanceOf(Date);
    expect(bag.txUpdateSetArg).not.toHaveProperty('role');
    expect(bag.txUpdateSetArg).not.toHaveProperty('id');
    expect(bag.txInsertReturning).not.toHaveBeenCalled();
  });

  it('preserves role on conflict (existing ADMIN stays ADMIN)', async () => {
    const existing = { ...MOCK_ADMIN_ROW, role: 'ADMIN' };
    bag.txRowSelectLimit.mockResolvedValueOnce([existing]);
    bag.txUpdateReturning.mockResolvedValueOnce([existing]);

    await upsertByGoogleId(input);

    expect(bag.txUpdateSetArg).not.toHaveProperty('role');
    expect(bag.txInsertReturning).not.toHaveBeenCalled();
  });

  it('retries as MEMBER on 23505 from users_one_admin', async () => {
    bag.txRowSelectLimit.mockResolvedValueOnce([]); // no existing googleId
    bag.txCountFrom.mockResolvedValueOnce([{ rowCount: 0 }]); // count said 0
    // First insert throws 23505 (users_one_admin race); retry insert succeeds as MEMBER.
    bag.txInsertReturning
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce([{ ...MOCK_MEMBER_ROW, role: 'MEMBER' }]);

    const result = await upsertByGoogleId(input);

    expect(result.role).toBe('MEMBER');
    expect(bag.txInsertValuesArg.role).toBe('MEMBER');
  });

  it('retries as refresh on 23505 from googleId conflict', async () => {
    bag.txRowSelectLimit
      .mockResolvedValueOnce([]) // initial select: no existing googleId
      .mockResolvedValueOnce([MOCK_MEMBER_ROW]); // re-read after double-23505
    bag.txCountFrom.mockResolvedValueOnce([{ rowCount: 0 }]);
    // Both inserts throw 23505 (googleId race on both attempts).
    bag.txInsertReturning
      .mockRejectedValueOnce({ code: '23505' })
      .mockRejectedValueOnce({ code: '23505' });
    const refreshed = { ...MOCK_MEMBER_ROW, email: 'refreshed@b.com' };
    bag.txUpdateReturning.mockResolvedValueOnce([refreshed]);

    const result = await upsertByGoogleId(input);

    expect(result).toEqual(refreshed);
    expect(bag.txUpdateReturning).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-23505 errors', async () => {
    bag.txRowSelectLimit.mockResolvedValueOnce([]);
    bag.txCountFrom.mockResolvedValueOnce([{ rowCount: 0 }]);
    const fkErr = { code: '23503' }; // FK violation, not unique
    bag.txInsertReturning.mockRejectedValueOnce(fkErr);

    await expect(upsertByGoogleId(input)).rejects.toEqual(fkErr);
  });
});

describe('findUserById', () => {
  beforeEach(resetBag);

  it('returns the row when found', async () => {
    const row = { ...MOCK_ADMIN_ROW };
    bag.dbSelectLimit.mockResolvedValueOnce([row]);

    const result = await findUserById('u-admin');

    expect(result).toEqual(row);
  });

  it('returns undefined when not found', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]);

    const result = await findUserById('nope');

    expect(result).toBeUndefined();
  });
});

describe('findUserByGoogleId', () => {
  beforeEach(resetBag);

  it('returns the row when found', async () => {
    const row = { ...MOCK_ADMIN_ROW };
    bag.dbSelectLimit.mockResolvedValueOnce([row]);

    const result = await findUserByGoogleId('g-admin');

    expect(result).toEqual(row);
  });

  it('returns null when not found', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]);

    const result = await findUserByGoogleId('nope');

    expect(result).toBeNull();
  });
});

describe('listUsers', () => {
  beforeEach(resetBag);

  it('returns [] when there are no users', async () => {
    bag.dbSelectOrderBy.mockResolvedValueOnce([]);

    const result = await listUsers();

    expect(result).toEqual([]);
  });

  it('returns a single user with only id/fullName/avatarUrl (no PII)', async () => {
    // Mock returns ONLY the three columns — the select shape itself enforces
    // PII exclusion at the SQL layer (route test verifies by mocking service).
    const row = { id: 'u-admin', fullName: 'Admin', avatarUrl: null };
    bag.dbSelectOrderBy.mockResolvedValueOnce([row]);

    const result = await listUsers();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(row);
    expect(result[0]).not.toHaveProperty('email');
    expect(result[0]).not.toHaveProperty('role');
  });

  it('passes rows through in the order the mock returns them', async () => {
    const rows = [
      { id: 'u-a', fullName: 'Alice', avatarUrl: 'http://a' },
      { id: 'u-b', fullName: 'Bob', avatarUrl: null },
      { id: 'u-c', fullName: 'Carol', avatarUrl: 'http://c' },
    ];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listUsers();

    expect(result).toEqual(rows);
    expect(result.map((r) => r.id)).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('excludes email and role keys from every item (PII guard)', async () => {
    const rows = [
      { id: 'u-a', fullName: 'Alice', avatarUrl: null },
      { id: 'u-b', fullName: 'Bob', avatarUrl: 'http://b' },
    ];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listUsers();

    for (const item of result) {
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('role');
    }
  });
});
