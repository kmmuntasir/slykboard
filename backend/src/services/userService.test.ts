import { beforeEach, describe, expect, it, vi } from 'vitest';

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
// SLYK-01 Task O: the global role enum is gone. userService now exposes:
//   findUserByEmail / findUserById   — db.select().from().where().limit(1)
//   listUsers                        — db.select({shape}).from().orderBy()
//   linkGoogleId                     — db.update().set().where().returning()
//                                       (+ re-read db.select().limit(1) on 0 rows;
//                                        23505 on the update -> FORBIDDEN mismatch)
//   createUser                       — db.insert().values().returning()
//   setPlatformAdmin                 — db.select().limit(1) [existing row],
//                                       db.select({count}).from().where() [last-admin guard],
//                                       db.update().set().where().returning() + bumpTokenVersion
//   setUserBlocked                   — db.update().set().where().returning() + bumpTokenVersion
//
// The fluent mock below routes every call shape above to a controllable bag fn.

const bag = vi.hoisted(() => ({
  // select(no-arg).from().where().limit()  -> row lookup (findUserByEmail/ById, setPlatformAdmin existing)
  selectLimit: vi.fn(),
  // select({count}).from().where()         -> setPlatformAdmin last-admin guard count
  selectCount: vi.fn(),
  // select({shape}).from().orderBy()       -> listUsers
  selectList: vi.fn(),
  // insert().values().returning()          -> createUser
  insertReturning: vi.fn(),
  // update().set().where().returning()     -> linkGoogleId / setPlatformAdmin update / setUserBlocked
  updateReturning: vi.fn(),
  bumpTokenVersion: vi.fn(),
  insertValuesArg: {} as Record<string, unknown>,
  updateSetArg: {} as Record<string, unknown>,
}));

// env mock — mutable allowedDomain so createUser's domain gate can be exercised.
const testEnv = vi.hoisted(() => ({
  env: {
    allowedDomain: undefined as string | undefined,
  },
}));

vi.mock('../config', () => ({ env: testEnv.env }));
vi.mock('../services/tokenVersion', () => ({
  bumpTokenVersion: bag.bumpTokenVersion,
  findUserTokenVersion: vi.fn(),
}));

vi.mock('../db/client', () => {
  // select() with NO arg → row-lookup chain (limit terminal).
  const noArgChain = {
    from: () => noArgChain,
    where: () => noArgChain,
    limit: () => bag.selectLimit(),
  };
  // select() WITH an arg → serves BOTH the count query (where terminal) and the
  // listUsers query (orderBy terminal). Branch on which method terminates.
  const argChain = {
    from: () => argChain,
    where: () => bag.selectCount(),
    orderBy: () => bag.selectList(),
  };

  const db = {
    select: vi.fn((selectArg?: unknown) => {
      if (selectArg !== undefined) return argChain;
      return noArgChain;
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        bag.insertValuesArg = v;
        return { returning: () => bag.insertReturning() };
      },
    })),
    update: vi.fn(() => ({
      set: (s: Record<string, unknown>) => {
        bag.updateSetArg = s;
        return { where: () => ({ returning: () => bag.updateReturning() }) };
      },
    })),
  };

  return { db };
});

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import {
  createUser,
  findUserByEmail,
  findUserById,
  linkGoogleId,
  listUsers,
  setPlatformAdmin,
  setUserBlocked,
} from './userService';

function resetBag() {
  bag.selectLimit.mockReset();
  bag.selectCount.mockReset();
  bag.selectList.mockReset();
  bag.insertReturning.mockReset();
  bag.updateReturning.mockReset();
  bag.bumpTokenVersion.mockReset();
  bag.insertValuesArg = {};
  bag.updateSetArg = {};
  testEnv.env.allowedDomain = undefined;
}

// ---------------------------------------------------------------------------
// findUserByEmail / findUserById (login-gate + /me helpers)
// ---------------------------------------------------------------------------

describe('findUserByEmail', () => {
  beforeEach(resetBag);

  it.each([
    { name: 'returns the row when found', input: 'admin@b.com', want: MOCK_USER_ROW, rows: [MOCK_USER_ROW] },
    { name: 'returns undefined when not found', input: 'nobody@b.com', want: undefined, rows: [] },
  ])('$name', async ({ input, want, rows }) => {
    bag.selectLimit.mockResolvedValueOnce(rows);
    await expect(findUserByEmail(input)).resolves.toEqual(want);
  });
});

describe('findUserById', () => {
  beforeEach(resetBag);

  it('returns the row when found', async () => {
    bag.selectLimit.mockResolvedValueOnce([MOCK_USER_ROW]);
    await expect(findUserById('u-admin')).resolves.toEqual(MOCK_USER_ROW);
  });

  it('returns undefined when not found', async () => {
    bag.selectLimit.mockResolvedValueOnce([]);
    await expect(findUserById('nope')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// linkGoogleId (first-login race-safe link + identity-mismatch defense)
// ---------------------------------------------------------------------------

describe('linkGoogleId', () => {
  beforeEach(resetBag);

  it('sets googleId and returns the row on first link (UPDATE matched 1 row)', async () => {
    const linked = { ...MOCK_USER_ROW, googleId: 'g-new' };
    bag.updateReturning.mockResolvedValueOnce([linked]);

    const result = await linkGoogleId('u-admin', 'g-new');

    expect(result).toEqual(linked);
    expect(bag.updateSetArg.googleId).toBe('g-new');
    // First-link update must never touch identity/admin fields.
    expect(bag.updateSetArg).not.toHaveProperty('isPlatformAdmin');
  });

  it('re-reads and returns the row when UPDATE matched 0 rows but googleId already matches (race)', async () => {
    // update returns [] (lost the race), re-read returns the same-id row.
    bag.updateReturning.mockResolvedValueOnce([]);
    const raced = { ...MOCK_USER_ROW, googleId: 'g-admin' };
    bag.selectLimit.mockResolvedValueOnce([raced]);

    const result = await linkGoogleId('u-admin', 'g-admin');

    expect(result).toEqual(raced);
    expect(bag.selectLimit).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN on identity mismatch when the stored googleId differs', async () => {
    bag.updateReturning.mockResolvedValueOnce([]);
    bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, googleId: 'g-real' }]);

    await expect(linkGoogleId('u-admin', 'g-attacker')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Account identity mismatch',
    });
  });

  it('throws NOT_FOUND when the account no longer exists (UPDATE 0 + re-read empty)', async () => {
    bag.updateReturning.mockResolvedValueOnce([]);
    bag.selectLimit.mockResolvedValueOnce([]);

    await expect(linkGoogleId('u-ghost', 'g-x')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });
  });

  it('surfaces a 23505 unique violation as FORBIDDEN identity mismatch (googleId bound elsewhere)', async () => {
    bag.updateReturning.mockRejectedValueOnce({ code: '23505' });

    await expect(linkGoogleId('u-admin', 'g-collision')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'Account identity mismatch',
    });
  });

  it('re-throws non-23505 errors from the update', async () => {
    const fkErr = { code: '23503' }; // FK violation, not unique
    bag.updateReturning.mockRejectedValueOnce(fkErr);

    await expect(linkGoogleId('u-admin', 'g-x')).rejects.toEqual(fkErr);
  });
});

// ---------------------------------------------------------------------------
// createUser (member-management provisioning)
// ---------------------------------------------------------------------------

describe('createUser', () => {
  beforeEach(resetBag);

  it('inserts a new user with isPlatformAdmin=false and googleId=null, returns the row', async () => {
    const inserted = { ...MOCK_USER_ROW, id: 'u-new', googleId: null, isPlatformAdmin: false };
    bag.insertReturning.mockResolvedValueOnce([inserted]);

    const result = await createUser({ email: 'new@b.com', fullName: 'New', displayName: 'N' });

    expect(result).toEqual(inserted);
    expect(bag.insertValuesArg).toMatchObject({
      email: 'new@b.com',
      fullName: 'New',
      displayName: 'N',
      googleId: null,
      isPlatformAdmin: false,
      blocked: false,
    });
    // New users are never platform admins; no role field exists.
    expect(bag.insertValuesArg).not.toHaveProperty('role');
  });

  it('defaults displayName to null when omitted', async () => {
    bag.insertReturning.mockResolvedValueOnce([MOCK_USER_ROW]);
    await createUser({ email: 'x@b.com', fullName: 'X' });
    expect(bag.insertValuesArg.displayName).toBeNull();
  });

  it('throws FORBIDDEN when the email domain is outside ALLOWED_DOMAIN (gate runs before insert)', async () => {
    testEnv.env.allowedDomain = 'allowed.com';

    await expect(
      createUser({ email: 'x@evil.com', fullName: 'Evil' }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    // Zero side effects — the insert never ran.
    expect(bag.insertReturning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setPlatformAdmin (promotion / demotion + last-platform-admin guard)
// ---------------------------------------------------------------------------

describe('setPlatformAdmin', () => {
  beforeEach(resetBag);

  it('promotes a member (existing PA=false → true): updates + bumps token version', async () => {
    bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, isPlatformAdmin: false }]);
    const updated = { ...MOCK_USER_ROW, isPlatformAdmin: true };
    bag.updateReturning.mockResolvedValueOnce([updated]);

    const result = await setPlatformAdmin('u-admin', true);

    expect(result.isPlatformAdmin).toBe(true);
    expect(bag.updateSetArg.isPlatformAdmin).toBe(true);
    expect(bag.bumpTokenVersion).toHaveBeenCalledWith('u-admin');
  });

  it('demotes a PA when more than one PA exists: updates + bumps token version', async () => {
    bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, isPlatformAdmin: true }]);
    bag.selectCount.mockResolvedValueOnce([{ count: 2 }]); // 2 PAs → safe to demote
    const updated = { ...MOCK_USER_ROW, isPlatformAdmin: false };
    bag.updateReturning.mockResolvedValueOnce([updated]);

    const result = await setPlatformAdmin('u-admin', false);

    expect(result.isPlatformAdmin).toBe(false);
    expect(bag.bumpTokenVersion).toHaveBeenCalledWith('u-admin');
  });

  it('is a no-op when the value is not changing (skips guard + token bump)', async () => {
    bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, isPlatformAdmin: true }]);

    const result = await setPlatformAdmin('u-admin', true);

    expect(result.isPlatformAdmin).toBe(true);
    expect(bag.updateReturning).not.toHaveBeenCalled();
    expect(bag.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when demoting the last platform admin', async () => {
    bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, isPlatformAdmin: true }]);
    bag.selectCount.mockResolvedValueOnce([{ count: 1 }]); // only PA

    await expect(setPlatformAdmin('u-admin', false)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'Cannot remove the last platform admin',
    });
    expect(bag.updateReturning).not.toHaveBeenCalled();
    expect(bag.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('treats a missing count row as 0 → CONFLICT (defensive last-admin guard)', async () => {
    bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, isPlatformAdmin: true }]);
    bag.selectCount.mockResolvedValueOnce([]); // defensive: no count row → 0

    await expect(setPlatformAdmin('u-admin', false)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    expect(bag.updateReturning).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the target user does not exist', async () => {
    bag.selectLimit.mockResolvedValueOnce([]);

    await expect(setPlatformAdmin('u-ghost', true)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });
    expect(bag.updateReturning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setUserBlocked (activate/deactivate)
// ---------------------------------------------------------------------------

describe('setUserBlocked', () => {
  beforeEach(resetBag);

  it.each([
    { name: 'blocks a user (true)', blocked: true },
    { name: 'reactivates a user (false)', blocked: false },
  ])('$name', async ({ blocked }) => {
    // pre-fetch returns a row currently in the opposite state (non-PA)
    bag.selectLimit.mockResolvedValueOnce([
      { ...MOCK_USER_ROW, isPlatformAdmin: false, blocked: !blocked },
    ]);
    const updated = { ...MOCK_USER_ROW, blocked };
    bag.updateReturning.mockResolvedValueOnce([updated]);

    const result = await setUserBlocked({
      targetUserId: 'u-admin',
      blocked,
      actingUserId: 'u-other',
    });

    expect(result.blocked).toBe(blocked);
    expect(bag.updateSetArg.blocked).toBe(blocked);
    expect(bag.bumpTokenVersion).toHaveBeenCalledWith('u-admin');
  });

  it('throws NOT_FOUND when the target user does not exist (pre-fetch empty)', async () => {
    bag.selectLimit.mockResolvedValueOnce([]);

    await expect(
      setUserBlocked({ targetUserId: 'u-ghost', blocked: true, actingUserId: 'u-other' }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, message: 'User not found' });
    expect(bag.bumpTokenVersion).not.toHaveBeenCalled();
  });

  // --- net-new cases for the actingUserId + order-of-checks signature --------

  it('FORBIDDEN: an actor cannot deactivate itself (self-check runs before pre-fetch)', async () => {
    await expect(
      setUserBlocked({ targetUserId: 'u1', blocked: true, actingUserId: 'u1' }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'You cannot deactivate yourself',
    });
    // self-check runs before pre-fetch and before any update
    expect(bag.selectLimit).not.toHaveBeenCalled();
    expect(bag.updateReturning).not.toHaveBeenCalled();
  });

  it('FORBIDDEN: self-block still rejected even when already blocked (self-check before no-op short-circuit)', async () => {
    // No mock seeding — proves the self-check fires before the pre-fetch /
    // no-op short-circuit.
    await expect(
      setUserBlocked({ targetUserId: 'u1', blocked: true, actingUserId: 'u1' }),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'You cannot deactivate yourself',
    });
    expect(bag.selectLimit).not.toHaveBeenCalled();
    expect(bag.updateReturning).not.toHaveBeenCalled();
  });

  it('self-unblock is allowed: an actor can reactivate itself', async () => {
    bag.selectLimit.mockResolvedValueOnce([
      { ...MOCK_USER_ROW, isPlatformAdmin: false, blocked: true },
    ]);
    const updated = { ...MOCK_USER_ROW, blocked: false };
    bag.updateReturning.mockResolvedValueOnce([updated]);

    const result = await setUserBlocked({
      targetUserId: 'u1',
      blocked: false,
      actingUserId: 'u1',
    });

    expect(result.blocked).toBe(false);
    expect(bag.bumpTokenVersion).toHaveBeenCalledWith('u1');
  });

  it('blocks a non-last platform admin: update + token bump', async () => {
    bag.selectLimit.mockResolvedValueOnce([
      { ...MOCK_USER_ROW, isPlatformAdmin: true, blocked: false },
    ]);
    bag.selectCount.mockResolvedValueOnce([{ count: 2 }]); // 2 PAs → safe
    const updated = { ...MOCK_USER_ROW, blocked: true };
    bag.updateReturning.mockResolvedValueOnce([updated]);

    const result = await setUserBlocked({
      targetUserId: 'u-admin',
      blocked: true,
      actingUserId: 'u-other',
    });

    expect(result.blocked).toBe(true);
    expect(bag.bumpTokenVersion).toHaveBeenCalledWith('u-admin');
  });

  it('CONFLICT: blocking the last platform admin is rejected', async () => {
    bag.selectLimit.mockResolvedValueOnce([
      { ...MOCK_USER_ROW, isPlatformAdmin: true, blocked: false },
    ]);
    bag.selectCount.mockResolvedValueOnce([{ count: 1 }]); // only PA

    await expect(
      setUserBlocked({ targetUserId: 'u-admin', blocked: true, actingUserId: 'u-other' }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'Cannot remove the last platform admin',
    });
    expect(bag.updateReturning).not.toHaveBeenCalled();
    expect(bag.bumpTokenVersion).not.toHaveBeenCalled();
  });

  it('CONFLICT: a missing count row is treated as 0 (defensive last-PA guard)', async () => {
    bag.selectLimit.mockResolvedValueOnce([
      { ...MOCK_USER_ROW, isPlatformAdmin: true, blocked: false },
    ]);
    bag.selectCount.mockResolvedValueOnce([]); // defensive: no count row → 0

    await expect(
      setUserBlocked({ targetUserId: 'u-admin', blocked: true, actingUserId: 'u-other' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(bag.updateReturning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listUsers (three-tier shape: isPlatformAdmin + displayName, no role)
// ---------------------------------------------------------------------------

describe('listUsers', () => {
  beforeEach(resetBag);

  it('returns [] when there are no users', async () => {
    bag.selectList.mockResolvedValueOnce([]);
    await expect(listUsers()).resolves.toEqual([]);
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
    bag.selectList.mockResolvedValueOnce([row]);

    const result = await listUsers();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(row);
    expect(result[0]).not.toHaveProperty('role');
  });

  it('passes rows through in the order the mock returns them', async () => {
    const rows = [
      { id: 'u-a', email: 'a@x.com', fullName: 'Alice', displayName: null, isPlatformAdmin: false, avatarUrl: 'http://a', blocked: false },
      { id: 'u-b', email: 'b@x.com', fullName: 'Bob', displayName: null, isPlatformAdmin: true, avatarUrl: null, blocked: false },
      { id: 'u-c', email: 'c@x.com', fullName: 'Carol', displayName: null, isPlatformAdmin: false, avatarUrl: 'http://c', blocked: false },
    ];
    bag.selectList.mockResolvedValueOnce(rows);

    const result = await listUsers();

    expect(result).toEqual(rows);
    expect(result.map((r) => r.id)).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('never exposes a role key on any item', async () => {
    const rows = [
      { id: 'u-a', email: 'a@x.com', fullName: 'Alice', displayName: null, isPlatformAdmin: false, avatarUrl: null, blocked: false },
      { id: 'u-b', email: 'b@x.com', fullName: 'Bob', displayName: null, isPlatformAdmin: true, avatarUrl: 'http://b', blocked: false },
    ];
    bag.selectList.mockResolvedValueOnce(rows);

    const result = await listUsers();
    for (const item of result) {
      expect(item).not.toHaveProperty('role');
    }
  });
});
