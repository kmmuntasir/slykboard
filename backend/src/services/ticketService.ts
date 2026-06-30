import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { labels, projectSequences, projects, tickets, users } from '../db/schema';
import { sanitizeDescription } from '../utils/sanitizeHtml';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { getProjectBySlug } from './projectService';
import { UNSORTED_BUCKET_ID } from './boardService';
import { replaceTicketLabels, hydrateLabelsForTickets } from './labelService';
import { diffTicketChanges, recordActivity } from './activityLogService';
import { stopTimerForTicket } from './timerService';
import type { HydratedLabel } from './labelService';
import type { LabelDiff } from './activityLogService';
import type { ChecklistItem } from '../db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// F11 D1: doublePrecision midpoint strategy. GAP = spacing between siblings;
// EPSILON = the minimum detectable neighbor gap — below it we rebalance the column.
export const POSITION_GAP = 65536;
export const POSITION_EPSILON = 1e-6;

export type TicketRow = typeof tickets.$inferSelect;

// F16: resolved creator/assignee actor shape (mirrors boardService BoardAssignee).
// null when the FK user row is missing/deleted (FK-dangle guard).
export interface TicketActor {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

// F16: alias the users table twice so getTicket can left-join BOTH the creator
// and the assignee in one query. Created once at module load (standard Drizzle).
const creatorUser = alias(users, 'ticket_creator');
const assigneeUser = alias(users, 'ticket_assignee');

// F13: Priority union mirrored from schema priorityEnum. (Schema doesn't export
// the inferred type yet; keep this local to avoid widening the T6 scope.)
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';

// F13 T6: partial patch for title/description/priority/assigneeId. `description`
// and `assigneeId` are nullable — `null` is a real value (clear), distinct from
// `undefined` (leave untouched). Route layer validates Priority; service trusts the type.
// F14: `labelIds` replaces the ticket's label set via replaceTicketLabels when present.
// F15: `checklist` replaces the ticket's checklist JSONB array (full-array replace).
export type TicketPatch = {
  title?: string;
  description?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  labelIds?: string[];
  checklist?: ChecklistItem[];
  dueDate?: string | null;
};

export interface MoveTicketInput {
  ticketId: string;
  statusColumn: string;
  position: number;
  actingUserId: string;
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
  actingUserId,
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

    // F18 T4: emit a STATUS_CHANGED row only when the status actually changed.
    // `ticket.statusColumn` was loaded pre-txn (pre-write) — that IS the old status.
    // Same-column reposition → oldStatus === statusColumn → guard skips → zero rows.
    const oldStatus = ticket.statusColumn;
    if (oldStatus !== statusColumn) {
      await recordActivity(tx, {
        ticketId,
        actorId: actingUserId,
        action: 'STATUS_CHANGED',
        oldValue: oldStatus,
        newValue: statusColumn,
      });
    }

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
  checklist?: ChecklistItem[]; // F15: optional checklist at create; DB defaults to []
  dueDate?: string | null; // T1: optional due date (ISO 8601); null = none
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

  const insertedTicket = await db.transaction(async (tx) => {
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
        checklist: input.checklist,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      })
      .returning();
    // F18 T3: stamp a CREATED activity log inside the same txn so a rollback
    // discards both the ticket row and its log atomically. old/new default null.
    await recordActivity(tx, {
      ticketId: inserted!.id,
      actorId: input.creatorId,
      action: 'CREATED',
    });
    return inserted!;
  });

  // F15 fix (pre-existing F14 bug): link labels AFTER the transaction commits.
  // replaceTicketLabels queries via the shared `db` pool, which cannot see the
  // uncommitted insert inside the txn — calling it inside threw a spurious
  // "Ticket not found" 404 on every create (the form always sends labelIds: []).
  // Skip the no-op when labelIds is empty (a new ticket has no labels to clear).
  if (input.labelIds !== undefined && input.labelIds.length > 0) {
    await replaceTicketLabels({ ticketId: insertedTicket.id, labelIds: input.labelIds });
  }
  return insertedTicket;
}

// F13 T6: read a single ticket by id, including description. Returns null on miss
// (route layer maps to 404). Used by the F13 detail/edit endpoint and the F16 modal.
// F14: hydrate the ticket's labels ({id,name,color}[]) so the edit modal can
// pre-select them — matches the board payload shape (boardService hydrates too).
// F16: left-join users twice to resolve BOTH creator and assignee into
// {id,fullName,avatarUrl} objects (mirrors boardService's FK-dangle guard at
// boardService.ts:96-108). No migration — creator_id/assignee_id FKs already exist.
// F16: hydrated single-ticket payload — ticket row plus resolved creator/
// assignee actors and the ticket's label set. Shared by getTicket (by id) and
// getTicketByNumber (by slug+number, F30).
export type HydratedTicket = TicketRow & {
  labels: HydratedLabel[];
  creator: TicketActor | null;
  assignee: TicketActor | null;
};

// F16: shared shape of a raw joined row from the tickets + 2x users left-join.
// Both getTicket and getTicketByNumber build this row, then call hydrateTicketRow
// to map it to HydratedTicket. Keeping the join shape in one place guarantees
// the two read paths produce identical payloads (F30 requirement: the detail
// endpoint returns the SAME shape regardless of the lookup key).
type JoinedTicketRow = {
  ticket: TicketRow;
  creatorId: string | null;
  creatorFullName: string | null;
  creatorAvatarUrl: string | null;
  assigneeId: string | null;
  assigneeFullName: string | null;
  assigneeAvatarUrl: string | null;
};

// F30: map a raw joined row → HydratedTicket. Hydrates labels by ticket id and
// resolves creator/assignee users into {id,fullName,avatarUrl} (null when the
// FK user row is missing — mirrors boardService's FK-dangle guard). Extracted
// from getTicket so getTicketByNumber reuses the exact same mapping; behavior
// of getTicket is unchanged (same query shape, same null/coalesce rules).
async function hydrateTicketRow(row: JoinedTicketRow): Promise<HydratedTicket> {
  const ticketId = row.ticket.id;
  const labelMap = await hydrateLabelsForTickets([ticketId]);
  return {
    ...row.ticket,
    creator:
      row.creatorId === null
        ? null
        : {
            id: row.creatorId,
            fullName: row.creatorFullName ?? 'Unknown user',
            avatarUrl: row.creatorAvatarUrl,
          },
    assignee:
      row.assigneeId === null
        ? null
        : {
            id: row.assigneeId,
            fullName: row.assigneeFullName ?? 'Unknown user',
            avatarUrl: row.assigneeAvatarUrl,
          },
    labels: labelMap.get(ticketId) ?? [],
  };
}

export async function getTicket(ticketId: string): Promise<HydratedTicket | null> {
  const rows = await db
    .select({
      ticket: tickets,
      creatorId: creatorUser.id,
      creatorFullName: creatorUser.fullName,
      creatorAvatarUrl: creatorUser.avatarUrl,
      assigneeId: assigneeUser.id,
      assigneeFullName: assigneeUser.fullName,
      assigneeAvatarUrl: assigneeUser.avatarUrl,
    })
    .from(tickets)
    .leftJoin(creatorUser, eq(creatorUser.id, tickets.creatorId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return hydrateTicketRow(row);
}

// F30 D-Display-Id-Lookup: fetch a ticket by its human-readable ref
// (slug, ticketNumber). Resolves the project by slug, then selects by the
// unique (project_id, ticket_number) index (≤1 row guaranteed). Returns the
// SAME hydrated payload shape as getTicket so the detail route is agnostic
// to which key the client used. Returns null when the project or the ticket
// is absent (route layer maps both to 404). Soft-deleted rows are returned
// for parity with getTicket — both reads are soft-delete-transparent; the
// unique index and the id lookup behave identically w.r.t. deletedAt.
export async function getTicketByNumber(
  slug: string,
  ticketNumber: number,
): Promise<HydratedTicket | null> {
  const project = await getProjectBySlug(slug);
  if (!project) return null;

  const rows = await db
    .select({
      ticket: tickets,
      creatorId: creatorUser.id,
      creatorFullName: creatorUser.fullName,
      creatorAvatarUrl: creatorUser.avatarUrl,
      assigneeId: assigneeUser.id,
      assigneeFullName: assigneeUser.fullName,
      assigneeAvatarUrl: assigneeUser.avatarUrl,
    })
    .from(tickets)
    .leftJoin(creatorUser, eq(creatorUser.id, tickets.creatorId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .where(and(eq(tickets.projectId, project.id), eq(tickets.ticketNumber, ticketNumber)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return hydrateTicketRow(row);
}

// F13 T6: partial update of ticket attributes. Accepts any subset of
// {title, description, priority, assigneeId, checklist, labelIds}; `undefined`
// means leave untouched, `null` for description/assigneeId means clear. Description
// is sanitized on write. Returns {old, new} for the route layer.
// F18 T5 (D5/D7/D8/D9): runs inside db.transaction; snapshots OLD label names
// before replace, diffs old→new, and writes ActivityLogs rows via recordActivity.
export async function updateTicket(args: {
  ticketId: string;
  patch: TicketPatch;
  actingUserId: string;
}): Promise<{ old: TicketRow; new: TicketRow }> {
  const { ticketId, patch, actingUserId } = args;

  // F18 T5 (D5, GAP #1): wrap the read + update + label replace + activity
  // logging in one db.transaction so a rollback discards everything atomically.
  return db.transaction(async (tx) => {
    // Load the OLD row INSIDE the txn so the read and the write are atomic.
    const oldRows = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    const oldRow = oldRows[0];
    if (!oldRow) {
      throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
        details: { ticketId },
      });
    }

    // F18 T5 (D9, GAP #2): when labels are in the patch, snapshot the OLD label
    // names BEFORE replacing (replace deletes the link rows). Resolve NEW names
    // from the project's label rows so the diff carries readable names, not ids.
    let labelDiff: LabelDiff | null = null;
    if (patch.labelIds !== undefined) {
      const oldLabelMap = await hydrateLabelsForTickets([ticketId], tx);
      const oldNames = (oldLabelMap.get(ticketId) ?? []).map((label) => label.name);
      const newLabelRows = await tx
        .select({ name: labels.name })
        .from(labels)
        .where(inArray(labels.id, patch.labelIds));
      const newNames = Array.from(new Set(newLabelRows.map((row) => row.name)));
      const oldNameSet = new Set(oldNames);
      const newNameSet = new Set(newNames);
      labelDiff = {
        added: newNames.filter((name) => !oldNameSet.has(name)),
        removed: oldNames.filter((name) => !newNameSet.has(name)),
      };
    }

    const updateSet: Partial<TicketRow> = { updatedAt: new Date() };
    if (patch.title !== undefined) {
      updateSet.title = patch.title;
    }
    if (patch.description !== undefined) {
      updateSet.description =
        patch.description === null ? null : sanitizeDescription(patch.description);
    }
    if (patch.priority !== undefined) {
      updateSet.priority = patch.priority;
    }
    if (patch.assigneeId !== undefined) {
      updateSet.assigneeId = patch.assigneeId;
    }
    if (patch.checklist !== undefined) {
      updateSet.checklist = patch.checklist;
    }
    if (patch.dueDate !== undefined) {
      updateSet.dueDate = patch.dueDate === null ? null : new Date(patch.dueDate);
    }

    const updated = await tx
      .update(tickets)
      .set(updateSet)
      .where(eq(tickets.id, ticketId))
      .returning();
    const newRow = updated[0];
    if (!newRow) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Update returned no row for ticket '${ticketId}'`,
        {
          details: { ticketId },
        },
      );
    }

    // F14: replace the label set. Now INSIDE the txn (D7 tx-aware labelService).
    // replaceTicketLabels validates all labelIds belong to the ticket's project.
    if (patch.labelIds !== undefined) {
      await replaceTicketLabels({ ticketId, labelIds: patch.labelIds }, tx);
    }

    // F18 T5: diff {old, new} + label changes -> ActivityLogs rows. A no-op
    // patch (no field changed) yields zero entries -> zero rows written.
    const entries = diffTicketChanges(
      {
        title: oldRow.title,
        description: oldRow.description,
        priority: oldRow.priority,
        assigneeId: oldRow.assigneeId,
      },
      {
        title: newRow.title,
        description: newRow.description,
        priority: newRow.priority,
        assigneeId: newRow.assigneeId,
      },
      labelDiff,
    );
    for (const entry of entries) {
      await recordActivity(tx, {
        ticketId,
        actorId: actingUserId,
        action: entry.action,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
      });
    }

    return { old: oldRow, new: newRow };
  });
}

export async function deleteTicket(ticketId: string): Promise<void> {
  const softDeleted = await db.transaction(async (tx) => {
    // F20 §9.3: close any running timer on this ticket before soft-delete,
    // so a deleted ticket cannot leave an orphaned open timer.
    await stopTimerForTicket(tx, ticketId);
    const [row] = await tx
      .update(tickets)
      .set({ deletedAt: new Date() })
      .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
      .returning({ id: tickets.id });
    return row;
  });
  if (!softDeleted) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
      details: { ticketId },
    });
  }
}
