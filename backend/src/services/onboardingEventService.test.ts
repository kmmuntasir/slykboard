import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0200 — unit tests for onboardingEventService. Mock wiring follows
// timerService.test.ts: vi.hoisted bag + a fluent mock tx/db factory.
//
// recordOnboardingEvent runs inside db.transaction(cb) and issues:
//   (a) tx.select({ projectId }).from(projectAgentMeta).where().limit(1)
//   (b) tx.update(projectAgentMeta).set(patch).where()
//   (c) tx.insert(onboardingEvents).values({...}).returning()
//
// getDeployTarget issues off `db` directly:
//   db.select({...}).from(projects).innerJoin(projectAgentMeta).where().limit(1)

const bag = vi.hoisted(() => ({
  // (a) meta lookup .limit(1) terminal — resolves to rows array
  metaLimit: vi.fn(),
  // (b) meta update .where() terminal
  txUpdateWhere: vi.fn(),
  txUpdateSetArg: {} as Record<string, unknown>,
  txUpdateCallCount: 0,
  // (c) insert .returning() terminal — resolves to rows array
  insertReturning: vi.fn(),
  insertValues: null as unknown,
  insertCallCount: 0,
  // deploy-target join .limit(1) terminal — resolves to rows array
  deployLimit: vi.fn(),
  // SLYK-0230 timeline: project-name .limit(1) terminal (tx select)
  projectLimit: vi.fn(),
  // SLYK-0230 timeline: events .orderBy() terminal (tx select)
  eventsOrderBy: vi.fn(),
}));

vi.mock('../db/client', () => {
  // The tx select chain is shared by three call sites with different
  // terminals: meta lookup + project-name lookup end in .limit(1), the
  // events list ends in .orderBy(). The chain factories below key on a
  // call counter — meta is the first select, project the second, events
  // the third (getOnboardingTimeline call order).
  let selectCall = 0;
  const tx = {
    select: () => {
      selectCall += 1;
      const call = selectCall;
      return {
        from: () => ({
          where: () => ({
            limit: () => (call === 1 ? bag.metaLimit() : bag.projectLimit()),
            orderBy: () => bag.eventsOrderBy(),
          }),
        }),
      };
    },
    update: () => ({
      set: (s: Record<string, unknown>) => {
        bag.txUpdateSetArg = s;
        bag.txUpdateCallCount += 1;
        return { where: () => bag.txUpdateWhere() };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        bag.insertValues = v;
        bag.insertCallCount += 1;
        return { returning: () => bag.insertReturning() };
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => {
      selectCall = 0;
      return cb(tx);
    }),
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => bag.deployLimit() }) }) }),
    }),
  };
  return { db };
});

import { onboardingEvents, projectAgentMeta } from '../db/schema';
import {
  recordOnboardingEvent,
  getDeployTarget,
  getOnboardingTimeline,
} from './onboardingEventService';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

const EVENT_ROW = {
  id: '44444444-4444-4444-8444-444444444444',
  projectId: PROJECT_ID,
  fromState: 'PROVISIONING_LXC',
  toState: 'WIRING_GITHUB',
  detail: { ctid: 142 },
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  bag.metaLimit.mockResolvedValue([{ projectId: PROJECT_ID }]);
  bag.txUpdateWhere.mockResolvedValue(undefined);
  bag.insertReturning.mockResolvedValue([EVENT_ROW]);
});

describe('recordOnboardingEvent', () => {
  it('inserts the event and advances onboardingState in one transaction', async () => {
    const event = await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'PROVISIONING_LXC', toState: 'WIRING_GITHUB', detail: { ctid: 142 } },
    });

    expect(event).toEqual(EVENT_ROW);
    expect(bag.txUpdateCallCount).toBe(1);
    expect(bag.txUpdateSetArg).toEqual({ onboardingState: 'WIRING_GITHUB' });
    expect(bag.insertValues).toMatchObject({
      projectId: PROJECT_ID,
      fromState: 'PROVISIONING_LXC',
      toState: 'WIRING_GITHUB',
      detail: { ctid: 142 },
    });
  });

  it('fromState=null (first event) inserts with null fromState', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: null, toState: 'PROVISIONING_LXC' },
    });

    expect(bag.insertValues).toMatchObject({ fromState: null, toState: 'PROVISIONING_LXC' });
  });

  it('toState=LIVE also stamps onboardedAt', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'SMOKE_TEST', toState: 'LIVE' },
    });

    const stamp = bag.txUpdateSetArg.onboardedAt;
    expect(stamp).toBeInstanceOf(Date);
    // Doc says now() — accept anything within a minute of the call.
    expect(Math.abs(Date.now() - (stamp as Date).getTime())).toBeLessThan(60_000);
    expect(bag.txUpdateSetArg.onboardingState).toBe('LIVE');
  });

  it('toState=FAILED stores detail.error text in onboardingError', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'SMOKE_TEST', toState: 'FAILED', detail: { error: 'ctid exhausted' } },
    });

    expect(bag.txUpdateSetArg).toEqual({
      onboardingState: 'FAILED',
      onboardingError: 'ctid exhausted',
    });
  });

  it('toState=FAILED without detail stores null onboardingError', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'SMOKE_TEST', toState: 'FAILED' },
    });

    expect(bag.txUpdateSetArg).toEqual({ onboardingState: 'FAILED', onboardingError: null });
  });

  it('unknown slug → NOT_FOUND before any write', async () => {
    bag.metaLimit.mockResolvedValue([]);

    const callsBefore = { update: bag.txUpdateCallCount, insert: bag.insertCallCount };
    await expect(
      recordOnboardingEvent({ slug: 'ghost', body: { fromState: null, toState: 'LIVE' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    expect(bag.txUpdateCallCount).toBe(callsBefore.update);
    expect(bag.insertCallCount).toBe(callsBefore.insert);
  });

  it('intermediate states touch neither onboardedAt nor onboardingError', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'WIRING_GITHUB', toState: 'WIRING_AGENT' },
    });

    expect(bag.txUpdateSetArg).toEqual({ onboardingState: 'WIRING_AGENT' });
  });
});

describe('getDeployTarget', () => {
  const META_ROW = {
    onboardingState: 'LIVE',
    lxcCtid: 142,
    lanIp: '192.168.31.142',
    systemdService: 'inventory-tracker-backend',
    subdomain: 'inventory-tracker',
    stack: 'node-express',
  };

  it('returns the five deploy fields for a LIVE project', async () => {
    bag.deployLimit.mockResolvedValue([META_ROW]);

    await expect(getDeployTarget('inventory-tracker')).resolves.toEqual({
      lxcCtid: 142,
      lanIp: '192.168.31.142',
      systemdService: 'inventory-tracker-backend',
      subdomain: 'inventory-tracker',
      stack: 'node-express',
    });
  });

  it('non-LIVE project → CONFLICT with current state in details', async () => {
    bag.deployLimit.mockResolvedValue([{ ...META_ROW, onboardingState: 'PROVISIONING_LXC' }]);

    await expect(getDeployTarget('inventory-tracker')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { slug: 'inventory-tracker', onboardingState: 'PROVISIONING_LXC' },
    });
  });

  it('unknown slug (join empty) → NOT_FOUND', async () => {
    bag.deployLimit.mockResolvedValue([]);

    await expect(getDeployTarget('ghost')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('DECOMMISSIONED is non-LIVE → CONFLICT (terminal states gated too)', async () => {
    bag.deployLimit.mockResolvedValue([{ ...META_ROW, onboardingState: 'DECOMMISSIONED' }]);

    await expect(getDeployTarget('inventory-tracker')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });
});

// Compile-time coupling only: importing the tables here guarantees the service
// and the tests reference the same schema module (drizzle table objects don't
// expose a runtime name property).
void onboardingEvents;
void projectAgentMeta;

// ── SLYK-0210 AC: mock streams DECOMMISSIONING→DECOMMISSIONED events → state
// lands DECOMMISSIONED. The callback path is generic (SLYK-0200) — decommission
// needs no special-casing, and these tests pin that contract.
describe('recordOnboardingEvent — decommission lifecycle (SLYK-0210)', () => {
  it('toState=DECOMMISSIONING advances the state and appends the event', async () => {
    const event = await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'LIVE', toState: 'DECOMMISSIONING' },
    });

    expect(event).toEqual(EVENT_ROW);
    // No onboardedAt/onboardingError side effects — pure state advance.
    expect(bag.txUpdateSetArg).toEqual({ onboardingState: 'DECOMMISSIONING' });
    expect(bag.insertValues).toMatchObject({
      fromState: 'LIVE',
      toState: 'DECOMMISSIONING',
    });
  });

  it('toState=DECOMMISSIONED lands terminal (LIVE → teardown complete)', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'DECOMMISSIONING', toState: 'DECOMMISSIONED' },
    });

    expect(bag.txUpdateSetArg).toEqual({ onboardingState: 'DECOMMISSIONED' });
    expect(bag.insertValues).toMatchObject({
      fromState: 'DECOMMISSIONING',
      toState: 'DECOMMISSIONED',
    });
  });

  it('dispatcher terminal event with detail (e.g. deleted ctid) is stored verbatim', async () => {
    await recordOnboardingEvent({
      slug: 'inventory-tracker',
      body: { fromState: 'DECOMMISSIONING', toState: 'DECOMMISSIONED', detail: { ctid: 142 } },
    });

    expect(bag.insertValues).toMatchObject({
      toState: 'DECOMMISSIONED',
      detail: { ctid: 142 },
    });
  });
});

// ── SLYK-0230 — GET /api/v1/me/projects/:slug/onboarding/events read side.
describe('getOnboardingTimeline', () => {
  const META_ROW = {
    projectId: PROJECT_ID,
    slug: 'inventory-tracker',
    onboardingState: 'PROVISIONING_LXC' as const,
    onboardingError: null as string | null,
  };

  const EVENT_ROWS = [
    {
      id: '44444444-4444-4444-8444-444444444444',
      projectId: PROJECT_ID,
      fromState: null,
      toState: 'PENDING',
      detail: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '45454545-4545-4545-8555-454545454545',
      projectId: PROJECT_ID,
      fromState: 'PENDING',
      toState: 'PROVISIONING_LXC',
      detail: { ctid: 142, lanIp: '192.168.31.142' },
      createdAt: new Date('2026-01-01T00:00:01Z'),
    },
  ];

  beforeEach(() => {
    bag.metaLimit.mockResolvedValue([META_ROW]);
    bag.projectLimit.mockResolvedValue([{ name: 'Inventory Tracker' }]);
    bag.eventsOrderBy.mockResolvedValue(EVENT_ROWS);
  });

  it('returns { project: {name, slug, onboardingState, onboardingError}, events asc }', async () => {
    const view = await getOnboardingTimeline('inventory-tracker');

    expect(view).toEqual({
      project: {
        name: 'Inventory Tracker',
        slug: 'inventory-tracker',
        onboardingState: 'PROVISIONING_LXC',
        onboardingError: null,
      },
      events: EVENT_ROWS,
    });
  });

  it('FAILED project carries onboardingError through to the timeline', async () => {
    bag.metaLimit.mockResolvedValue([
      { ...META_ROW, onboardingState: 'FAILED', onboardingError: 'ctid exhausted' },
    ]);

    const view = await getOnboardingTimeline('inventory-tracker');
    expect(view.project.onboardingError).toBe('ctid exhausted');
    expect(view.project.onboardingState).toBe('FAILED');
  });

  it('unknown slug → NOT_FOUND before the project/events reads', async () => {
    bag.metaLimit.mockResolvedValue([]);

    await expect(getOnboardingTimeline('ghost')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(bag.projectLimit).not.toHaveBeenCalled();
    expect(bag.eventsOrderBy).not.toHaveBeenCalled();
  });

  it('orphaned meta (project row gone) → NOT_FOUND, events never read', async () => {
    bag.projectLimit.mockResolvedValue([]);

    await expect(getOnboardingTimeline('inventory-tracker')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(bag.eventsOrderBy).not.toHaveBeenCalled();
  });
});
