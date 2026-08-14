import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { pipelineEvents, pipelineJobs, projects, tickets } from '../db/schema';
import type { Column } from '../db/schema';
import type { PipelineState } from '../services/pipelineStateService';

// SLYK-0260 — data access for PipelineJobs/PipelineEvents
// (docs/agentic-automation/05-backend-routes.md § jobs/:ticketId/state).
// First agent-domain repository (11-existing-patterns.md mandates
// Route → Service → Repository for agent code); every mutation takes the
// caller's tx handle so the state write stays atomic (transactions in
// services, per AGENTS.md).

// Local alias mirroring onboardingEventService.ts — the drizzle tx client type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PipelineJobRow = typeof pipelineJobs.$inferSelect;
export type PipelineEventRow = typeof pipelineEvents.$inferSelect;

/** Load a pipeline job by ticketId, or null when the ticket is not in the pipeline. */
export async function findJobByTicketId(tx: Tx, ticketId: string): Promise<PipelineJobRow | null> {
  const [row] = await tx
    .select()
    .from(pipelineJobs)
    .where(eq(pipelineJobs.ticketId, ticketId))
    .limit(1);
  return row ?? null;
}

export interface UpdateJobPatch {
  state: PipelineState;
  attempts?: number;
  needsPmAttention?: boolean;
  githubPrNumber?: number;
  githubPrSha?: string;
  traceId?: string | null;
}

/** Update the job row; returns the updated row (updatedAt via $onUpdate). */
export async function updateJob(
  tx: Tx,
  ticketId: string,
  patch: UpdateJobPatch,
): Promise<PipelineJobRow> {
  const [row] = await tx
    .update(pipelineJobs)
    .set(patch)
    .where(eq(pipelineJobs.ticketId, ticketId))
    .returning();
  return row!;
}

export interface InsertEventArgs {
  ticketId: string;
  fromState: PipelineState;
  toState: PipelineState;
  detail: Record<string, unknown> | null;
  traceId: string | null;
}

/** Append one row to the PipelineEvents log (append-only; duplicates allowed). */
export async function insertEvent(tx: Tx, args: InsertEventArgs): Promise<PipelineEventRow> {
  const [row] = await tx
    .insert(pipelineEvents)
    .values({
      ticketId: args.ticketId,
      fromState: args.fromState,
      toState: args.toState,
      detail: args.detail,
      traceId: args.traceId,
    })
    .returning();
  return row!;
}

/**
 * Resolve the project's Done column id. statusColumn stores a Column.id
 * (UUID), never the display name — writing 'Done' would strand the ticket in
 * the unsorted bucket. Convention (F48 D6, reportService): the Done column is
 * the last entry of projects.columns. Returns null when the project has no
 * columns (degenerate config; caller decides).
 */
export async function findDoneColumnId(tx: Tx, projectId: string): Promise<string | null> {
  const [row] = await tx
    .select({ columns: projects.columns })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const cols: Column[] | undefined = row?.columns;
  return cols && cols.length > 0 ? cols[cols.length - 1]!.id : null;
}

/**
 * Kanban auto-move on DONE (service resolves the Done column id first).
 * statusColumn must be a real Column.id — the display name would strand the
 * ticket in the unsorted bucket.
 */
export async function setTicketStatusColumn(
  tx: Tx,
  ticketId: string,
  columnId: string,
): Promise<void> {
  await tx.update(tickets).set({ statusColumn: columnId }).where(eq(tickets.id, ticketId));
}
