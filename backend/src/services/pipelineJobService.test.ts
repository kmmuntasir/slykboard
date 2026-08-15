import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0260 — unit tests for pipelineJobService. Mock wiring follows
// onboardingEventService.test.ts: vi.hoisted bag + a fluent mock tx/db
// factory. The service's db.transaction issues, in order:
//   (a) tx.select().from(pipelineJobs).where().limit(1)        — job load
//   (b) tx.insert(pipelineEvents).values().returning()         — event append
//   (c) tx.update(pipelineJobs).set(patch).where().returning() — job update
//   (d) tx.select({columns}).from(projects).where().limit(1)   — DONE only
//   (e) tx.update(tickets).set({statusColumn}).where()         — DONE only
//
// The fake tx dispatches on the drizzle table object (reference compare) —
// pipelineJobs vs projects share the .from() shape, jobs vs tickets share
// the .update() shape.

const bag = vi.hoisted(() => ({
  // (a) job load .limit(1) terminal — resolves to rows array
  jobLimit: vi.fn(),
  // (b) event insert .returning() terminal
  eventReturning: vi.fn(),
  eventValues: null as unknown,
  eventCallCount: 0,
  // (c) job update .returning() terminal
  jobReturning: vi.fn(),
  jobSetArg: {} as Record<string, unknown>,
  jobUpdateCallCount: 0,
  // (d) done-column lookup .limit(1) terminal
  projectLimit: vi.fn(),
  // (e) ticket column update .where() terminal
  ticketWhere: vi.fn(),
  ticketSetArg: {} as Record<string, unknown>,
  ticketUpdateCallCount: 0,
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
          limit: () => (nameOf(table) === 'projects' ? bag.projectLimit() : bag.jobLimit()),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        bag.eventValues = v;
        bag.eventCallCount += 1;
        return { returning: () => bag.eventReturning() };
      },
    }),
    update: (table: unknown) => ({
      set: (s: Record<string, unknown>) => {
        if (nameOf(table) === 'tickets') {
          bag.ticketSetArg = s;
          bag.ticketUpdateCallCount += 1;
          return { where: () => bag.ticketWhere() };
        }
        bag.jobSetArg = s;
        bag.jobUpdateCallCount += 1;
        return { where: () => ({ returning: () => bag.jobReturning() }) };
      },
    }),
  };
  const db = {
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  };
  return { db };
});

import { pipelineJobs, pipelineEvents, projects, tickets } from '../db/schema';
import { updateJobState } from './pipelineJobService';
import { setStateSink, type SseStateEvent } from './sseEmitter';
import { notifyAgentWaitingEmail } from './agentWaitingNotifyService';
import { notifyTicketStateEmail } from './ticketStateNotifyService';

// SLYK-0350 — the AGENT_WAITING email trigger is a post-commit hook inside
// updateJobState. Mock the notify service (its own delivery/gating matrix
// lives in agentWaitingNotifyService.test.ts); here we assert reachability,
// call shape, and failure isolation.
vi.mock('./agentWaitingNotifyService', () => ({
  notifyAgentWaitingEmail: vi.fn(async () => {}),
}));

// SLYK-0390 — same posture for the DONE / BLOCKED_HUMAN trigger (delivery /
// preference-gating matrix lives in ticketStateNotifyService.test.ts).
vi.mock('./ticketStateNotifyService', () => ({
  notifyTicketStateEmail: vi.fn(async () => {}),
}));

const notify = vi.mocked(notifyAgentWaitingEmail);
const notifyState = vi.mocked(notifyTicketStateEmail);

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const DONE_COLUMN_ID = 'col-done';
const COLUMNS = [
  { id: 'col-todo', name: 'To Do' },
  { id: 'col-wip', name: 'In Progress' },
  { id: DONE_COLUMN_ID, name: 'Done' },
];

function baseJob(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: TICKET_ID,
    projectId: PROJECT_ID,
    state: 'BACKLOG',
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const sseEvents: SseStateEvent[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  bag.tables = { pipelineJobs, pipelineEvents, projects, tickets };
  // Hand-rolled counters (not vi.fn state) — reset explicitly.
  bag.eventCallCount = 0;
  bag.jobUpdateCallCount = 0;
  bag.ticketUpdateCallCount = 0;
  bag.jobLimit.mockResolvedValue([baseJob()]);
  bag.eventReturning.mockResolvedValue([]);
  bag.jobReturning.mockResolvedValue([baseJob()]);
  bag.projectLimit.mockResolvedValue([{ columns: COLUMNS }]);
  bag.ticketWhere.mockResolvedValue(undefined);
  sseEvents.length = 0;
  setStateSink((e) => sseEvents.push(e));
  notify.mockClear();
  notifyState.mockClear();
});

describe('updateJobState — legal transitions', () => {
  // Representative cells of the 15×15 matrix (the full matrix lives in
  // pipelineStateService.test.ts — 225 exhaustive cells, SLYK-0250).
  it.each([
    { name: 'BACKLOG → QUEUED (dispatch ack)', from: 'BACKLOG', to: 'QUEUED' },
    { name: 'AGENT_RUNNING → AGENT_WAITING', from: 'AGENT_RUNNING', to: 'AGENT_WAITING' },
    { name: 'CI_RUNNING → MERGING', from: 'CI_RUNNING', to: 'MERGING' },
    { name: 'MERGING → DONE', from: 'MERGING', to: 'DONE' },
    { name: 'DEPLOYING → DONE', from: 'DEPLOYING', to: 'DONE' },
  ])('$name — inserts event + updates job', async ({ from, to }) => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: from })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: to as never } });

    expect(bag.eventValues).toMatchObject({ ticketId: TICKET_ID, fromState: from, toState: to });
    expect(bag.jobSetArg.state).toBe(to);
  });

  it('legal FAILED_AGENT → QUEUED at attempts=0 bumps attempts to 1', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'FAILED_AGENT', attempts: 0 })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'QUEUED' } });

    expect(bag.jobSetArg).toMatchObject({ state: 'QUEUED', attempts: 1 });
  });

  it('attempts=2 FAILED_CI → QUEUED is the last allowed retry (becomes 3)', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'FAILED_CI', attempts: 2 })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'QUEUED' } });

    expect(bag.jobSetArg).toMatchObject({ attempts: 3 });
  });

  it('FAILED_* → BLOCKED_HUMAN does NOT bump attempts', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'FAILED_DEPLOY', attempts: 2 })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'BLOCKED_HUMAN' } });

    expect(bag.jobSetArg.attempts).toBeUndefined();
  });

  it('non-retry requeue (BACKLOG → QUEUED) leaves attempts untouched', async () => {
    await updateJobState({ ticketId: TICKET_ID, body: { state: 'QUEUED' } });

    expect(bag.jobSetArg.attempts).toBeUndefined();
  });
});

describe('updateJobState — DONE kanban auto-move', () => {
  it('moves the ticket to the project Done column id (last column, F48 D6)', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'MERGING' })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'DONE' } });

    expect(bag.ticketUpdateCallCount).toBe(1);
    expect(bag.ticketSetArg).toEqual({ statusColumn: DONE_COLUMN_ID });
  });

  it('skips the ticket move when the project has no columns (degenerate config)', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'MERGING' })]);
    bag.projectLimit.mockResolvedValue([{ columns: [] }]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'DONE' } });

    expect(bag.ticketUpdateCallCount).toBe(0);
  });

  it('non-DONE transition never touches Tickets', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'QUEUED' })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_RUNNING' } });

    expect(bag.ticketUpdateCallCount).toBe(0);
  });
});

describe('updateJobState — AGENT_WAITING badge', () => {
  it('entry sets needsPmAttention=true', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_WAITING' } });

    expect(bag.jobSetArg.needsPmAttention).toBe(true);
  });

  it('exit to AGENT_RUNNING (PM replied) clears needsPmAttention', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING', needsPmAttention: true })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_RUNNING' } });

    expect(bag.jobSetArg.needsPmAttention).toBe(false);
  });

  it('exit to FAILED_AGENT (timeout) also clears needsPmAttention', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING', needsPmAttention: true })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'FAILED_AGENT' } });

    expect(bag.jobSetArg.needsPmAttention).toBe(false);
  });
});

describe('updateJobState — detail promotion + traceId', () => {
  it('persists githubPrNumber/githubPrSha from detail when present', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);

    await updateJobState({
      ticketId: TICKET_ID,
      body: { state: 'PR_OPEN', detail: { prNumber: 42, sha: 'abc1234' } },
    });

    expect(bag.jobSetArg).toMatchObject({ githubPrNumber: 42, githubPrSha: 'abc1234' });
    // Event detail is stored verbatim.
    expect(bag.eventValues).toMatchObject({ detail: { prNumber: 42, sha: 'abc1234' } });
  });

  it('non-number prNumber / non-string sha are ignored (jsonb is free-form)', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);

    await updateJobState({
      ticketId: TICKET_ID,
      body: { state: 'PR_OPEN', detail: { prNumber: '42', sha: 7 } },
    });

    expect(bag.jobSetArg.githubPrNumber).toBeUndefined();
    expect(bag.jobSetArg.githubPrSha).toBeUndefined();
  });

  it('traceId lands on both the event row and the job row', async () => {
    const traceId = '9b7c6d5e-1111-4222-8333-444455556666';
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'QUEUED' })]);

    await updateJobState({
      ticketId: TICKET_ID,
      body: { state: 'AGENT_RUNNING', traceId },
    });

    expect(bag.eventValues).toMatchObject({ traceId });
    expect(bag.jobSetArg.traceId).toBe(traceId);
  });

  it('absent detail inserts the event with null detail', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'QUEUED' })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_RUNNING' } });

    expect(bag.eventValues).toMatchObject({ detail: null, traceId: null });
  });
});

describe('updateJobState — SSE emit', () => {
  it('emits a state event after commit with from/to/detail/traceId', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'BACKLOG' })]);

    await updateJobState({
      ticketId: TICKET_ID,
      body: {
        state: 'QUEUED',
        detail: { hint: 'go' },
        traceId: '9b7c6d5e-1111-4222-8333-444455556666',
      },
    });

    expect(sseEvents).toEqual([
      {
        ticketId: TICKET_ID,
        fromState: 'BACKLOG',
        toState: 'QUEUED',
        detail: { hint: 'go' },
        traceId: '9b7c6d5e-1111-4222-8333-444455556666',
      },
    ]);
  });

  it('a throwing sink never fails the state write (sseEmit swallows)', async () => {
    setStateSink(() => {
      throw new Error('SSE channel gone');
    });

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: 'QUEUED' } }),
    ).resolves.toBeDefined();
  });
});

describe('updateJobState — AGENT_WAITING email trigger (SLYK-0350)', () => {
  it('transition to AGENT_WAITING fires the notify hook exactly once with the ticketId', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_WAITING' } });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(TICKET_ID);
  });

  // WAITING→RUNNING→WAITING re-entry must notify again (two emails total —
  // correct per the ticket); the reverse-direction exit must NOT notify.
  it('non-AGENT_WAITING transitions never fire the notify hook', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING', needsPmAttention: true })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_RUNNING' } });

    expect(notify).not.toHaveBeenCalled();
  });

  // AC "one email per transition": the ticket's WAITING→RUNNING→WAITING
  // sequence = 2 entries = 2 emails. The mock job load returns the CURRENT
  // state each round, so each await below pins the `from` side correctly.
  it('WAITING→RUNNING→WAITING fires once per AGENT_WAITING entry (2 total)', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);
    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_WAITING' } });
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING', needsPmAttention: true })]);
    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_RUNNING' } });
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);
    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_WAITING' } });

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('rejected transition (illegal self-loop) never reaches the notify hook', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_WAITING' })]);

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_WAITING' } }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

    expect(notify).not.toHaveBeenCalled();
  });

  it('a rejecting notify hook never fails the state write (email is fire-and-forget)', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'AGENT_RUNNING' })]);
    bag.jobReturning.mockResolvedValue([baseJob({ state: 'AGENT_WAITING' })]);
    notify.mockRejectedValue(new Error('SMTP down') as never);

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_WAITING' } }),
    ).resolves.toMatchObject({ state: 'AGENT_WAITING' });
  });
});

describe('updateJobState — DONE/BLOCKED_HUMAN email trigger (SLYK-0390)', () => {
  it.each([
    { name: 'MERGING → DONE fires kind=done', from: 'MERGING', to: 'DONE', kind: 'done' },
    {
      name: 'FAILED_DEPLOY → BLOCKED_HUMAN fires kind=blockedHuman',
      from: 'FAILED_DEPLOY',
      to: 'BLOCKED_HUMAN',
      kind: 'blockedHuman',
    },
  ])('$name — exactly once with the ticketId', async ({ from, to, kind }) => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: from })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: to as never } });

    expect(notifyState).toHaveBeenCalledTimes(1);
    expect(notifyState).toHaveBeenCalledWith(TICKET_ID, kind);
  });

  it('non-triggering transitions never fire the ticket-state notify hook', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'QUEUED' })]);

    await updateJobState({ ticketId: TICKET_ID, body: { state: 'AGENT_RUNNING' } });

    expect(notifyState).not.toHaveBeenCalled();
  });

  it('a rejecting ticket-state hook never fails the state write', async () => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: 'MERGING' })]);
    bag.jobReturning.mockResolvedValue([baseJob({ state: 'DONE' })]);
    notifyState.mockRejectedValue(new Error('SMTP down') as never);

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: 'DONE' } }),
    ).resolves.toMatchObject({ state: 'DONE' });
  });
});

describe('updateJobState — rejections', () => {
  it('unknown ticketId → NOT_FOUND before any write', async () => {
    bag.jobLimit.mockResolvedValue([]);

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: 'QUEUED' } }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      details: { ticketId: TICKET_ID },
    });

    expect(bag.eventCallCount).toBe(0);
    expect(bag.jobUpdateCallCount).toBe(0);
  });

  // DONE is terminal + self-loops are illegal everywhere: the same-state
  // double write (dispatcher retry after a lost 200) is rejected, not
  // deduped — inbound idempotency is the dispatcher's job
  // (07-dispatcher-contract.md § Retry semantics).
  it.each([
    { name: 'DONE → MERGING (terminal)', from: 'DONE', to: 'MERGING' },
    { name: 'QUEUED → QUEUED (same-state replay)', from: 'QUEUED', to: 'QUEUED' },
    { name: 'AGENT_WAITING → PR_OPEN (skips agent)', from: 'AGENT_WAITING', to: 'PR_OPEN' },
  ])('$name → INVALID_STATE_TRANSITION 400 with {from, to} details', async ({ from, to }) => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: from })]);

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: to as never } }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      status: 400,
      details: { from, to },
    });

    expect(bag.eventCallCount).toBe(0);
    expect(bag.jobUpdateCallCount).toBe(0);
    expect(sseEvents).toHaveLength(0);
  });

  it.each([
    { name: 'FAILED_AGENT at attempts=3', from: 'FAILED_AGENT' },
    { name: 'FAILED_CI at attempts=4', from: 'FAILED_CI' },
    { name: 'FAILED_CONFLICT at attempts=3', from: 'FAILED_CONFLICT' },
    { name: 'FAILED_DEPLOY at attempts=3', from: 'FAILED_DEPLOY' },
  ])('over-cap retry $from → QUEUED → 400 (must escalate to BLOCKED_HUMAN)', async ({ from }) => {
    bag.jobLimit.mockResolvedValue([baseJob({ state: from as never, attempts: 3 })]);

    await expect(
      updateJobState({ ticketId: TICKET_ID, body: { state: 'QUEUED' } }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      status: 400,
      details: { from, to: 'QUEUED' },
    });
  });
});
