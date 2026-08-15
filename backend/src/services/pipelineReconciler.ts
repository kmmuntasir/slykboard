import { logger } from '../config/logger';
import { db } from '../db/client';
import { getFromDispatcher, DispatcherError } from './dispatcherClient';
import { PIPELINE_STATES, isLegalTransition, type PipelineState } from './pipelineStateService';
import * as pipelineJobService from './pipelineJobService';
import * as pipelineJobRepository from '../repositories/pipelineJobRepository';

// SLYK-0440 — missed-webhook safety net (07-dispatcher-contract.md § failure
// table: "Dispatcher webhook to slykboard fails … Polling fallback in Phase 5:
// every 60s, slykboard queries dispatcher GET /jobs/:ticketId/state for any
// ticket in a non-terminal state, reconciles"). The dispatcher is the source
// of truth; this loop converges slykboard onto it through the LEGAL-transition
// path only (SLYK-0260's updateJobState) — the matrix still applies, so drift
// requiring an illegal edge is logged + skipped, never forced.
//
// Agent-mode only: index.ts boots the loop after migrations when
// SLYKBOARD_AGENT_MODE=true; plain mode never imports it at runtime. The
// interval is unref'd (never holds the event loop open) and serial-drained
// (a slow sweep can't pile up on the next tick).

/** Default sweep cadence — 07 § failure table: "every 60s". */
export const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;

/** Env knob: SLYKBOARD_RECONCILE_INTERVAL_MS (ms). Test/local only — prod runs 60s. */
const INTERVAL_ENV = 'SLYKBOARD_RECONCILE_INTERVAL_MS';

/** Terminal per the matrix — no legal forward edge out of these. */
const TERMINAL_STATES: readonly PipelineState[] = [
  'DONE',
  'FAILED_AGENT',
  'FAILED_CI',
  'FAILED_CONFLICT',
  'FAILED_DEPLOY',
  'BLOCKED_HUMAN',
];

/**
 * Non-terminal = everything else (BACKLOG → DEPLOYING range). Kept derived
 * (complement of TERMINAL_STATES over the enum) so a new enum value can never
 * be silently excluded from polling.
 */
const NON_TERMINAL_STATES: readonly PipelineState[] = PIPELINE_STATES.filter(
  (state) => !TERMINAL_STATES.includes(state),
);

/** Dispatcher GET /jobs/:ticketId/state response body (SLYK-0440 contract). */
export interface DispatcherJobState {
  state: PipelineState;
  detail?: Record<string, unknown>;
  traceId?: string;
}

function readIntervalMs(): number {
  const raw = Number(process.env[INTERVAL_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECONCILE_INTERVAL_MS;
}

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

/** True when the dispatcher's 4xx says "no such job" — 404 and 400/422 shapes. */
function isNoSuchJob(err: unknown): boolean {
  return err instanceof DispatcherError && (err.status === 404 || err.status === 410);
}

/**
 * Reconcile ONE ticket against dispatcher truth. Conflict rules (ticket §3):
 *   dispatcher == local → no-op (no event, no write)
 *   dispatcher ahead    → apply via updateJobState, legal path only
 *   dispatcher behind / illegal edge → trust local, log. The matrix's edges
 *       are the pipeline's forward direction, so a stale dispatcher surfaces
 *       as an edge the matrix rejects — indistinguishable from a dispatcher
 *       bug, and in both cases the answer is "don't force it".
 */
export async function reconcileTicket(
  job: pipelineJobRepository.PipelineJobRow,
): Promise<'in-sync' | 'applied' | 'skipped-illegal' | 'error'> {
  try {
    const truth = await getFromDispatcher<DispatcherJobState>(`/jobs/${job.ticketId}/state`);
    if (!truth || typeof truth.state !== 'string' || !PIPELINE_STATES.includes(truth.state)) {
      logger.warn(
        { ticketId: job.ticketId, response: truth },
        'reconciler: dispatcher returned an unreadable state payload — skipping ticket',
      );
      return 'error';
    }

    if (truth.state === job.state) return 'in-sync';

    // Legal-edge check BEFORE the write: updateJobState would 400, but deciding
    // here keeps the reason distinguishable (illegal edge vs. dispatcher lag).
    const legal = isLegalTransition(job.state, truth.state);

    if (!legal) {
      // Matrix wins even though the dispatcher is the source of truth (ticket
      // §2: "illegal-transition errors logged + skipped"). If the dispatcher is
      // AHEAD via a legal edge, apply below; an illegal edge means either a
      // dispatcher bug or a missed intermediate state — flag, don't force.
      logger.warn(
        { ticketId: job.ticketId, local: job.state, dispatcher: truth.state },
        'reconciler: dispatcher state requires an illegal transition — skipping',
      );
      return 'skipped-illegal';
    }

    // Reached here ⇒ legal edge AND states differ. If the edge is legal, the
    // dispatcher is definitionally ahead on the matrix's acyclic happy path;
    // "behind" manifests as an illegal backwards edge (handled above).
    await pipelineJobService.updateJobState({
      ticketId: job.ticketId,
      body: {
        state: truth.state,
        detail: truth.detail,
        traceId: truth.traceId,
      },
    });
    logger.info(
      { ticketId: job.ticketId, from: job.state, to: truth.state },
      'reconciler: drift converged to dispatcher truth',
    );
    return 'applied';
  } catch (err) {
    if (isNoSuchJob(err)) {
      // Dispatcher never saw the ticket (e.g. its DB was reset, or the
      // ticket_created webhook never arrived). Local stays — do NOT tear down
      // the job row on a poll; a human decides.
      logger.warn(
        { ticketId: job.ticketId },
        'reconciler: dispatcher has no job for this ticket — keeping local state',
      );
      return 'error';
    }
    // HTTP failure / illegal-transition AppError from updateJobState — logged
    // (dispatcherClient already logs transport failures) and skipped so one
    // bad ticket never kills the sweep.
    logger.error(
      { ticketId: job.ticketId, err: err instanceof Error ? err.message : String(err) },
      'reconciler: ticket sweep failed — continuing',
    );
    return 'error';
  }
}

/** One full sweep: select non-terminal jobs, reconcile each. Never throws. */
export async function runReconcileSweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const jobs = await pipelineJobRepository.findNonTerminalJobs(db, [...NON_TERMINAL_STATES]);
    if (jobs.length === 0) return;
    for (const job of jobs) {
      await reconcileTicket(job);
    }
  } catch (err) {
    // Selection query itself failed — the loop must survive to the next tick.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'reconciler: sweep failed to load non-terminal jobs — continuing',
    );
  } finally {
    sweeping = false;
  }
}

/** Boot the reconcile loop. No-op when already running. Agent mode only. */
export function startPipelineReconciler(): void {
  if (timer !== null) return;
  const intervalMs = readIntervalMs();
  timer = setInterval(() => {
    void runReconcileSweep();
  }, intervalMs);
  // A poll must never hold the event loop open at shutdown.
  timer.unref();
  logger.info(
    { intervalMs },
    'pipeline reconciler started — polling dispatcher for non-terminal jobs',
  );
}

/** Graceful shutdown / test hook — clear the interval. Idempotent. */
export function stopPipelineReconciler(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    logger.info('pipeline reconciler stopped');
  }
}

/** Test/diagnostic surface — is the loop armed? */
export function reconcilerIsRunning(): boolean {
  return timer !== null;
}

/** Exposed for tests to assert the terminal-state exclusion set. */
export const RECONCILER_TERMINAL_STATES = TERMINAL_STATES;
