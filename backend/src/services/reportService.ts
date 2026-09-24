import { and, eq, gte, inArray, isNull, isNotNull, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { timeEntries, tickets, projects, users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { TicketType } from './ticketService';

export interface ReportUserTicketRow {
  id: string;
  ticketNumber: number;
  title: string;
  type: TicketType;
  /** CR-06: the epic this ticket rolls up to (null when it has no epic). */
  epic: { id: string; ticketNumber: number; title: string } | null;
  totalMs: number;
  autoMs: number;
  manualMs: number;
  entryCount: number;
}

export interface ReportUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalMs: number;
  /** CR-06: auto/manual split of totalMs. */
  autoMs: number;
  manualMs: number;
  entryCount: number;
  /** CR-06: where this member's time went (sorted totalMs DESC). */
  tickets: ReportUserTicketRow[];
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
  projectId: string;
  // CR-06: the same member/source filters the hierarchy reports expose.
  memberId?: string | null;
  source?: 'auto' | 'manual' | null;
}): Promise<TimeReportResponse> {
  // SLYK-16 T3: defense-in-depth runtime guard — reject JS callers that bypass TS.
  if (!args.projectId) throw new Error('projectId is required');
  const start = computeWindowStart(args.period, args.offset);
  const end = computeWindowEnd(start, args.period);
  const label = formatWindowLabel(start, args.period);

  // CR-06: the member report reuses the SAME windowed entry read + effective
  // duration as the hierarchy reports, so member totals, ticket rows, and
  // hierarchy roll-ups can never drift apart.
  const ticketRows = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      title: tickets.title,
      type: tickets.type,
      parentId: tickets.parentId,
    })
    .from(tickets)
    .where(and(eq(tickets.projectId, args.projectId), isNull(tickets.deletedAt)));
  const metaById = new Map(ticketRows.map((t) => [t.id, t]));
  const epicCache = new Map<string, { id: string; ticketNumber: number; title: string } | null>();
  const epicById = (id: string) => {
    const cached = epicCache.get(id);
    if (cached !== undefined) return cached;
    let current = metaById.get(id);
    let guard = 0;
    while (current?.parentId != null && guard < 4) {
      current = metaById.get(current.parentId);
      guard += 1;
    }
    const epic =
      current && (current.type as TicketType) === 'EPIC'
        ? { id: current.id, ticketNumber: current.ticketNumber, title: current.title }
        : null;
    epicCache.set(id, epic);
    return epic;
  };

  const entryConditions = [
    gte(timeEntries.startTime, start),
    lt(timeEntries.startTime, end),
    isNotNull(timeEntries.endTime),
  ];
  if (args.memberId) entryConditions.push(eq(timeEntries.userId, args.memberId));
  if (args.source === 'manual') entryConditions.push(isNotNull(timeEntries.manualEntryMinutes));
  if (args.source === 'auto') entryConditions.push(isNull(timeEntries.manualEntryMinutes));
  const entries = await db
    .select({
      ticketId: timeEntries.ticketId,
      userId: timeEntries.userId,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      manualEntryMinutes: timeEntries.manualEntryMinutes,
    })
    .from(timeEntries)
    .where(and(...entryConditions));

  interface MemberAgg {
    id: string;
    fullName: string;
    avatarUrl: string | null;
    totalMs: number;
    autoMs: number;
    manualMs: number;
    entryCount: number;
    tickets: Map<string, ReportUserTicketRow>;
  }
  const members = new Map<string, MemberAgg>();
  for (const row of entries) {
    if (!row.userId) continue;
    const meta = metaById.get(row.ticketId);
    if (!meta) continue; // ticket soft-deleted between the two reads
    const ms = effectiveDurationMs(row);
    const isManual = row.manualEntryMinutes !== null;
    const member = members.get(row.userId) ?? {
      id: row.userId,
      fullName: 'Unknown user',
      avatarUrl: null,
      totalMs: 0,
      autoMs: 0,
      manualMs: 0,
      entryCount: 0,
      tickets: new Map<string, ReportUserTicketRow>(),
    };
    member.totalMs += ms;
    if (isManual) member.manualMs += ms;
    else member.autoMs += ms;
    member.entryCount += 1;
    const ticket = member.tickets.get(row.ticketId) ?? {
      id: row.ticketId,
      ticketNumber: meta.ticketNumber,
      title: meta.title,
      type: meta.type as TicketType,
      epic: epicById(row.ticketId),
      totalMs: 0,
      autoMs: 0,
      manualMs: 0,
      entryCount: 0,
    };
    ticket.totalMs += ms;
    if (isManual) ticket.manualMs += ms;
    else ticket.autoMs += ms;
    ticket.entryCount += 1;
    member.tickets.set(row.ticketId, ticket);
    members.set(row.userId, member);
  }

  // Resolve member names in ONE query rather than per row.
  if (members.size > 0) {
    const userRows = await db
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, [...members.keys()]));
    const userById = new Map(userRows.map((u) => [u.id, u]));
    for (const member of members.values()) {
      const user = userById.get(member.id);
      if (user) {
        member.fullName = user.fullName;
        member.avatarUrl = user.avatarUrl;
      }
    }
  }

  const reportUsers: ReportUser[] = [...members.values()]
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      avatarUrl: member.avatarUrl,
      totalMs: member.totalMs,
      autoMs: member.autoMs,
      manualMs: member.manualMs,
      entryCount: member.entryCount,
      tickets: [...member.tickets.values()].sort(
        (a, b) => b.totalMs - a.totalMs || a.ticketNumber - b.ticketNumber,
      ),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  return {
    users: reportUsers,
    window: { start: start.toISOString(), end: end.toISOString(), label },
  };
}

export async function getTicketSummary(args: {
  period: 'weekly' | 'monthly';
  offset: number;
  // F48: project scope is REQUIRED.
  projectId: string;
}): Promise<TicketSummaryResponse> {
  // SLYK-16 T3: defense-in-depth runtime guard — reject JS callers that bypass TS.
  if (!args.projectId) throw new Error('projectId is required');
  const start = computeWindowStart(args.period, args.offset);
  const end = computeWindowEnd(start, args.period);
  const label = formatWindowLabel(start, args.period);

  // 1. F48 D6: derive the "Done" column ids. projectId is required, so read
  //    only that one project's columns (the scoped route's membership gate
  //    already paid the lookup cost; we re-derive here to keep the service
  //    req-free).
  const doneColumnIds = new Set<string>();
  const [project] = await db
    .select({ columns: projects.columns })
    .from(projects)
    .where(eq(projects.id, args.projectId))
    .limit(1);
  const cols = project?.columns;
  if (cols && cols.length > 0) {
    doneColumnIds.add(cols[cols.length - 1]!.id);
  }

  // 2. F48: tickets updated in window, not soft-deleted, with an assignee,
  //    scoped to projectId.
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
        eq(tickets.projectId, args.projectId),
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

// ============================================================================
// CR-04 / CR-05 — hierarchy roll-up + drill-down time reports.
//
// One shared entry query over the node's live subtree feeds every surface, so
// the roll-up, the per-ticket rows, the member table, and the raw entries can
// never disagree. Effective duration follows the cross-cutting rule: timer
// entries use (end - start) and manual entries use manualEntryMinutes; CR-14's
// adjustment column will fold into this single spot when it lands.
// ============================================================================

/** Depth cap of the type-ranked hierarchy (Epic→Story→Task→Subtask). */
const HIERARCHY_MAX_DEPTH = 3;

export interface HierarchyNodeRef {
  id: string;
  ticketNumber: number;
  title: string;
  type: TicketType;
}

export interface NodeMemberTotal {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalMs: number;
  autoMs: number;
  manualMs: number;
  entryCount: number;
}

export interface NodeBreakdownRow {
  id: string;
  ticketNumber: number;
  title: string;
  type: TicketType;
  /** Time tracked on this ticket itself. */
  ownMs: number;
  /** CR-11: source split of ownMs (timer vs manual). */
  ownAutoMs: number;
  ownManualMs: number;
  /** This ticket's own time plus its descendants' time (subtree fold). */
  rollupMs: number;
  /** CR-11: source split of rollupMs. */
  rollupAutoMs: number;
  rollupManualMs: number;
  entryCount: number;
  members: Array<{ id: string; totalMs: number }>;
}

export interface NodeTimeEntryRow {
  id: string;
  ticketId: string;
  ticketNumber: number;
  ticketTitle: string;
  ticketType: TicketType;
  userId: string | null;
  userFullName: string | null;
  userAvatarUrl: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number;
  type: 'manual' | 'timer';
  description: string | null;
  // CR-14 hook: the adjustment columns are not in the schema yet; the field is
  // shipped now so the UI contract is stable when adjustments land.
  adjusted: boolean;
  adjustmentReason: string | null;
}

interface NodeEntryAggregateRow {
  entryId: string;
  ticketId: string;
  userId: string | null;
  userFullName: string | null;
  userAvatarUrl: string | null;
  startTime: Date;
  endTime: Date | null;
  manualEntryMinutes: number | null;
  description: string | null;
}

// Live subtree of a node as flat id → parentId rows (root first). BFS with at
// most HIERARCHY_MAX_DEPTH+1 queries — the rank ordering bounds the depth, so
// no recursive CTE is needed and the query stays builder-typed.
async function loadSubtree(projectId: string, nodeId: string) {
  const rootRows = await db
    .select({
      id: tickets.id,
      parentId: tickets.parentId,
      ticketNumber: tickets.ticketNumber,
      title: tickets.title,
      type: tickets.type,
    })
    .from(tickets)
    .where(and(eq(tickets.id, nodeId), eq(tickets.projectId, projectId), isNull(tickets.deletedAt)))
    .limit(1);
  const root = rootRows[0];
  if (!root) {
    return null;
  }

  const byParent = new Map<string, (typeof root)[]>([[root.id, [root]]]);
  const all: (typeof root)[] = [root];
  let frontier = [root.id];
  for (let depth = 0; depth < HIERARCHY_MAX_DEPTH && frontier.length > 0; depth += 1) {
    const rows = await db
      .select({
        id: tickets.id,
        parentId: tickets.parentId,
        ticketNumber: tickets.ticketNumber,
        title: tickets.title,
        type: tickets.type,
      })
      .from(tickets)
      .where(
        and(
          inArray(tickets.parentId, frontier),
          eq(tickets.projectId, projectId),
          isNull(tickets.deletedAt),
        ),
      );
    frontier = [];
    for (const row of rows) {
      all.push(row);
      frontier.push(row.id);
      byParent.set(row.id, [row]);
    }
  }
  return { root, nodes: all };
}

/**
 * Single entry read over the subtree, window-scoped, running timers excluded
 * (FR-04.5), optional member/source filters applied at the source so every
 * aggregate below recomputes from the same filtered set.
 */
async function loadSubtreeEntries(args: {
  projectId: string;
  subtreeIds: string[];
  start: Date;
  end: Date;
  memberId?: string | null;
  source?: 'auto' | 'manual' | null;
}) {
  if (args.subtreeIds.length === 0) return [];
  const conditions = [
    inArray(timeEntries.ticketId, args.subtreeIds),
    gte(timeEntries.startTime, args.start),
    lt(timeEntries.startTime, args.end),
    isNotNull(timeEntries.endTime),
  ];
  if (args.memberId) {
    conditions.push(eq(timeEntries.userId, args.memberId));
  }
  if (args.source === 'manual') {
    conditions.push(isNotNull(timeEntries.manualEntryMinutes));
  } else if (args.source === 'auto') {
    conditions.push(isNull(timeEntries.manualEntryMinutes));
  }
  return db
    .select({
      entryId: timeEntries.id,
      ticketId: timeEntries.ticketId,
      userId: timeEntries.userId,
      userFullName: users.fullName,
      userAvatarUrl: users.avatarUrl,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      manualEntryMinutes: timeEntries.manualEntryMinutes,
      description: timeEntries.description,
    })
    .from(timeEntries)
    .leftJoin(users, eq(users.id, timeEntries.userId))
    .where(and(...conditions))
    .orderBy(timeEntries.startTime);
}
/**
 * Effective duration of one entry — the single definition shared by every
 * hierarchy time surface (roll-up, rows, members, entries). Timer entries use
 * wall-clock (end - start); manual entries use their recorded minutes; running
 * timers contribute 0 (FR-04.5). CR-14's adjustment delta folds in here when
 * the column lands.
 */
export function effectiveDurationMs(row: {
  startTime: Date;
  endTime: Date | null;
  manualEntryMinutes: number | null;
}): number {
  if (row.manualEntryMinutes !== null) return row.manualEntryMinutes * 60_000;
  if (row.endTime === null) return 0;
  return row.endTime.getTime() - row.startTime.getTime();
}

interface HierarchyReportArgs {
  projectId: string;
  nodeId: string;
  period: 'weekly' | 'monthly';
  offset: number;
  memberId?: string | null;
  source?: 'auto' | 'manual' | null;
}

interface HierarchyReportData {
  node: HierarchyNodeRef;
  window: { start: string; end: string; label: string };
  totalMs: number;
  autoMs: number;
  manualMs: number;
  entryCount: number;
  members: NodeMemberTotal[];
  rows: NodeBreakdownRow[];
  entries: NodeTimeEntryRow[];
}

async function buildHierarchyReport(
  args: HierarchyReportArgs,
): Promise<HierarchyReportData | null> {
  const start = computeWindowStart(args.period, args.offset);
  const end = computeWindowEnd(start, args.period);
  const label = formatWindowLabel(start, args.period);

  const subtree = await loadSubtree(args.projectId, args.nodeId);
  if (!subtree) return null;

  const metaById = new Map(subtree.nodes.map((n) => [n.id, n]));
  const entryRows = (await loadSubtreeEntries({
    projectId: args.projectId,
    subtreeIds: subtree.nodes.map((n) => n.id),
    start,
    end,
    memberId: args.memberId ?? null,
    source: args.source ?? null,
  })) as NodeEntryAggregateRow[];

  let totalMs = 0;
  let autoMs = 0;
  let manualMs = 0;
  const memberMap = new Map<string, NodeMemberTotal>();
  const rowMap = new Map<
    string,
    {
      ownMs: number;
      ownAutoMs: number;
      ownManualMs: number;
      entryCount: number;
      members: Map<string, number>;
    }
  >();
  const entries: NodeTimeEntryRow[] = [];

  for (const raw of entryRows) {
    const meta = metaById.get(raw.ticketId);
    if (!meta) continue; // defensive: entry whose ticket left the subtree
    const ms = effectiveDurationMs(raw);
    const isManual = raw.manualEntryMinutes !== null;

    totalMs += ms;
    if (isManual) manualMs += ms;
    else autoMs += ms;

    if (raw.userId) {
      const existing = memberMap.get(raw.userId) ?? {
        id: raw.userId,
        fullName: raw.userFullName ?? 'Unknown user',
        avatarUrl: raw.userAvatarUrl,
        totalMs: 0,
        autoMs: 0,
        manualMs: 0,
        entryCount: 0,
      };
      existing.totalMs += ms;
      if (isManual) existing.manualMs += ms;
      else existing.autoMs += ms;
      existing.entryCount += 1;
      memberMap.set(raw.userId, existing);
    }

    const row = rowMap.get(raw.ticketId) ?? {
      ownMs: 0,
      ownAutoMs: 0,
      ownManualMs: 0,
      entryCount: 0,
      members: new Map(),
    };
    row.ownMs += ms;
    if (isManual) row.ownManualMs += ms;
    else row.ownAutoMs += ms;
    row.entryCount += 1;
    if (raw.userId) row.members.set(raw.userId, (row.members.get(raw.userId) ?? 0) + ms);
    rowMap.set(raw.ticketId, row);

    entries.push({
      id: raw.entryId,
      ticketId: raw.ticketId,
      ticketNumber: meta.ticketNumber,
      ticketTitle: meta.title,
      ticketType: meta.type as TicketType,
      userId: raw.userId,
      userFullName: raw.userFullName,
      userAvatarUrl: raw.userAvatarUrl,
      startTime: raw.startTime.toISOString(),
      endTime: raw.endTime ? raw.endTime.toISOString() : null,
      durationMs: ms,
      type: isManual ? 'manual' : 'timer',
      description: raw.description,
      adjusted: false,
      adjustmentReason: null,
    });
  }

  // Fold each ticket's own time (and its source split) up the ancestor chain
  // (depth ≤ 3), so a row's rollup includes its descendants — the CR-04 total,
  // decomposed (CR-11: the split rides along).
  const rollupById = new Map<string, number>();
  const rollupAutoById = new Map<string, number>();
  const rollupManualById = new Map<string, number>();
  for (const [ticketId, row] of rowMap) {
    rollupById.set(ticketId, (rollupById.get(ticketId) ?? 0) + row.ownMs);
    rollupAutoById.set(ticketId, (rollupAutoById.get(ticketId) ?? 0) + row.ownAutoMs);
    rollupManualById.set(ticketId, (rollupManualById.get(ticketId) ?? 0) + row.ownManualMs);
    let parentId = metaById.get(ticketId)?.parentId ?? null;
    let guard = 0;
    while (parentId !== null && guard < HIERARCHY_MAX_DEPTH + 1) {
      rollupById.set(parentId, (rollupById.get(parentId) ?? 0) + row.ownMs);
      rollupAutoById.set(parentId, (rollupAutoById.get(parentId) ?? 0) + row.ownAutoMs);
      rollupManualById.set(parentId, (rollupManualById.get(parentId) ?? 0) + row.ownManualMs);
      parentId = metaById.get(parentId)?.parentId ?? null;
      guard += 1;
    }
  }

  const rows: NodeBreakdownRow[] = [...rowMap.entries()]
    .map(([ticketId, row]) => {
      const meta = metaById.get(ticketId)!;
      return {
        id: ticketId,
        ticketNumber: meta.ticketNumber,
        title: meta.title,
        type: meta.type as TicketType,
        ownMs: row.ownMs,
        ownAutoMs: row.ownAutoMs,
        ownManualMs: row.ownManualMs,
        rollupMs: rollupById.get(ticketId) ?? row.ownMs,
        rollupAutoMs: rollupAutoById.get(ticketId) ?? row.ownAutoMs,
        rollupManualMs: rollupManualById.get(ticketId) ?? row.ownManualMs,
        entryCount: row.entryCount,
        members: [...row.members.entries()]
          .map(([id, totalMsForMember]) => ({ id, totalMs: totalMsForMember }))
          .sort((a, b) => b.totalMs - a.totalMs),
      };
    })
    .sort((a, b) => b.rollupMs - a.rollupMs || a.ticketNumber - b.ticketNumber);

  const members = [...memberMap.values()].sort((a, b) => b.totalMs - a.totalMs);

  return {
    node: {
      id: subtree.root.id,
      ticketNumber: subtree.root.ticketNumber,
      title: subtree.root.title,
      type: subtree.root.type as TicketType,
    },
    window: { start: start.toISOString(), end: end.toISOString(), label },
    totalMs,
    autoMs,
    manualMs,
    entryCount: entries.length,
    members,
    rows,
    entries,
  };
}

export type NodeRollupResponse = Pick<
  HierarchyReportData,
  'node' | 'window' | 'totalMs' | 'autoMs' | 'manualMs' | 'entryCount'
>;

export type NodeBreakdownResponse = Pick<
  HierarchyReportData,
  'node' | 'window' | 'totalMs' | 'autoMs' | 'manualMs' | 'entryCount' | 'members' | 'rows'
>;

export type NodeEntriesResponse = Pick<HierarchyReportData, 'node' | 'window' | 'entries'>;

/** CR-04: windowed roll-up total for a node + its whole live subtree. */
export async function getNodeTimeRollup(args: HierarchyReportArgs): Promise<NodeRollupResponse> {
  const report = await buildHierarchyReport(args);
  if (!report) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${args.nodeId}' not found`);
  }
  const { node, window, totalMs, autoMs, manualMs, entryCount } = report;
  return { node, window, totalMs, autoMs, manualMs, entryCount };
}

/**
 * CR-05: per-ticket rows (own + folded descendant time) and the per-member
 * summary for a node's subtree, plus the same filters the UI exposes.
 */
export async function getNodeTimeBreakdown(
  args: HierarchyReportArgs,
): Promise<NodeBreakdownResponse> {
  const report = await buildHierarchyReport(args);
  if (!report) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${args.nodeId}' not found`);
  }
  return {
    node: report.node,
    window: report.window,
    totalMs: report.totalMs,
    autoMs: report.autoMs,
    manualMs: report.manualMs,
    entryCount: report.entryCount,
    members: report.members,
    rows: report.rows,
  };
}

/** CR-05.2: raw entries behind the breakdown (optionally scoped to one ticket). */
export async function getNodeTimeEntries(
  args: HierarchyReportArgs & { ticketId?: string | null },
): Promise<NodeEntriesResponse> {
  const report = await buildHierarchyReport(args);
  if (!report) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${args.nodeId}' not found`);
  }
  let entries = report.entries;
  if (args.ticketId) {
    const scoped = await loadSubtree(args.projectId, args.ticketId);
    const scopeIds = new Set(scoped?.nodes.map((n) => n.id) ?? []);
    entries = report.entries.filter((entry) => scopeIds.has(entry.ticketId));
  }
  return { node: report.node, window: report.window, entries };
}

/**
 * FR-04.2: all-time tracked total for a node + subtree (running timers = 0,
 * soft-deleted descendants excluded). Used by the ticket-detail header; kept
 * window-free because the detail badge is "tracked so far", not a report.
 */
export async function getNodeTrackedTotalMs(args: {
  projectId: string;
  nodeId: string;
}): Promise<{ totalMs: number; descendantCount: number }> {
  const subtree = await loadSubtree(args.projectId, args.nodeId);
  if (!subtree) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${args.nodeId}' not found`);
  }
  const rows = await loadSubtreeEntries({
    projectId: args.projectId,
    subtreeIds: subtree.nodes.map((n) => n.id),
    start: new Date(0),
    end: new Date('2999-12-31T00:00:00.000Z'),
  });
  const totalMs = rows.reduce((sum, row) => sum + effectiveDurationMs(row), 0);
  return { totalMs, descendantCount: subtree.nodes.length - 1 };
}

/** Light displayId → live ticket id resolution for the hierarchy endpoints. */
export async function resolveLiveTicketByNumber(
  projectId: string,
  ticketNumber: number,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(
        eq(tickets.projectId, projectId),
        eq(tickets.ticketNumber, ticketNumber),
        isNull(tickets.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
