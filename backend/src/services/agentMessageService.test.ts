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
  // dispatcherClient.postToDispatcher mock (SLYK-0330)
  postToDispatcher: vi.fn(),
  // pmReplyDeliveryQueue.enqueuePmReply mock (SLYK-0330)
  enqueuePmReply: vi.fn(),
  // SLYK-0330 GET: listByTicketId rows; markAgentMessagesRead .returning rows
  listRows: [] as unknown[],
  markReadReturning: [{ id: '44444444-4444-4444-8444-444444444444' }] as unknown[],
  // SLYK-0330 POST: findLatestAgentSessionId .limit(1) terminal
  latestSessionLimit: vi.fn(),
  // captured update() calls ({table, patch}) — asserts the needsPmAttention
  // clear and the readAt stamp
  updateCalls: [] as Array<{ table: string; patch: unknown }>,
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
        where: () => {
          // where → limit — job load (pipelineJobs) and dedup lookup (agentMessages).
          const limit = () =>
            nameOf(table) === 'pipelineJobs' ? bag.jobLimit() : bag.dedupLimit();
          return {
            limit,
            // where → orderBy:
            //   .then — listByTicketId (GET thread, agentMessages, no limit)
            //   .limit — findLatestAgentSessionId (latest AGENT session)
            orderBy: () => ({
              limit: () => bag.latestSessionLimit(),
              then: (onFulfilled: (v: unknown) => unknown, onRejected: unknown) =>
                Promise.resolve(nameOf(table) === 'agentMessages' ? bag.listRows : []).then(
                  onFulfilled,
                  onRejected as never,
                ),
            }),
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        bag.insertValues = v;
        bag.insertCallCount += 1;
        return { returning: () => bag.insertReturning() };
      },
    }),
    // update(agentMessages).set().where().returning() — markAgentMessagesRead;
    // update(pipelineJobs).set().where().returning() — updateJob.
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        bag.updateCalls.push({ table: nameOf(table), patch });
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(
                nameOf(table) === 'agentMessages'
                  ? bag.markReadReturning
                  : [{ ticketId: 'updated-job', patch }],
              ),
          }),
        };
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

vi.mock('./dispatcherClient', () => ({
  postToDispatcher: bag.postToDispatcher,
}));

vi.mock('./pmReplyDeliveryQueue', () => ({
  enqueuePmReply: bag.enqueuePmReply,
}));

import { pipelineJobs, agentMessages } from '../db/schema';
import { recordAgentMessage, getChatThread, postPmReply } from './agentMessageService';

// Hoisted-module factory needs baseJob inside the vi.mock closure — reference
// through the hoisted bag instead: the update() returning() for pipelineJobs
// just needs A row, so a static minimal job object suffices.

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '9b7c6d5e-1111-4222-8333-444455556666';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');

function baseJob(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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
  bag.updateCalls = [];
  bag.jobLimit.mockResolvedValue([baseJob()]);
  bag.dedupLimit.mockResolvedValue([]);
  bag.insertReturning.mockResolvedValue([messageRow()]);
  bag.latestSessionLimit.mockResolvedValue([{ agentSessionId: 'cyrus-session-abc' }]);
  bag.postToDispatcher.mockResolvedValue(undefined);
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

// ── SLYK-0330 — PM chat thread ──────────────────────────────────────────────

function pmRow(overrides: Record<string, unknown> = {}) {
  return messageRow({
    id: '66666666-6666-4666-8666-666666666666',
    authorRole: 'PM',
    authorUserId: 'u-pm',
    body: 'Yes, add a confirm dialog with Cancel as default.',
    agentSessionId: 'cyrus-session-abc',
    idempotencyKey: null,
    ...overrides,
  });
}

describe('getChatThread — GET /api/v1/me/tickets/:id/messages', () => {
  it('returns messages asc + job state, and marks unread AGENT rows read', async () => {
    const messages = [messageRow(), pmRow()];
    bag.listRows = messages;
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING' })]);

    const view = await getChatThread(TICKET_ID);

    expect(view).toEqual({ messages, ticketState: 'AGENT_WAITING' });
    // readAt stamp — markAgentMessagesRead ran with a Date readAt on the
    // agentMessages table (PM's GET is the "saw them" event).
    const markRead = bag.updateCalls.find((c) => c.table === 'agentMessages');
    expect(markRead?.patch).toEqual({ readAt: expect.any(Date) });
    expect(bag.sseEmit).not.toHaveBeenCalled();
  });

  it('ticket with no pipeline row → empty state null, thread still renders', async () => {
    bag.listRows = [];
    bag.jobLimit.mockResolvedValue([]);

    const view = await getChatThread(TICKET_ID);

    expect(view).toEqual({ messages: [], ticketState: null });
  });
});

describe('postPmReply — POST /api/v1/me/tickets/:id/messages (happy path)', () => {
  it('AGENT_WAITING: PM row inserted, needsPmAttention cleared, signed pm_reply dispatched, SSE frame, 201-shape row', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING', needsPmAttention: true })]);
    bag.dedupLimit.mockResolvedValue([]);
    bag.latestSessionLimit.mockResolvedValue([{ agentSessionId: 'cyrus-session-abc' }]);
    bag.insertReturning.mockResolvedValue([pmRow()]);
    bag.postToDispatcher.mockResolvedValue(undefined);

    const result = await postPmReply({
      ticketId: TICKET_ID,
      userId: 'u-pm',
      body: 'Yes, add a confirm dialog with Cancel as default.',
    });

    // Row shape — PM role, author stamped, session routed from latest AGENT msg.
    expect(result.row).toEqual(pmRow());
    expect(result.delivered).toBe(true);
    expect(bag.insertValues).toMatchObject({
      ticketId: TICKET_ID,
      authorRole: 'PM',
      authorUserId: 'u-pm',
      body: 'Yes, add a confirm dialog with Cancel as default.',
      agentSessionId: 'cyrus-session-abc',
      idempotencyKey: null,
    });
    // needsPmAttention cleared via updateJob (pipelineJobs update with the
    // flag off; state passed through unchanged).
    const jobPatch = bag.updateCalls.find((c) => c.table === 'pipelineJobs');
    expect(jobPatch?.patch).toMatchObject({ needsPmAttention: false });
    expect(bag.postToDispatcher).toHaveBeenCalledTimes(1);
    const [path, payload] = bag.postToDispatcher.mock.calls[0]!;
    expect(path).toBe('/webhooks/ticket-events');
    expect(payload).toMatchObject({
      eventType: 'pm_reply',
      ticketId: TICKET_ID,
      agentSessionId: 'cyrus-session-abc',
      body: 'Yes, add a confirm dialog with Cancel as default.',
    });
    expect(payload.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // SSE frame on the ticket channel.
    expect(bag.sseEmit).toHaveBeenCalledWith(
      TICKET_ID,
      expect.objectContaining({ type: 'message' }),
    );
    // Nothing queued — delivery succeeded.
    expect(bag.enqueuePmReply).not.toHaveBeenCalled();
  });

  it('AGENT_RUNNING also accepts replies', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);
    bag.dedupLimit.mockResolvedValue([]);
    bag.latestSessionLimit.mockResolvedValue([]);
    bag.insertReturning.mockResolvedValue([pmRow({ agentSessionId: null })]);
    bag.postToDispatcher.mockResolvedValue(undefined);

    const result = await postPmReply({ ticketId: TICKET_ID, userId: 'u-pm', body: 'go' });

    expect(result.delivered).toBe(true);
    // No AGENT message yet → agentSessionId null rides the payload.
    expect(bag.postToDispatcher.mock.calls[0]![1]).toMatchObject({
      agentSessionId: null,
    });
  });
});

describe('postPmReply — 409 agent not listening', () => {
  it.each(['DONE', 'PR_OPEN', 'QUEUED', 'CI_RUNNING', 'FAILED_AGENT', 'BACKLOG', 'BLOCKED_HUMAN'])(
    'state %s → CONFLICT 409, no insert, no webhook, no SSE',
    async (state) => {
      bag.jobLimit.mockResolvedValue([baseJob({ state: state as never })]);

      await expect(
        postPmReply({ ticketId: TICKET_ID, userId: 'u-pm', body: 'too late' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        message: 'Agent is not listening on this ticket',
        details: { ticketId: TICKET_ID, state },
      });

      expect(bag.insertCallCount).toBe(0);
      expect(bag.postToDispatcher).not.toHaveBeenCalled();
      expect(bag.sseEmit).not.toHaveBeenCalled();
    },
  );
});

describe('postPmReply — dispatcher down (07 § failure table)', () => {
  it('row persists, delivered:false, queued for background retry, SSE frame still sent', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING', needsPmAttention: true })]);
    bag.dedupLimit.mockResolvedValue([]);
    bag.latestSessionLimit.mockResolvedValue([{ agentSessionId: 'cyrus-session-abc' }]);
    bag.insertReturning.mockResolvedValue([pmRow()]);
    bag.postToDispatcher.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await postPmReply({ ticketId: TICKET_ID, userId: 'u-pm', body: 'ping' });

    // The reply is durable — no rollback, no thrown UPSTREAM_FAILED.
    expect(result.row).toEqual(pmRow());
    expect(result.delivered).toBe(false);
    expect(bag.insertCallCount).toBe(1);
    // Queued with the SAME payload (fixed idempotencyKey) for retries.
    expect(bag.enqueuePmReply).toHaveBeenCalledTimes(1);
    expect(bag.enqueuePmReply.mock.calls[0]![0].payload).toEqual(
      bag.postToDispatcher.mock.calls[0]![1],
    );
    // Open tabs still update.
    expect(bag.sseEmit).toHaveBeenCalledWith(
      TICKET_ID,
      expect.objectContaining({ type: 'message' }),
    );
  });
});
