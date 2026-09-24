import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db/client';
import { activityLogs, projectSequences, projects, tickets, users } from '../db/schema';
import * as ticketService from './ticketService';
import { AppError } from '../utils/appError';

// CR-03 integration tests — REAL test DB (mirrors db.test.ts's live-Postgres
// approach; env injected by vitest.config.ts). Exercises the full hierarchy
// stack end-to-end: rank validation, derived (auto-progressed) columns, the
// recompute cascade, re-parenting, and cascade soft-delete — paths the mocked
// unit suites cannot observe.
//
// Layout per test: fresh user + project with columns [c1, c2, c3] (c3 = Done).
// Rows are hard-deleted in cleanup (test-only; the app itself only soft-deletes).

const C1 = 'col-1';
const C2 = 'col-2';
const C3 = 'col-3';
const COLUMNS = [
  { id: C1, name: 'To Do' },
  { id: C2, name: 'In Progress' },
  { id: C3, name: 'Done' },
];

let userId = '';
let slugSeq = 0;

async function createTestProject(): Promise<string> {
  slugSeq += 1;
  const slug = `H${String(slugSeq).padStart(2, '0')}${Date.now() % 1000}`;
  const [project] = await db
    .insert(projects)
    .values({ name: `Hierarchy ${slugSeq}`, slug, columns: COLUMNS, creatorId: userId })
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
    description: 'Fixture description',
    priority: 'MEDIUM',
    statusColumn: args.statusColumn ?? C1,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    type: args.type,
    parentId: args.parentId ?? null,
  });
}

async function columnOf(ticketId: string): Promise<string> {
  const [row] = await db
    .select({ statusColumn: tickets.statusColumn })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row!.statusColumn;
}

async function isDeleted(ticketId: string): Promise<boolean> {
  const [row] = await db
    .select({ deletedAt: tickets.deletedAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row?.deletedAt != null;
}

beforeEach(async () => {
  // One shared user per run; each test gets a fresh project (own ticket space).
  if (!userId) {
    const [user] = await db
      .insert(users)
      .values({ email: `hierarchy-${Date.now()}@example.com`, fullName: 'Hierarchy Tester' })
      .returning();
    userId = user!.id;
  }
});

afterAll(async () => {
  // Hard cleanup: tickets (activity/time cascade via FK), then projects, user.
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.creatorId, userId));
  const projectIds = projectRows.map((p) => p.id);
  if (projectIds.length > 0) {
    await db.delete(tickets).where(inArray(tickets.projectId, projectIds));
    await db.delete(projectSequences).where(inArray(projectSequences.projectId, projectIds));
    await db.delete(projects).where(inArray(projects.id, projectIds));
  }
  await db.delete(users).where(eq(users.id, userId));
  // Belt-and-braces: clear any orphaned activity rows (FKs should prevent).
  await db.delete(activityLogs).where(eq(activityLogs.userId, userId));
});

describe('CR-03 hierarchy (integration)', () => {
  it('enforces rank rules on create: subtask needs a parent; parent must outrank child', async () => {
    const slug = await createTestProject();
    const epic = await create(slug, { title: 'Epic 1', type: 'EPIC' });

    await expect(create(slug, { title: 'Orphan subtask', type: 'SUBTASK' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    const task = await create(slug, { title: 'Task under epic', type: 'TASK', parentId: epic.id });
    // STORY under a TASK is rank-inverted (2 > 1).
    await expect(
      create(slug, { title: 'Story under task', type: 'STORY', parentId: task.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Valid chains: STORY under EPIC, TASK under STORY, SUBTASK under TASK.
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const subtask = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: story.id });
    expect(story.parentId).toBe(epic.id);
    expect(subtask.parentId).toBe(story.id);
  });

  it('auto-progresses parent chains to the least-progressed child and blocks manual parent moves', async () => {
    const slug = await createTestProject();
    const epic = await create(slug, { title: 'Epic', type: 'EPIC', statusColumn: C3 });
    const task = await create(slug, { title: 'Task', type: 'TASK', parentId: epic.id });
    const sub = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: task.id });

    // Everything derives to c1 (the subtask, the least progressed).
    expect(await columnOf(sub.id)).toBe(C1);
    expect(await columnOf(task.id)).toBe(C1);
    expect(await columnOf(epic.id)).toBe(C1);

    // Manual cross-column move of a parent with live children is rejected…
    await expect(
      ticketService.moveTicket({
        ticketId: task.id,
        statusColumn: C2,
        position: 100,
        actingUserId: userId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // …but moving the leaf cascades the whole chain upward.
    await ticketService.moveTicket({
      ticketId: sub.id,
      statusColumn: C2,
      position: 100,
      actingUserId: userId,
    });
    expect(await columnOf(task.id)).toBe(C2);
    expect(await columnOf(epic.id)).toBe(C2);

    // A second child left behind pulls the parents back (backward move).
    const sub2 = await create(slug, { title: 'Sub 2', type: 'SUBTASK', parentId: task.id });
    expect(await columnOf(task.id)).toBe(C1); // sub2 sits in c1
    expect(await columnOf(epic.id)).toBe(C1);

    // Same-column vertical reorder of a parent is still allowed (FR-03.10).
    const reordered = await ticketService.moveTicket({
      ticketId: task.id,
      statusColumn: C1,
      position: 1,
      actingUserId: userId,
    });
    expect(reordered.statusColumn).toBe(C1);
  });

  it('re-parenting recomputes both chains; type changes respect children', async () => {
    const slug = await createTestProject();
    const epicA = await create(slug, { title: 'Epic A', type: 'EPIC' });
    const epicB = await create(slug, { title: 'Epic B', type: 'EPIC' });
    const task = await create(slug, { title: 'Task', type: 'TASK', parentId: epicA.id });
    const sub = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: task.id });

    await ticketService.moveTicket({
      ticketId: sub.id,
      statusColumn: C2,
      position: 100,
      actingUserId: userId,
    });
    expect(await columnOf(task.id)).toBe(C2);

    // Re-parent the task (with its subtask) from Epic A to Epic B.
    const { new: moved } = await ticketService.updateTicket({
      ticketId: task.id,
      patch: { parentId: epicB.id },
      actingUserId: userId,
    });
    expect(moved.parentId).toBe(epicB.id);
    expect(await columnOf(epicB.id)).toBe(C2); // derives from its new child

    // Type change blocked when children would become invalid (subtask under subtask).
    await expect(
      ticketService.updateTicket({
        ticketId: task.id,
        patch: { type: 'SUBTASK' },
        actingUserId: userId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Legal type change (TASK -> STORY under an EPIC) logs TYPE_CHANGED.
    await ticketService.updateTicket({
      ticketId: task.id,
      patch: { type: 'STORY' },
      actingUserId: userId,
    });
    const logs = await db
      .select({
        actionType: activityLogs.actionType,
        oldValue: activityLogs.oldValue,
        newValue: activityLogs.newValue,
      })
      .from(activityLogs)
      .where(eq(activityLogs.ticketId, task.id));
    const typeChange = logs.find((l) => l.actionType === 'TYPE_CHANGED');
    const parentChange = logs.find((l) => l.actionType === 'PARENT_CHANGED');
    expect(typeChange?.oldValue).toBe('TASK');
    expect(typeChange?.newValue).toBe('STORY');
    expect(parentChange).toBeDefined(); // from the earlier re-parent
  });

  it('cascades soft-delete through the subtree and recomputes the orphaned chain', async () => {
    const slug = await createTestProject();
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });
    const sub = await create(slug, { title: 'Sub', type: 'SUBTASK', parentId: story.id });
    const siblingStory = await create(slug, {
      title: 'Sibling story',
      type: 'STORY',
      parentId: epic.id,
    });

    // story in c2, sibling in c1 → epic pinned to c1 by the sibling.
    await ticketService.moveTicket({
      ticketId: sub.id,
      statusColumn: C2,
      position: 100,
      actingUserId: userId,
    });
    expect(await columnOf(epic.id)).toBe(C1);

    // Delete the sibling (a leaf parent-less... actually a childless STORY):
    // epic must re-derive to c2 from the remaining story chain.
    const { deletedCount } = await ticketService.deleteTicket(siblingStory.id, userId);
    expect(deletedCount).toBe(1);
    expect(await columnOf(epic.id)).toBe(C2);

    // Delete the story → subtask goes with it (cascade).
    const cascade = await ticketService.deleteTicket(story.id, userId);
    expect(cascade.deletedCount).toBe(2);
    expect(await isDeleted(story.id)).toBe(true);
    expect(await isDeleted(sub.id)).toBe(true);

    // Epic is now childless: keeps its last derived column, manual moves resume.
    expect(await columnOf(epic.id)).toBe(C2);
    await ticketService.moveTicket({
      ticketId: epic.id,
      statusColumn: C3,
      position: 100,
      actingUserId: userId,
    });
    expect(await columnOf(epic.id)).toBe(C3);
  });

  it('hydrateTicketRow exposes parent + children summaries', async () => {
    const slug = await createTestProject();
    const epic = await create(slug, { title: 'Epic', type: 'EPIC' });
    const story = await create(slug, { title: 'Story', type: 'STORY', parentId: epic.id });

    const detail = await ticketService.getTicket(epic.id);
    expect(detail!.parent).toBeNull();
    expect(detail!.children).toHaveLength(1);
    expect(detail!.children[0]!.id).toBe(story.id);
    expect(detail!.children[0]!.type).toBe('STORY');

    const childDetail = await ticketService.getTicket(story.id);
    expect(childDetail!.parent!.id).toBe(epic.id);
    expect(childDetail!.parent!.type).toBe('EPIC');
    expect(childDetail!.children).toEqual([]);
  });

  it('AppError surfaces for unknown parent (NOT_FOUND, not a crash)', async () => {
    const slug = await createTestProject();
    await expect(
      create(slug, {
        title: 'Bad parent',
        type: 'TASK',
        parentId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
