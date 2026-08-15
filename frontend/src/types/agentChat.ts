// SLYK-0340 — frontend mirror of the PM chat-thread payloads
// (SLYK-0330 GET/POST /api/v1/me/tickets/:id/messages). Row shapes match the
// Drizzle select types (repositories/agentMessageRepository.ts) as
// JSON-serialized: timestamps arrive as ISO strings.

import type { PipelineState } from '@/constants/pipelineStates';

/** MessageAuthorRole enum (db/schema/agent.ts). */
export type MessageAuthorRole = 'PM' | 'AGENT' | 'SYSTEM';

/** AgentMessages row (JSON-serialized), ascending by createdAt. */
export interface AgentMessage {
  id: string;
  ticketId: string;
  authorRole: MessageAuthorRole;
  authorUserId: string | null;
  body: string;
  agentSessionId: string | null;
  idempotencyKey: string | null;
  readAt: string | null;
  createdAt: string;
}

/** GET /api/v1/me/tickets/:id/messages envelope payload. */
export interface ChatThreadView {
  messages: AgentMessage[];
  /** Current pipeline state; null when the ticket has no pipeline row. */
  ticketState: PipelineState | null;
}

/**
 * POST response: the persisted PM row plus `delivered` — false when the
 * pm_reply webhook failed (the reply is durable; the queue retries). Never a
 * 4xx/5xx on that path, so `delivered: false` is an inline indicator, not a
 * thrown error.
 */
export interface PmReplyResult extends AgentMessage {
  delivered: boolean;
}
