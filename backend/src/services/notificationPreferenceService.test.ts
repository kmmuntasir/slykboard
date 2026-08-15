import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0390 — unit tests for the notification-preference service. Mock
// wiring follows agentWaitingNotifyService.test.ts: vi.hoisted bag + fluent
// mock db. The service issues:
//   (a) db.select().from(notificationPreferences).where().limit(1)  — read
//   (b) db.insert(...).values(...).onConflictDoUpdate(...).returning() — upsert

const bag = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  insertReturning: vi.fn(),
  // Captured call args for the upsert assertions.
  insertValues: null as Record<string, unknown> | null,
  conflictTarget: null as unknown[] | null,
  conflictSet: null as Record<string, unknown> | null,
}));

vi.mock('../db/client', () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => bag.selectLimit() }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        bag.insertValues = v;
        return {
          onConflictDoUpdate: (cfg: { target: unknown[]; set: Record<string, unknown> }) => {
            bag.conflictTarget = cfg.target;
            bag.conflictSet = cfg.set;
            return { returning: () => bag.insertReturning() };
          },
        };
      },
    }),
  };
  return { db };
});

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  saveNotificationPreferences,
} from './notificationPreferenceService';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    notifyOnDone: true,
    notifyOnBlockedHuman: true,
    notifyOnAgentWaiting: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bag.insertValues = null;
  bag.conflictTarget = null;
  bag.conflictSet = null;
});

describe('getNotificationPreferences', () => {
  it('no row → lazy all-true defaults (and no insert)', async () => {
    bag.selectLimit.mockResolvedValue([]);

    const values = await getNotificationPreferences(USER_ID, PROJECT_ID);

    expect(values).toEqual({
      notifyOnDone: true,
      notifyOnBlockedHuman: true,
      notifyOnAgentWaiting: true,
    });
    expect(values).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('existing row → its values', async () => {
    bag.selectLimit.mockResolvedValue([row({ notifyOnDone: false, notifyOnAgentWaiting: false })]);

    const values = await getNotificationPreferences(USER_ID, PROJECT_ID);

    expect(values).toEqual({
      notifyOnDone: false,
      notifyOnBlockedHuman: true,
      notifyOnAgentWaiting: false,
    });
  });
});

describe('saveNotificationPreferences', () => {
  it('upserts with the (userId, projectId) composite-PK conflict target', async () => {
    bag.insertReturning.mockResolvedValue([row({ notifyOnDone: false })]);

    const saved = await saveNotificationPreferences(USER_ID, PROJECT_ID, {
      notifyOnDone: false,
      notifyOnBlockedHuman: true,
      notifyOnAgentWaiting: true,
    });

    expect(bag.insertValues).toMatchObject({ userId: USER_ID, projectId: PROJECT_ID });
    expect(bag.conflictTarget).toHaveLength(2);
    expect(bag.conflictSet).toEqual({
      notifyOnDone: false,
      notifyOnBlockedHuman: true,
      notifyOnAgentWaiting: true,
    });
    expect(saved).toEqual({
      notifyOnDone: false,
      notifyOnBlockedHuman: true,
      notifyOnAgentWaiting: true,
    });
  });

  it('returns only the three booleans (wire shape, no row metadata)', async () => {
    bag.insertReturning.mockResolvedValue([row()]);

    const saved = await saveNotificationPreferences(USER_ID, PROJECT_ID, {
      notifyOnDone: true,
      notifyOnBlockedHuman: false,
      notifyOnAgentWaiting: true,
    });

    expect(Object.keys(saved).sort()).toEqual([
      'notifyOnAgentWaiting',
      'notifyOnBlockedHuman',
      'notifyOnDone',
    ]);
  });
});
