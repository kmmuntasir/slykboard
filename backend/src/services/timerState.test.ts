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
import { getTimerState, startTimer, stopTimer } from './timerService';

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
});
