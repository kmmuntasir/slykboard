import { randomUUID } from 'node:crypto';
import { db } from '../db/client';
import { logger } from '../config/logger';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { AgentMessageBody } from '../routes/internal.schema';
import * as agentMessageRepository from '../repositories/agentMessageRepository';
import type { AgentMessageRow } from '../repositories/agentMessageRepository';
import { findJobByTicketId, updateJob } from '../repositories/pipelineJobRepository';
import type { PipelineJobRow } from '../repositories/pipelineJobRepository';
import { emit as sseEmitMessage } from './sseEmitter';
import { postToDispatcher } from './dispatcherClient';
import { enqueuePmReply } from './pmReplyDeliveryQueue';

// SLYK-0320 — dispatcher message-forward endpoint's business logic
// (docs/agentic-automation/05-backend-routes.md § jobs/:ticketId/messages).
// One db.transaction: job lookup → idempotency check → insert; SSE message
// event fires after commit so subscribers only ever see durable rows.
//
// State coupling (ticket behavior step 5): the dispatcher flips AGENT_WAITING
// via the state endpoint — this service does NOT second-guess message content
// (no question-detection heuristics server-side).

/** SSE `message` frame shape — 05-backend-routes.md § /api/v1/me/tickets/:id/events. */
export interface SseMessageEventData {
  id: string;
  authorRole: AgentMessageRow['authorRole'];
  body: string;
  createdAt: Date;
}

export type { AgentMessageRow };

/**
 * POST /api/v1/internal/jobs/:ticketId/messages — persist a dispatcher-
 * forwarded agent/system utterance and fan it out to subscribed PM tabs.
 * Returns the row (pre-existing on an idempotent replay — no duplicate
 * insert, no second SSE frame). Throws AppError (NOT_FOUND 404) when the
 * ticket has no pipeline row.
 */
export async function recordAgentMessage(args: {
  ticketId: string;
  body: AgentMessageBody;
}): Promise<AgentMessageRow> {
  const { ticketId, body } = args;

  const message = await db.transaction(async (tx) => {
    // 1. Job lookup — absent row = ticket not in the pipeline (404).
    const job = await findJobByTicketId(tx, ticketId);
    if (!job) {
      throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' is not in the pipeline`, {
        details: { ticketId },
      });
    }

    // 2. Idempotency — same idempotencyKey replay returns the ORIGINAL row
    //    (07-dispatcher-contract.md § Retry semantics: slykboard checks
    //    AgentMessages.idempotencyKey for duplicates before inserting). The
    //    check runs inside the tx with the partial unique index as backstop.
    if (body.idempotencyKey !== undefined) {
      const existing = await agentMessageRepository.findByIdempotencyKey(tx, body.idempotencyKey);
      if (existing) {
        return { row: existing, replay: true };
      }
    }

    // 3. Insert — authorUserId null (dispatcher forwards, never a PM session);
    //    agentSessionId persisted for PM-reply routing; key stored for dedup.
    const row = await agentMessageRepository.insertMessage(tx, {
      ticketId,
      authorRole: body.authorRole,
      authorUserId: null,
      body: body.body,
      agentSessionId: body.agentSessionId ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
    });
    return { row, replay: false };
  });

  // 4. SSE message event — after commit, fresh inserts only (a replay already
  //    fanned out on first delivery; re-emitting would double-render in PM
  //    tabs). emit() never throws (dead-subscriber swallow in sseEmitter).
  if (!message.replay) {
    const data: SseMessageEventData = {
      id: message.row.id,
      authorRole: message.row.authorRole,
      body: message.row.body,
      createdAt: message.row.createdAt,
    };
    sseEmitMessage(ticketId, { type: 'message', data });
  }

  return message.row;
}

// ── SLYK-0330 — PM chat thread (05-backend-routes.md § me/tickets/:id/messages)

/** Chat-thread GET payload — messages asc + the gating state for the input box. */
export interface ChatThreadView {
  messages: AgentMessageRow[];
  ticketState: PipelineJobRow['state'] | null;
}

/**
 * GET /api/v1/me/tickets/:id/messages — the PM-facing thread read. The route
 * has ALREADY run getTicketForUser (404 for unknown ticket / non-member), so
 * by the time we get here the caller is a project member or platform admin —
 * that is what licenses the readAt write in step 3 (only a member's GET marks
 * agent messages read). One transaction: list asc → job state → stamp unread
 * AGENT rows. A ticket with no pipeline row still renders its (empty) thread
 * with ticketState null — the doc's shape has ticketState nullable.
 */
export async function getChatThread(ticketId: string): Promise<ChatThreadView> {
  return db.transaction(async (tx) => {
    const messages = await agentMessageRepository.listByTicketId(tx, ticketId);
    const job = await findJobByTicketId(tx, ticketId);
    await agentMessageRepository.markAgentMessagesRead(tx, ticketId);
    return { messages, ticketState: job?.state ?? null };
  });
}

/** Job states where the agent process can still receive a PM reply. */
const AGENT_LISTENING_STATES: ReadonlySet<PipelineJobRow['state']> = new Set([
  'AGENT_RUNNING',
  'AGENT_WAITING',
]);

/** PM row + the delivery flag the failure path adds (07 § failure table). */
export interface PmReplyResult {
  row: AgentMessageRow;
  delivered: boolean;
}

/**
 * POST /api/v1/me/tickets/:id/messages — the PM's reply. One db.transaction
 * (11-existing-patterns.md § agentMessageService skeleton): job lookup →
 * listening-state check → insert PM row → clear needsPmAttention (SLYK-0260
 * set it on AGENT_WAITING entry). AFTER the commit: signed pm_reply webhook
 * to the dispatcher (mock 202 = delivered), SSE message frame either way so
 * open tabs update. Webhook failure never rolls the reply back — the row is
 * durable, the response carries delivered:false, and the in-memory queue
 * retries every 30s up to 10 min (07 § failure table).
 */
export async function postPmReply(args: {
  ticketId: string;
  userId: string;
  body: string;
}): Promise<PmReplyResult> {
  const { ticketId, userId, body } = args;

  // The idempotencyKey is minted BEFORE the insert: every webhook attempt —
  // the first try and every background retry — must carry the same key so the
  // dispatcher can dedupe a late-delivered duplicate (07 § Retry semantics).
  const idempotencyKey = randomUUID();

  const { row, agentSessionId } = await db.transaction(async (tx) => {
    // 1. Job lookup — absent row = ticket not in the pipeline (404).
    const job = await findJobByTicketId(tx, ticketId);
    if (!job) {
      throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' is not in the pipeline`, {
        details: { ticketId },
      });
    }

    // 2. Listening check — replies past the agent's lifetime are a 409
    //    "agent not listening" (ticket behavior step 2; CONFLICT matches the
    //    closed ErrorCode vocabulary, same code the /queue route remaps to).
    if (!AGENT_LISTENING_STATES.has(job.state)) {
      throw new AppError(ErrorCode.CONFLICT, 'Agent is not listening on this ticket', {
        details: { ticketId, state: job.state },
      });
    }

    // 3. The reply's agentSessionId — routed to the session that last spoke
    //    (the question being answered), per ticket behavior step 5.
    const sessionId = await agentMessageRepository.findLatestAgentSessionId(tx, ticketId);

    // 4. Insert — authorRole PM, authorUserId = the logged-in PM. idempotencyKey
    //    null in the row: the key scopes the DISPATCHER call, not our insert
    //    (PM posts are never replayed by us; the column is for dispatcher
    //    forwards — internal.schema.ts rejects PM there).
    const inserted = await agentMessageRepository.insertMessage(tx, {
      ticketId,
      authorRole: 'PM',
      authorUserId: userId,
      body,
      agentSessionId: sessionId,
      idempotencyKey: null,
    });

    // 5. Clear needsPmAttention — SLYK-0260 set it on AGENT_WAITING; the PM
    //    answering IS the attention the badge asked for.
    await updateJob(tx, ticketId, { state: job.state, needsPmAttention: false });

    return { row: inserted, agentSessionId: sessionId };
  });

  // 6. SSE message frame — after commit, on BOTH delivery paths (open PM tabs
  //    render the reply regardless of dispatcher health).
  sseEmitMessage(ticketId, {
    type: 'message',
    data: {
      id: row.id,
      authorRole: row.authorRole,
      body: row.body,
      createdAt: row.createdAt,
    },
  });

  // 7. Signed pm_reply webhook (07 § /webhooks/ticket-events). Failure is a
  //    delivered:false response, never a lost reply: the queue retries.
  const payload = {
    eventType: 'pm_reply' as const,
    ticketId,
    agentSessionId,
    body,
    idempotencyKey,
  };
  let delivered = true;
  try {
    await postToDispatcher('/webhooks/ticket-events', payload);
  } catch (cause) {
    delivered = false;
    logger.error(
      { err: cause, ticketId, messageId: row.id },
      'pm_reply webhook failed after retries — queued for background delivery',
    );
    enqueuePmReply({ ticketId, messageId: row.id, payload });
  }

  return { row, delivered };
}
