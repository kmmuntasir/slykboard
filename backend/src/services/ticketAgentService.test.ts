import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0290 — unit tests for the agent-mode ticket add-ons: the auto-queue
// hook (BACKLOG job row + fire-and-forget ticket_created webhook) and the PM
// "Start work" queue path. Mock wiring follows ticketService.test.ts /
// pipelineJobService.test.ts: vi.hoisted bag + mocked repository/db/dispatcher
// seams. postToDispatcher is a plain vi.fn — dispatcherClient's own retry/HMAC
// behavior is locked in dispatcherClient.test.ts.

const bag = vi.hoisted(() => ({
  insertJob: vi.fn(),
  findMetaByProjectId: vi.fn(),
  postToDispatcher: vi.fn(),
  hydrateLabelsForTickets: vi.fn(),
  updateJobState: vi.fn(),
  errorLogs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../repositories/pipelineJobRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../repositories/pipelineJobRepository')>();
  return { ...actual, insertJob: bag.insertJob };
});

vi.mock('../repositories/projectAgentMetaRepository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../repositories/projectAgentMetaRepository')>();
  return { ...actual, findMetaByProjectId: bag.findMetaByProjectId };
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

vi.mock('./labelService', () => ({
  hydrateLabelsForTickets: bag.hydrateLabelsForTickets,
}));

vi.mock('./pipelineJobService', () => ({
  updateJobState: bag.updateJobState,
}));

vi.mock('../config/logger', () => ({
  logger: {
    error: (fields: Record<string, unknown>) => bag.errorLogs.push(fields),
    info: vi.fn(),
    warn: vi.fn(),
  },
  isProd: false,
}));

import { randomUUID } from 'node:crypto';
import {
  agentModeEnabled,
  autoQueueOnCreate,
  queueForAgent,
  type TicketCreatedTicket,
} from './ticketAgentService';
import type { TicketRow } from './ticketService';
import { ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';

function makeTicket(over: Partial<TicketRow> = {}): TicketRow {
  return {
    id: TICKET_ID,
    projectId: PROJECT_ID,
    ticketNumber: 42,
    title: 'Add CSV import',
    description: 'Allow users to bulk-import inventory from a CSV file.',
    statusColumn: 'col-todo',
    position: 65536,
    assigneeId: null,
    creatorId: 'u1',
    priority: 'HIGH',
    dueDate: null,
    checklist: [],
    createdAt: new Date('2026-08-13T12:34:56.789Z'),
    updatedAt: new Date('2026-08-13T12:34:56.789Z'),
    deletedAt: null,
    ...over,
  };
}

function makeJob(over: Partial<Record<string, unknown>> = {}) {
  return {
    ticketId: TICKET_ID,
    projectId: PROJECT_ID,
    state: 'BACKLOG',
    attempts: 0,
    traceId: 'trace-1',
    ...over,
  };
}

function makeMeta(over: Partial<Record<string, unknown>> = {}) {
  return {
    projectId: PROJECT_ID,
    slug: 'inventory-tracker',
    subdomain: 'inventory',
    teamKey: 'INVENTORYTRACKER',
    agentBackend: null,
    ...over,
  };
}

/** Extract the ticket_created payload our hook sent to the dispatcher. */
function sentTicketPayload(): { eventType: string; ticket: TicketCreatedTicket } {
  const call = bag.postToDispatcher.mock.calls.find(
    (args) => (args[1] as { eventType?: string }).eventType === 'ticket_created',
  );
  return call![1] as { eventType: string; ticket: TicketCreatedTicket };
}

beforeEach(() => {
  vi.clearAllMocks();
  bag.errorLogs.length = 0;
  bag.insertJob.mockResolvedValue(makeJob());
  bag.findMetaByProjectId.mockResolvedValue(makeMeta());
  bag.postToDispatcher.mockResolvedValue({ acceptedAt: '2026-08-13T12:34:57.000Z' });
  bag.hydrateLabelsForTickets.mockResolvedValue(
    new Map([[TICKET_ID, [{ id: 'l1', name: 'feature', color: '#000000' }]]]),
  );
  bag.updateJobState.mockResolvedValue(makeJob({ state: 'QUEUED' }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('agentModeEnabled (SLYK-0290)', () => {
  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
  ])('SLYKBOARD_AGENT_MODE=%s → %s', (value, expected) => {
    if (value === undefined) delete process.env.SLYKBOARD_AGENT_MODE;
    else vi.stubEnv('SLYKBOARD_AGENT_MODE', value);
    expect(agentModeEnabled()).toBe(expected);
  });
});

describe('autoQueueOnCreate (SLYK-0290)', () => {
  it('inserts a BACKLOG job row with the meta agentBackend + a fresh traceId, then fires the webhook', async () => {
    bag.findMetaByProjectId.mockResolvedValue(makeMeta({ agentBackend: 'claude-code' }));

    await autoQueueOnCreate(makeTicket());

    expect(bag.insertJob).toHaveBeenCalledTimes(1);
    const arg = bag.insertJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg).toEqual({
      ticketId: TICKET_ID,
      projectId: PROJECT_ID,
      agentBackend: 'claude-code',
      traceId: expect.any(String),
    });
    // traceId is a uuid v4
    expect(arg.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    expect(bag.postToDispatcher).toHaveBeenCalledWith(
      '/webhooks/ticket-events',
      expect.objectContaining({ eventType: 'ticket_created' }),
    );
  });

  it('payload matches 07-dispatcher-contract.md § ticket_created field-for-field', async () => {
    await autoQueueOnCreate(makeTicket());

    const body = sentTicketPayload();
    expect(Object.keys(body)).toEqual(['eventType', 'ticket']);
    expect(Object.keys(body.ticket).sort()).toEqual(
      [
        'id',
        'projectId',
        'projectSlug',
        'teamKey',
        'agentBackend',
        'number',
        'title',
        'description',
        'priority',
        'labels',
        'createdAt',
      ].sort(),
    );
    expect(body.ticket).toEqual({
      id: TICKET_ID,
      projectId: PROJECT_ID,
      projectSlug: 'inventory-tracker',
      teamKey: 'INVENTORYTRACKER',
      agentBackend: null,
      number: 42,
      title: 'Add CSV import',
      description: 'Allow users to bulk-import inventory from a CSV file.',
      priority: 'HIGH',
      labels: ['feature'],
      createdAt: '2026-08-13T12:34:56.789Z',
    });
  });

  it('hydrates label NAMES (not ids) into the payload', async () => {
    await autoQueueOnCreate(makeTicket());

    expect(bag.hydrateLabelsForTickets).toHaveBeenCalledWith([TICKET_ID]);
    expect(sentTicketPayload().ticket.labels).toEqual(['feature']);
  });

  it('no meta row → agentBackend null, empty slug/teamKey, job still inserted', async () => {
    bag.findMetaByProjectId.mockResolvedValue(null);

    await autoQueueOnCreate(makeTicket());

    const arg = bag.insertJob.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg.agentBackend).toBeNull();
    expect(sentTicketPayload().ticket.agentBackend).toBeNull();
  });

  it('webhook failure: resolve succeeds, job stays BACKLOG, error logged with traceId, no unhandled rejection', async () => {
    bag.postToDispatcher.mockRejectedValue(new Error('ECONNREFUSED after 3 retries'));

    // Must NOT reject — the ticket create path depends on that.
    await expect(autoQueueOnCreate(makeTicket())).resolves.toBeUndefined();

    // let the microtask catch handler run
    await vi.waitFor(() => expect(bag.errorLogs).toHaveLength(1));
    const fields = bag.errorLogs[0]!;
    expect(fields.ticketId).toBe(TICKET_ID);
    expect(fields.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fields.jobState).toBe('BACKLOG');
  });

  it('the job row insert is awaited BEFORE the webhook fires (durable before dispatch)', async () => {
    let insertResolved = false;
    bag.insertJob.mockImplementation(async () => {
      expect(bag.postToDispatcher).not.toHaveBeenCalled();
      insertResolved = true;
      return makeJob();
    });

    await autoQueueOnCreate(makeTicket());

    expect(insertResolved).toBe(true);
    expect(bag.postToDispatcher).toHaveBeenCalledTimes(1);
  });
});

describe('queueForAgent (SLYK-0290)', () => {
  it('transitions via updateJobState to QUEUED with detail.source pm_start_work, then emits queue_for_agent', async () => {
    const job = await queueForAgent(TICKET_ID);

    expect(bag.updateJobState).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      body: { state: 'QUEUED', detail: { source: 'pm_start_work' } },
    });
    expect(bag.postToDispatcher).toHaveBeenCalledWith('/webhooks/ticket-events', {
      eventType: 'queue_for_agent',
      ticketId: TICKET_ID,
    });
    expect(job.state).toBe('QUEUED');
  });

  it('emits the webhook only AFTER the transition committed', async () => {
    let transitioned = false;
    bag.updateJobState.mockImplementation(async () => {
      expect(bag.postToDispatcher).not.toHaveBeenCalled();
      transitioned = true;
      return makeJob({ state: 'QUEUED' });
    });

    await queueForAgent(TICKET_ID);

    expect(transitioned).toBe(true);
    expect(bag.postToDispatcher).toHaveBeenCalledTimes(1);
  });

  it('dispatcher failure after retries → UPSTREAM_FAILED 502 with traceId details', async () => {
    bag.postToDispatcher.mockRejectedValue(new Error('gave up after 3 retries'));

    const error = await queueForAgent(TICKET_ID).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.UPSTREAM_FAILED);
    expect((error as AppError).details).toEqual({ ticketId: TICKET_ID, traceId: 'trace-1' });
  });

  it('illegal source state → CONFLICT 409 (remapped from the internal 400), no webhook', async () => {
    bag.updateJobState.mockRejectedValue(
      new AppError(ErrorCode.INVALID_STATE_TRANSITION, 'Cannot transition from DONE to QUEUED', {
        details: { from: 'DONE', to: 'QUEUED' },
      }),
    );

    const error = await queueForAgent(TICKET_ID).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    expect((error as AppError).details).toEqual({ from: 'DONE', to: 'QUEUED' });
    expect(bag.postToDispatcher).not.toHaveBeenCalled();
  });

  it('non-transition service failures (e.g. no job 404) propagate untouched', async () => {
    bag.updateJobState.mockRejectedValue(
      new AppError(ErrorCode.NOT_FOUND, `Ticket '${TICKET_ID}' is not in the pipeline`, {
        details: { ticketId: TICKET_ID },
      }),
    );

    const error = await queueForAgent(TICKET_ID).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(bag.postToDispatcher).not.toHaveBeenCalled();
  });
});

// Guard against accidentally coupling to a specific uuid — the hook mints a
// fresh traceId per call (job row + log line share it).
describe('autoQueueOnCreate traceId uniqueness (SLYK-0290)', () => {
  it('two calls mint distinct traceIds', async () => {
    await autoQueueOnCreate(makeTicket());
    await autoQueueOnCreate(makeTicket());
    const first = (bag.insertJob.mock.calls[0]![1] as { traceId: string }).traceId;
    const second = (bag.insertJob.mock.calls[1]![1] as { traceId: string }).traceId;
    expect(first).not.toBe(second);
    expect(randomUUID()).toBeTruthy(); // sanity: node:crypto import path works
  });
});
