import { and, asc, eq, ilike, inArray, isNull, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { tickets, users, ticketLabels } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { logger } from '../config/logger';
import { getProjectBySlug } from './projectService';
import { hydrateLabelsForTickets } from './labelService';
import type { HydratedLabel } from './labelService';
import type { ChecklistItem } from '../db/schema';

// F09 D-Unsorted-Bucket: stable id for the orphan pseudo-column.
export const UNSORTED_BUCKET_ID = '__unsorted__';
const UNSORTED_BUCKET_NAME = 'Unsorted';

// F09 D-Soft-Cap: warn-only (no truncate). Full virtualization is F10+.
export const BOARD_SOFT_CAP = Object.freeze({ tickets: 200, columns: 12 });

export interface BoardAssignee {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface BoardTicket {
  id: string;
  ticketNumber: number;
  title: string;
  statusColumn: string;
  position: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';
  labels: HydratedLabel[];
  checklist: ChecklistItem[];
  assignee: BoardAssignee | null;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardColumn {
  id: string;
  name: string;
  isUnsorted: boolean;
  tickets: BoardTicket[];
}

export interface BoardPayload {
  project: { id: string; name: string; slug: string };
  columns: BoardColumn[];
}

export interface BoardFilters {
  search?: string;
  assignee?: string;
  priority?: string;
  label?: string;
}

export async function getBoard(slug: string, filters?: BoardFilters): Promise<BoardPayload> {
  // F08: project lookup by slug.
  const project = await getProjectBySlug(slug);
  if (!project) {
    throw new AppError(ErrorCode.NOT_FOUND, `Project '${slug}' not found`);
  }

  // F26: build extra WHERE conditions from optional filters. Numeric search →
  // ticketNumber exact match; otherwise title ilike. Each filter only applies
  // when present and non-empty. Empty array → spread is a no-op (unchanged SQL).
  const extraConditions: SQL[] = [];

  if (filters) {
    const search = filters.search?.trim();
    if (search) {
      if (/^\d+$/.test(search)) {
        extraConditions.push(eq(tickets.ticketNumber, parseInt(search, 10)));
      } else {
        extraConditions.push(ilike(tickets.title, `%${search}%`));
      }
    }

    const assignee = filters.assignee?.trim();
    if (assignee) {
      extraConditions.push(eq(tickets.assigneeId, assignee));
    }

    const priority = filters.priority?.trim();
    if (priority) {
      // Cast to the Priority enum union (mirrors ticketService.Priority; schema
      // doesn't export the inferred type). BoardFilters keeps priority as string
      // per the route contract; invalid values simply yield no matches at the DB.
      extraConditions.push(
        eq(tickets.priority, priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL'),
      );
    }

    const label = filters.label?.trim();
    if (label) {
      extraConditions.push(
        inArray(
          tickets.id,
          db
            .select({ id: ticketLabels.ticketId })
            .from(ticketLabels)
            .where(eq(ticketLabels.labelId, label)),
        ),
      );
    }
  }

  // F09: load this project's tickets ordered by position ASC (parameterized —
  // never string-concat SQL). Left-join users for assignee.
  const rows = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      title: tickets.title,
      statusColumn: tickets.statusColumn,
      position: tickets.position,
      priority: tickets.priority,
      checklist: tickets.checklist,
      assigneeId: tickets.assigneeId,
      creatorId: tickets.creatorId,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      assigneeFullName: users.fullName,
      assigneeAvatarUrl: users.avatarUrl,
      assigneeRowId: users.id,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.assigneeId))
    .where(and(eq(tickets.projectId, project.id), isNull(tickets.deletedAt), ...extraConditions))
    .orderBy(asc(tickets.position));

  // F14 D8: batch-hydrate labels for all board tickets in a single query (no N+1).
  // Tickets with no label rows default to [] at the read site.
  const labelMap = await hydrateLabelsForTickets(rows.map((r) => r.id));

  const allTickets: BoardTicket[] = rows.map((r) => ({
    id: r.id,
    ticketNumber: r.ticketNumber,
    title: r.title,
    statusColumn: r.statusColumn,
    position: r.position,
    priority: r.priority,
    checklist: r.checklist ?? [],
    labels: labelMap.get(r.id) ?? [],
    assignee:
      r.assigneeId === null
        ? null
        : r.assigneeFullName === null
          ? { id: r.assigneeId, fullName: 'Unknown user', avatarUrl: null }
          : {
              id: r.assigneeId,
              fullName: r.assigneeFullName,
              avatarUrl: r.assigneeAvatarUrl,
            },
    creatorId: r.creatorId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  // F09 D-Soft-Cap: warn (not truncate).
  if (
    allTickets.length > BOARD_SOFT_CAP.tickets ||
    project.columns.length > BOARD_SOFT_CAP.columns
  ) {
    logger.warn(
      {
        projectId: project.id,
        ticketCount: allTickets.length,
        columnCount: project.columns.length,
      },
      'board exceeds soft cap',
    );
  }

  // F09 D-Unsorted-Bucket: group by Column.id; orphans → trailing bucket.
  const columnIds = new Set(project.columns.map((c) => c.id));
  const byColumn = new Map<string, BoardTicket[]>();
  const unsorted: BoardTicket[] = [];

  for (const t of allTickets) {
    if (columnIds.has(t.statusColumn)) {
      const list = byColumn.get(t.statusColumn) ?? [];
      list.push(t);
      byColumn.set(t.statusColumn, list);
    } else {
      unsorted.push(t);
    }
  }

  const columns: BoardColumn[] = project.columns.map((c) => ({
    id: c.id,
    name: c.name,
    isUnsorted: false,
    tickets: byColumn.get(c.id) ?? [],
  }));

  if (unsorted.length > 0) {
    columns.push({
      id: UNSORTED_BUCKET_ID,
      name: UNSORTED_BUCKET_NAME,
      isUnsorted: true,
      tickets: unsorted,
    });
  }

  return {
    project: { id: project.id, name: project.name, slug: project.slug },
    columns,
  };
}
