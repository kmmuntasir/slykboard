// SLYK-0250: pipeline state machine — pure transition-matrix module
// (docs/agentic-automation/05-backend-routes.md § Pipeline state transitions).
// No DB, no HTTP — importable by route + service layers. The route layer
// (SLYK-0260) maps the thrown AppError to `400 INVALID_STATE_TRANSITION`
// with `details: { from, to }` via the global error middleware.
import { pipelineStateEnum } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

/** All 15 pipeline states, in enum order (source of truth: db/schema/agent.ts). */
export const PIPELINE_STATES = pipelineStateEnum.enumValues;

export type PipelineState = (typeof PIPELINE_STATES)[number];

/** FAILED_* states — the only ones subject to the auto-retry cap. */
const RETRYABLE_STATES: ReadonlySet<PipelineState> = new Set([
  'FAILED_AGENT',
  'FAILED_CI',
  'FAILED_CONFLICT',
  'FAILED_DEPLOY',
]);

/** Default max attempts before a FAILED_* job must escalate to BLOCKED_HUMAN. */
export const DEFAULT_RETRY_CAP = 3;

/**
 * Legal-transition matrix encoded as `"${from}->${to}"` keys. Every cell not
 * present is illegal. Matches the 15×15 table in 05-backend-routes.md exactly.
 */
export const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  'BACKLOG->QUEUED',
  'QUEUED->AGENT_RUNNING',
  'QUEUED->FAILED_AGENT',
  'AGENT_RUNNING->AGENT_WAITING',
  'AGENT_RUNNING->PR_OPEN',
  'AGENT_RUNNING->FAILED_AGENT',
  'AGENT_WAITING->AGENT_RUNNING',
  'AGENT_WAITING->FAILED_AGENT',
  'PR_OPEN->CI_RUNNING',
  'CI_RUNNING->MERGING',
  'CI_RUNNING->FAILED_CI',
  'MERGING->CONFLICT_RETRY',
  'MERGING->DONE',
  'CONFLICT_RETRY->MERGING',
  'CONFLICT_RETRY->FAILED_CONFLICT',
  'DEPLOYING->DONE',
  'DEPLOYING->FAILED_DEPLOY',
  'FAILED_AGENT->QUEUED',
  'FAILED_AGENT->BLOCKED_HUMAN',
  'FAILED_CI->QUEUED',
  'FAILED_CI->BLOCKED_HUMAN',
  'FAILED_CONFLICT->QUEUED',
  'FAILED_CONFLICT->BLOCKED_HUMAN',
  'FAILED_DEPLOY->QUEUED',
  'FAILED_DEPLOY->BLOCKED_HUMAN',
  'BLOCKED_HUMAN->QUEUED',
]);

/** True iff `from -> to` is a legal edge in the matrix (DONE rejects all). */
export function isLegalTransition(from: PipelineState, to: PipelineState): boolean {
  return LEGAL_TRANSITIONS.has(`${from}->${to}`);
}

/**
 * True when the job has exhausted its auto-retry budget — FAILED_* → QUEUED is
 * no longer allowed and the only legal exit is BLOCKED_HUMAN (05-backend-routes
 * § invariants, "Auto-retry cap").
 */
export function exceedsRetryCap(attempts: number, cap: number = DEFAULT_RETRY_CAP): boolean {
  return attempts >= cap;
}

/**
 * Validate one transition. Legal → no-op. Illegal → AppError(VALIDATION_FAILED)
 * with `details: { from, to }`, which errorMiddleware serializes as
 * `400 INVALID_STATE_TRANSITION`. SLYK-0260's state route calls this inside its
 * transaction, before writing PipelineEvents/PipelineJobs.
 */
export function assertLegalTransition(
  from: PipelineState,
  to: PipelineState,
  attempts: number = 0,
  cap: number = DEFAULT_RETRY_CAP,
): void {
  if (isLegalTransition(from, to)) {
    // FAILED_* → QUEUED is only legal under the retry cap; at/over cap the
    // only exit is BLOCKED_HUMAN (escalation), so re-queueing must 400.
    if (to === 'QUEUED' && RETRYABLE_STATES.has(from) && exceedsRetryCap(attempts, cap)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `Retry cap reached (${attempts}/${cap}); ${from} must escalate to BLOCKED_HUMAN`,
        { details: { from, to } },
      );
    }
    return;
  }
  throw new AppError(ErrorCode.VALIDATION_FAILED, `Cannot transition from ${from} to ${to}`, {
    details: { from, to },
  });
}
