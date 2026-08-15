// SLYK-0400 — "Need human help" escalation service.
// POST /api/v1/me/tickets/:id/escalate backend: BLOCKED_HUMAN gate, signed
// dispatcher webhook (07-dispatcher-contract.md § /webhooks/pm-action/
// need-human-help — the AUTHORITATIVE path; 06's direct-Slack wording lost to
// 07 in reconciliation), 60s per-ticket debounce, optional secondary Slack
// ping when SLYKBOARD_SLACK_ESCALATION_WEBHOOK is set.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { pipelineJobs } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { postToDispatcher } from './dispatcherClient';

// One escalation per ticket per 60s (ticket acceptance: double-click fires a
// single dispatch; the second call 409s). In-memory is correct under the v1
// single-pod invariant (same seam note as the SSE emitter + rate limiter).
const DEBOUNCE_MS = 60_000;

const lastDispatchAt = new Map<string, number>();

// In-flight guard so two concurrent clicks can't both pass the timestamp
// check before either records a dispatch.
const inFlight = new Set<string>();

async function loadBlockedJob(ticketId: string) {
  const [job] = await db
    .select()
    .from(pipelineJobs)
    .where(eq(pipelineJobs.ticketId, ticketId))
    .limit(1);
  if (!job) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' is not in the pipeline`, {
      details: { ticketId },
    });
  }
  if (job.state !== 'BLOCKED_HUMAN') {
    // 409 "agent not listening" split per the ticket (non-BLOCKED state).
    throw new AppError(
      ErrorCode.CONFLICT,
      `Ticket is in state ${job.state}; escalation requires BLOCKED_HUMAN`,
      { details: { state: job.state } },
    );
  }
  return job;
}

/**
 * Escalate a BLOCKED_HUMAN ticket. 202-equivalent behavior: resolves
 * `{ ticketId, projectId, escalatedAt }` after the dispatcher acks; throws
 * AppError(UPSTREAM_FAILED) on dispatcher failure so the button re-enables
 * for a retry.
 */
export async function escalateTicket(ticketId: string): Promise<{
  ticketId: string;
  projectId: string;
  escalatedAt: string;
}> {
  const job = await loadBlockedJob(ticketId);

  if (inFlight.has(ticketId)) {
    throw new AppError(ErrorCode.CONFLICT, 'Escalation already in flight');
  }
  const now = Date.now();
  const last = lastDispatchAt.get(ticketId);
  if (last !== undefined && now - last < DEBOUNCE_MS) {
    throw new AppError(ErrorCode.CONFLICT, 'Escalation already sent within the last 60 seconds');
  }

  inFlight.add(ticketId);
  lastDispatchAt.set(ticketId, now);
  try {
    // Access check ran in the route; the dispatcher payload needs projectId —
    // the job row carries it (denormalized at insert per 04-schema.md). The
    // idempotencyKey is fixed per escalation attempt so dispatcher retries
    // dedupe, but a later (post-debounce) re-escalation gets a fresh key.
    await postToDispatcher('/webhooks/pm-action/need-human-help', {
      ticketId,
      projectId: job.projectId,
      reason: 'BLOCKED_HUMAN',
      idempotencyKey: randomUUID(),
    });
  } catch (err) {
    // Failed dispatch does not consume the debounce window — retry allowed.
    lastDispatchAt.delete(ticketId);
    // Duck-typed DispatcherError check — the real class is imported for the
    // type only; vi.mock replaces it with a lookalike in tests.
    if (err instanceof Error && err.name === 'DispatcherError') {
      throw new AppError(ErrorCode.UPSTREAM_FAILED, `Dispatcher escalation failed: ${err.message}`);
    }
    throw err;
  } finally {
    inFlight.delete(ticketId);
  }

  // Optional SECONDARY direct Slack ping (07 is authoritative; this is
  // belt-and-suspenders). Fire-and-forget — never fails the request.
  const slackWebhook = process.env.SLYKBOARD_SLACK_ESCALATION_WEBHOOK;
  if (slackWebhook) {
    void fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Slykboard: ticket ${ticketId} (project ${job.projectId}) needs human help — BLOCKED_HUMAN`,
      }),
    }).catch(() => {
      // Secondary channel failure is log-worthy, not request-fatal.
    });
  }

  return {
    ticketId,
    projectId: job.projectId,
    escalatedAt: new Date(now).toISOString(),
  };
}

/** Test seam: clear the debounce map between cases. */
export function _resetEscalationDebounceForTests(): void {
  lastDispatchAt.clear();
  inFlight.clear();
}
