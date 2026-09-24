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
import type { TicketType } from './ticketService';

// CR-03: rank map mirrored from ticketService for the board's epic-chip walk
// (top-level epic resolution) — importing the frozen const directly would pull
// the whole service into the board read path; the map is 4 literals.
const TYPE_RANK: Readonly<Record<TicketType, number>> = {
  EPIC: 3,
  STORY: 2,
  TASK: 1,
  SUBTASK: 0,
};

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
  // CR-03: hierarchy context.
  type: TicketType;
  parentId: string | null;
  parent: { id: string; ticketNumber: number; title: string; type: TicketType } | null;
  epic: { id: string; ticketNumber: number; title: string } | null; // top-level epic ancestor
  childCount: number; // live direct children (0 → card is freely draggable)
  childDoneCount: number; // direct children sitting in the LAST column
}

// CR-03 FR-03.8: epic summary for the board's Epics view.
export interface EpicSummary {
  id: string;
  ticketNumber: number;
  title: string;
  descendantCount: number; // live descendants at any depth
  doneDescendantCount: number; // descendants in the LAST column
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
  epics: EpicSummary[]; // CR-03 FR-03.8: epic roll-up list for the Epics view
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
      type: tickets.type,
      parentId: tickets.parentId,
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
    type: r.type as TicketType,
    parentId: r.parentId,
    parent: null, // resolved below (needs the full-row map)
    epic: null, // resolved below
    childCount: 0,
    childDoneCount: 0,
  }));

  // CR-03: hierarchy enrichment — done in one pass over the in-memory rows
  // (the board already loads every live ticket, so parent/epic/child lookups
  // are map hits; max chain depth is 3 by the rank ordering).
  const byId = new Map(allTickets.map((t) => [t.id, t]));
  const lastColumnId = project.columns.at(-1)?.id ?? null;
  const childrenOf = new Map<string, BoardTicket[]>();
  for (const t of allTickets) {
    if (t.parentId !== null) {
      const list = childrenOf.get(t.parentId) ?? [];
      list.push(t);
      childrenOf.set(t.parentId, list);
    }
  }
  for (const t of allTickets) {
    const parent = t.parentId !== null ? (byId.get(t.parentId) ?? null) : null;
    t.parent = parent
      ? { id: parent.id, ticketNumber: parent.ticketNumber, title: parent.title, type: parent.type }
      : null;
    // Walk up to the topmost ancestor; the epic chip shows it when it's an EPIC.
    let ancestor = parent;
    let guard = 0;
    while (ancestor !== null && ancestor.parentId !== null && guard < 4) {
      ancestor = byId.get(ancestor.parentId) ?? null;
      guard += 1;
    }
    t.epic =
      ancestor !== null && ancestor.type === 'EPIC'
        ? { id: ancestor.id, ticketNumber: ancestor.ticketNumber, title: ancestor.title }
        : null;
    const children = childrenOf.get(t.id) ?? [];
    t.childCount = children.length;
    t.childDoneCount =
      lastColumnId === null ? 0 : children.filter((c) => c.statusColumn === lastColumnId).length;
  }

  // CR-03 FR-03.8: epic summaries (live descendants at any depth).
  const epics: EpicSummary[] = allTickets
    .filter((t) => t.type === 'EPIC')
    .map((epic) => {
      let frontier = [epic.id];
      const seen = new Set<string>([epic.id]);
      let descendantCount = 0;
      let doneDescendantCount = 0;
      for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const child of childrenOf.get(id) ?? []) {
            if (seen.has(child.id)) continue;
            seen.add(child.id);
            descendantCount += 1;
            if (lastColumnId !== null && child.statusColumn === lastColumnId) {
              doneDescendantCount += 1;
            }
            next.push(child.id);
          }
        }
        frontier = next;
      }
      return {
        id: epic.id,
        ticketNumber: epic.ticketNumber,
        title: epic.title,
        descendantCount,
        doneDescendantCount,
      };
    });

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
    epics,
  };
}
