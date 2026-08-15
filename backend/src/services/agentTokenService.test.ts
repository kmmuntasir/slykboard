import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0370 — unit tests for agentTokenService. Mock wiring follows
// agentMessageService.test.ts: vi.hoisted bag + a fluent mock db factory.
// The service is single-statement-per-operation (no transaction):
//   createAgentToken → db.insert(agentTokens).values().returning()
//   listAgentTokens → db.select({...6 cols}).from().orderBy()
//   revokeAgentToken → db.update().set().where().returning()
//   listActiveTokenHashes → db.select({tokenHash}).from().where()
// The fake db dispatches on the drizzle table object (reference compare).

const bag = vi.hoisted(() => ({
  // insert().values().returning() terminal
  insertReturning: vi.fn(),
  insertValues: null as unknown,
  // update().set().where().returning() terminal — revoke
  revokeReturning: vi.fn(),
  revokePatch: null as unknown,
  revokeWhere: null as unknown,
  // select chains
  selectColumns: null as unknown, // captured projection (hash-leak assert)
  listThen: [] as unknown[], // list orderBy → then
  activeWhere: null as unknown, // listActiveTokenHashes where() arg
  activeThen: [] as unknown[],
  // table-identity map refreshed in beforeEach (imports are hoisted)
  tables: null as null | Record<string, unknown>,
}));

vi.mock('../db/client', () => {
  const nameOf = (table: unknown): string => {
    for (const [name, t] of Object.entries(bag.tables ?? {})) {
      if (t === table) return name;
    }
    return 'other';
  };
  const db = {
    // Only the middleware path (listActiveTokenHashes) may read outside a
    // transaction; revoke's 404-vs-409 disambiguation also selects — model
    // the plain select chain.
    select: (columns: unknown) => ({
      from: (table: unknown) => {
        if (nameOf(table) !== 'agentTokens') {
          return {
            orderBy: () => ({
              then: (_onF: unknown, onR: unknown) => Promise.reject(onR as never),
            }),
          };
        }
        bag.selectColumns = columns;
        return {
          // list: .orderBy(asc(createdAt)).then
          orderBy: () => ({
            then: (onFulfilled: (v: unknown) => unknown, onRejected: unknown) =>
              Promise.resolve(bag.listThen).then(onFulfilled, onRejected as never),
          }),
          // active hashes: .where(isNull(revokedAt)).then
          where: (w: unknown) => {
            bag.activeWhere = w;
            return {
              then: (onFulfilled: (v: unknown) => unknown, onRejected: unknown) =>
                Promise.resolve(bag.activeThen).then(onFulfilled, onRejected as never),
            };
          },
        };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        bag.insertValues = v;
        return { returning: () => bag.insertReturning() };
      },
    }),
    update: () => ({
      set: (patch: unknown) => {
        bag.revokePatch = patch;
        return {
          where: (w: unknown) => {
            bag.revokeWhere = w;
            return { returning: () => bag.revokeReturning() };
          },
        };
      },
    }),
  };
  return { db };
});

import { createHash } from 'node:crypto';
import { agentTokens } from '../db/schema';
import {
  createAgentToken,
  hashToken,
  listActiveTokenHashes,
  listAgentTokens,
  revokeAgentToken,
} from './agentTokenService';
import { AppError } from '../utils/appError';

const CREATED_AT = new Date('2026-01-01T00:00:00Z');
const REVOKED_AT = new Date('2026-02-01T00:00:00Z');
const TOKEN_ID = '55555555-5555-4555-8555-555555555555';

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN_ID,
    name: 'dispatcher-prod',
    projectId: null,
    createdBy: 'u1',
    revokedAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bag.tables = { agentTokens };
  bag.insertValues = null;
  bag.revokePatch = null;
  bag.revokeWhere = null;
  bag.activeWhere = null;
  bag.selectColumns = null;
});

describe('hashToken', () => {
  it('produces hex sha256 of the raw token (matching node:crypto directly)', () => {
    const raw = 'ab'.repeat(32);
    expect(hashToken(raw)).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createAgentToken', () => {
  it('stores sha256(raw), name, projectId, createdBy; returns raw once + id + name', async () => {
    bag.insertReturning.mockResolvedValue([{ id: TOKEN_ID, name: 'dispatcher-prod' }]);

    const out = await createAgentToken({
      body: { name: 'dispatcher-prod', projectId: null },
      createdBy: 'u1',
    });

    // Raw token is 64-hex and returned in full…
    expect(out).toMatchObject({ id: TOKEN_ID, name: 'dispatcher-prod' });
    expect(out.token).toMatch(/^[0-9a-f]{64}$/);
    // …and ONLY its sha256 was persisted.
    const values = bag.insertValues as {
      tokenHash: string;
      name: string;
      projectId: string | null;
      createdBy: string;
    };
    expect(values.tokenHash).toBe(hashToken(out.token));
    expect(values.tokenHash).not.toBe(out.token);
    expect(values).toMatchObject({ name: 'dispatcher-prod', projectId: null, createdBy: 'u1' });
  });

  it('two generates never produce the same raw token or hash', async () => {
    bag.insertReturning.mockResolvedValue([{ id: TOKEN_ID, name: 'a' }]);
    const first = await createAgentToken({ body: { name: 'a', projectId: null }, createdBy: 'u1' });
    const second = await createAgentToken({
      body: { name: 'a', projectId: null },
      createdBy: 'u1',
    });

    expect(first.token).not.toBe(second.token);
    expect(hashToken(first.token)).not.toBe(hashToken(second.token));
  });

  it('scoped projectId is persisted as given', async () => {
    bag.insertReturning.mockResolvedValue([{ id: TOKEN_ID, name: 'scoped' }]);
    const projectId = '33333333-3333-4333-8333-333333333333';
    await createAgentToken({ body: { name: 'scoped', projectId }, createdBy: 'u1' });

    expect(bag.insertValues).toMatchObject({ projectId });
  });
});

describe('listAgentTokens', () => {
  it('returns rows without any hash field (projection has none to leak)', async () => {
    bag.listThen = [
      tokenRow(),
      tokenRow({
        id: '66666666-6666-4666-8666-666666666666',
        name: 'dispatcher-staging',
        revokedAt: REVOKED_AT,
      }),
    ];

    const rows = await listAgentTokens();

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('tokenHash');
      expect(JSON.stringify(row)).not.toContain('tokenHash');
    }
    expect(rows[0]).toEqual(tokenRow());
    expect(rows[1]!.revokedAt).toEqual(REVOKED_AT);
  });
});

describe('revokeAgentToken', () => {
  it('sets revokedAt = now on a live row', async () => {
    bag.revokeReturning.mockResolvedValue([{ id: TOKEN_ID, revokedAt: null }]);

    await expect(revokeAgentToken(TOKEN_ID)).resolves.toBeUndefined();

    expect(bag.revokePatch).toHaveProperty('revokedAt');
    expect((bag.revokePatch as { revokedAt: Date }).revokedAt).toBeInstanceOf(Date);
  });

  it('already-revoked row → CONFLICT 409 with the prior revokedAt', async () => {
    bag.revokeReturning.mockResolvedValue([{ id: TOKEN_ID, revokedAt: REVOKED_AT }]);

    await expect(revokeAgentToken(TOKEN_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { id: TOKEN_ID, revokedAt: REVOKED_AT },
    });
  });

  it('unknown id → NOT_FOUND 404 with details.id', async () => {
    bag.revokeReturning.mockResolvedValue([]);

    await expect(revokeAgentToken(TOKEN_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      details: { id: TOKEN_ID },
    });
  });

  it('rejects with AppError instances (errorMiddleware contract)', async () => {
    bag.revokeReturning.mockResolvedValue([]);
    await expect(revokeAgentToken(TOKEN_ID)).rejects.toBeInstanceOf(AppError);
  });
});

describe('listActiveTokenHashes', () => {
  it('projects tokenHash only and filters via where() (revoked excluded)', async () => {
    bag.activeThen = [{ tokenHash: 'a'.repeat(64) }, { tokenHash: 'b'.repeat(64) }];

    const hashes = await listActiveTokenHashes();

    expect(hashes).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(bag.selectColumns).toHaveProperty('tokenHash');
    expect(Object.keys(bag.selectColumns as object)).toEqual(['tokenHash']);
    expect(bag.activeWhere).toBeDefined();
  });
});
