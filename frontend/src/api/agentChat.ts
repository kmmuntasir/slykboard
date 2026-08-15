import { apiFetch } from './client';
import type { AgentMessage, ChatThreadView, PmReplyResult } from '@/types/agentChat';

// SLYK-0340 — typed client for the PM chat endpoints (SLYK-0330). Agent
// routes live under the versioned /api/v1 mount — apiFetch's base URL is
// .../api, so agent paths are written as `/v1/...` here (same convention as
// api/onboarding.ts).
//
//   GET  /v1/me/tickets/:id/messages → ChatThreadView (thread asc + the
//        ticketState that gates the reply input; null state + empty thread
//        for a ticket with no pipeline row — not an error).
//   POST /v1/me/tickets/:id/messages → 201 PmReplyResult. 409 CONFLICT
//        ("Agent is not listening") when state ∉ {AGENT_RUNNING,
//        AGENT_WAITING}; 201 with delivered:false when the dispatcher
//        webhook failed (the row is durable, the queue retries).

export const agentChatApi = {
  getThread: (ticketId: string): Promise<ChatThreadView> =>
    apiFetch<ChatThreadView>(`/v1/me/tickets/${ticketId}/messages`),

  postReply: (ticketId: string, body: string): Promise<PmReplyResult> =>
    apiFetch<PmReplyResult>(`/v1/me/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};

// Query key factory additions per 11-existing-patterns.md — colocated here
// (not in queryKeys.ts) so the plain-mode bundle never references agent keys
// (same convention as onboardingKeys). Own root: SSE message events append
// into the cached thread directly, so the key must not ride ticketKeys.
export const agentChatKeys = {
  all: ['agent-chat'] as const,
  thread: (ticketId: string) => [...agentChatKeys.all, 'thread', ticketId] as const,
};

/** Convenience re-export for consumers building cached thread views. */
export type { AgentMessage, ChatThreadView, PmReplyResult };
