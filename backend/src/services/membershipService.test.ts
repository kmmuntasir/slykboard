import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock wiring ------------------------------------------------------------
//
// membershipService owns ALL project_members access. Two tx contexts:
//   (a) isProjectMember / getMemberRole receive a `tx` arg from their CALLER
//       (middleware) — tests pass the shared tx mock directly.
//   (b) addMember / addExistingMember / createAndAddMember run inside
//       db.transaction(cb); db.transaction invokes cb(txMock).
//
// The tx insert/update mocks are THENABLE objects that also expose a
// `.returning()` method: addMember calls `await tx.insert().values()` (no
// returning) while addExistingMember / createAndAddMember call
// `await tx.insert().values().returning()`. The thenable wraps the same promise
// either way, so a queued rejection propagates to BOTH call shapes (this is how
// the 23505 unique-violation is surfaced).

const bag = vi.hoisted(() => ({
  // tx.select().from().where().limit()  -> isProjectMember / getMemberRole
  txSelectLimit: vi.fn(),
  // tx.insert().values() / .returning() -> addMember / addExistingMember / createAndAddMember
  txInsertReturning: vi.fn(),
  // tx.update().set().where() / .returning() -> 23505 idempotent-update path
  txUpdateReturning: vi.fn(),
  // db.select().from().innerJoin().where().orderBy() -> listProjectMembers
  dbListRows: vi.fn(),
  // db.delete().where().returning() -> removeMember
  dbDeleteReturning: vi.fn(),
  // db.update().set().where().returning() -> promoteToProjectAdmin / setMemberRole
  dbUpdateReturning: vi.fn(),
  // userService.findUserById -> addExistingMember PA pre-check
  findUserById: vi.fn(),
  txInsertValuesArg: {} as Record<string, unknown>,
  txUpdateSetArg: {} as Record<string, unknown>,
  dbUpdateSetArg: {} as Record<string, unknown>,
}));

// Mutable env so createAndAddMember's domain gate can be exercised.
const testEnv = vi.hoisted(() => ({ env: { allowedDomain: undefined as string | undefined } }));

vi.mock('../config', () => ({ env: testEnv.env }));
vi.mock('../services/userService', () => ({ findUserById: bag.findUserById }));
vi.mock('../db/client', () => {
  const tx = {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => bag.txSelectLimit(),
      };
      return chain;
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        bag.txInsertValuesArg = v;
        const p = bag.txInsertReturning();
        return {
          // thenable so `await tx.insert().values()` (no .returning) works.
          then: (onF: unknown, onR: unknown) =>
            p.then(() => (onF as (v: undefined) => void)?.(undefined), onR as (e: unknown) => void),
          returning: () => p,
        };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        bag.txUpdateSetArg = s;
        const p = bag.txUpdateReturning();
        return {
          where: () => ({
            then: (onF: unknown, onR: unknown) =>
              p.then(() => (onF as (v: undefined) => void)?.(undefined), onR as (e: unknown) => void),
            returning: () => p,
          }),
        };
      },
    }),
  };

  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => bag.dbListRows() }) }) }),
    }),
    delete: () => ({ where: () => ({ returning: () => bag.dbDeleteReturning() }) }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        bag.dbUpdateSetArg = s;
        return { where: () => ({ returning: () => bag.dbUpdateReturning() }) };
      },
    }),
  };

  return { db };
});

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { db } from '../db/client';
import {
  addExistingMember,
  addMember,
  createAndAddMember,
  getMemberRole,
  isProjectMember,
  listProjectMembers,
  promoteToProjectAdmin,
  removeMember,
  setMemberRole,
} from './membershipService';

// Pull the tx out of the mocked db.transaction by running a throwaway callback;
// isProjectMember / getMemberRole receive this tx as their first argument.
async function getTx(): Promise<Record<string, (...a: unknown[]) => unknown>> {
  let captured: Record<string, (...a: unknown[]) => unknown> | undefined;
  await db.transaction(async (t) => {
    captured = t as unknown as Record<string, (...a: unknown[]) => unknown>;
  });
  return captured!;
}

function resetBag() {
  bag.txSelectLimit.mockReset();
  bag.txInsertReturning.mockReset();
  bag.txUpdateReturning.mockReset();
  bag.dbListRows.mockReset();
  bag.dbDeleteReturning.mockReset();
  bag.dbUpdateReturning.mockReset();
  bag.findUserById.mockReset();
  bag.txInsertValuesArg = {};
  bag.txUpdateSetArg = {};
  bag.dbUpdateSetArg = {};
  testEnv.env.allowedDomain = undefined;
  // Clear call history on db.transaction (shared vi.fn) without resetting its
  // implementation; getTx() in other tests also calls it.
  vi.mocked(db.transaction).mockClear();
}

const PROJECT_ID = 'proj-1';
const USER_ID = 'user-1';

const membershipRow = {
  projectId: PROJECT_ID,
  userId: USER_ID,
  role: 'MEMBER' as const,
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// isProjectMember / getMemberRole (tx-passed reads)
// ---------------------------------------------------------------------------

describe('isProjectMember', () => {
  beforeEach(resetBag);

  it('returns true when a membership row exists', async () => {
    const t = await getTx();
    bag.txSelectLimit.mockResolvedValueOnce([{ projectId: PROJECT_ID }]);
    await expect(isProjectMember(t as never, PROJECT_ID, USER_ID)).resolves.toBe(true);
  });

  it('returns false when no membership row exists', async () => {
    const t = await getTx();
    bag.txSelectLimit.mockResolvedValueOnce([]);
    await expect(isProjectMember(t as never, PROJECT_ID, USER_ID)).resolves.toBe(false);
  });
});

describe('getMemberRole', () => {
  beforeEach(resetBag);

  it.each([
    { name: "PROJECT_ADMIN", role: 'PROJECT_ADMIN' },
    { name: "MEMBER", role: 'MEMBER' },
  ])('returns the tier ($name) for an existing member', async ({ role }) => {
    const t = await getTx();
    bag.txSelectLimit.mockResolvedValueOnce([{ role }]);
    await expect(getMemberRole(t as never, PROJECT_ID, USER_ID)).resolves.toBe(role);
  });

  it('returns null for a non-member', async () => {
    const t = await getTx();
    bag.txSelectLimit.mockResolvedValueOnce([]);
    await expect(getMemberRole(t as never, PROJECT_ID, USER_ID)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listProjectMembers
// ---------------------------------------------------------------------------

describe('listProjectMembers', () => {
  beforeEach(resetBag);

  it('returns the roster shape joined with users', async () => {
    const rows = [
      {
        userId: USER_ID,
        email: 'm@x.com',
        fullName: 'Member',
        displayName: null,
        avatarUrl: null,
        role: 'MEMBER',
        createdAt: new Date(),
      },
    ];
    bag.dbListRows.mockResolvedValueOnce(rows);

    const result = await listProjectMembers(PROJECT_ID);

    expect(result).toEqual(rows);
  });

  it('returns [] when a project has no members', async () => {
    bag.dbListRows.mockResolvedValueOnce([]);
    await expect(listProjectMembers(PROJECT_ID)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addMember (idempotent on 23505)
// ---------------------------------------------------------------------------

describe('addMember', () => {
  beforeEach(resetBag);

  it('inserts a new membership with the given role (default MEMBER)', async () => {
    bag.txInsertReturning.mockResolvedValueOnce([]); // values() awaited, result ignored

    await addMember(PROJECT_ID, USER_ID);

    expect(bag.txInsertValuesArg).toMatchObject({
      projectId: PROJECT_ID,
      userId: USER_ID,
      role: 'MEMBER',
    });
    expect(bag.txUpdateReturning).not.toHaveBeenCalled();
  });

  it('inserts with role PROJECT_ADMIN when supplied', async () => {
    bag.txInsertReturning.mockResolvedValueOnce([]);
    await addMember(PROJECT_ID, USER_ID, 'PROJECT_ADMIN');
    expect(bag.txInsertValuesArg.role).toBe('PROJECT_ADMIN');
  });

  it('is idempotent on 23505: updates the existing row instead of surfacing the conflict', async () => {
    bag.txInsertReturning.mockRejectedValueOnce({ code: '23505' }); // insert rejects
    bag.txUpdateReturning.mockResolvedValueOnce([]); // update path

    await addMember(PROJECT_ID, USER_ID, 'PROJECT_ADMIN');

    expect(bag.txUpdateSetArg.role).toBe('PROJECT_ADMIN');
  });

  it('re-throws non-23505 errors from the insert', async () => {
    const fkErr = { code: '23503' };
    bag.txInsertReturning.mockRejectedValueOnce(fkErr);

    await expect(addMember(PROJECT_ID, USER_ID)).rejects.toEqual(fkErr);
    expect(bag.txUpdateReturning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addExistingMember (idempotent on 23505, returns the membership row)
// ---------------------------------------------------------------------------

describe('addExistingMember', () => {
  beforeEach(resetBag);

  it('inserts and returns the membership row on a fresh add (non-PA target)', async () => {
    bag.findUserById.mockResolvedValueOnce({ id: USER_ID, isPlatformAdmin: false });
    const inserted = { ...membershipRow, role: 'PROJECT_ADMIN' };
    bag.txInsertReturning.mockResolvedValueOnce([inserted]);

    const result = await addExistingMember(PROJECT_ID, USER_ID, 'PROJECT_ADMIN');

    expect(result).toEqual(inserted);
    expect(bag.txInsertValuesArg).toMatchObject({ projectId: PROJECT_ID, userId: USER_ID });
  });

  it('defaults to MEMBER when role is omitted', async () => {
    bag.findUserById.mockResolvedValueOnce({ id: USER_ID, isPlatformAdmin: false });
    bag.txInsertReturning.mockResolvedValueOnce([membershipRow]);
    await addExistingMember(PROJECT_ID, USER_ID);
    expect(bag.txInsertValuesArg.role).toBe('MEMBER');
  });

  it('is idempotent on 23505: re-fetches via UPDATE + returns the updated row', async () => {
    bag.findUserById.mockResolvedValueOnce({ id: USER_ID, isPlatformAdmin: false });
    bag.txInsertReturning.mockRejectedValueOnce({ code: '23505' });
    const updated = { ...membershipRow, role: 'PROJECT_ADMIN' };
    bag.txUpdateReturning.mockResolvedValueOnce([updated]);

    const result = await addExistingMember(PROJECT_ID, USER_ID, 'PROJECT_ADMIN');

    expect(result).toEqual(updated);
    expect(bag.txUpdateSetArg.role).toBe('PROJECT_ADMIN');
  });

  it('re-throws non-23505 errors from the insert', async () => {
    bag.findUserById.mockResolvedValueOnce({ id: USER_ID, isPlatformAdmin: false });
    bag.txInsertReturning.mockRejectedValueOnce({ code: '23503' });
    await expect(addExistingMember(PROJECT_ID, USER_ID)).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects with CONFLICT "Already a member" for a Platform Admin target and inserts no row', async () => {
    bag.findUserById.mockResolvedValueOnce({ id: USER_ID, isPlatformAdmin: true });

    await expect(addExistingMember(PROJECT_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'Already a member',
    });

    // PA short-circuit runs BEFORE the transaction → no insert attempted.
    expect(bag.txInsertReturning).not.toHaveBeenCalled();
    expect(bag.txUpdateReturning).not.toHaveBeenCalled();
  });

  it('rejects with NOT_FOUND "User not found" for an unknown userId', async () => {
    bag.findUserById.mockResolvedValueOnce(undefined);

    await expect(addExistingMember(PROJECT_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });

    expect(bag.txInsertReturning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe('removeMember', () => {
  beforeEach(resetBag);

  it('deletes the membership row', async () => {
    bag.dbDeleteReturning.mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: USER_ID }]);
    await expect(removeMember(PROJECT_ID, USER_ID)).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND (non-revealing "User not found") when no membership exists', async () => {
    bag.dbDeleteReturning.mockResolvedValueOnce([]); // 0 rows affected
    await expect(removeMember(PROJECT_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });
  });
});

// ---------------------------------------------------------------------------
// promoteToProjectAdmin
// ---------------------------------------------------------------------------

describe('promoteToProjectAdmin', () => {
  beforeEach(resetBag);

  it('sets the member tier to PROJECT_ADMIN', async () => {
    bag.dbUpdateReturning.mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: USER_ID }]);
    await promoteToProjectAdmin(PROJECT_ID, USER_ID);
    expect(bag.dbUpdateSetArg.role).toBe('PROJECT_ADMIN');
  });

  it('throws NOT_FOUND "User not found" when the user is not a member', async () => {
    bag.dbUpdateReturning.mockResolvedValueOnce([]);
    await expect(promoteToProjectAdmin(PROJECT_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });
  });
});

// ---------------------------------------------------------------------------
// setMemberRole
// ---------------------------------------------------------------------------

describe('setMemberRole', () => {
  beforeEach(resetBag);

  it.each(['PROJECT_ADMIN', 'MEMBER'] as const)('sets the tier to %s on an existing member', async (role) => {
    bag.dbUpdateReturning.mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: USER_ID }]);
    await setMemberRole(PROJECT_ID, USER_ID, role);
    expect(bag.dbUpdateSetArg.role).toBe(role);
  });

  it('throws NOT_FOUND "User not found" when demoting a non-member (no silent create)', async () => {
    bag.dbUpdateReturning.mockResolvedValueOnce([]);
    await expect(setMemberRole(PROJECT_ID, USER_ID, 'MEMBER')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'User not found',
    });
  });
});

// ---------------------------------------------------------------------------
// createAndAddMember (domain gate + single-transaction provisioning)
// ---------------------------------------------------------------------------

describe('createAndAddMember', () => {
  beforeEach(resetBag);

  it('inserts the user then the membership in one transaction and returns both', async () => {
    const userRow = {
      id: 'u-new',
      email: 'new@allowed.com',
      fullName: 'New',
      displayName: null,
      isPlatformAdmin: false,
    };
    const memberRow = { projectId: PROJECT_ID, userId: 'u-new', role: 'MEMBER', createdAt: new Date() };
    bag.txInsertReturning
      .mockResolvedValueOnce([userRow]) // users insert
      .mockResolvedValueOnce([memberRow]); // project_members insert

    const result = await createAndAddMember('new@allowed.com', 'New', null, PROJECT_ID);

    expect(result.user).toEqual(userRow);
    expect(result.membership).toEqual(memberRow);
    expect(bag.txInsertValuesArg).toMatchObject({ projectId: PROJECT_ID, userId: 'u-new', role: 'MEMBER' });
    // Exactly two inserts ran inside the one db.transaction.
    expect(bag.txInsertReturning).toHaveBeenCalledTimes(2);
  });

  it('honors the supplied PROJECT_ADMIN role', async () => {
    bag.txInsertReturning
      .mockResolvedValueOnce([{ id: 'u-x', email: 'x@allowed.com', fullName: 'X', displayName: null, isPlatformAdmin: false }])
      .mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: 'u-x', role: 'PROJECT_ADMIN', createdAt: new Date() }]);

    await createAndAddMember('x@allowed.com', 'X', null, PROJECT_ID, 'PROJECT_ADMIN');

    expect(bag.txInsertValuesArg.role).toBe('PROJECT_ADMIN');
  });

  it('throws FORBIDDEN before any insert when the email domain is outside ALLOWED_DOMAIN (zero side effects)', async () => {
    testEnv.env.allowedDomain = 'allowed.com';

    await expect(
      createAndAddMember('evil@evil.com', 'Evil', null, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    // The domain gate runs BEFORE the transaction → no inserts.
    expect(bag.txInsertReturning).not.toHaveBeenCalled();
  });

  it('runs both inserts inside a single db.transaction', async () => {
    bag.txInsertReturning
      .mockResolvedValueOnce([{ id: 'u-a', email: 'a@allowed.com', fullName: 'A', displayName: null, isPlatformAdmin: false }])
      .mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: 'u-a', role: 'MEMBER', createdAt: new Date() }]);

    await createAndAddMember('a@allowed.com', 'A', null, PROJECT_ID);

    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('maps a duplicate-email 23505 on the users insert to CONFLICT "User already exists" and skips the project_members insert', async () => {
    testEnv.env.allowedDomain = 'allowed.com';
    bag.txInsertReturning.mockRejectedValueOnce({ code: '23505' }); // users insert

    await expect(
      createAndAddMember('dup@allowed.com', 'Dup', null, PROJECT_ID),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, message: 'User already exists' });

    // Only the users insert ran — the project_members insert did not execute.
    expect(bag.txInsertReturning).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-23505 errors from the users insert unchanged', async () => {
    testEnv.env.allowedDomain = 'allowed.com';
    const fkErr = { code: '23503' };
    bag.txInsertReturning.mockRejectedValueOnce(fkErr);

    await expect(
      createAndAddMember('x@allowed.com', 'X', null, PROJECT_ID),
    ).rejects.toEqual(fkErr);

    expect(bag.txInsertReturning).toHaveBeenCalledTimes(1);
  });
});

