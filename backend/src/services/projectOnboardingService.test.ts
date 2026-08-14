import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0190 — unit tests for projectOnboardingService. Mock wiring follows
// onboardingEventService.test.ts: a vi.hoisted bag + fluent mock db/tx.
//
// createAgentProject issues:
//   (pre) getProjectBySlug(coreSlug)   → db.select().from().where().limit(1)
//   (pre) findMetaBySlug(body.slug)    → db.select().from().where().limit(1)
//   (pre) findSubdomainOwner(sub)      → db.select().from().where().limit(1)
//   (tx)  insertProjectInTx            → tx.insert().values().return()
//        + projectSequences insert     → tx.insert().values()
//   (tx)  addMemberInTx                → tx.insert().values()
//   (tx)  insertMeta                   → tx.insert().values().return()
//   (post) postToDispatcher('/onboard', payload)  — mocked module
//   (fail) markOnboardingFailed        → db.update().set().where()
//
// insertProjectInTx / addMemberInTx are the REAL functions (they only touch
// the mocked tx), so the composed transaction is exercised end-to-end.

const bag = vi.hoisted(() => ({
  // .limit(1) terminal shared by all three pre-check selects; each call pops
  dbSelectLimit: vi.fn(),
  // tx inserts in call order: [projects, projectSequences, projectMembers, ProjectAgentMeta]
  txInserts: [] as Array<Record<string, unknown>>,
  // returning() terminals per insert call
  insertReturnings: [] as Array<Promise<unknown[]>>,
  // markOnboardingFailed: db.update().set(arg).where()
  dbUpdateSetArg: null as Record<string, unknown> | null,
  dbUpdateCallCount: 0,
  // mocked postToDispatcher
  postToDispatcher: vi.fn(),
}));

vi.mock('../db/client', () => {
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        bag.txInserts.push(v);
        return {
          returning: () => {
            // projects insert is call 1; meta insert is call 4 (after
            // sequences + members). Both have returning(); middle two don't.
            const idx = bag.txInserts.length - 1;
            return bag.insertReturnings[Math.min(idx, bag.insertReturnings.length - 1)]!;
          },
        };
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    select: () => ({ from: () => ({ where: () => ({ limit: () => bag.dbSelectLimit() }) }) }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        bag.dbUpdateSetArg = s;
        bag.dbUpdateCallCount += 1;
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return { db };
});

vi.mock('./dispatcherClient', () => ({
  postToDispatcher: bag.postToDispatcher,
  DispatcherError: class DispatcherError extends Error {
    constructor(
      public path: string,
      public status: number,
      public detail: string,
    ) {
      super(`Dispatcher ${path} ${status}: ${detail}`);
    }
  },
}));

import { DispatcherError, postToDispatcher } from './dispatcherClient';
import { createAgentProject } from './projectOnboardingService';

const mockedPost = vi.mocked(postToDispatcher);

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

const PROJECT_ROW = {
  id: PROJECT_ID,
  name: 'Inventory Tracker',
  slug: 'INVENTORYTRACKER',
  columns: [
    { id: 'c1', name: 'To Do' },
    { id: 'c2', name: 'In Progress' },
    { id: 'c3', name: 'Done' },
  ],
  creatorId: CREATOR_ID,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const META_ROW = {
  projectId: PROJECT_ID,
  slug: 'inventory-tracker',
  subdomain: 'inventory-tracker',
  sourceMode: 'new',
  githubRepo: null,
  githubRepoCreated: false,
  stack: 'node-express',
  teamKey: 'INVENTORYTRACKER',
  agentBackend: null,
  initialAgentContext: null,
  lxcCtid: null,
  lanIp: null,
  systemdService: null,
  zoraxyProxyId: null,
  onboardingState: 'PENDING',
  onboardingError: null,
  onboardedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const VALID_BODY = {
  name: 'Inventory Tracker',
  slug: 'inventory-tracker',
  subdomain: 'inventory-tracker',
  sourceMode: 'new',
  githubRepo: null,
  stack: 'node-express',
  agentBackend: null,
  visibility: 'internal',
  initialAgentContext: null,
} as const;

function setupHappyTx() {
  // Four tx inserts: projects (returns row), sequences, members, meta (returns row).
  bag.insertReturnings = [
    Promise.resolve([PROJECT_ROW]),
    Promise.resolve([]), // projectSequences — no returning() call, but keep index aligned
    Promise.resolve([]), // projectMembers
    Promise.resolve([META_ROW]),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  bag.txInserts = [];
  bag.insertReturnings = [];
  bag.dbUpdateSetArg = null;
  bag.dbUpdateCallCount = 0;
  // Default: all three uniqueness pre-checks find nothing.
  bag.dbSelectLimit.mockResolvedValue([]);
  setupHappyTx();
  mockedPost.mockResolvedValue({ orchestratorId: 'orch-1' });
});

describe('createAgentProject — happy path', () => {
  it('creates project + sequence + membership + meta in one tx, then POSTs /onboard', async () => {
    const result = await createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID });

    expect(result.project).toEqual(PROJECT_ROW);
    expect(result.meta).toEqual(META_ROW);

    // Insert order within the single transaction.
    expect(
      bag.txInserts.map((v) =>
        Object.hasOwn(v, 'columns')
          ? 'projects'
          : Object.hasOwn(v, 'nextNumber')
            ? 'sequences'
            : Object.hasOwn(v, 'role')
              ? 'members'
              : 'meta',
      ),
    ).toEqual(['projects', 'sequences', 'members', 'meta']);

    // Core project row carries the board alphabet slug; meta keeps kebab-case.
    expect(bag.txInserts[0]).toMatchObject({
      name: 'Inventory Tracker',
      slug: 'INVENTORYTRACKER',
      creatorId: CREATOR_ID,
    });
    expect(bag.txInserts[0]!.columns).toHaveLength(3);

    // F12: counter seeded at 1 so ticket creation works immediately.
    expect(bag.txInserts[1]).toMatchObject({ projectId: PROJECT_ID, nextNumber: 1 });

    // Creating admin seeded as PROJECT_ADMIN (board usable even if PA flag lost).
    expect(bag.txInserts[2]).toMatchObject({
      projectId: PROJECT_ID,
      userId: CREATOR_ID,
      role: 'PROJECT_ADMIN',
    });

    // Meta row: PENDING comes from the column default (no explicit write).
    expect(bag.txInserts[3]).toMatchObject({
      projectId: PROJECT_ID,
      slug: 'inventory-tracker',
      subdomain: 'inventory-tracker',
      sourceMode: 'new',
      githubRepo: null,
      stack: 'node-express',
      teamKey: 'INVENTORYTRACKER',
    });
    expect(bag.txInserts[3]).not.toHaveProperty('onboardingState');
  });

  it('dispatcher payload matches 07-contract /onboard project shape', async () => {
    await createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID });

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [path, payload] = mockedPost.mock.calls[0]!;
    expect(path).toBe('/onboard');
    expect(payload).toEqual({
      project: {
        id: PROJECT_ID,
        slug: 'inventory-tracker',
        name: 'Inventory Tracker',
        subdomain: 'inventory-tracker',
        sourceMode: 'new',
        githubRepo: null,
        stack: 'node-express',
        teamKey: 'INVENTORYTRACKER',
        agentBackend: null,
        visibility: 'internal',
        initialAgentContext: null,
      },
    });
  });

  it('sourceMode=existing persists githubRepo and forwards it', async () => {
    const repo = 'git@github.com:kmlab/inventory-tracker.git';
    // The meta insert returns the persisted row — reflect the input.
    bag.insertReturnings[3] = Promise.resolve([
      { ...META_ROW, sourceMode: 'existing', githubRepo: repo },
    ]);
    await createAgentProject({
      body: { ...VALID_BODY, sourceMode: 'existing', githubRepo: repo },
      creatorId: CREATOR_ID,
    });

    expect(bag.txInserts[3]).toMatchObject({ sourceMode: 'existing', githubRepo: repo });
    expect(mockedPost.mock.calls[0]![1]).toMatchObject({
      project: { sourceMode: 'existing', githubRepo: repo },
    });
  });
});

describe('createAgentProject — uniqueness pre-checks (CONFLICT)', () => {
  it('core slug taken (plain project with same mapped slug) → 409, no inserts, no dispatcher', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([PROJECT_ROW]); // getProjectBySlug finds one

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });

    expect(bag.txInserts).toHaveLength(0);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('agent slug taken (meta row exists) → 409', async () => {
    bag.dbSelectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([META_ROW]);

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(bag.txInserts).toHaveLength(0);
  });

  it('subdomain taken by a DIFFERENT slug → 409', async () => {
    bag.dbSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...META_ROW, slug: 'other-project' }]);

    await expect(
      createAgentProject({
        body: { ...VALID_BODY, subdomain: 'inventory-tracker' },
        creatorId: CREATOR_ID,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { subdomain: 'inventory-tracker' },
    });
    expect(bag.txInserts).toHaveLength(0);
  });
});

describe('createAgentProject — slug mapping (kebab → board alphabet)', () => {
  it('slug mapping to an invalid board slug (<2 chars after hyphen strip) → 400', async () => {
    await expect(
      createAgentProject({
        body: { ...VALID_BODY, slug: 'a', subdomain: 'a-app' },
        creatorId: CREATOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('slug mapping to >16 chars → 400', async () => {
    const longSlug = 'a'.repeat(17);
    await expect(
      createAgentProject({ body: { ...VALID_BODY, slug: longSlug }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });

  it('slug mapping onto a reserved board slug (admin) → 400', async () => {
    await expect(
      createAgentProject({ body: { ...VALID_BODY, slug: 'admin' }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });
});

describe('createAgentProject — dispatcher failures', () => {
  it('dispatcher 400 → meta marked FAILED + 502 UPSTREAM_FAILED to caller', async () => {
    mockedPost.mockRejectedValue(new DispatcherError('/onboard', 400, 'validation failed: stack'));

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_FAILED',
      status: 502,
      details: { slug: 'inventory-tracker', dispatcherStatus: 400 },
    });

    // FAILED + the dispatcher's message persisted post-commit.
    expect(bag.dbUpdateCallCount).toBe(1);
    expect(bag.dbUpdateSetArg).toEqual({
      onboardingState: 'FAILED',
      onboardingError: 'Dispatcher /onboard 400: validation failed: stack',
    });
  });

  it('dispatcher 409 → FAILED + 502', async () => {
    mockedPost.mockRejectedValue(new DispatcherError('/onboard', 409, 'slug collision'));

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_FAILED',
      status: 502,
      details: { dispatcherStatus: 409 },
    });
    expect(bag.dbUpdateSetArg).toMatchObject({ onboardingState: 'FAILED' });
  });

  it('dispatcher unreachable after retries (status 0) → FAILED + 502', async () => {
    mockedPost.mockRejectedValue(new DispatcherError('/onboard', 0, 'ECONNREFUSED'));

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_FAILED',
      status: 502,
      details: { dispatcherStatus: 0 },
    });
    expect(bag.dbUpdateSetArg).toMatchObject({
      onboardingState: 'FAILED',
      onboardingError: expect.stringContaining('ECONNREFUSED'),
    });
  });

  it('rows still committed when the dispatcher fails (project survives, meta FAILED)', async () => {
    mockedPost.mockRejectedValue(new DispatcherError('/onboard', 400, 'nope'));

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({ status: 502 });

    // The transaction ran fully (4 inserts) BEFORE the dispatcher call.
    expect(bag.txInserts).toHaveLength(4);
  });

  it('a DB failure while marking FAILED does not mask the 502', async () => {
    mockedPost.mockRejectedValue(new DispatcherError('/onboard', 400, 'nope'));
    // markOnboardingFailed's db.update().set() throws.
    const dbModule = await import('../db/client');
    const dbObj = dbModule.db as unknown as {
      update: () => { set: (s: Record<string, unknown>) => { where: () => Promise<unknown[]> } };
    };
    const originalUpdate = dbObj.update.bind(dbObj);
    (dbObj as unknown as { update: typeof dbObj.update }).update = () => ({
      set: () => {
        throw new Error('db down');
      },
    });

    try {
      await expect(
        createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
      ).rejects.toMatchObject({ code: 'UPSTREAM_FAILED', status: 502 });
    } finally {
      (dbObj as unknown as { update: typeof dbObj.update }).update = originalUpdate;
    }
  });
});

describe('createAgentProject — unique-violation race backstop', () => {
  it('tx unique violation on Projects slug → CONFLICT (not 500)', async () => {
    const { db } = (await import('../db/client')) as unknown as {
      db: { transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    };
    const err = Object.assign(new Error('dup'), {
      code: '23505',
      constraint: 'Projects_slug_unique',
    });
    (db as { transaction: unknown }).transaction = vi.fn(async () => {
      throw err;
    });

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { constraint: 'Projects_slug_unique' },
    });
  });

  it('non-unique driver error propagates untouched', async () => {
    const { db } = (await import('../db/client')) as unknown as { db: { transaction: unknown } };
    const err = Object.assign(new Error('boom'), { code: '42P01' });
    (db as { transaction: unknown }).transaction = vi.fn(async () => {
      throw err;
    });

    await expect(
      createAgentProject({ body: { ...VALID_BODY }, creatorId: CREATOR_ID }),
    ).rejects.toBe(err);
  });
});
