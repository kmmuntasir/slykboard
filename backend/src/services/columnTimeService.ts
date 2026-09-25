import { and, asc, eq, gte, isNotNull, isNull, lt } from 'drizzle-orm';

import { db } from '../db/client';
import { activityLogs, projects, timeEntries, tickets } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { effectiveDurationMs } from './reportService';
import type { TicketType } from './ticketService';

// CR-08: per-column time for a single ticket.
//
//  (a) RESIDENCE — wall-clock time the ticket sat in each board column,
//      derived from its status-transition history (CREATED + STATUS_CHANGED).
//  (b) TRACKED — effective working time overlapping each column's residence
//      intervals (FR-08.6), with manual entries attributed to the column the
//      ticket occupied at the entry's instant. CR-14 adjustment deltas are not
//      pro-rated across a split: they land whole in the interval containing the
//      timer's endTime (where the member stopped), falling back to the
//      ticket's still-open interval.
//
// Both metrics come from the same interval model, so the table can never
// contradict itself. Running timers are excluded (consistent with CR-04/05);
// soft-deleted tickets stop accruing at their deletedAt timestamp.

export interface ColumnTimeRow {
  columnId: string;
  columnName: string;
  /** Wall-clock time spent in this column (window-clipped), including the
   *  still-open interval for the ticket's current column. */
  residenceMs: number;
  /** Effective tracked time overlapping this column's intervals. */
  trackedMs: number;
  /** CR-11/FR-11.4: source split of trackedMs (trackedMs === autoMs + manualMs). */
  autoMs: number;
  manualMs: number;
  visits: number;
  /** Share of the ticket's total residence (0-100). */
  sharePct: number;
}

export interface ColumnTimeReport {
  ticket: {
    id: string;
    ticketNumber: number;
    title: string;
    type: TicketType;
    statusColumn: string;
    deletedAt: string | null;
  };
  columns: ColumnTimeRow[];
  totalResidenceMs: number;
  totalTrackedMs: number;
  /** CR-11/FR-11.4: source split of totalTrackedMs (totalTrackedMs === autoMs + manualMs). */
  autoMs: number;
  manualMs: number;
  window: { start: string; end: string; label: string } | null;
  filters: { memberId: string | null; source: 'auto' | 'manual' | null };
}

interface Interval {
  columnId: string;
  start: Date;
  end: Date;
}

/** Compute the window (null = the ticket's whole lifetime). */
function computeWindow(
  period: 'weekly' | 'monthly' | null,
  offset: number,
): { start: Date; end: Date; label: string } | null {
  if (period === null) return null;
  const now = new Date();
  let start: Date;
  if (period === 'weekly') {
    const day = now.getUTCDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
    );
    start.setUTCDate(start.getUTCDate() + offset * 7);
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  }
  const end = new Date(start);
  if (period === 'weekly') end.setUTCDate(end.getUTCDate() + 7);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const label =
    period === 'weekly'
      ? `Week of ${start.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })}`
      : `${start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
  return { start, end, label };
}

/** Clip an interval to the window (null window = unchanged). */
function clip(
  interval: Interval,
  window: { start: Date; end: Date } | null,
): { columnId: string; start: Date; end: Date } | null {
  if (window === null) return interval;
  const start = interval.start > window.start ? interval.start : window.start;
  const end = interval.end < window.end ? interval.end : window.end;
  if (end <= start) return null;
  return { columnId: interval.columnId, start, end };
}

export async function getColumnTimeReport(args: {
  projectId: string;
  ticketId: string;
  period: 'weekly' | 'monthly' | null;
  offset: number;
  memberId?: string | null;
  source?: 'auto' | 'manual' | null;
}): Promise<ColumnTimeReport> {
  const [ticketRows] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      title: tickets.title,
      type: tickets.type,
      statusColumn: tickets.statusColumn,
      createdAt: tickets.createdAt,
      deletedAt: tickets.deletedAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.id, args.ticketId),
        eq(tickets.projectId, args.projectId),
        isNull(tickets.deletedAt),
      ),
    )
    .limit(1);
  const ticket = ticketRows;
  if (!ticket) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${args.ticketId}' not found`);
  }

  const [project] = await db
    .select({ columns: projects.columns })
    .from(projects)
    .where(eq(projects.id, args.projectId))
    .limit(1);
  const projectColumns = project?.columns ?? [];
  const columnNameById = new Map(projectColumns.map((column) => [column.id, column.name]));

  // --- Residence intervals from the transition history --------------------
  const transitions = await db
    .select({
      actionType: activityLogs.actionType,
      oldValue: activityLogs.oldValue,
      newValue: activityLogs.newValue,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .where(eq(activityLogs.ticketId, args.ticketId))
    .orderBy(asc(activityLogs.createdAt));

  // The ticket stops accruing at soft-delete (a deleted ticket is read-only).
  const effectiveNow = ticket.deletedAt ?? new Date();
  const rawIntervals: Interval[] = [];
  let currentColumn = ticket.statusColumn;
  let currentSince = ticket.createdAt;
  for (const row of transitions) {
    if (row.actionType !== 'STATUS_CHANGED' || row.newValue === null) continue;
    if (row.oldValue !== null) {
      // The very first transition carries the ORIGINAL column in oldValue.
      currentColumn = row.oldValue;
    }
    if (row.createdAt > currentSince) {
      rawIntervals.push({ columnId: currentColumn, start: currentSince, end: row.createdAt });
    }
    currentColumn = row.newValue;
    currentSince = row.createdAt;
  }
  if (effectiveNow > currentSince) {
    rawIntervals.push({ columnId: currentColumn, start: currentSince, end: effectiveNow });
  }

  const window = computeWindow(args.period, args.offset);
  const intervals = rawIntervals
    .map((interval) => clip(interval, window))
    .filter(
      (interval): interval is { columnId: string; start: Date; end: Date } => interval !== null,
    );

  // --- Tracked time overlapping the intervals ------------------------------
  const entryConditions = [eq(timeEntries.ticketId, args.ticketId), isNotNull(timeEntries.endTime)];
  if (window) {
    entryConditions.push(gte(timeEntries.startTime, window.start));
    entryConditions.push(lt(timeEntries.startTime, window.end));
  }
  if (args.memberId) entryConditions.push(eq(timeEntries.userId, args.memberId));
  if (args.source === 'manual') entryConditions.push(isNotNull(timeEntries.manualEntryMinutes));
  if (args.source === 'auto') entryConditions.push(isNull(timeEntries.manualEntryMinutes));

  const entryRows = await db
    .select({
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      manualEntryMinutes: timeEntries.manualEntryMinutes,
      adjustmentMinutes: timeEntries.adjustmentMinutes,
    })
    .from(timeEntries)
    .where(and(...entryConditions));

  // Source-split attribution (CR-11/FR-11.4): every tracked millisecond is
  // booked as auto (timer) or manual, so trackedMs === autoMs + manualMs holds
  // per column and in the totals.
  const trackedByColumn = new Map<string, number>();
  const autoByColumn = new Map<string, number>();
  const manualByColumn = new Map<string, number>();
  const addTracked = (columnId: string, ms: number, source: 'auto' | 'manual'): void => {
    trackedByColumn.set(columnId, (trackedByColumn.get(columnId) ?? 0) + ms);
    const split = source === 'auto' ? autoByColumn : manualByColumn;
    split.set(columnId, (split.get(columnId) ?? 0) + ms);
  };
  const intervalContaining = (at: Date) =>
    intervals.find((interval) => at >= interval.start && at < interval.end);
  // The ticket's still-open interval — the last one chronologically, running to
  // effectiveNow (or the window edge) in the ticket's current column. Used as
  // the attribution fallback when no interval contains an instant.
  const openInterval = intervals.length > 0 ? intervals[intervals.length - 1] : undefined;

  for (const row of entryRows) {
    if (row.manualEntryMinutes !== null) {
      // Manual entries are instantaneous: attribute the full duration to
      // whichever column the ticket occupied at that instant.
      const owner = intervalContaining(row.startTime);
      if (owner) {
        addTracked(owner.columnId, effectiveDurationMs(row), 'manual');
      }
      continue;
    }
    if (row.endTime === null) continue;
    // Timer entries: split the wall-clock across every column interval they
    // overlap (pro-rated).
    for (const interval of intervals) {
      const start = row.startTime > interval.start ? row.startTime : interval.start;
      const end = row.endTime < interval.end ? row.endTime : interval.end;
      if (end <= start) continue;
      addTracked(interval.columnId, end.getTime() - start.getTime(), 'auto');
    }
    // FR-08.6: the CR-14 adjustment is NOT pro-rated — the signed delta lands
    // whole in the column where the member stopped the timer (endTime's
    // interval), falling back to the ticket's current interval on the edge
    // where none contains it.
    const adjustmentMs = (row.adjustmentMinutes ?? 0) * 60_000;
    if (adjustmentMs !== 0) {
      const owner = intervalContaining(row.endTime) ?? openInterval;
      if (owner) {
        addTracked(owner.columnId, adjustmentMs, 'auto');
      }
    }
  }

  // --- Fold into rows (project column order first, then any legacy ids) ----
  const residenceByColumn = new Map<string, number>();
  const visitsByColumn = new Map<string, number>();
  for (const interval of intervals) {
    residenceByColumn.set(
      interval.columnId,
      (residenceByColumn.get(interval.columnId) ?? 0) +
        (interval.end.getTime() - interval.start.getTime()),
    );
    visitsByColumn.set(interval.columnId, (visitsByColumn.get(interval.columnId) ?? 0) + 1);
  }
  const totalResidenceMs = [...residenceByColumn.values()].reduce((a, b) => a + b, 0);
  const totalTrackedMs = [...trackedByColumn.values()].reduce((a, b) => a + b, 0);
  const totalAutoMs = [...autoByColumn.values()].reduce((a, b) => a + b, 0);
  const totalManualMs = [...manualByColumn.values()].reduce((a, b) => a + b, 0);

  const rowFor = (columnId: string): ColumnTimeRow => ({
    columnId,
    columnName: columnNameById.get(columnId) ?? 'Archived column',
    residenceMs: residenceByColumn.get(columnId) ?? 0,
    trackedMs: trackedByColumn.get(columnId) ?? 0,
    autoMs: autoByColumn.get(columnId) ?? 0,
    manualMs: manualByColumn.get(columnId) ?? 0,
    visits: visitsByColumn.get(columnId) ?? 0,
    sharePct:
      totalResidenceMs === 0
        ? 0
        : Math.round(((residenceByColumn.get(columnId) ?? 0) / totalResidenceMs) * 100),
  });

  const ordered = projectColumns.map((column) => rowFor(column.id));
  const legacy = [...new Set(intervals.map((interval) => interval.columnId))].filter(
    (id) => !columnNameById.has(id),
  );

  return {
    ticket: {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      type: ticket.type as TicketType,
      statusColumn: ticket.statusColumn,
      deletedAt: ticket.deletedAt?.toISOString() ?? null,
    },
    columns: [...ordered, ...legacy.map(rowFor)],
    totalResidenceMs,
    totalTrackedMs,
    autoMs: totalAutoMs,
    manualMs: totalManualMs,
    window: window
      ? {
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          label: window.label,
        }
      : null,
    filters: { memberId: args.memberId ?? null, source: args.source ?? null },
  };
}
