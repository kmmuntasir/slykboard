import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { activityLogs, tickets, users, projects } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// F19 feed page cap. Frontend paginates beyond this later; 50 covers a ticket's
// recent history without an unbounded scan.
export const MAX_ACTIVITY_ROWS = 50;

export type EnrichedActionType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'LABELS_CHANGED'
  | 'CONTENT_UPDATED'
  | 'COMMENT_EDITED'
  | 'COMMENT_DELETED';

export interface ActivityActor {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ActivityEntry {
  id: string;
  createdAt: string; // ISO string
  actionType: EnrichedActionType;
  actor: ActivityActor | null;
  from: string | null;
  to: string | null;
  message: string | null;
}

// Mirrors the drizzle select() output in getTicketActivity. Kept local so the
// pure enrichment helpers (and their tests) don't depend on the drizzle types.
interface ActivityLogRow {
  id: string;
  createdAt: Date | string;
  actionType: EnrichedActionType;
  oldValue: string | null;
  newValue: string | null;
  actorId: string | null;
  actorFullName: string | null;
  actorAvatarUrl: string | null;
}

/**
 * Resolve an ASSIGNEE_CHANGED old/new value to a display string.
 * - null → null (no value present)
 * - 'unassigned' sentinel → 'Unassigned'
 * - known user id → full name from the batch-resolved map
 * - unknown id → 'Unknown user' (defensive; should not normally happen)
 */
export function resolveAssignee(value: string | null, map: Map<string, string>): string | null {
  if (value === null) {
    return null;
  }
  if (value === 'unassigned') {
    return 'Unassigned';
  }
  return map.get(value) ?? 'Unknown user';
}

function toActor(row: ActivityLogRow): ActivityActor | null {
  if (row.actorId === null) {
    return null;
  }
  return {
    id: row.actorId,
    fullName: row.actorFullName ?? 'Unknown user',
    avatarUrl: row.actorAvatarUrl ?? null,
  };
}

/**
 * PURE enrichment of raw log rows into ActivityEntry[]. Does no I/O and does
 * NOT sort — callers rely on SQL ORDER BY for reverse-chrono ordering.
 * columnMap resolves STATUS_CHANGED column ids to display names.
 * assigneeMap resolves ASSIGNEE_CHANGED user ids to full names.
 */
export function enrichActivityRows(
  rows: ActivityLogRow[],
  columnMap: Map<string, string>,
  assigneeMap: Map<string, string>,
): ActivityEntry[] {
  return rows.map((row) => {
    const createdAt =
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString();

    const base: ActivityEntry = {
      id: row.id,
      createdAt,
      actionType: row.actionType,
      actor: toActor(row),
      from: null,
      to: null,
      message: null,
    };

    switch (row.actionType) {
      case 'STATUS_CHANGED':
        return {
          ...base,
          from: columnMap.get(row.oldValue ?? '') ?? 'Unknown column',
          to: columnMap.get(row.newValue ?? '') ?? 'Unknown column',
        };
      case 'ASSIGNEE_CHANGED':
        return {
          ...base,
          from: resolveAssignee(row.oldValue, assigneeMap),
          to: resolveAssignee(row.newValue, assigneeMap),
        };
      case 'PRIORITY_CHANGED':
        // Raw SCREAMING_SNAKE passthrough; FE title-cases per PRD REQ-3.2.
        return { ...base, from: row.oldValue, to: row.newValue };
      case 'LABELS_CHANGED':
        return { ...base, message: row.newValue };
      case 'CONTENT_UPDATED':
        return { ...base, message: row.newValue };
      // SLYK-13: comment lifecycle events. Privacy — never surface comment
      // content in from/to/message; return base (all null).
      case 'COMMENT_EDITED':
      case 'COMMENT_DELETED':
      case 'CREATED':
      default:
        return base;
    }
  });
}

/**
 * F19 read side: load up to MAX_ACTIVITY_ROWS activity log rows for a ticket,
 * reverse-chrono, enriched with actor identity and human-readable from/to.
 * Throws AppError(NOT_FOUND) when the ticket does not exist.
 */
export async function getTicketActivity(ticketId: string): Promise<ActivityEntry[]> {
  // 1. Existence check — also gives us projectId for the column lookup.
  const ticketRows = await db
    .select({ id: tickets.id, projectId: tickets.projectId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (ticketRows.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`);
  }
  // Length guarded above; noUncheckedIndexedAccess still types [0] as possibly
  // undefined, so assert at this single boundary.
  const ticket = ticketRows[0]!;

  // 2. Resolve project columns {id,name} → name lookup for STATUS_CHANGED.
  const columnMap = new Map<string, string>();
  const projectRows = await db
    .select({ columns: projects.columns })
    .from(projects)
    .where(eq(projects.id, ticket.projectId))
    .limit(1);
  const projectColumns = projectRows[0]?.columns;
  if (projectColumns) {
    for (const col of projectColumns) {
      columnMap.set(col.id, col.name);
    }
  }

  // 3. Reverse-chrono logs with actor leftJoin (userId nullable → SET NULL).
  const rows: ActivityLogRow[] = await db
    .select({
      id: activityLogs.id,
      createdAt: activityLogs.createdAt,
      actionType: activityLogs.actionType,
      oldValue: activityLogs.oldValue,
      newValue: activityLogs.newValue,
      actorId: users.id,
      actorFullName: users.fullName,
      actorAvatarUrl: users.avatarUrl,
    })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.userId))
    .where(eq(activityLogs.ticketId, ticketId))
    .orderBy(desc(activityLogs.createdAt))
    .limit(MAX_ACTIVITY_ROWS);

  // 4. Batch-resolve ASSIGNEE_CHANGED user ids → full names (avoids N+1).
  const assigneeMap = new Map<string, string>();
  const assigneeIds = new Set<string>();
  for (const row of rows) {
    if (row.actionType !== 'ASSIGNEE_CHANGED') {
      continue;
    }
    for (const value of [row.oldValue, row.newValue]) {
      if (value !== null && value !== 'unassigned') {
        assigneeIds.add(value);
      }
    }
  }
  if (assigneeIds.size > 0) {
    const assigneeRows = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, [...assigneeIds]))
      .limit(assigneeIds.size);
    for (const a of assigneeRows) {
      assigneeMap.set(a.id, a.fullName);
    }
  }

  // 5. Enrich via the pure helper (single path; exercised by unit tests).
  return enrichActivityRows(rows, columnMap, assigneeMap);
}
