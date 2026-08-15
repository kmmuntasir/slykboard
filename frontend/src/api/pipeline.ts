// SLYK-0310 — agent pipeline API client (11-existing-patterns.md § API client).
// Thin functions over apiFetch, mirroring api/tickets.ts. The pipeline GET
// 404s ("is not in the pipeline") when the ticket has no job row — the
// PipelinePanel empty state keys off ApiClientError(404, NOT_FOUND).

import { apiFetch } from './client';
import type { PipelineJob, PipelineView } from '@/types/pipeline';

/** GET /api/v1/me/tickets/:id/pipeline — job row + last 50 events (asc). */
export function fetchPipeline(ticketId: string): Promise<PipelineView> {
  return apiFetch<PipelineView>(`/api/v1/me/tickets/${ticketId}/pipeline`);
}

/** POST /api/v1/me/tickets/:id/queue — PM "Start work"; returns the QUEUED job. */
export function queueTicketForAgent(ticketId: string): Promise<PipelineJob> {
  return apiFetch<PipelineJob>(`/api/v1/me/tickets/${ticketId}/queue`, {
    method: 'POST',
  });
}

/** SLYK-0400 escalation result (202 payload). */
export interface EscalationResult {
  ticketId: string;
  projectId: string;
  escalatedAt: string;
}

/** POST /api/v1/me/tickets/:id/escalate — "Need human help" on BLOCKED_HUMAN. */
export function escalateTicket(ticketId: string): Promise<EscalationResult> {
  return apiFetch<EscalationResult>(`/api/v1/me/tickets/${ticketId}/escalate`, {
    method: 'POST',
  });
}
