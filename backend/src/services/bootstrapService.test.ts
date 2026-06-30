import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock wiring ------------------------------------------------------------
//
// ensureBootstrapAdmin reads env (bootstrapAdminEmail, allowedDomain,
// bootstrapAdminFullName/DisplayName), logs via logger, and does all DB work
// inside ONE db.transaction. The domain gate calls the REAL normalizeEmailDomain
// from accessControl (which reads env.allowedDomain) — so the env mock below is
// shared with accessControl. process.exit is spied per-suite to assert the
// hard-stop on a domain mismatch.

const testEnv = vi.hoisted(() => ({
  env: {
    bootstrapAdminEmail: undefined as string | undefined,
    bootstrapAdminFullName: undefined as string | undefined,
    bootstrapAdminDisplayName: undefined as string | undefined,
    allowedDomain: undefined as string | undefined,
  },
}));

vi.mock('../config', () => ({ env: testEnv.env }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const bag = vi.hoisted(() => ({
  // tx.select().from().where().limit()  -> existing-row lookup
  txSelectLimit: vi.fn(),
  // tx.insert().values().returning()    -> create path
  txInsertReturning: vi.fn(),
  // tx.update().set().where().returning() -> promote path
  txUpdateReturning: vi.fn(),
  txInsertValuesArg: {} as Record<string, unknown>,
  txUpdateSetArg: {} as Record<string, unknown>,
}));

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
        return { returning: () => bag.txInsertReturning() };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        bag.txUpdateSetArg = s;
        return { where: () => ({ returning: () => bag.txUpdateReturning() }) };
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  };
  return { db };
});

import { ensureBootstrapAdmin } from './bootstrapService';
import { db } from '../db/client';
import { logger } from '../config/logger';

function resetBag() {
  bag.txSelectLimit.mockReset();
  bag.txInsertReturning.mockReset();
  bag.txUpdateReturning.mockReset();
  bag.txInsertValuesArg = {};
  bag.txUpdateSetArg = {};
  testEnv.env.bootstrapAdminEmail = undefined;
  testEnv.env.bootstrapAdminFullName = undefined;
  testEnv.env.bootstrapAdminDisplayName = undefined;
  testEnv.env.allowedDomain = undefined;
  vi.mocked(db.transaction).mockClear();
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.error).mockClear();
}

describe('ensureBootstrapAdmin', () => {
  beforeEach(() => {
    resetBag();
    // process.exit hard-stops the process on a domain mismatch; throw to make
    // the rejection observable inside a test (the real impl never returns).
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  it('is a no-op (disabled) when BOOTSTRAP_ADMIN_EMAIL is unset — logs + returns', async () => {
    testEnv.env.bootstrapAdminEmail = undefined;

    await ensureBootstrapAdmin();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Bootstrap admin disabled'),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('is a no-op when BOOTSTRAP_ADMIN_EMAIL is empty/whitespace', async () => {
    testEnv.env.bootstrapAdminEmail = '   ';

    await ensureBootstrapAdmin();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Bootstrap admin disabled'),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('inserts a brand-new Platform Admin when no row exists', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@allowed.com';
    testEnv.env.bootstrapAdminFullName = 'Boss';
    bag.txSelectLimit.mockResolvedValueOnce([]); // no existing row
    bag.txInsertReturning.mockResolvedValueOnce([{}]);

    await ensureBootstrapAdmin();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(bag.txInsertValuesArg).toMatchObject({
      email: 'admin@allowed.com',
      fullName: 'Boss',
      googleId: null,
      isPlatformAdmin: true,
      blocked: false,
    });
    expect(bag.txUpdateReturning).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Bootstrap platform admin created'),
    );
  });

  it('is idempotent when the row already has isPlatformAdmin=true (no-op)', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@allowed.com';
    bag.txSelectLimit.mockResolvedValueOnce([{ id: 'u1', email: 'admin@allowed.com', isPlatformAdmin: true }]);

    await ensureBootstrapAdmin();

    expect(bag.txInsertReturning).not.toHaveBeenCalled();
    expect(bag.txUpdateReturning).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('already configured'),
    );
  });

  it('promotes an existing non-PA row to Platform Admin', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@allowed.com';
    bag.txSelectLimit.mockResolvedValueOnce([{ id: 'u1', isPlatformAdmin: false }]);
    bag.txUpdateReturning.mockResolvedValueOnce([{}]);

    await ensureBootstrapAdmin();

    expect(bag.txUpdateSetArg.isPlatformAdmin).toBe(true);
    expect(bag.txInsertReturning).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('promoted'),
    );
  });

  it('hard-stops (process.exit 1) when ALLOWED_DOMAIN mismatches the bootstrap email', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@evil.com';
    testEnv.env.allowedDomain = 'allowed.com';

    await expect(ensureBootstrapAdmin()).rejects.toThrow('process.exit called');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ bootstrapAdminEmail: 'admin@evil.com' }),
      expect.stringContaining('does not match ALLOWED_DOMAIN'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    // No DB work ran.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does NOT enforce the domain gate when ALLOWED_DOMAIN is unset', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@anywhere.com';
    testEnv.env.allowedDomain = undefined;
    bag.txSelectLimit.mockResolvedValueOnce([]);
    bag.txInsertReturning.mockResolvedValueOnce([{}]);

    await ensureBootstrapAdmin();

    expect(bag.txInsertValuesArg.email).toBe('admin@anywhere.com');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('admits the bootstrap email when its domain matches ALLOWED_DOMAIN', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@allowed.com';
    testEnv.env.allowedDomain = 'allowed.com';
    bag.txSelectLimit.mockResolvedValueOnce([]);
    bag.txInsertReturning.mockResolvedValueOnce([{}]);

    await ensureBootstrapAdmin();

    expect(bag.txInsertValuesArg.email).toBe('admin@allowed.com');
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('defaults fullName to the bootstrap email when BOOTSTRAP_ADMIN_FULL_NAME is unset', async () => {
    testEnv.env.bootstrapAdminEmail = 'admin@allowed.com';
    bag.txSelectLimit.mockResolvedValueOnce([]);
    bag.txInsertReturning.mockResolvedValueOnce([{}]);

    await ensureBootstrapAdmin();

    expect(bag.txInsertValuesArg.fullName).toBe('admin@allowed.com');
  });
});
