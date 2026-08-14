import { db } from '../db/client';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { AgentMessageBody } from '../routes/internal.schema';
import * as agentMessageRepository from '../repositories/agentMessageRepository';
import type { AgentMessageRow } from '../repositories/agentMessageRepository';
import { findJobByTicketId } from '../repositories/pipelineJobRepository';
import { emit as sseEmitMessage } from './sseEmitter';

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
