import { config as loadEnv } from 'dotenv';
// Override vitest's placeholder DATABASE_URL (see vitest.config.ts test.env) with the real
// backend/.env value so this integration test hits the docker-compose dev DB.
loadEnv({ override: true });

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  users,
  projects,
  projectMembers,
  tickets,
  projectSequences,
  START_TICKET_NUMBER,
} from '../db/schema/core';
import { pipelineJobs, pipelineEvents } from '../db/schema/agent';
import { getPipelineView, MAX_PIPELINE_EVENTS } from './pipelineViewService';
import { getTicketForUser } from './ticketService';
import { AppError } from '../utils/appError';

// SLYK-0280 — DB-backed coverage for the pipeline read path per the ticket's
// test matrix: member sees job + events; non-member 404/403; no-job 404;
// events capped at 50 (seed 60, assert 50); jsonb detail round-trips
// verbatim (the MERGING mergebot shape Phase 6.5 depends on). Same fixture
// approach as db/schema/agent.test.ts (11-existing-patterns.md: no DB mocking).

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface Fixture {
  member: { id: string; isPlatformAdmin: boolean };
  outsider: { id: string; isPlatformAdmin: boolean };
  projectId: string;
  ticketId: string;
  plainTicketId: string;
}

async function seedFixture(db: ReturnType<typeof drizzle>): Promise<Fixture> {
  const [member] = await db
    .insert(users)
    .values({
      googleId: `slyk0280-member-${RUN}`,
      email: `slyk0280-member-${RUN}@slykboard.local`,
      fullName: 'Pipeline Member',
    })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({
      googleId: `slyk0280-outsider-${RUN}`,
      email: `slyk0280-outsider-${RUN}@slykboard.local`,
      fullName: 'Pipeline Outsider',
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `Pipeline View ${RUN}`,
      slug: `slyk0280-${RUN}`,
      columns: [
        { id: 'col-todo', name: 'To Do' },
        { id: 'col-done', name: 'Done' },
      ],
      creatorId: member!.id,
    })
    .returning();

  await db.insert(projectSequences).values({ projectId: project!.id });
  await db
    .insert(projectMembers)
    .values({ projectId: project!.id, userId: member!.id, role: 'MEMBER' });

  const [ticket] = await db
    .insert(tickets)
    .values({
      projectId: project!.id,
      ticketNumber: START_TICKET_NUMBER,
      title: `Pipeline ticket ${RUN}`,
      statusColumn: 'col-todo',
      creatorId: member!.id,
    })
    .returning();
  const [plainTicket] = await db
    .insert(tickets)
    .values({
      projectId: project!.id,
      ticketNumber: START_TICKET_NUMBER + 1,
      title: `Plain ticket ${RUN}`,
      statusColumn: 'col-todo',
      creatorId: member!.id,
    })
    .returning();

  return {
    member: { id: member!.id, isPlatformAdmin: false },
    outsider: { id: outsider!.id, isPlatformAdmin: false },
    projectId: project!.id,
    ticketId: ticket!.id,
    plainTicketId: plainTicket!.id,
  };
}

// The mergebot decision log documented in 04-schema.md (PipelineEvents.detail,
// toState=MERGING) — the exact shape Phase 6.5 consumes.
const MERGING_DETAIL = {
  checksPassed: ['lint', 'typecheck', 'test'],
  checksFailed: [],
  coverageDelta: { files: 2, lines: -14 },
  diffSize: { filesChanged: 4, insertions: 120, deletions: 31 },
  touchedSensitivePaths: { infra: false, migrations: true, deployConfig: false },
};

describe('SLYK0280 getPipelineView', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  let f: Fixture;

  beforeAll(async () => {
    f = await seedFixture(db);
  });

  afterAll(async () => {
    // Same ordered cleanup as agent.test.ts — Tickets/project_sequences lack
    // CASCADE to Projects, Projects.creatorId lacks CASCADE to Users.
    if (f) {
      await db.delete(tickets).where(eq(tickets.projectId, f.projectId));
      await db.delete(projectSequences).where(eq(projectSequences.projectId, f.projectId));
      await db.delete(projects).where(eq(projects.id, f.projectId));
      await db.delete(users).where(inArray(users.id, [f.member.id, f.outsider.id]));
    }
    await pool.end();
  });

  it('member sees the job row + seeded events in ascending createdAt order', async () => {
    const base = Date.now();
    await db
      .insert(pipelineJobs)
      .values({ ticketId: f.ticketId, projectId: f.projectId, state: 'MERGING' });
    await db.insert(pipelineEvents).values([
      {
        ticketId: f.ticketId,
        fromState: 'QUEUED',
        toState: 'AGENT_RUNNING',
        detail: null,
        createdAt: new Date(base - 2000),
      },
      {
        ticketId: f.ticketId,
        fromState: 'AGENT_RUNNING',
        toState: 'MERGING',
        detail: MERGING_DETAIL,
        createdAt: new Date(base - 1000),
      },
    ]);

    const view = await getPipelineView(f.ticketId);

    expect(view.job.ticketId).toBe(f.ticketId);
    expect(view.job.state).toBe('MERGING');
    expect(view.events).toHaveLength(2);
    expect(view.events[0]!.toState).toBe('AGENT_RUNNING');
    expect(view.events[1]!.toState).toBe('MERGING');
  });

  it('jsonb detail round-trips verbatim (MERGING mergebot shape)', async () => {
    const view = await getPipelineView(f.ticketId);
    const merging = view.events.find((e) => e.toState === 'MERGING');

    expect(merging!.detail).toEqual(MERGING_DETAIL);
  });

  it('caps events at 50 when 60 exist (newest 50 kept, oldest 10 dropped)', async () => {
    // 60 events with staggered createdAt so ordering is deterministic even
    // within the same millisecond.
    const now = Date.now();
    const rows = Array.from({ length: 60 }, (_, i) => ({
      ticketId: f.ticketId,
      fromState: 'QUEUED' as const,
      toState: 'AGENT_RUNNING' as const,
      detail: { seq: i },
      createdAt: new Date(now - (60 - i) * 1000),
    }));
    await db.insert(pipelineEvents).values(rows);

    const view = await getPipelineView(f.ticketId);

    expect(view.events).toHaveLength(MAX_PIPELINE_EVENTS);
    expect(MAX_PIPELINE_EVENTS).toBe(50);
    // Ascending timeline order, and the cap kept the NEWEST 60-seq rows
    // (dropping the oldest). detail is null for rows seeded by the first
    // test, so map seq via optional access and filter to real numbers.
    const seqs = view.events
      .map((e) => (e.detail as { seq?: number } | null)?.seq)
      .filter((s): s is number => typeof s === 'number');
    // 60 seq rows + 2 earlier rows (null detail) — only 48 seq rows fit in
    // the 50-event window, and they are the NEWEST 48 (seq 12..59); seq 0..11
    // were pushed out (10 oldest seq rows + the 2 null-detail ones).
    expect(seqs).toEqual(Array.from({ length: 48 }, (_, i) => i + 12));
  });

  it('ticket with no pipeline row → NOT_FOUND (plain-mode ticket / not queued)', async () => {
    await expect(getPipelineView(f.plainTicketId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      details: { ticketId: f.plainTicketId },
    });
  });
});

describe('SLYK0280 getTicketForUser access check', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  let f: Fixture;

  beforeAll(async () => {
    f = await seedFixture(db);
  });

  afterAll(async () => {
    if (f) {
      await db.delete(tickets).where(eq(tickets.projectId, f.projectId));
      await db.delete(projectSequences).where(eq(projectSequences.projectId, f.projectId));
      await db.delete(projects).where(eq(projects.id, f.projectId));
      await db.delete(users).where(inArray(users.id, [f.member.id, f.outsider.id]));
    }
    await pool.end();
  });

  it('member → returns the ticket', async () => {
    const ticket = await getTicketForUser(f.member, f.ticketId);
    expect(ticket.id).toBe(f.ticketId);
  });

  it('non-member → FORBIDDEN with the non-revealing literal', async () => {
    await expect(getTicketForUser(f.outsider, f.ticketId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      message: 'You do not have access to this project',
    });
  });

  it('unknown ticket → NOT_FOUND', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    await expect(getTicketForUser(f.member, ghost)).rejects.toBeInstanceOf(AppError);
    await expect(getTicketForUser(f.member, ghost)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});
