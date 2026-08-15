import { db } from '../db/client';
import { logger } from '../config/logger';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { StateUpdateBody } from '../routes/internal.schema';
import { assertLegalTransition, type PipelineState } from './pipelineStateService';
import * as pipelineJobRepository from '../repositories/pipelineJobRepository';
import type { PipelineJobRow } from '../repositories/pipelineJobRepository';
import { sseEmit } from './sseEmitter';
import { notifyAgentWaitingEmail } from './agentWaitingNotifyService';
import { notifyTicketStateEmail } from './ticketStateNotifyService';

// SLYK-0260 — dispatcher state-write endpoint's business logic
// (docs/agentic-automation/05-backend-routes.md § jobs/:ticketId/state,
// behavior table on the ticket). One db.transaction: load job → validate
// transition → append event → update job (+ DONE kanban move,
// AGENT_WAITING badge, attempts bump, PR fields) → SSE emit after commit.

/** FAILED_* states — the only ones that bump attempts when retried to QUEUED. */
const RETRYABLE_STATES: ReadonlySet<PipelineState> = new Set([
  'FAILED_AGENT',
  'FAILED_CI',
  'FAILED_CONFLICT',
  'FAILED_DEPLOY',
]);

// detail keys documented in 04-schema.md (PipelineEvents.detail): free-form
// jsonb the dispatcher populates; we persist it verbatim but promote these
// two onto the job row when present.
interface JobDetail {
  prNumber?: unknown;
  sha?: unknown;
}

/**
 * Map the state machine's VALIDATION_FAILED rejection onto the wire contract.
 * SLYK-0250 throws VALIDATION_FAILED (its own tests lock that in); the route
 * contract (05-backend-routes.md § error envelope, and that module's header)
 * assigns SLYK-0260 the mapping to 400 INVALID_STATE_TRANSITION. details
 * {from, to} rides through unchanged.
 */
function asInvalidTransition(err: unknown, from: PipelineState, to: PipelineState): AppError {
  if (err instanceof AppError) {
    return new AppError(ErrorCode.INVALID_STATE_TRANSITION, err.message, { details: err.details });
  }
  return new AppError(
    ErrorCode.INVALID_STATE_TRANSITION,
    `Cannot transition from ${from} to ${to}`,
    { details: { from, to } },
  );
}

/**
 * POST /api/v1/internal/jobs/:ticketId/state — transition a ticket's pipeline
 * job. Returns the updated job row. Throws AppError (NOT_FOUND 404,
 * INVALID_STATE_TRANSITION 400) — the route layer never shapes errors.
 */
export async function updateJobState(args: {
  ticketId: string;
  body: StateUpdateBody;
}): Promise<PipelineJobRow> {
  const { ticketId, body } = args;
  const to = body.state;
  let fromStateForEvent: PipelineState = to; // overwritten by the load inside the tx

  const job = await db.transaction(async (tx) => {
    // 1. Load the job — absent row = ticket not in the pipeline.
    const current = await pipelineJobRepository.findJobByTicketId(tx, ticketId);
    if (!current) {
      throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' is not in the pipeline`, {
        details: { ticketId },
      });
    }
    const from = current.state;
    fromStateForEvent = from;

    // 2. Validate the transition (SLYK-0250 core) → 400 INVALID_STATE_TRANSITION.
    //    Same-state writes are illegal self-loops here: dispatcher dedups
    //    upstream (07-dispatcher-contract.md § Retry semantics — inbound
    //    idempotency is the dispatcher's job).
    try {
      assertLegalTransition(from, to, current.attempts);
    } catch (err) {
      throw asInvalidTransition(err, from, to);
    }

    // 3. Append the event (detail verbatim; append-only, duplicates allowed).
    await pipelineJobRepository.insertEvent(tx, {
      ticketId,
      fromState: from,
      toState: to,
      detail: body.detail ?? null,
      traceId: body.traceId ?? null,
    });

    // 4. Update the job. attempts++ whenever a FAILED_* job re-queues — the
    //    consistent rule the ticket names (the cap check in step 2 read the
    //    pre-bump value, so attempts=2 → QUEUED is legal, becomes 3, and the
    //    next FAILED_*→QUEUED at 3 is rejected).
    const patch: pipelineJobRepository.UpdateJobPatch = { state: to };
    if (RETRYABLE_STATES.has(from) && to === 'QUEUED') {
      patch.attempts = current.attempts + 1;
    }
    // needsPmAttention: set on AGENT_WAITING entry, cleared on any exit.
    if (to === 'AGENT_WAITING') {
      patch.needsPmAttention = true;
    } else if (from === 'AGENT_WAITING') {
      patch.needsPmAttention = false;
    }
    const detail = (body.detail ?? {}) as JobDetail;
    if (typeof detail.prNumber === 'number') {
      patch.githubPrNumber = detail.prNumber;
    }
    if (typeof detail.sha === 'string') {
      patch.githubPrSha = detail.sha;
    }
    if (body.traceId !== undefined) {
      patch.traceId = body.traceId;
    }
    const updated = await pipelineJobRepository.updateJob(tx, ticketId, patch);

    // 5. DONE → kanban auto-move. statusColumn holds a Column.id, so resolve
    //    the project's Done column (last entry — F48 D6 convention) first.
    if (to === 'DONE') {
      const doneColumnId = await pipelineJobRepository.findDoneColumnId(tx, current.projectId);
      if (doneColumnId) {
        await pipelineJobRepository.setTicketStatusColumn(tx, ticketId, doneColumnId);
      }
    }

    return updated;
  });

  // 7. SSE state event — after commit, so subscribers only ever see durable
  //    state. Seamed through sseEmitter (no-op until SLYK-0270 wires the
  //    per-ticket channel).
  sseEmit({
    ticketId,
    fromState: fromStateForEvent,
    toState: to,
    detail: body.detail ?? null,
    traceId: body.traceId ?? null,
  });

  // 8. SLYK-0350 — AGENT_WAITING entry emails the ticket creator. The notify
  //    service never rejects by contract, but belt-and-braces: email is
  //    best-effort and must never fail the durable state write (same swallow
  //    posture as sseEmit above). Plain mode never reaches here —
  //    requireAgentMode 501s the route before the service is invoked.
  if (to === 'AGENT_WAITING') {
    try {
      await notifyAgentWaitingEmail(ticketId);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), ticketId },
        'AGENT_WAITING email hook threw',
      );
    }
  }

  // 9. SLYK-0390 — DONE / BLOCKED_HUMAN entry emails the ticket creator
  //    (the other two email-triggering states, 06-frontend-ui.md §
  //    Notifications). Same fire-and-forget posture as the AGENT_WAITING
  //    hook above; the notify service preference-gates per trigger.
  if (to === 'DONE' || to === 'BLOCKED_HUMAN') {
    const kind = to === 'DONE' ? 'done' : 'blockedHuman';
    try {
      await notifyTicketStateEmail(ticketId, kind);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), ticketId, kind },
        'ticket-state email hook threw',
      );
    }
  }

  return job;
}
