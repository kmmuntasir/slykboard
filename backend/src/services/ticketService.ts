import { and, asc, eq, max, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { projectSequences, projects, tickets } from '../db/schema';
import { sanitizeDescription } from '../utils/sanitizeHtml';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { getProjectBySlug } from './projectService';
import { UNSORTED_BUCKET_ID } from './boardService';
import { replaceTicketLabels } from './labelService';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// F11 D1: doublePrecision midpoint strategy. GAP = spacing between siblings;
// EPSILON = the minimum detectable neighbor gap — below it we rebalance the column.
export const POSITION_GAP = 65536;
export const POSITION_EPSILON = 1e-6;

export type TicketRow = typeof tickets.$inferSelect;

// F13: Priority union mirrored from schema priorityEnum. (Schema doesn't export
// the inferred type yet; keep this local to avoid widening the T6 scope.)
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';

// F13 T6: partial patch for title/description/priority/assigneeId. `description`
// and `assigneeId` are nullable — `null` is a real value (clear), distinct from
// `undefined` (leave untouched). Route layer validates Priority; service trusts the type.
// F14: `labelIds` replaces the ticket's label set via replaceTicketLabels when present.
export type TicketPatch = {
  title?: string;
  description?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  labelIds?: string[];
};

export interface MoveTicketInput {
  ticketId: string;
  statusColumn: string;
  position: number;
}

// True when any adjacent pair in an ASC-ordered position list is closer than EPSILON
// → precision exhausted → whole column must be re-numbered.
function columnNeedsRebalance(positions: number[]): boolean {
  for (let i = 1; i < positions.length; i += 1) {
    const prev = positions[i - 1]!;
    const next = positions[i]!;
    if (next - prev < POSITION_EPSILON) {
      return true;
    }
  }
  return false;
}

export async function moveTicket({
  ticketId,
  statusColumn,
  position,
}: MoveTicketInput): Promise<TicketRow> {
  // 1. Load the ticket (404 if absent). Derive projectId from the row.
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
      details: { ticketId },
    });
  }

  // 2. Load the project's configured columns (JSONB) for membership validation.
  const [project] = await db
    .select({ columns: projects.columns })
    .from(projects)
    .where(eq(projects.id, ticket.projectId))
    .limit(1);
  if (!project) {
    throw new AppError(ErrorCode.NOT_FOUND, `Project for ticket '${ticketId}' not found`, {
      details: { ticketId },
    });
  }

  // 3. Validate statusColumn: must be a real Column.id AND must NOT be the unsorted
  //    sentinel (you cannot persist a card INTO __unsorted__ — it is display-only).
  const columnIds = project.columns.map((column) => column.id);
  if (statusColumn === UNSORTED_BUCKET_ID || !columnIds.includes(statusColumn)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Unknown column '${statusColumn}'`, {
      details: { statusColumn: 'Unknown column' },
    });
  }

  // 4-6. Single Drizzle transaction: write both fields, conditionally rebalance the
  //      destination column, then return the final row. A thrown error inside aborts
  //      the txn (drizzle/pg rollback) — atomicity is structural.
  return db.transaction(async (tx) => {
    await tx
      .update(tickets)
      .set({ statusColumn, position, updatedAt: new Date() })
      .where(eq(tickets.id, ticketId));

    // 5. Re-read the destination column ASC by position; rebalance on tight gap.
    const columnRows = await tx
      .select({ id: tickets.id, position: tickets.position })
      .from(tickets)
      .where(and(eq(tickets.projectId, ticket.projectId), eq(tickets.statusColumn, statusColumn)))
      .orderBy(asc(tickets.position));

    if (columnNeedsRebalance(columnRows.map((row) => row.position))) {
      // Re-number the whole column index * GAP in the same txn.
      await Promise.all(
        columnRows.map((row, index) =>
          tx
            .update(tickets)
            .set({ position: index * POSITION_GAP })
            .where(eq(tickets.id, row.id)),
        ),
      );
    }

    // 6. Return the moved ticket's final state (post any rebalance).
    const [updated] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    return updated!;
  });
}

// F12 D1: allocate the next per-project ticket_number inside the caller's txn.
// SELECT ... FOR UPDATE locks the counter row; the unique (project_id, ticket_number)
// index on tickets is the defense-in-depth backstop (double-alloc -> 23505 -> CONFLICT).
// Do NOT use noWait — Drizzle #3554 emits invalid "NO WAIT".
export async function allocateTicketNumber(tx: Tx, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ nextNumber: projectSequences.nextNumber })
    .from(projectSequences)
    .where(eq(projectSequences.projectId, projectId))
    .for('update');
  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, `Project sequence missing for project ${projectId}`);
  }
  const number = row.nextNumber;
  await tx
    .update(projectSequences)
    .set({ nextNumber: sql`${projectSequences.nextNumber} + 1` })
    .where(eq(projectSequences.projectId, projectId));
  return number;
}

export interface CreateTicketInput {
  slug: string;
  creatorId: string;
  title: string;
  description?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';
  labelIds?: string[];
  assigneeId?: string;
  statusColumn?: string; // optional; defaults to project.columns[0].id
}

// F12: create a ticket with a per-project sequential number, bottom of the
// resolved column. Single db.transaction: allocate number + compute bottom
// position + insert. Returns the inserted row.
export async function createTicket(input: CreateTicketInput): Promise<TicketRow> {
  const project = await getProjectBySlug(input.slug);
  if (!project) {
    throw new AppError(ErrorCode.NOT_FOUND, `Project '${input.slug}' not found`);
  }
  const firstColumnId = project.columns[0]?.id;
  if (!firstColumnId) {
    throw new AppError(ErrorCode.CONFLICT, `Project '${input.slug}' has no columns`);
  }
  const resolvedColumn = input.statusColumn ?? firstColumnId;
  const columnIds = new Set(project.columns.map((column) => column.id));
  if (!columnIds.has(resolvedColumn) || resolvedColumn === UNSORTED_BUCKET_ID) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Unknown column '${resolvedColumn}'`, {
      details: { statusColumn: 'Unknown column' },
    });
  }

  return db.transaction(async (tx) => {
    const ticketNumber = await allocateTicketNumber(tx, project.id);

    // F12 D3: bottom of the resolved column = (max(position) || 0) + POSITION_GAP.
    const [maxRow] = await tx
      .select({ maxPos: max(tickets.position) })
      .from(tickets)
      .where(and(eq(tickets.projectId, project.id), eq(tickets.statusColumn, resolvedColumn)));
    const position = (maxRow?.maxPos ?? 0) + POSITION_GAP;

    const [inserted] = await tx
      .insert(tickets)
      .values({
        projectId: project.id,
        ticketNumber,
        title: input.title,
        description: input.description,
        statusColumn: resolvedColumn,
        position,
        creatorId: input.creatorId,
        assigneeId: input.assigneeId,
        priority: input.priority,
      })
      .returning();
    const insertedTicket = inserted!;

    // F14: link labels via the join table after the ticket row exists.
    // replaceTicketLabels validates all labelIds belong to this project.
    if (input.labelIds !== undefined) {
      // tx is structurally compatible with db for replaceTicketLabels's queries;
      // run outside the closure's tx scope to keep labelService self-contained.
      // The outer db.transaction will rollback the ticket insert if this throws.
      await replaceTicketLabels({ ticketId: insertedTicket.id, labelIds: input.labelIds });
    }
    return insertedTicket;
  });
}

// F13 T6: read a single ticket by id, including description. Returns null on miss
// (route layer maps to 404). Used by the F13 detail/edit endpoint and the F16 modal.
export async function getTicket(ticketId: string): Promise<TicketRow | null> {
  const rows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  const row = rows[0];
  return row ?? null;
}

// F13 T6: partial update of ticket attributes. Accepts any subset of
// {title, description, priority, assigneeId}; `undefined` means leave untouched,
// `null` for description/assigneeId means clear. Description is sanitized on write
// via the T2 util. Returns {old, new} so F18 can diff for ActivityLogs without
// re-querying. `actingUserId` is accepted for a stable route contract but has no
// behavior in F13 (F18 will stamp audit metadata).
export async function updateTicket(args: {
  ticketId: string;
  patch: TicketPatch;
  actingUserId: string;
}): Promise<{ old: TicketRow; new: TicketRow }> {
  const { ticketId, patch } = args;
  const oldRows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  const oldRow = oldRows[0];
  if (!oldRow) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
      details: { ticketId },
    });
  }

  const updateSet: Partial<TicketRow> = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    updateSet.title = patch.title;
  }
  if (patch.description !== undefined) {
    updateSet.description = patch.description === null ? null : sanitizeDescription(patch.description);
  }
  if (patch.priority !== undefined) {
    updateSet.priority = patch.priority;
  }
  if (patch.assigneeId !== undefined) {
    updateSet.assigneeId = patch.assigneeId;
  }

  const updated = await db
    .update(tickets)
    .set(updateSet)
    .where(eq(tickets.id, ticketId))
    .returning();
  const newRow = updated[0];
  if (!newRow) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `Update returned no row for ticket '${ticketId}'`, {
      details: { ticketId },
    });
  }

  // F14: replace the label set when labelIds is present in the patch.
  // replaceTicketLabels validates all labelIds belong to the ticket's project
  // (foreign → VALIDATION_FAILED). Runs after the attribute update so the ticket
  // row is confirmed to exist. The { old, new } seam is preserved for F18.
  if (patch.labelIds !== undefined) {
    await replaceTicketLabels({ ticketId, labelIds: patch.labelIds });
  }

  // TODO(F18): diff {old, new} and write ActivityLogs here. REQ-5.2 covers
  // priority/assignee old→new; REQ-5.3 covers description (CONTENT_UPDATED).
  // F13 returns the diff shape; F18 hooks at this seam.
  return { old: oldRow, new: newRow };
}
