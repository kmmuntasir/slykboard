import { randomUUID } from 'node:crypto';
import { db } from '../db/client';
import { logger } from '../config/logger';
import { ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { postToDispatcher } from './dispatcherClient';
import { sseEmit } from './sseEmitter';
import { hydrateLabelsForTickets } from './labelService';
import { insertJob } from '../repositories/pipelineJobRepository';
import { findMetaByProjectId } from '../repositories/projectAgentMetaRepository';
import type { TicketRow } from './ticketService';
import { updateJobState } from './pipelineJobService';
import type { PipelineJobRow } from '../repositories/pipelineJobRepository';

// SLYK-0290 — agent-mode add-ons around ticket creation and the PM
// "Start work" action (07-dispatcher-contract.md § /webhooks/ticket-events,
// 11-existing-patterns.md § auto-queue hook). Plain mode never imports the
// behavior: every entry point is gated on SLYKBOARD_AGENT_MODE === 'true',
// read lazily (same idiom as requireAgentMode / agentTokenAuth).

/** Lazy agent-mode gate — test env defaults to plain (no SLYKBOARD_* vars). */
export function agentModeEnabled(): boolean {
  return process.env.SLYKBOARD_AGENT_MODE === 'true';
}

/**
 * ticket_created payload ticket object — 07-dispatcher-contract.md § ticket_created,
 * field-for-field: id, projectId, projectSlug, teamKey, agentBackend, number,
 * title, description, priority, labels[], createdAt.
 */
export interface TicketCreatedTicket {
  id: string;
  projectId: string;
  projectSlug: string;
  teamKey: string;
  agentBackend: string | null;
  number: number;
  title: string;
  description: string | null;
  priority: string;
  labels: string[];
  createdAt: string;
}

/**
 * Auto-queue hook — runs AFTER the ticket insert (and label linking) commit.
 * 1. Insert the PipelineJobs row (state BACKLOG, agentBackend snapshot, traceId).
 * 2. Fire-and-forget the signed ticket_created webhook. The dispatcherClient
 *    owns retries (3×) and idempotencyKey injection; on final failure the job
 *    stays at BACKLOG per 07's failure table — the ticket already exists and
 *    must not fail because the dispatcher is unreachable (unlike /onboard,
 *    which rolls its failure into a 502).
 */
export async function autoQueueOnCreate(ticket: TicketRow): Promise<void> {
  const traceId = randomUUID();
  const meta = await findMetaByProjectId(ticket.projectId);
  const job = await insertJob(db, {
    ticketId: ticket.id,
    projectId: ticket.projectId,
    agentBackend: meta?.agentBackend ?? null,
    traceId,
  });

  // Fire-and-forget AFTER the job row is durable: a crash between insert and
  // webhook leaves a recoverable BACKLOG job, never an untracked ticket.
  void emitTicketCreated(ticket, meta).catch((err: unknown) => {
    // 07 § failure table "Dispatcher unreachable / 4xx on ticket creation":
    // log with traceId for the admin badge (SLYK-0310) — never rethrow into
    // the create path, never an unhandled rejection.
    logger.error(
      {
        err,
        ticketId: ticket.id,
        traceId,
        jobState: job.state,
      },
      'ticket_created webhook failed after retries — job left at BACKLOG',
    );
  });
}

async function emitTicketCreated(
  ticket: TicketRow,
  meta: { slug: string; teamKey: string; agentBackend: string | null } | null,
): Promise<void> {
  // Labels are linked after the create transaction commits, so hydrate names
  // here (payload wants label names, not ids).
  const labelMap = await hydrateLabelsForTickets([ticket.id]);
  const payload: { eventType: 'ticket_created'; ticket: TicketCreatedTicket } = {
    eventType: 'ticket_created',
    ticket: {
      id: ticket.id,
      projectId: ticket.projectId,
      // Core projects.slug IS the teamKey by construction (onboarding maps
      // 'inventory-tracker' → 'INVENTORYTRACKER'); meta?.slug is the lowercase
      // kebab agent slug the dispatcher routes on.
      projectSlug: meta?.slug ?? '',
      teamKey: meta?.teamKey ?? '',
      agentBackend: meta?.agentBackend ?? null,
      number: ticket.ticketNumber,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      labels: (labelMap.get(ticket.id) ?? []).map((label) => label.name),
      createdAt: ticket.createdAt.toISOString(),
    },
  };
  // dispatcherClient injects the idempotencyKey and logs ticketId via
  // body.ticket.id; traceId rides on the job row for the admin timeline.
  await postToDispatcher('/webhooks/ticket-events', payload);
}

/**
 * POST /api/v1/me/tickets/:ticketId/queue — PM "Start work" (06-frontend-ui.md
 * PipelinePanel empty state → 'Queue for agent'). Transitions the job to QUEUED
 * through the SLYK-0260 service path (matrix + attempts cap + event row + SSE
 * frame), then emits queue_for_agent to the dispatcher AFTER the commit.
 * Throws: NOT_FOUND (no job), CONFLICT 409 (illegal source state — the ticket
 * contract's PM-facing code; the internal dispatcher route keeps its own 400
 * INVALID_STATE_TRANSITION mapping), UPSTREAM_FAILED (dispatcher unreachable
 * after retries — the QUEUED row is kept; the dispatcher re-picks via its own
 * lease query).
 */
export async function queueForAgent(ticketId: string): Promise<PipelineJobRow> {
  let job: PipelineJobRow;
  const transition: Parameters<typeof updateJobState>[0] = {
    ticketId,
    body: { state: 'QUEUED', detail: { source: 'pm_start_work' } },
  };
  try {
    job = await updateJobState(transition);
  } catch (err) {
    // SLYK-0260 maps illegal transitions to INVALID_STATE_TRANSITION (400) for
    // the dispatcher-facing internal route. The PM-facing contract on this
    // ticket says 409 CONFLICT — remap, keeping message + {from, to} details.
    if (err instanceof AppError && err.code === ErrorCode.INVALID_STATE_TRANSITION) {
      throw new AppError(ErrorCode.CONFLICT, err.message, {
        details: err.details,
      });
    }
    throw err;
  }

  try {
    await postToDispatcher('/webhooks/ticket-events', {
      eventType: 'queue_for_agent',
      ticketId,
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    logger.error(
      { err: cause, ticketId, traceId: job.traceId },
      'queue_for_agent webhook failed after retries — job stays QUEUED',
    );
    throw new AppError(ErrorCode.UPSTREAM_FAILED, `Dispatcher queue failed: ${detail}`, {
      details: { ticketId, traceId: job.traceId },
      cause,
    });
  }

  return job;
}

// Re-export so route layers subscribe to state frames through one seam.
export { sseEmit };
