import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

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
import * as columnTimeService from './columnTimeService';

// CR-08 integration tests — REAL test DB. Wall-clock residence comes from the
// status-transition history; tracked time overlaps the same intervals.

const C1 = 'col-1';
const C2 = 'col-2';
const C3 = 'col-3';
const COLUMNS = [
  { id: C1, name: 'To Do' },
  { id: C2, name: 'In Progress' },
  { id: C3, name: 'Done' },
];
const HOUR = 3_600_000;

let userId = '';
let otherUserId = '';
let slugSeq = 0;

async function createTestProject(): Promise<string> {
  slugSeq += 1;
  const slug = `C${String(slugSeq).padStart(2, '0')}${Date.now() % 1000}`;
  const [project] = await db
    .insert(projects)
    .values({ name: `ColumnTime ${slugSeq}`, slug, columns: COLUMNS, creatorId: userId })
    .returning();
  await db.insert(projectSequences).values({ projectId: project!.id, nextNumber: 1 });
  return slug;
}

function create(
  slug: string,
  args: {
    title: string;
    type?: ticketService.TicketType;
    parentId?: string | null;
    statusColumn?: string;
  },
) {
  return ticketService.createTicket({
    slug,
    creatorId: userId,
    title: args.title,
    description: 'Fixture',
    priority: 'MEDIUM',
    statusColumn: args.statusColumn ?? C1,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    type: args.type ?? 'TASK',
    parentId: args.parentId ?? null,
  });
}

async function projectIdFor(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return row!.id;
}

/** Insert a timer of `ms` ending now; returns the entry id (for adjustments). */
async function addTimer(ticketId: string, ms: number, user = userId): Promise<string> {
  const start = new Date(Date.now() - ms);
  const [row] = await db
    .insert(timeEntries)
    .values({
      ticketId,
      userId: user,
      startTime: start,
      endTime: new Date(),
    })
    .returning({ id: timeEntries.id });
  return row!.id;
}

/** Insert a timer entry with EXPLICIT bounds (for deterministic overlaps). */
async function addTimerAt(
  ticketId: string,
  start: Date,
  end: Date,
  user = userId,
): Promise<string> {
  const [row] = await db
    .insert(timeEntries)
    .values({ ticketId, userId: user, startTime: start, endTime: end })
    .returning({ id: timeEntries.id });
  return row!.id;
}

/**
 * Backdate the ticket's creation + its STATUS_CHANGED activity rows so the
 * residence intervals have exact, deterministic spans (the service derives
 * intervals from these timestamps, never from wall-clock now).
 */
async function backdateTimeline(
  ticketId: string,
  createdAt: Date,
  moveTimes: Date[],
): Promise<void> {
  await db.update(tickets).set({ createdAt }).where(eq(tickets.id, ticketId));
  const rows = await db
    .select({ id: activityLogs.id, actionType: activityLogs.actionType })
    .from(activityLogs)
    .where(eq(activityLogs.ticketId, ticketId));
  const statusRows = rows.filter((r) => r.actionType === 'STATUS_CHANGED');
  for (const [index, row] of statusRows.entries()) {
    const at = moveTimes[index];
    if (at) {
      await db.update(activityLogs).set({ createdAt: at }).where(eq(activityLogs.id, row.id));
    }
  }
  const created = rows.find((r) => r.actionType === 'CREATED');
  if (created) {
    await db.update(activityLogs).set({ createdAt }).where(eq(activityLogs.id, created.id));
  }
}

/** Timeline helper bound to ONE clock read per test (no ms drift). */
function timeline() {
  const now = Date.now();
  return {
    hoursAgo: (h: number) => new Date(now - h * HOUR),
    minutesAgo: (m: number) => new Date(now - m * 60_000),
  };
}

beforeEach(async () => {
  if (!userId) {
    const [a] = await db
      .insert(users)
      .values({ email: `coltime-a-${Date.now()}@example.com`, fullName: 'CT A' })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `coltime-b-${Date.now()}@example.com`, fullName: 'CT B' })
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

describe('CR-08 column time report (integration)', () => {
  it('reports residence per column in project column order', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });

    const before = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    expect(before.columns.map((c) => c.columnName)).toEqual(['To Do', 'In Progress', 'Done']);
    // Everything so far sits in To Do.
    expect(before.columns[0]!.residenceMs).toBeGreaterThanOrEqual(0);
    expect(before.columns[0]!.visits).toBe(1);
    expect(before.columns[1]!.residenceMs).toBe(0);

    // Move twice: In Progress → Done, then back to In Progress (two visits).
    await ticketService.moveTicket({
      ticketId: ticket.id,
      statusColumn: C2,
      position: 10,
      actingUserId: userId,
    });
    await ticketService.moveTicket({
      ticketId: ticket.id,
      statusColumn: C3,
      position: 10,
      actingUserId: userId,
    });
    await ticketService.moveTicket({
      ticketId: ticket.id,
      statusColumn: C2,
      position: 10,
      actingUserId: userId,
    });

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    const inProgress = report.columns.find((c) => c.columnId === C2)!;
    const done = report.columns.find((c) => c.columnId === C3)!;
    const todo = report.columns.find((c) => c.columnId === C1)!;
    expect(inProgress.visits).toBe(2);
    expect(inProgress.residenceMs).toBeGreaterThan(0);
    expect(done.residenceMs).toBeGreaterThanOrEqual(0);
    expect(todo.residenceMs).toBeGreaterThanOrEqual(0);
    // Shares add up (rounding aside).
    const shareSum = report.columns.reduce((sum, c) => sum + c.sharePct, 0);
    expect(shareSum).toBeGreaterThanOrEqual(95);
    expect(shareSum).toBeLessThanOrEqual(101);
  });

  it('attributes tracked timer time to the column it overlapped', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    const at = timeline();

    // Move To Do → In Progress, then backdate: To Do = [2h ago, 1h ago],
    // In Progress = [1h ago, now].
    await ticketService.moveTicket({
      ticketId: ticket.id,
      statusColumn: C2,
      position: 10,
      actingUserId: userId,
    });
    await backdateTimeline(ticket.id, at.hoursAgo(2), [at.hoursAgo(1)]);

    // 20m tracked fully inside To Do ([2h..1h ago]); 10m inside In Progress.
    await addTimerAt(ticket.id, at.minutesAgo(110), at.minutesAgo(90));
    await addTimerAt(ticket.id, at.minutesAgo(50), at.minutesAgo(40));

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    const todo = report.columns.find((c) => c.columnId === C1)!;
    const inProgress = report.columns.find((c) => c.columnId === C2)!;
    expect(todo.residenceMs).toBeGreaterThanOrEqual(HOUR);
    // In Progress is the OPEN interval (runs to now) — allow test-time drift.
    expect(inProgress.residenceMs).toBeGreaterThanOrEqual(HOUR - 60_000);
    expect(todo.trackedMs).toBe(20 * 60_000);
    expect(inProgress.trackedMs).toBe(10 * 60_000);
    expect(report.totalTrackedMs).toBe(30 * 60_000);
    expect(report.totalResidenceMs).toBeGreaterThan(HOUR);
  });

  it('splits a timer that spans two columns', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    const at = timeline();
    await ticketService.moveTicket({
      ticketId: ticket.id,
      statusColumn: C2,
      position: 10,
      actingUserId: userId,
    });
    await backdateTimeline(ticket.id, at.hoursAgo(2), [at.hoursAgo(1)]);
    // Runs 1h30 → 30m ago: 30m in To Do, 30m in In Progress.
    await addTimerAt(ticket.id, at.minutesAgo(90), at.minutesAgo(30));

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    expect(report.columns.find((c) => c.columnId === C1)!.trackedMs).toBe(30 * 60_000);
    expect(report.columns.find((c) => c.columnId === C2)!.trackedMs).toBe(30 * 60_000);
  });

  it('books the CR-14 adjustment delta where the timer stopped (FR-08.6)', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    const at = timeline();
    // Backdate creation so the open To Do interval spans the whole entry.
    await backdateTimeline(ticket.id, at.hoursAgo(2), []);

    // The ticket never leaves To Do.
    const entryId = await addTimer(ticket.id, HOUR);
    await db
      .update(timeEntries)
      .set({ adjustmentMinutes: -30, adjustmentReason: 'Overtracked while idle' })
      .where(eq(timeEntries.id, entryId));

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    const todo = report.columns.find((c) => c.columnId === C1)!;
    // Wall-clock ~1h minus the -30m delta; the open interval clips at most a
    // few test-scheduling ms off the tail.
    expect(todo.trackedMs).toBeGreaterThan(30 * 60_000 - 5_000);
    expect(todo.trackedMs).toBeLessThanOrEqual(30 * 60_000);
    expect(todo.trackedMs).toBe(todo.autoMs + todo.manualMs);
    expect(todo.manualMs).toBe(0);
    expect(report.totalTrackedMs).toBe(todo.trackedMs);
  });

  it('lands the adjustment delta whole in the stop column, not pro-rated (FR-08.6)', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    const at = timeline();
    await ticketService.moveTicket({
      ticketId: ticket.id,
      statusColumn: C2,
      position: 10,
      actingUserId: userId,
    });
    await backdateTimeline(ticket.id, at.hoursAgo(2), [at.hoursAgo(1)]);
    // To Do = [2h ago, 1h ago]; In Progress = [1h ago, now].
    // Timer runs 90m → 10m ago: 30m in To Do, 50m in In Progress, stopped there.
    const entryId = await addTimerAt(ticket.id, at.minutesAgo(90), at.minutesAgo(10));
    await db
      .update(timeEntries)
      .set({ adjustmentMinutes: 15, adjustmentReason: 'Missed buffer' })
      .where(eq(timeEntries.id, entryId));

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    expect(report.columns.find((c) => c.columnId === C1)!.trackedMs).toBe(30 * 60_000);
    const inProgress = report.columns.find((c) => c.columnId === C2)!;
    // 50m overlap + the FULL +15m delta (not 15m × 50/80 pro-rated).
    expect(inProgress.trackedMs).toBe(65 * 60_000);
    expect(inProgress.autoMs).toBe(65 * 60_000);
    expect(inProgress.manualMs).toBe(0);
    expect(report.totalTrackedMs).toBe(95 * 60_000);
    expect(report.autoMs).toBe(95 * 60_000);
    expect(report.manualMs).toBe(0);
  });

  it('splits tracked time into autoMs and manualMs per row and in totals (FR-11.4)', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    const at = timeline();
    await backdateTimeline(ticket.id, at.hoursAgo(2), []);
    // To Do = [2h ago, now] — both entries land there deterministically.
    await addTimerAt(ticket.id, at.minutesAgo(90), at.minutesAgo(60)); // 30m auto
    await db.insert(timeEntries).values({
      ticketId: ticket.id,
      userId,
      startTime: at.minutesAgo(30),
      endTime: at.minutesAgo(30),
      manualEntryMinutes: 15,
    });

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    const todo = report.columns.find((c) => c.columnId === C1)!;
    expect(todo.trackedMs).toBe(45 * 60_000);
    expect(todo.autoMs).toBe(30 * 60_000);
    expect(todo.manualMs).toBe(15 * 60_000);
    expect(todo.trackedMs).toBe(todo.autoMs + todo.manualMs);
    expect(report.totalTrackedMs).toBe(45 * 60_000);
    expect(report.autoMs).toBe(30 * 60_000);
    expect(report.manualMs).toBe(15 * 60_000);
  });

  it('member + source filters narrow tracked time but not residence', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    const at = timeline();
    await backdateTimeline(ticket.id, at.hoursAgo(4), []);
    await addTimerAt(ticket.id, at.minutesAgo(210), at.minutesAgo(150), userId); // 1h
    await addTimerAt(ticket.id, at.minutesAgo(150), at.minutesAgo(30), otherUserId); // 2h

    const justMe = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
      memberId: userId,
    });
    const all = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    expect(justMe.totalTrackedMs).toBe(HOUR);
    expect(all.totalTrackedMs).toBe(3 * HOUR);
    // Residence is member-independent — the member filter cannot move it.
    // (Two service calls read the clock a millisecond apart, so compare
    // with a small tolerance rather than exact equality.)
    expect(Math.abs(justMe.totalResidenceMs - all.totalResidenceMs)).toBeLessThan(5_000);
  });

  it('excludes running timers', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    const ticket = await create(slug, { title: 'Task' });
    await db.insert(timeEntries).values({
      ticketId: ticket.id,
      userId,
      startTime: new Date(Date.now() - HOUR),
      endTime: null,
    });

    const report = await columnTimeService.getColumnTimeReport({
      projectId,
      ticketId: ticket.id,
      period: null,
      offset: 0,
    });
    expect(report.totalTrackedMs).toBe(0);
  });

  it('404s for an unknown ticket', async () => {
    const slug = await createTestProject();
    const projectId = await projectIdFor(slug);
    await expect(
      columnTimeService.getColumnTimeReport({
        projectId,
        ticketId: '00000000-0000-4000-8000-000000000000',
        period: null,
        offset: 0,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
