import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0320 — unit tests for agentMessageService. Mock wiring follows
// pipelineJobService.test.ts: vi.hoisted bag + a fluent mock tx/db factory.
// recordAgentMessage runs inside db.transaction(cb) and issues, in order:
//   (a) tx.select().from(pipelineJobs).where().limit(1)          — job load
//   (b) tx.select().from(agentMessages).where().limit(1)         — dedup (key present only)
//   (c) tx.insert(agentMessages).values().returning()            — insert
//
// The fake tx dispatches on the drizzle table object (reference compare) —
// pipelineJobs vs agentMessages share the .from() shape.
//
// SSE: the real per-ticket channel (sseEmitter.emit) is spied so the wire
// frame shape is asserted without subscribers.

const bag = vi.hoisted(() => ({
  // (a) job load .limit(1) terminal — resolves to rows array
  jobLimit: vi.fn(),
  // (b) dedup lookup .limit(1) terminal
  dedupLimit: vi.fn(),
  // (c) insert .returning() terminal
  insertReturning: vi.fn(),
  insertValues: null as unknown,
  insertCallCount: 0,
  // sseEmitter.emit spy target
  sseEmit: vi.fn(),
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
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => (nameOf(table) === 'pipelineJobs' ? bag.jobLimit() : bag.dedupLimit()),
        }),
      }),
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
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  };
  return { db };
});

vi.mock('./sseEmitter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sseEmitter')>();
  return { ...actual, emit: bag.sseEmit };
});

import { pipelineJobs, agentMessages } from '../db/schema';
import { recordAgentMessage } from './agentMessageService';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '9b7c6d5e-1111-4222-8333-444455556666';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function baseJob() {
  return {
    ticketId: TICKET_ID,
    projectId: '33333333-3333-4333-8333-333333333333',
    state: 'AGENT_RUNNING',
    priority: 0,
    attempts: 0,
    leaseOwnerId: null,
    leaseExpiresAt: null,
    agentIssueId: null,
    agentBackend: null,
    githubPrNumber: null,
    githubPrSha: null,
    needsPmAttention: false,
    traceId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    ticketId: TICKET_ID,
    authorRole: 'AGENT',
    authorUserId: null,
    body: 'Should I add a confirm dialog?',
    agentSessionId: 'cyrus-session-abc',
    idempotencyKey: IDEMPOTENCY_KEY,
    readAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bag.tables = { pipelineJobs, agentMessages };
  bag.insertCallCount = 0;
  bag.jobLimit.mockResolvedValue([baseJob()]);
  bag.dedupLimit.mockResolvedValue([]);
  bag.insertReturning.mockResolvedValue([messageRow()]);
});

describe('recordAgentMessage — happy path', () => {
  it('inserts the row (authorUserId null, session + key persisted) and emits SSE', async () => {
    const row = await recordAgentMessage({
      ticketId: TICKET_ID,
      body: {
        authorRole: 'AGENT',
        body: 'Should I add a confirm dialog?',
        agentSessionId: 'cyrus-session-abc',
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });

    expect(row).toEqual(messageRow());
    expect(bag.insertCallCount).toBe(1);
    expect(bag.insertValues).toEqual({
      ticketId: TICKET_ID,
      authorRole: 'AGENT',
      authorUserId: null,
      body: 'Should I add a confirm dialog?',
      agentSessionId: 'cyrus-session-abc',
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    // SSE frame per 05-backend-routes.md § events spec — {id, authorRole,
    // body, createdAt} on the ticket's channel.
    expect(bag.sseEmit).toHaveBeenCalledTimes(1);
    expect(bag.sseEmit).toHaveBeenCalledWith(TICKET_ID, {
      type: 'message',
      data: {
        id: messageRow().id,
        authorRole: 'AGENT',
        body: 'Should I add a confirm dialog?',
        createdAt: CREATED_AT,
      },
    });
  });

  it('SYSTEM message allowed, persisted, and emitted', async () => {
    bag.insertReturning.mockResolvedValue([
      messageRow({ authorRole: 'SYSTEM', idempotencyKey: null }),
    ]);

    const row = await recordAgentMessage({
      ticketId: TICKET_ID,
      body: { authorRole: 'SYSTEM', body: 'PR #12 opened' },
    });

    expect(row.authorRole).toBe('SYSTEM');
    expect(bag.insertValues).toMatchObject({
      authorRole: 'SYSTEM',
      agentSessionId: null,
      idempotencyKey: null,
    });
    expect(bag.sseEmit).toHaveBeenCalledTimes(1);
  });

  it('message without idempotencyKey skips the dedup lookup', async () => {
    await recordAgentMessage({
      ticketId: TICKET_ID,
      body: { authorRole: 'AGENT', body: 'no key' },
    });

    expect(bag.dedupLimit).not.toHaveBeenCalled();
    expect(bag.insertCallCount).toBe(1);
    expect(bag.insertValues).toMatchObject({ idempotencyKey: null });
  });
});

describe('recordAgentMessage — idempotency (07 § Retry semantics)', () => {
  it('replays the ORIGINAL row: no second insert, no second SSE frame', async () => {
    const original = messageRow();
    bag.dedupLimit.mockResolvedValue([original]);

    const row = await recordAgentMessage({
      ticketId: TICKET_ID,
      body: {
        authorRole: 'AGENT',
        body: 'retry delivery — different body, same key',
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });

    expect(row).toEqual(original);
    expect(bag.insertCallCount).toBe(0); // row-count assert: no duplicate insert
    expect(bag.sseEmit).not.toHaveBeenCalled();
  });
});

describe('recordAgentMessage — job gating', () => {
  it('ticket not in the pipeline → NOT_FOUND (no insert, no SSE)', async () => {
    bag.jobLimit.mockResolvedValue([]);

    await expect(
      recordAgentMessage({ ticketId: TICKET_ID, body: { authorRole: 'AGENT', body: 'hi' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    expect(bag.insertCallCount).toBe(0);
    expect(bag.sseEmit).not.toHaveBeenCalled();
  });
});
