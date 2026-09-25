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
import { getTimerState, startTimer, stopTimer, adjustTimeEntry } from './timerService';
import { timeEntries as teTable } from '../db/schema';

// CR-09 / CR-15 integration tests — REAL test DB. The widget and the start guard
// both read this state: the open session (with its ticket) and the most recent
// CLOSED session, skipping soft-deleted tickets.

const C1 = 'col-1';
const COLUMNS = [{ id: C1, name: 'To Do' }];
const MINUTE = 60_000;

let userId = '';
let slugSeq = 0;
const createdUserIds: string[] = [];

async function createTestProject(): Promise<string> {
  slugSeq += 1;
  const slug = `T${String(slugSeq).padStart(2, '0')}${Date.now() % 1000}`;
  const [project] = await db
    .insert(projects)
    .values({ name: `TimerState ${slugSeq}`, slug, columns: COLUMNS, creatorId: userId })
    .returning();
  await db.insert(projectSequences).values({ projectId: project!.id, nextNumber: 1 });
  return slug;
}

function create(slug: string, title: string) {
  return ticketService.createTicket({
    slug,
    creatorId: userId,
    title,
    description: 'Fixture',
    priority: 'MEDIUM',
    statusColumn: C1,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
}

async function insertClosed(
  ticketId: string,
  minutesAgo: number,
  durationMin: number,
): Promise<void> {
  const end = new Date(Date.now() - minutesAgo * MINUTE);
  const start = new Date(end.getTime() - durationMin * MINUTE);
  await db.insert(timeEntries).values({ ticketId, userId, startTime: start, endTime: end });
}

// Each test gets its OWN user so timer state never leaks between cases.
beforeEach(async () => {
  const [u] = await db
    .insert(users)
    .values({
      email: `timerstate-${createdUserIds.length}-${Date.now()}@example.com`,
      fullName: 'TS User',
    })
    .returning();
  userId = u!.id;
  createdUserIds.push(userId);
});

afterAll(async () => {
  // Projects created by ANY of the per-test users.
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      createdUserIds.length > 0
        ? inArray(projects.creatorId, createdUserIds)
        : eq(projects.creatorId, userId),
    );
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
  if (createdUserIds.length > 0) {
    await db.delete(activityLogs).where(inArray(activityLogs.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe('CR-09/CR-15 timer state (integration)', () => {
  it('reports no active timer and no last-tracked ticket for a fresh user', async () => {
    const state = await getTimerState(userId);
    expect(state.active).toBeNull();
    expect(state.lastTracked).toBeNull();
  });

  it('exposes the running session WITH its ticket (for the widget + guard)', async () => {
    const slug = await createTestProject();
    const ticket = await create(slug, 'Running ticket');
    await startTimer({ ticketId: ticket.id, userId });

    const state = await getTimerState(userId);
    expect(state.active).not.toBeNull();
    expect(state.active!.ticket.id).toBe(ticket.id);
    expect(state.active!.ticket.title).toBe('Running ticket');
    expect(state.active!.ticket.projectSlug).toBe(slug);
    expect(Date.parse(state.active!.startTime)).toBeLessThanOrEqual(Date.now());

    // Close it so later tests start clean.
    await stopTimer({ ticketId: ticket.id, userId, isAdmin: false });
  });

  it('falls back to the previous ticket when the last-tracked one is deleted', async () => {
    const slug = await createTestProject();
    const older = await create(slug, 'Older ticket');
    const newer = await create(slug, 'Newer ticket');
    await insertClosed(older.id, 60, 30);
    await insertClosed(newer.id, 5, 10);

    let state = await getTimerState(userId);
    expect(state.lastTracked!.id).toBe(newer.id);
    expect(state.lastTracked!.durationMs).toBe(10 * MINUTE);

    // Delete the most recent one → the widget must point at the previous.
    await ticketService.deleteTicket(newer.id, userId);
    state = await getTimerState(userId);
    expect(state.lastTracked!.id).toBe(older.id);
    expect(state.lastTracked!.durationMs).toBe(30 * MINUTE);
    expect(state.lastTracked!.projectSlug).toBe(slug);
  });

  it('replaces lastTracked when another session runs (CR-15 FR-15.5)', async () => {
    const slug = await createTestProject();
    const first = await create(slug, 'First');
    const second = await create(slug, 'Second');
    await insertClosed(first.id, 30, 20);
    expect((await getTimerState(userId)).lastTracked!.id).toBe(first.id);

    // A new session on another ticket supersedes it once stopped.
    await startTimer({ ticketId: second.id, userId });
    await stopTimer({ ticketId: second.id, userId, isAdmin: false });
    expect((await getTimerState(userId)).lastTracked!.id).toBe(second.id);
  });

  it('never reports a manual entry as lastTracked, even when logged after the last session (OQ-15a)', async () => {
    const slug = await createTestProject();
    const timerTicket = await create(slug, 'Timer ticket');
    await insertClosed(timerTicket.id, 60, 30); // last real session: 30m, ended 1h ago

    // A manual log created AFTER that session (startTime === endTime, duration
    // carried solely by manualEntryMinutes) must not hijack last-tracked.
    const manualTicket = await create(slug, 'Manual ticket');
    const loggedAt = new Date(Date.now() - 5 * MINUTE);
    await db.insert(teTable).values({
      ticketId: manualTicket.id,
      userId,
      startTime: loggedAt,
      endTime: loggedAt,
      manualEntryMinutes: 20,
    });

    const state = await getTimerState(userId);
    expect(state.lastTracked!.id).toBe(timerTicket.id);
    expect(state.lastTracked!.title).toBe('Timer ticket');
    expect(state.lastTracked!.durationMs).toBe(30 * MINUTE);
  });

  it('reports no lastTracked for a manual-only user (OQ-15a)', async () => {
    const slug = await createTestProject();
    const ticket = await create(slug, 'Only manual');
    const loggedAt = new Date();
    await db.insert(teTable).values({
      ticketId: ticket.id,
      userId,
      startTime: loggedAt,
      endTime: loggedAt,
      manualEntryMinutes: 45,
    });

    const state = await getTimerState(userId);
    expect(state.active).toBeNull();
    expect(state.lastTracked).toBeNull();
  });
});

describe('CR-14 adjustTimeEntry (integration)', () => {
  it('applies a negative adjustment, keeps the original, and audits it', async () => {
    const slug = await createTestProject();
    const ticket = await create(slug, 'Adjusted ticket');
    await insertClosed(ticket.id, 1, 150); // 2h30m session

    const [entry] = await db.select().from(teTable).where(eq(teTable.ticketId, ticket.id));
    const original = entry!.endTime!.getTime() - entry!.startTime.getTime();
    expect(original).toBe(150 * MINUTE);

    // The meeting example: −2h with a reason.
    const adjusted = await adjustTimeEntry({
      ticketId: ticket.id,
      entryId: entry!.id,
      adjustmentMinutes: -120,
      reason: 'Left the desk for two hours during an emergency',
      actingUserId: userId,
      actingUserIsAdmin: false,
    });
    expect(adjusted.adjustmentMinutes).toBe(-120);

    // Effective duration is 30m; the row's start/end are untouched.
    const [after] = await db.select().from(teTable).where(eq(teTable.id, entry!.id));
    expect(after!.endTime!.getTime() - after!.startTime.getTime()).toBe(original);
    expect(after!.adjustmentMinutes).toBe(-120);
    expect(after!.adjustmentReason).toContain('emergency');
    expect(after!.adjustedById).toBe(userId);

    // TIME_ADJUSTED audit row on the ticket.
    const logs = await db.select().from(activityLogs).where(eq(activityLogs.ticketId, ticket.id));
    const audit = logs.find((l) => l.actionType === 'TIME_ADJUSTED');
    expect(audit).toBeDefined();
    expect(audit!.newValue).toContain('-120m');
  });

  it('rejects: short reason, running entry, manual entry, zero/negative effective, non-owner', async () => {
    const slug = await createTestProject();
    const ticket = await create(slug, 'Guards');
    await insertClosed(ticket.id, 1, 30);

    const [entry] = await db.select().from(teTable).where(eq(teTable.ticketId, ticket.id));
    const base = {
      ticketId: ticket.id,
      entryId: entry!.id,
      actingUserId: userId,
      actingUserIsAdmin: false,
    };

    await expect(
      adjustTimeEntry({ ...base, adjustmentMinutes: -5, reason: 'too short' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      adjustTimeEntry({ ...base, adjustmentMinutes: 0, reason: 'A valid reason here' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Would drive the effective duration to <= 0.
    await expect(
      adjustTimeEntry({ ...base, adjustmentMinutes: -60, reason: 'A valid reason here' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // A running entry cannot be adjusted.
    const running = await ticketService.createTicket({
      slug,
      creatorId: userId,
      title: 'Running',
      description: 'x',
      priority: 'MEDIUM',
      statusColumn: C1,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await startTimer({ ticketId: running.id, userId });
    const [open] = await db.select().from(teTable).where(eq(teTable.ticketId, running.id));
    await expect(
      adjustTimeEntry({
        ticketId: running.id,
        entryId: open!.id,
        adjustmentMinutes: 10,
        reason: 'A valid reason here',
        actingUserId: userId,
        actingUserIsAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await stopTimer({ ticketId: running.id, userId, isAdmin: false });

    // Manual entries are out of scope.
    const manualTicket = await create(slug, 'Manual ticket');
    await db.insert(teTable).values({
      ticketId: manualTicket.id,
      userId,
      startTime: new Date(),
      endTime: new Date(),
      manualEntryMinutes: 20,
    });
    const [manual] = await db.select().from(teTable).where(eq(teTable.ticketId, manualTicket.id));
    await expect(
      adjustTimeEntry({
        ticketId: manualTicket.id,
        entryId: manual!.id,
        adjustmentMinutes: 10,
        reason: 'A valid reason here',
        actingUserId: userId,
        actingUserIsAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Another member without admin rights is forbidden.
    const [other] = await db
      .insert(users)
      .values({ email: `cr14-other-${Date.now()}@example.com`, fullName: 'Other' })
      .returning();
    createdUserIds.push(other!.id);
    await expect(
      adjustTimeEntry({
        ...base,
        adjustmentMinutes: 10,
        reason: 'A valid reason here',
        actingUserId: other!.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a second correction overwrites with a new mandatory reason', async () => {
    const slug = await createTestProject();
    const ticket = await create(slug, 'Twice adjusted');
    await insertClosed(ticket.id, 1, 60);
    const [entry] = await db.select().from(teTable).where(eq(teTable.ticketId, ticket.id));

    await adjustTimeEntry({
      ticketId: ticket.id,
      entryId: entry!.id,
      adjustmentMinutes: -10,
      reason: 'First correction reason',
      actingUserId: userId,
      actingUserIsAdmin: false,
    });
    const second = await adjustTimeEntry({
      ticketId: ticket.id,
      entryId: entry!.id,
      adjustmentMinutes: -20,
      reason: 'Second correction reason',
      actingUserId: userId,
      actingUserIsAdmin: false,
    });
    expect(second.adjustmentMinutes).toBe(-20);
    expect(second.adjustmentReason).toBe('Second correction reason');
  });

  it('returns NOT_FOUND when the entry belongs to another ticket of the SAME project (entry↔ticket binding)', async () => {
    const slug = await createTestProject();
    const host = await create(slug, 'Host ticket');
    const other = await create(slug, 'Other ticket');
    await insertClosed(other.id, 1, 30);
    const [entry] = await db.select().from(teTable).where(eq(teTable.ticketId, other.id));

    // The URL resolves `host`, but the entry lives on `other` — same project,
    // yet the request must not reach it (no existence leak either).
    await expect(
      adjustTimeEntry({
        ticketId: host.id,
        entryId: entry!.id,
        adjustmentMinutes: 10,
        reason: 'A valid reason here',
        actingUserId: userId,
        actingUserIsAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // The entry row is untouched.
    const [after] = await db.select().from(teTable).where(eq(teTable.id, entry!.id));
    expect(after!.adjustmentMinutes).toBeNull();
  });

  it('returns NOT_FOUND when the entry belongs to a ticket of a DIFFERENT project', async () => {
    const slugA = await createTestProject();
    const slugB = await createTestProject();
    const ticketB = await create(slugB, 'Project B ticket');
    await insertClosed(ticketB.id, 1, 30);
    const [entry] = await db.select().from(teTable).where(eq(teTable.ticketId, ticketB.id));

    // The caller legitimately sees project A but not B; aiming the URL at an
    // A-ticket must not expose B's entry.
    const ticketA = await create(slugA, 'Project A ticket');
    await expect(
      adjustTimeEntry({
        ticketId: ticketA.id,
        entryId: entry!.id,
        adjustmentMinutes: 10,
        reason: 'A valid reason here',
        actingUserId: userId,
        actingUserIsAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an admin adjust another member’s closed entry (FR-14.1)', async () => {
    const slug = await createTestProject();
    const ticket = await create(slug, 'Admin adjusted ticket');
    await insertClosed(ticket.id, 1, 30);
    const [entry] = await db.select().from(teTable).where(eq(teTable.ticketId, ticket.id));

    const [admin] = await db
      .insert(users)
      .values({ email: `cr14-admin-${Date.now()}@example.com`, fullName: 'Admin' })
      .returning();
    createdUserIds.push(admin!.id);

    const adjusted = await adjustTimeEntry({
      ticketId: ticket.id,
      entryId: entry!.id,
      adjustmentMinutes: 15,
      reason: 'Admin corrected the tracked session length',
      actingUserId: admin!.id,
      actingUserIsAdmin: true,
    });
    expect(adjusted.adjustmentMinutes).toBe(15);
    expect(adjusted.adjustedById).toBe(admin!.id);

    const [after] = await db.select().from(teTable).where(eq(teTable.id, entry!.id));
    expect(after!.adjustmentMinutes).toBe(15);
  });
});
