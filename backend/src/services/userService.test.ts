import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleUserInfo } from './googleOAuth';

// --- Fixtures ---------------------------------------------------------------

const MOCK_USER_ROW = {
  id: 'u-admin',
  googleId: 'g-admin',
  email: 'admin@b.com',
  fullName: 'Admin',
  displayName: null,
  avatarUrl: null,
  isPlatformAdmin: false,
  tokenVersion: 0,
  blocked: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// --- Mock wiring ------------------------------------------------------------
//
// SLYK-01 Task D: the global role enum is gone, so upsertByGoogleId no longer
// counts rows or derives a role. The insert path takes the schema default
// (isPlatformAdmin=false); platform-admin provisioning is owned by the
// bootstrap service (Task E). The only 23505 race remaining is a googleId
// conflict (users_one_admin was dropped) -> re-read + refresh.
//
// Service call shapes inside the transaction:
//   tx.select().from(users).where(...).limit(1)     -> Promise<array>  [existing]
//   tx.update(users).set(...).where(...).returning()  -> Promise<array>
//   tx.insert(users).values(...).returning()        -> Promise<array>  [may throw]
// Top-level (findUserById, findUserByGoogleId, listUsers):
//   db.select().from(users).where(...).limit(1)     -> Promise<array>
//   db.select({...}).from(users).orderBy(...)       -> Promise<array>

const bag = vi.hoisted(() => ({
  txRowSelectLimit: vi.fn(),
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
      void arg;
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
        // listUsers: select({id, fullName, ...}).from(users).orderBy(...)
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
  bag.txInsertReturning.mockReset();
  bag.txUpdateReturning.mockReset();
  bag.dbSelectLimit.mockReset();
  bag.dbSelectOrderBy.mockReset();
  bag.txUpdateSetArg = {};
  bag.txInsertValuesArg = {};
}

describe('upsertByGoogleId (SLYK-01: no role, no first-user admin logic)', () => {
  beforeEach(resetBag);

  const input: GoogleUserInfo = {
    googleId: 'g-admin',
    email: 'admin@b.com',
    fullName: 'Admin',
    avatarUrl: null,
  };

  it('inserts a new user when no existing googleId (no role derivation)', async () => {
    bag.txRowSelectLimit.mockResolvedValueOnce([]); // no existing googleId
    bag.txInsertReturning.mockResolvedValueOnce([{ ...MOCK_USER_ROW }]);

    const result = await upsertByGoogleId(input);

    expect(result.id).toBe(MOCK_USER_ROW.id);
    // SLYK-01: insert values never carry a role; isPlatformAdmin defaults at the DB.
    expect(bag.txInsertValuesArg).not.toHaveProperty('role');
    expect(bag.txInsertValuesArg).not.toHaveProperty('isPlatformAdmin');
    expect(bag.txInsertValuesArg.googleId).toBe('g-admin');
  });

  it('updates profile on conflict (existing googleId)', async () => {
    const existing = { ...MOCK_USER_ROW };
    const updated = { ...MOCK_USER_ROW, email: 'new@b.com', fullName: 'New' };
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
    // Conflict path must not rewrite identity/admin fields.
    expect(bag.txUpdateSetArg).not.toHaveProperty('role');
    expect(bag.txUpdateSetArg).not.toHaveProperty('isPlatformAdmin');
    expect(bag.txUpdateSetArg).not.toHaveProperty('id');
    expect(bag.txInsertReturning).not.toHaveBeenCalled();
  });

  it('refreshes on 23505 googleId conflict (re-read + update)', async () => {
    bag.txRowSelectLimit
      .mockResolvedValueOnce([]) // initial select: no existing googleId
      .mockResolvedValueOnce([MOCK_USER_ROW]); // re-read after 23505
    bag.txInsertReturning.mockRejectedValueOnce({ code: '23505' });
    const refreshed = { ...MOCK_USER_ROW, email: 'refreshed@b.com' };
    bag.txUpdateReturning.mockResolvedValueOnce([refreshed]);

    const result = await upsertByGoogleId(input);

    expect(result).toEqual(refreshed);
    expect(bag.txUpdateReturning).toHaveBeenCalledTimes(1);
    expect(bag.txUpdateSetArg).not.toHaveProperty('role');
  });

  it('re-throws non-23505 errors', async () => {
    bag.txRowSelectLimit.mockResolvedValueOnce([]);
    const fkErr = { code: '23503' }; // FK violation, not unique
    bag.txInsertReturning.mockRejectedValueOnce(fkErr);

    await expect(upsertByGoogleId(input)).rejects.toEqual(fkErr);
  });
});

describe('findUserById', () => {
  beforeEach(resetBag);

  it('returns the row when found', async () => {
    const row = { ...MOCK_USER_ROW };
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
    const row = { ...MOCK_USER_ROW };
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

describe('listUsers (SLYK-01 shape: isPlatformAdmin + displayName, no role)', () => {
  beforeEach(resetBag);

  it('returns [] when there are no users', async () => {
    bag.dbSelectOrderBy.mockResolvedValueOnce([]);

    const result = await listUsers();

    expect(result).toEqual([]);
  });

  it('returns the full three-tier shape and never a role key', async () => {
    const row = {
      id: 'u-admin',
      email: 'admin@b.com',
      fullName: 'Admin',
      displayName: null,
      isPlatformAdmin: false,
      avatarUrl: null,
      blocked: false,
    };
    bag.dbSelectOrderBy.mockResolvedValueOnce([row]);

    const result = await listUsers();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(row);
    expect(result[0]).not.toHaveProperty('role');
  });

  it('passes rows through in the order the mock returns them', async () => {
    const rows = [
      {
        id: 'u-a',
        email: 'a@x.com',
        fullName: 'Alice',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: 'http://a',
        blocked: false,
      },
      {
        id: 'u-b',
        email: 'b@x.com',
        fullName: 'Bob',
        displayName: null,
        isPlatformAdmin: true,
        avatarUrl: null,
        blocked: false,
      },
      {
        id: 'u-c',
        email: 'c@x.com',
        fullName: 'Carol',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: 'http://c',
        blocked: false,
      },
    ];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listUsers();

    expect(result).toEqual(rows);
    expect(result.map((r) => r.id)).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('never exposes a role key on any item', async () => {
    const rows = [
      {
        id: 'u-a',
        email: 'a@x.com',
        fullName: 'Alice',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: null,
        blocked: false,
      },
      {
        id: 'u-b',
        email: 'b@x.com',
        fullName: 'Bob',
        displayName: null,
        isPlatformAdmin: true,
        avatarUrl: 'http://b',
        blocked: false,
      },
    ];
    bag.dbSelectOrderBy.mockResolvedValueOnce(rows);

    const result = await listUsers();

    for (const item of result) {
      expect(item).not.toHaveProperty('role');
    }
  });
});
