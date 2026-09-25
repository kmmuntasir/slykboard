import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { desc, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client';
import {
  activityLogs,
  projectSequences,
  projects,
  timeEntries,
  tickets,
  users,
} from '../db/schema';
import * as ticketService from './ticketService';
import * as reportService from './reportService';

// CR-04/CR-05 integration tests — REAL test DB. Covers subtree roll-ups, the
// auto/manual split, running-timer and soft-delete exclusion, window scoping,
// the per-ticket fold, member rows + filters, and the raw entries surface.

const C1 = 'col-1';
const C2 = 'col-2';
const C3 = 'col-3';
const COLUMNS = [
  { id: C1, name: 'To Do' },
  { id: C2, name: 'In Progress' },
  { id: C3, name: 'Done' },
];
const HOUR = 3_600_000;
const MINUTE = 60_000;

let userId = '';
let otherUserId = '';
let slugSeq = 0;

async function createTestProject(): Promise<string> {
  slugSeq += 1;
  const slug = `R${String(slugSeq).padStart(2, '0')}${Date.now() % 1000}`;
  const [project] = await db
    .insert(projects)
    .values({ name: `Reports ${slugSeq}`, slug, columns: COLUMNS, creatorId: userId })
    .returning();
  await db.insert(projectSequences).values({ projectId: project!.id, nextNumber: 1 });
  return slug;
}

function create(
  slug: string,
  args: { title: string; type?: ticketService.TicketType; parentId?: string | null },
) {
  return ticketService.createTicket({
    slug,
    creatorId: userId,
    title: args.title,
    description: 'Fixture description',
    priority: 'MEDIUM',
    statusColumn: C1,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    type: args.type ?? 'TASK',
    parentId: args.parentId ?? null,
  });
}

/** Closed timer entry of `ms` duration, dated `daysAgo` days back. */
async function addTimer(
  ticketId: string,
  ms: number,
  user = userId,
  daysAgo = 0,
  endTime: Date | null = null,
) {
  const start = new Date(Date.now() - daysAgo * 24 * 3_600_000 - ms);
  const end = endTime ?? new Date(start.getTime() + ms);
  await db.insert(timeEntries).values({
    ticketId,
    userId: user,
    startTime: start,
    endTime: end,
  });
}

async function addManual(ticketId: string, minutes: number, user = userId, daysAgo = 0) {
  const at = new Date(Date.now() - daysAgo * 24 * 3_600_000);
  await db.insert(timeEntries).values({
    ticketId,
    userId: user,
    startTime: at,
    endTime: at,
    manualEntryMinutes: minutes,
  });
}

/** CR-14: attach a signed adjustment + reason to the ticket's latest entry. */
async function adjustLatestEntry(ticketId: string, minutes: number, reason: string) {
  const rows = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(eq(timeEntries.ticketId, ticketId))
    .orderBy(desc(timeEntries.startTime))
    .limit(1);
  await db
    .update(timeEntries)
    .set({ adjustmentMinutes: minutes, adjustmentReason: reason })
    .where(eq(timeEntries.id, rows[0]!.id));
}

beforeEach(async () => {
  if (!userId) {
    const [a] = await db
      .insert(users)
      .values({ email: `reports-a-${Date.now()}@example.com`, fullName: 'Report A' })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `reports-b-${Date.now()}@example.com`, fullName: 'Report B' })
      .returning();
    userId = a!.id;
    otherUserId = b!.id;
  }
});

afterAll(async () => {
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.creatorId, userId));
  const projectIds = projectRows.map((p) => p.id);
  if (projectIds.length > 0) {
    const ticketRows = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(inArray(tickets.projectId, projectIds));
    const ticketIds = ticketRows.map((t) => t.id);
    if (ticketIds.length > 0) {
      await db.delete(timeEntries).where(inArray(timeEntries.ticketId, ticketIds));
      await db.delete(tickets).where(inArray(tickets.id, ticketIds));
    }
    await db.delete(projectSequences).where(inArray(projectSequences.projectId, projectIds));
    await db.delete(projects).where(inArray(projects.id, projectIds));
  }
  await db.delete(activityLogs).where(inArray(activityLogs.userId, [userId, otherUserId]));
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

async function projectIdFor(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return row!.id;
}

describe('CR-04/CR-05 hierarchy time reports (integration)', () => {
  it('rolls up subtree time with the auto/manual split (doc acceptance: 1h + 2h + 30m = 3h30m)', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const storyA = await create(slug, { title: 'Story A', type: 'STORY', parentId: epic.id });
    const storyB = await create(slug, { title: 'Story B', type: 'STORY', parentId: epic.id });

    await addTimer(storyA.id, HOUR);
    await addTimer(storyB.id, 2 * HOUR);
    await addManual(epic.id, 30);

    const rollup = await reportService.getNodeTimeRollup({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
    });
    expect(rollup.totalMs).toBe(3 * HOUR + 30 * MINUTE);
    expect(rollup.autoMs).toBe(3 * HOUR);
    expect(rollup.manualMs).toBe(30 * MINUTE);
    expect(rollup.entryCount).toBe(3);
    expect(rollup.node.type).toBe('EPIC');
    expect(rollup.window.label).toContain('Week of');
  });

  it('excludes running timers, soft-deleted descendants, and other-window entries', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });

    await addTimer(story.id, HOUR);
    // Running timer (endTime NULL) → 0.
    await db.insert(timeEntries).values({
      ticketId: story.id,
      userId: userId,
      startTime: new Date(),
      endTime: null,
    });
    // Last month (monthly offset -1 excludes it from the weekly window).
    await addTimer(story.id, 5 * HOUR, userId, 40);
    // Soft-deleted sibling's time is out of the working set.
    const deleted = await create(slug, { title: 'Deleted', type: 'STORY', parentId: epic.id });
    await addTimer(deleted.id, 9 * HOUR);
    await ticketService.deleteTicket(deleted.id, userId);

    const rollup = await reportService.getNodeTimeRollup({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
    });
    expect(rollup.totalMs).toBe(HOUR);
    expect(rollup.entryCount).toBe(1);

    const previousMonth = await reportService.getNodeTimeRollup({
      projectId,
      nodeId: epic.id,
      period: 'monthly',
      offset: -1,
    });
    // Previous calendar month holds only the 5h entry (the 1h one is
    // dated this month, outside the monthly offset -1 window).
    expect(previousMonth.totalMs).toBe(5 * HOUR);
  });

  it('breaks the subtree down per ticket (own + folded descendants) and per member', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const sub = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: story.id });
    const other = await create(slug, { title: 'Other story', type: 'STORY', parentId: epic.id });

    await addTimer(story.id, HOUR, otherUserId);
    await addTimer(sub.id, 30 * MINUTE, otherUserId);
    await addManual(other.id, 15, userId);

    const breakdown = await reportService.getNodeTimeBreakdown({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
    });
    // FR-05.1: one row per live ticket in the subtree, sorted by rollupMs DESC:
    // the epic's own zero-time row (1h45 folded) leads, then story 1h30 (own
    // 1h + sub 30m folded), the subtask's 30m, the other story's 15m.
    expect(breakdown.rows).toHaveLength(4);
    const [epicRow, storyRow, subRow, otherRow] = breakdown.rows;
    expect(epicRow!.id).toBe(epic.id);
    expect(epicRow!.ownMs).toBe(0);
    expect(epicRow!.ownAutoMs).toBe(0);
    expect(epicRow!.ownManualMs).toBe(0);
    expect(epicRow!.entryCount).toBe(0);
    expect(epicRow!.members).toEqual([]);
    expect(epicRow!.rollupMs).toBe(HOUR + 30 * MINUTE + 15 * MINUTE);
    expect(storyRow!.id).toBe(story.id);
    expect(storyRow!.ownMs).toBe(HOUR);
    expect(storyRow!.rollupMs).toBe(HOUR + 30 * MINUTE);
    expect(storyRow!.members[0]!.totalMs).toBe(HOUR);
    expect(subRow!.id).toBe(sub.id);
    expect(subRow!.rollupMs).toBe(30 * MINUTE);
    expect(otherRow!.id).toBe(other.id);
    expect(otherRow!.rollupMs).toBe(15 * MINUTE);
    // Direct children of the node partition the node total exactly once.
    expect(storyRow!.rollupMs + otherRow!.rollupMs).toBe(breakdown.totalMs);
    // Zero rows contribute nothing — the roll-up total is unchanged.
    expect(breakdown.totalMs).toBe(HOUR + 30 * MINUTE + 15 * MINUTE);
    // Member summary: B has 1h30, A has 15m.
    expect(breakdown.members[0]!.id).toBe(otherUserId);
    expect(breakdown.members[0]!.totalMs).toBe(HOUR + 30 * MINUTE);
    expect(breakdown.members[0]!.autoMs).toBe(HOUR + 30 * MINUTE);
    expect(breakdown.members[1]!.id).toBe(userId);
    expect(breakdown.members[1]!.manualMs).toBe(15 * MINUTE);
    expect(breakdown.members[1]!.entryCount).toBe(1);
  });

  it('recomputes rows and totals under the member filter', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    await addTimer(story.id, HOUR, userId);
    await addTimer(story.id, 2 * HOUR, otherUserId);

    const forA = await reportService.getNodeTimeBreakdown({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
      memberId: userId,
    });
    expect(forA.totalMs).toBe(HOUR);
    // FR-05.1: the zero-time epic row survives the member filter. It folds the
    // story's filtered 1h up, tying with the story row — the ticketNumber
    // tiebreak (epic created first) puts it first; it still owns 0 itself.
    expect(forA.rows).toHaveLength(2);
    expect(forA.rows[0]!.id).toBe(epic.id);
    expect(forA.rows[0]!.ownMs).toBe(0);
    expect(forA.rows[0]!.rollupMs).toBe(HOUR);
    expect(forA.rows[1]!.id).toBe(story.id);
    expect(forA.rows[1]!.ownMs).toBe(HOUR);
    expect(forA.rows[1]!.rollupMs).toBe(HOUR);
    expect(forA.members).toHaveLength(1);
    expect(forA.members[0]!.id).toBe(userId);
  });

  it('filters by entry source (auto vs manual)', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    await addTimer(epic.id, HOUR);
    await addManual(epic.id, 20);

    const auto = await reportService.getNodeTimeBreakdown({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
      source: 'auto',
    });
    expect(auto.totalMs).toBe(HOUR);
    expect(auto.entryCount).toBe(1);

    const manual = await reportService.getNodeTimeBreakdown({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
      source: 'manual',
    });
    expect(manual.totalMs).toBe(20 * MINUTE);
  });

  it('exposes raw entries, optionally scoped to one ticket subtree', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const sub = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: story.id });
    await addTimer(story.id, HOUR, otherUserId);
    await addManual(sub.id, 10, userId, 0);
    // CR-14: adjust the story timer (+15m, reason recorded).
    await adjustLatestEntry(story.id, 15, 'Forgot to stop the timer');

    const all = await reportService.getNodeTimeEntries({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
    });
    expect(all.entries).toHaveLength(2);
    const timerEntry = all.entries.find((e) => e.type === 'timer')!;
    // FR-05.2: effective duration includes the signed adjustment.
    expect(timerEntry.durationMs).toBe(HOUR + 15 * MINUTE);
    expect(timerEntry.ticketNumber).toBe(story.ticketNumber);
    expect(timerEntry.userFullName).toBe('Report B');
    expect(timerEntry.adjusted).toBe(true);
    expect(timerEntry.adjustmentReason).toBe('Forgot to stop the timer');
    const manualEntry = all.entries.find((e) => e.type === 'manual')!;
    expect(manualEntry.adjusted).toBe(false);
    expect(manualEntry.adjustmentReason).toBeNull();

    const scoped = await reportService.getNodeTimeEntries({
      projectId,
      nodeId: epic.id,
      period: 'weekly',
      offset: 0,
      ticketId: story.id,
    });
    // Scoping to the story folds in its subtask's manual entry.
    expect(scoped.entries.map((e) => e.ticketId).sort()).toEqual([story.id, sub.id].sort());
  });

  it('all-time tracked total (detail header) ignores the window and folds descendants', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const sub = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: story.id });
    await addTimer(story.id, HOUR, userId, 100); // long ago
    await addTimer(sub.id, 30 * MINUTE, userId, 0);

    const total = await reportService.getNodeTrackedTotalMs({ projectId, nodeId: epic.id });
    expect(total.totalMs).toBe(HOUR + 30 * MINUTE);
    expect(total.descendantCount).toBe(2);
  });

  it('404s for an unknown node and resolves display ids for live tickets only', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });

    const resolved = await reportService.resolveLiveTicketByNumber(projectId, epic.ticketNumber);
    expect(resolved?.id).toBe(epic.id);

    await ticketService.deleteTicket(epic.id, userId);
    expect(await reportService.resolveLiveTicketByNumber(projectId, epic.ticketNumber)).toBeNull();
    await expect(
      reportService.getNodeTimeRollup({
        projectId,
        nodeId: '00000000-0000-4000-8000-000000000000',
        period: 'weekly',
        offset: 0,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('effectiveDurationMs prefers manual minutes and zeroes running timers', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    expect(
      reportService.effectiveDurationMs({
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        manualEntryMinutes: null,
      }),
    ).toBe(HOUR);
    expect(
      reportService.effectiveDurationMs({
        startTime: start,
        endTime: new Date(start.getTime() + HOUR),
        manualEntryMinutes: 15,
      }),
    ).toBe(15 * MINUTE);
    expect(
      reportService.effectiveDurationMs({
        startTime: start,
        endTime: null,
        manualEntryMinutes: null,
      }),
    ).toBe(0);
  });

  it('CR-06: the member report breaks totals down per ticket and epic', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const loose = await create(slug, { title: 'Loose task', type: 'TASK' });

    await addTimer(story.id, HOUR, userId);
    await addTimer(story.id, 30 * MINUTE, otherUserId);
    await addManual(loose.id, 15, userId);

    const report = await reportService.getTimeReport({
      projectId,
      period: 'weekly',
      offset: 0,
    });

    const me = report.users.find((u) => u.id === userId)!;
    const other = report.users.find((u) => u.id === otherUserId)!;
    // Sorted by total DESC: me (1h + 15m) then other (30m).
    expect(report.users[0]!.id).toBe(userId);
    expect(me.totalMs).toBe(HOUR + 15 * MINUTE);
    expect(me.autoMs).toBe(HOUR);
    expect(me.manualMs).toBe(15 * MINUTE);
    expect(me.entryCount).toBe(2);
    expect(other.totalMs).toBe(30 * MINUTE);

    // Per-ticket rows, sorted DESC, with the epic reference attached.
    expect(me.tickets.map((t) => t.ticketNumber)).toEqual([story.ticketNumber, loose.ticketNumber]);
    const storyRow = me.tickets[0]!;
    expect(storyRow.totalMs).toBe(HOUR);
    expect(storyRow.type).toBe('STORY');
    expect(storyRow.epic?.id).toBe(epic.id);
    expect(me.tickets[1]!.epic).toBeNull();
    // AC: the member's rows sum exactly to the headline total.
    expect(me.tickets.reduce((sum, t) => sum + t.totalMs, 0)).toBe(me.totalMs);
  });

  it('CR-06: member + source filters narrow totals AND breakdown rows', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task', type: 'TASK' });
    await addTimer(ticket.id, HOUR, userId);
    await addTimer(ticket.id, 2 * HOUR, otherUserId);
    await addManual(ticket.id, 20, userId);

    const manualOnly = await reportService.getTimeReport({
      projectId,
      period: 'weekly',
      offset: 0,
      source: 'manual',
    });
    expect(manualOnly.users).toHaveLength(1);
    expect(manualOnly.users[0]!.totalMs).toBe(20 * MINUTE);
    expect(manualOnly.users[0]!.tickets).toHaveLength(1);

    const justMe = await reportService.getTimeReport({
      projectId,
      period: 'weekly',
      offset: 0,
      memberId: userId,
    });
    expect(justMe.users).toHaveLength(1);
    expect(justMe.users[0]!.totalMs).toBe(HOUR + 20 * MINUTE);
    expect(justMe.users[0]!.tickets[0]!.totalMs).toBe(HOUR + 20 * MINUTE);
  });

  it('FR-06.4: the member report uses CR-14 adjusted durations, not raw wall-clock', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task', type: 'TASK' });

    // 2h timer adjusted by -30m → 90m effective.
    await addTimer(ticket.id, 2 * HOUR, userId);
    await adjustLatestEntry(ticket.id, -30, 'Overtracked while idle');

    const report = await reportService.getTimeReport({
      projectId,
      period: 'weekly',
      offset: 0,
    });

    expect(report.users).toHaveLength(1);
    const me = report.users[0]!;
    expect(me.totalMs).toBe(90 * MINUTE);
    expect(me.autoMs).toBe(90 * MINUTE);
    expect(me.manualMs).toBe(0);
    expect(me.entryCount).toBe(1);
    expect(me.tickets).toHaveLength(1);
    expect(me.tickets[0]!.totalMs).toBe(90 * MINUTE);
    expect(me.tickets[0]!.autoMs).toBe(90 * MINUTE);
    // AC: rows still sum exactly to the headline total.
    expect(me.tickets.reduce((sum, t) => sum + t.totalMs, 0)).toBe(me.totalMs);
  });

  it('FR-06.3: the type filter narrows member totals AND ticket rows together', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const task = await create(slug, { title: 'Task', type: 'TASK' });

    await addTimer(epic.id, HOUR, userId);
    await addTimer(task.id, 30 * MINUTE, userId);
    await addManual(story.id, 45, userId);

    const tasksOnly = await reportService.getTimeReport({
      projectId,
      period: 'weekly',
      offset: 0,
      type: 'TASK',
    });
    expect(tasksOnly.users).toHaveLength(1);
    expect(tasksOnly.users[0]!.totalMs).toBe(30 * MINUTE);
    expect(tasksOnly.users[0]!.tickets.map((t) => t.type)).toEqual(['TASK']);
    expect(tasksOnly.users[0]!.tickets[0]!.id).toBe(task.id);

    const unfiltered = await reportService.getTimeReport({
      projectId,
      period: 'weekly',
      offset: 0,
    });
    expect(unfiltered.users[0]!.totalMs).toBe(HOUR + 30 * MINUTE + 45 * MINUTE);
    // Invariant: per-ticket rows sum to the headline total with and without the filter.
    expect(unfiltered.users[0]!.tickets.reduce((sum, t) => sum + t.totalMs, 0)).toBe(
      unfiltered.users[0]!.totalMs,
    );
    expect(tasksOnly.users[0]!.tickets.reduce((sum, t) => sum + t.totalMs, 0)).toBe(
      tasksOnly.users[0]!.totalMs,
    );
  });
});
