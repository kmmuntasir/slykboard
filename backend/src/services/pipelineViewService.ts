import { db } from '../db/client';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import * as pipelineJobRepository from '../repositories/pipelineJobRepository';
import type { PipelineJobRow, PipelineEventRow } from '../repositories/pipelineJobRepository';

// SLYK-0280 — read side of the ticket Pipeline tab
// (docs/agentic-automation/05-backend-routes.md § me/tickets/:id/pipeline).
// The write side lives in pipelineJobService (SLYK-0260); this service only
// composes the job row + the capped event window into the response envelope.

/** Cap on returned events per 05-backend-routes.md ("up to 50 most recent"). */
export const MAX_PIPELINE_EVENTS = 50;

export interface PipelineView {
  job: PipelineJobRow;
  events: PipelineEventRow[];
}

/**
 * GET /api/v1/me/tickets/:id/pipeline — the job row plus the most recent 50
 * events in ascending createdAt order (timeline render order). Throws
 * AppError NOT_FOUND when the ticket has no PipelineJobs row (plain-mode
 * ticket / not queued) — access control happens before this runs, in
 * ticketService.getTicketForUser.
 */
export async function getPipelineView(ticketId: string): Promise<PipelineView> {
  return db.transaction(async (tx) => {
    const job = await pipelineJobRepository.findJobByTicketId(tx, ticketId);
    if (!job) {
      throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' is not in the pipeline`, {
        details: { ticketId },
      });
    }
    const events = await pipelineJobRepository.listEventsByTicketId(
      tx,
      ticketId,
      MAX_PIPELINE_EVENTS,
    );
    return { job, events };
  });
}
