// SLYK-0310 — frontend mirror of the backend pipeline payloads
// (SLYK-0280 GET /api/v1/me/tickets/:id/pipeline, SLYK-0290 POST
// /api/v1/me/tickets/:id/queue). Row shapes match the Drizzle select types
// (repositories/pipelineJobRepository.ts) as JSON-serialized: timestamps
// arrive as ISO strings.

import type { PipelineState } from '@/constants/pipelineStates';

/** Documented detail keys (db/schema/agent.ts pipelineEvents.detail jsonb). */
export interface PipelineEventDetail {
  traceId?: string;
  prNumber?: number;
  sha?: string;
  attempt?: number;
  error?: string;
  durationMs?: number;
  [key: string]: unknown;
}

/** PipelineJobs row (JSON-serialized). */
export interface PipelineJob {
  ticketId: string;
  projectId: string;
  state: PipelineState;
  priority: number;
  attempts: number;
  leaseOwnerId: string | null;
  leaseExpiresAt: string | null;
  agentIssueId: string | null;
  agentBackend: string | null;
  githubPrNumber: number | null;
  githubPrSha: string | null;
  needsPmAttention: boolean;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** PipelineEvents row (JSON-serialized), ascending by createdAt. */
export interface PipelineEvent {
  id: string;
  ticketId: string;
  fromState: PipelineState | null;
  toState: PipelineState;
  detail: PipelineEventDetail | null;
  traceId: string | null;
  createdAt: string;
}

/** GET /api/v1/me/tickets/:id/pipeline envelope payload. */
export interface PipelineView {
  job: PipelineJob;
  events: PipelineEvent[];
}
