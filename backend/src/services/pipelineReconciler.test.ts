import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-0440 — polling reconciliation fallback (07-dispatcher-contract.md §
// failure table: "every 60s, slykboard queries dispatcher
// GET /jobs/:ticketId/state for any ticket in a non-terminal state,
// reconciles"). Mock wiring follows pipelineJobService.test.ts: a vi.hoisted
// bag + module mocks for the edges (dispatcher GET, SLYK-0260 write path,
// repository selection, db). Fake timers drive the interval — no real 60s.

const bag = vi.hoisted(() => ({
  // dispatcherClient.getFromDispatcher — keyed per-path scripted truth
  getFromDispatcher: vi.fn(),
  // pipelineJobService.updateJobState — the SLYK-0260 legal-transition write
  updateJobState: vi.fn(),
  // pipelineJobRepository.findNonTerminalJobs — the selection query
  findNonTerminalJobs: vi.fn(),
  // config/logger — silence + assert
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('./dispatcherClient', () => ({
  getFromDispatcher: bag.getFromDispatcher,
  DispatcherError: class DispatcherError extends Error {
    constructor(
      public readonly path: string,
      public readonly status: number,
      public readonly detail: string,
    ) {
      super(`Dispatcher ${path} ${status}: ${detail}`);
    }
  },
}));

vi.mock('./pipelineJobService', () => ({
  updateJobState: bag.updateJobState,
}));

vi.mock('../repositories/pipelineJobRepository', () => ({
  findNonTerminalJobs: bag.findNonTerminalJobs,
}));

vi.mock('../config/logger', () => ({
  logger: { info: bag.loggerInfo, warn: bag.loggerWarn, error: bag.loggerError },
}));

vi.mock('../db/client', () => ({ db: {} }));

import {
  DEFAULT_RECONCILE_INTERVAL_MS,
  RECONCILER_TERMINAL_STATES,
  reconcileTicket,
  reconcilerIsRunning,
  runReconcileSweep,
  startPipelineReconciler,
  stopPipelineReconciler,
} from './pipelineReconciler';
import { DispatcherError } from './dispatcherClient';
import { PIPELINE_STATES } from './pipelineStateService';
import type { PipelineJobRow } from '../repositories/pipelineJobRepository';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

function makeJob(overrides: Partial<PipelineJobRow> = {}): PipelineJobRow {
  return {
    ticketId: TICKET_ID,
    projectId: '33333333-3333-4333-8333-333333333333',
    state: 'QUEUED',
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
  } as PipelineJobRow;
}

/** Advance the fake clock past one interval AND flush pending microtasks. */
async function tickOnce(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  stopPipelineReconciler();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('terminal-state selection', () => {
  it('excludes exactly DONE, FAILED_* and BLOCKED_HUMAN — keeps the rest', () => {
    const nonTerminal = PIPELINE_STATES.filter((s) => !RECONCILER_TERMINAL_STATES.includes(s));
    expect(RECONCILER_TERMINAL_STATES).toEqual([
      'DONE',
      'FAILED_AGENT',
      'FAILED_CI',
      'FAILED_CONFLICT',
      'FAILED_DEPLOY',
      'BLOCKED_HUMAN',
    ]);
    // BACKLOG → DEPLOYING range per the ticket.
    expect(nonTerminal).toEqual([
      'BACKLOG',
      'QUEUED',
      'AGENT_RUNNING',
      'AGENT_WAITING',
      'PR_OPEN',
      'CI_RUNNING',
      'MERGING',
      'CONFLICT_RETRY',
      'DEPLOYING',
    ]);
  });
});

describe('reconcileTicket — conflict rules', () => {
  it('dispatcher == local → in-sync, no write, no event', async () => {
    bag.getFromDispatcher.mockResolvedValue({ state: 'AGENT_RUNNING' });

    const outcome = await reconcileTicket(makeJob({ state: 'AGENT_RUNNING' }));

    expect(outcome).toBe('in-sync');
    expect(bag.updateJobState).not.toHaveBeenCalled();
  });

  it('dispatcher ahead via a legal edge → applied through updateJobState', async () => {
    bag.getFromDispatcher.mockResolvedValue({
      state: 'AGENT_RUNNING',
      detail: { sha: 'abc123' },
      traceId: '0f0e0d0c-1111-4111-8111-111111111111',
    });

    const outcome = await reconcileTicket(makeJob({ state: 'QUEUED' }));

    expect(outcome).toBe('applied');
    expect(bag.updateJobState).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      body: {
        state: 'AGENT_RUNNING',
        detail: { sha: 'abc123' },
        traceId: '0f0e0d0c-1111-4111-8111-111111111111',
      },
    });
  });

  it('dispatcher behind (illegal backwards edge) → trust local, log, no write', async () => {
    // Local already at AGENT_RUNNING; a stale dispatcher still says QUEUED.
    // BACKLOG is the only QUEUED→-source edge's target… QUEUED→AGENT_RUNNING
    // is forward, so simulate lag as: local AGENT_RUNNING, dispatcher BACKLOG
    // — no legal edge AGENT_RUNNING→BACKLOG exists.
    bag.getFromDispatcher.mockResolvedValue({ state: 'BACKLOG' });

    const outcome = await reconcileTicket(makeJob({ state: 'AGENT_RUNNING' }));

    expect(outcome).toBe('skipped-illegal');
    expect(bag.updateJobState).not.toHaveBeenCalled();
    expect(bag.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: TICKET_ID,
        local: 'AGENT_RUNNING',
        dispatcher: 'BACKLOG',
      }),
      expect.stringContaining('illegal transition'),
    );
  });

  it('dispatcher requiring an illegal forward jump → skipped, matrix wins', async () => {
    // BACKLOG → DONE skips the whole happy path — illegal per the matrix.
    bag.getFromDispatcher.mockResolvedValue({ state: 'DONE' });

    const outcome = await reconcileTicket(makeJob({ state: 'BACKLOG' }));

    expect(outcome).toBe('skipped-illegal');
    expect(bag.updateJobState).not.toHaveBeenCalled();
  });

  it('unreadable dispatcher payload → logged, no write, error outcome', async () => {
    bag.getFromDispatcher.mockResolvedValue({ state: 'NOT_A_STATE' });

    const outcome = await reconcileTicket(makeJob({ state: 'QUEUED' }));

    expect(outcome).toBe('error');
    expect(bag.updateJobState).not.toHaveBeenCalled();
    expect(bag.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: TICKET_ID }),
      expect.stringContaining('unreadable'),
    );
  });

  it('404 from dispatcher → keeps local state, logged (human decides)', async () => {
    bag.getFromDispatcher.mockRejectedValue(
      new DispatcherError(`/jobs/${TICKET_ID}/state`, 404, 'no such job'),
    );

    const outcome = await reconcileTicket(makeJob({ state: 'QUEUED' }));

    expect(outcome).toBe('error');
    expect(bag.updateJobState).not.toHaveBeenCalled();
    expect(bag.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: TICKET_ID }),
      expect.stringContaining('no job'),
    );
  });

  it('HTTP failure (unreachable) → logged, no throw', async () => {
    bag.getFromDispatcher.mockRejectedValue(
      new DispatcherError(`/jobs/${TICKET_ID}/state`, 0, 'ECONNREFUSED'),
    );

    const outcome = await reconcileTicket(makeJob({ state: 'QUEUED' }));

    expect(outcome).toBe('error');
    expect(bag.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: TICKET_ID }),
      expect.stringContaining('sweep failed'),
    );
  });

  it('updateJobState throwing (e.g. retry-cap AppError) → caught, no throw', async () => {
    bag.getFromDispatcher.mockResolvedValue({ state: 'QUEUED' });
    bag.updateJobState.mockRejectedValue(new Error('Retry cap reached (3/3)'));

    const outcome = await reconcileTicket(makeJob({ state: 'FAILED_AGENT', attempts: 3 }));

    expect(outcome).toBe('error');
  });
});

describe('runReconcileSweep', () => {
  it('reconciles every non-terminal job the repository returns', async () => {
    const jobs = [
      makeJob({ ticketId: '00000000-0000-4000-8000-000000000001', state: 'QUEUED' }),
      makeJob({ ticketId: '00000000-0000-4000-8000-000000000002', state: 'PR_OPEN' }),
    ];
    bag.findNonTerminalJobs.mockResolvedValue(jobs);
    bag.getFromDispatcher.mockResolvedValue({ state: 'AGENT_RUNNING' });
    // QUEUED→AGENT_RUNNING legal; PR_OPEN→AGENT_RUNNING illegal → skipped.
    bag.updateJobState.mockResolvedValue(makeJob({ state: 'AGENT_RUNNING' }));

    await runReconcileSweep();

    expect(bag.findNonTerminalJobs).toHaveBeenCalledOnce();
    expect(bag.getFromDispatcher).toHaveBeenCalledTimes(2);
    expect(bag.updateJobState).toHaveBeenCalledOnce();
  });

  it('selection query failure → logged, does not throw', async () => {
    bag.findNonTerminalJobs.mockRejectedValue(new Error('connection terminated'));

    await expect(runReconcileSweep()).resolves.toBeUndefined();
    expect(bag.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.stringContaining('failed to load non-terminal jobs'),
    );
  });

  it('empty selection → no dispatcher calls', async () => {
    bag.findNonTerminalJobs.mockResolvedValue([]);

    await runReconcileSweep();

    expect(bag.getFromDispatcher).not.toHaveBeenCalled();
  });
});

describe('interval loop', () => {
  it('startPipelineReconciler fires a sweep every interval (fake timers)', async () => {
    bag.findNonTerminalJobs.mockResolvedValue([]);
    startPipelineReconciler();
    expect(reconcilerIsRunning()).toBe(true);

    // Not before the first interval elapses.
    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS - 1);
    expect(bag.findNonTerminalJobs).not.toHaveBeenCalled();

    await tickOnce(1);
    expect(bag.findNonTerminalJobs).toHaveBeenCalledOnce();

    // And again on the next tick — the loop survives.
    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS);
    expect(bag.findNonTerminalJobs).toHaveBeenCalledTimes(2);
  });

  it('honors SLYKBOARD_RECONCILE_INTERVAL_MS', async () => {
    vi.stubEnv('SLYKBOARD_RECONCILE_INTERVAL_MS', '1000');
    bag.findNonTerminalJobs.mockResolvedValue([]);
    startPipelineReconciler();

    await tickOnce(999);
    expect(bag.findNonTerminalJobs).not.toHaveBeenCalled();
    await tickOnce(1);
    expect(bag.findNonTerminalJobs).toHaveBeenCalledOnce();
  });

  it('drift converges on an interval tick (end-to-end through the loop)', async () => {
    bag.findNonTerminalJobs.mockResolvedValue([makeJob({ state: 'QUEUED' })]);
    bag.getFromDispatcher.mockResolvedValue({ state: 'AGENT_RUNNING' });
    bag.updateJobState.mockResolvedValue(makeJob({ state: 'AGENT_RUNNING' }));
    startPipelineReconciler();

    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS);

    expect(bag.getFromDispatcher).toHaveBeenCalledWith(`/jobs/${TICKET_ID}/state`);
    expect(bag.updateJobState).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      body: { state: 'AGENT_RUNNING', detail: undefined, traceId: undefined },
    });
  });

  it('dispatcher HTTP failure on one tick does not kill the loop', async () => {
    bag.findNonTerminalJobs.mockResolvedValue([makeJob()]);
    bag.getFromDispatcher.mockRejectedValue(
      new DispatcherError(`/jobs/${TICKET_ID}/state`, 0, 'ECONNREFUSED'),
    );
    startPipelineReconciler();

    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS);
    expect(bag.getFromDispatcher).toHaveBeenCalledOnce();

    // Next tick still fires and still attempts the dispatcher.
    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS);
    expect(bag.getFromDispatcher).toHaveBeenCalledTimes(2);
  });

  it('states already agreeing on consecutive ticks → still exactly one write total', async () => {
    bag.findNonTerminalJobs.mockResolvedValue([makeJob({ state: 'AGENT_RUNNING' })]);
    bag.getFromDispatcher.mockResolvedValue({ state: 'AGENT_RUNNING' });
    startPipelineReconciler();

    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS);
    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS);

    // No duplicate PipelineEvents — updateJobState (which appends events)
    // never fires when states agree.
    expect(bag.updateJobState).not.toHaveBeenCalled();
  });

  it('stopPipelineReconciler clears the interval (idempotent)', async () => {
    bag.findNonTerminalJobs.mockResolvedValue([]);
    startPipelineReconciler();
    stopPipelineReconciler();
    stopPipelineReconciler();
    expect(reconcilerIsRunning()).toBe(false);

    await tickOnce(DEFAULT_RECONCILE_INTERVAL_MS * 3);
    expect(bag.findNonTerminalJobs).not.toHaveBeenCalled();
  });

  it('startPipelineReconciler is a no-op when already running', () => {
    bag.findNonTerminalJobs.mockResolvedValue([]);
    startPipelineReconciler();
    startPipelineReconciler();

    // Two starts, one timer — the second call must not have replaced it
    // (a replaced unref'd timer would still sweep; assert via stop-once).
    stopPipelineReconciler();
    expect(reconcilerIsRunning()).toBe(false);
  });
});
