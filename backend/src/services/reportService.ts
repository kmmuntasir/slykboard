import { and, eq, gte, lt, isNull, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { timeEntries, tickets, projects, users } from '../db/schema';

export interface ReportUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalMs: number;
}
export interface TimeReportResponse {
  users: ReportUser[];
  window: { start: string; end: string; label: string };
}

export interface TicketCountByPriority {
  LOW: number;
  MEDIUM: number;
  HIGH: number;
  URGENT: number;
  CRITICAL: number;
  total: number;
}
export interface TicketSummaryUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  counts: TicketCountByPriority;
}
export interface TicketSummaryResponse {
  users: TicketSummaryUser[];
  window: { start: string; end: string; label: string };
}

// F23: compute the window start in UTC. weekly = Monday 00:00 UTC; monthly = 1st of month 00:00 UTC.
// offset: 0 = current, -1 = previous, etc.
function computeWindowStart(period: 'weekly' | 'monthly', offset: number): Date {
  const now = new Date();
  if (period === 'weekly') {
    const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
    );
    monday.setUTCDate(monday.getUTCDate() + offset * 7);
    return monday;
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

function computeWindowEnd(start: Date, period: 'weekly' | 'monthly'): Date {
  const end = new Date(start);
  if (period === 'weekly') {
    end.setUTCDate(end.getUTCDate() + 7);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return end;
}

function formatWindowLabel(start: Date, period: 'weekly' | 'monthly'): string {
  if (period === 'weekly') {
    return `Week of ${start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })}`;
  }
  return `${start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
}

export async function getTimeReport(args: {
  period: 'weekly' | 'monthly';
  offset: number;
  // F48: optional project scope. Absent = global aggregation (old behavior,
  // used by the deprecated /api/reports/time route). When provided, time is
  // scoped via a join timeEntries → tickets (timeEntries has no projectId column).
  projectId?: string;
}): Promise<TimeReportResponse> {
  const start = computeWindowStart(args.period, args.offset);
  const end = computeWindowEnd(start, args.period);
  const label = formatWindowLabel(start, args.period);

  // F48 D5: project scoping joins tickets on ticketId and filters projectId.
  // timeEntries has no projectId column, so the join is the only way to scope
  // time by project. Drizzle's query builder chains immutably, so the join is
  // applied conditionally by branching on args.projectId.
  const baseSelect = {
    userId: users.id,
    userFullName: users.fullName,
    userAvatarUrl: users.avatarUrl,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    manualEntryMinutes: timeEntries.manualEntryMinutes,
  };

  // Global path (deprecated /api/reports/time) — no project join, no projectId filter.
  const withoutProject = () =>
    db
      .select(baseSelect)
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId));

  // Scoped path — join tickets to filter on projectId.
  const withProject = (projectId: string) =>
    db
      .select(baseSelect)
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .leftJoin(tickets, eq(tickets.id, timeEntries.ticketId));

  const query = args.projectId ? withProject(args.projectId) : withoutProject();

  const rows = await query.where(
    and(
      gte(timeEntries.startTime, start),
      lt(timeEntries.startTime, end),
      isNotNull(timeEntries.endTime),
      ...(args.projectId ? [eq(tickets.projectId, args.projectId)] : []),
    ),
  );

  const userMap = new Map<string, ReportUser>();
  for (const r of rows) {
    if (!r.userId) continue;
    const isManual = r.manualEntryMinutes !== null;
    const durationMs = isManual
      ? (r.manualEntryMinutes ?? 0) * 60_000
      : r.endTime!.getTime() - r.startTime.getTime();
    const existing = userMap.get(r.userId);
    if (existing) {
      existing.totalMs += durationMs;
    } else {
      userMap.set(r.userId, {
        id: r.userId,
        fullName: r.userFullName ?? 'Unknown user',
        avatarUrl: r.userAvatarUrl,
        totalMs: durationMs,
      });
    }
  }

  const reportUsers = [...userMap.values()].sort((a, b) => b.totalMs - a.totalMs);
  return {
    users: reportUsers,
    window: { start: start.toISOString(), end: end.toISOString(), label },
  };
}

export async function getTicketSummary(args: {
  period: 'weekly' | 'monthly';
  offset: number;
  // F48: optional project scope. Absent = global aggregation (old behavior,
  // used by the deprecated /api/reports/tickets route).
  projectId?: string;
}): Promise<TicketSummaryResponse> {
  const start = computeWindowStart(args.period, args.offset);
  const end = computeWindowEnd(start, args.period);
  const label = formatWindowLabel(start, args.period);

  // 1. F48 D6: derive the "Done" column ids. When projectId is provided, read
  //    only that one project's columns (the scoped route's membership gate
  //    already paid the lookup cost; we re-derive here to keep the service
  //    req-free). When absent, fall back to the global scan (old behavior).
  const doneColumnIds = new Set<string>();
  if (args.projectId) {
    const [project] = await db
      .select({ columns: projects.columns })
      .from(projects)
      .where(eq(projects.id, args.projectId))
      .limit(1);
    const cols = project?.columns;
    if (cols && cols.length > 0) {
      doneColumnIds.add(cols[cols.length - 1]!.id);
    }
  } else {
    const projectRows = await db.select({ id: projects.id, columns: projects.columns }).from(projects);
    for (const p of projectRows) {
      const cols = p.columns;
      if (cols && cols.length > 0) {
        doneColumnIds.add(cols[cols.length - 1]!.id);
      }
    }
  }

  // 2. F48: tickets updated in window, not soft-deleted, with an assignee.
  //    Scoped path adds eq(tickets.projectId, projectId) to the WHERE clause.
  const assigneeAlias = alias(users, 'assignee');
  const ticketRows = await db
    .select({
      assigneeId: tickets.assigneeId,
      assigneeFullName: assigneeAlias.fullName,
      assigneeAvatarUrl: assigneeAlias.avatarUrl,
      statusColumn: tickets.statusColumn,
      priority: tickets.priority,
    })
    .from(tickets)
    .leftJoin(assigneeAlias, eq(assigneeAlias.id, tickets.assigneeId))
    .where(
      and(
        gte(tickets.updatedAt, start),
        lt(tickets.updatedAt, end),
        isNull(tickets.deletedAt),
        isNotNull(tickets.assigneeId),
        ...(args.projectId ? [eq(tickets.projectId, args.projectId)] : []),
      ),
    );

  // 3. Keep only resolved tickets (statusColumn is a Done column) and aggregate per user.
  const userMap = new Map<string, TicketSummaryUser>();
  for (const r of ticketRows) {
    if (!r.assigneeId || !doneColumnIds.has(r.statusColumn)) continue;
    const priority = r.priority as keyof TicketCountByPriority;
    const existing = userMap.get(r.assigneeId);
    if (existing) {
      existing.counts[priority] = (existing.counts[priority] ?? 0) + 1;
      existing.counts.total += 1;
    } else {
      const counts: TicketCountByPriority = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        URGENT: 0,
        CRITICAL: 0,
        total: 1,
      };
      counts[priority] = 1;
      userMap.set(r.assigneeId, {
        id: r.assigneeId,
        fullName: r.assigneeFullName ?? 'Unknown user',
        avatarUrl: r.assigneeAvatarUrl,
        counts,
      });
    }
  }

  const reportUsers = [...userMap.values()].sort((a, b) => b.counts.total - a.counts.total);
  return {
    users: reportUsers,
    window: { start: start.toISOString(), end: end.toISOString(), label },
  };
}
