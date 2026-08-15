// DB integration runs against vitest.config.ts test.env's DATABASE_URL
// (postgresql://test:test@localhost:5432/test). Do NOT dotenv-override to
// backend/.env here: the services under test resolve their own pool from the
// same config, and a file-level override splits seed-vs-read pools whenever
// import order differs (the db/client singleton caches the first URL it saw).
// `make test-api` migrates the test DB (core + agent) before the suite.

import { afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { users, projects, tickets, projectSequences, START_TICKET_NUMBER } from './core';
import {
  pipelineStateEnum,
  onboardingStateEnum,
  messageAuthorRoleEnum,
  agentTokens,
  pipelineJobs,
  pipelineEvents,
  agentMessages,
  onboardingEvents,
  notificationPreferences,
  projectAgentMeta,
} from './agent';

// SLYK-0140 — agent schema integration tests per 04-schema.md "Test fixtures".
// Runs against a real agent-mode DB (SLYKBOARD_AGENT_MODE=true npm run db:migrate).
// Each test creates its own fixture rows and deletes them via the core FK cascade
// (delete project → everything below it disappears), so tests stay independent.

function makeClient(): { db: ReturnType<typeof drizzle>; pool: Pool } {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  return { db, pool };
}

// Drizzle wraps driver errors — match on the serialized cause (pg code 23505 /
// 'duplicate key'), not the outer "Failed query: ..." message. Helper keeps the
// duplicate-rejection assertions on the underlying constraint error.
function duplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  return (
    e?.code === '23505' ||
    e?.cause?.code === '23505' ||
    /duplicate key|unique constraint/i.test(e?.cause?.message ?? e?.message ?? '')
  );
}

const CORE_TABLES = [
  'Users',
  'Projects',
  'project_members',
  'project_sequences',
  'Tickets',
  'Labels',
  'TicketLabels',
  'ActivityLogs',
  'TimeEntries',
  'Comments',
];

const AGENT_TABLES = [
  'AgentTokens',
  'PipelineJobs',
  'PipelineEvents',
  'AgentMessages',
  'OnboardingEvents',
  'NotificationPreferences',
  'ProjectAgentMeta',
];

interface Fixture {
  userId: string;
  projectId: string;
  ticketId: string;
}

// Unique-per-run suffix keeps slug/token hashes collision-free across reruns.
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function seedFixture(db: ReturnType<typeof drizzle>, n: number): Promise<Fixture> {
  const [user] = await db
    .insert(users)
    .values({
      googleId: `agent-schema-${RUN}-${n}`,
      email: `agent-schema-${RUN}-${n}@slykboard.local`,
      fullName: 'Agent Schema Test',
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `Agent Schema ${n}`,
      slug: `agent-schema-${RUN}-${n}`,
      columns: [
        { id: 'col-todo', name: 'To Do' },
        { id: 'col-done', name: 'Done' },
      ],
      creatorId: user!.id,
    })
    .returning();

  await db.insert(projectSequences).values({ projectId: project!.id });

  const [ticket] = await db
    .insert(tickets)
    .values({
      projectId: project!.id,
      ticketNumber: START_TICKET_NUMBER,
      title: `Agent schema ticket ${n}`,
      statusColumn: 'col-todo',
      creatorId: user!.id,
    })
    .returning();

  return { userId: user!.id, projectId: project!.id, ticketId: ticket!.id };
}

describe('SLYK-0140 agent schema', () => {
  const { db, pool } = makeClient();
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    // Defense-in-depth cleanup: fixtures normally self-delete via the project
    // cascade; this catches rows from failed assertions so reruns stay clean.
    // Non-cascading core FKs (Tickets/project_sequences → Projects,
    // Projects.creatorId → Users) require deleting in this order.
    if (createdProjectIds.length) {
      await db.delete(tickets).where(inArray(tickets.projectId, createdProjectIds));
      await db
        .delete(projectSequences)
        .where(inArray(projectSequences.projectId, createdProjectIds));
      await db.delete(projects).where(inArray(projects.id, createdProjectIds));
    }
    if (createdUserIds.length) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    await pool.end();
  });

  // ── 1. Enum values match the spec ──────────────────────────────────────
  it('pipelineStateEnum has all 15 spec values in order', () => {
    expect(pipelineStateEnum.enumValues).toEqual([
      'BACKLOG',
      'QUEUED',
      'AGENT_RUNNING',
      'AGENT_WAITING',
      'PR_OPEN',
      'CI_RUNNING',
      'MERGING',
      'CONFLICT_RETRY',
      'DEPLOYING',
      'DONE',
      'FAILED_AGENT',
      'FAILED_CI',
      'FAILED_CONFLICT',
      'FAILED_DEPLOY',
      'BLOCKED_HUMAN',
    ]);
  });

  it('onboardingStateEnum has all 10 spec values in order', () => {
    expect(onboardingStateEnum.enumValues).toEqual([
      'PENDING',
      'PROVISIONING_LXC',
      'WIRING_GITHUB',
      'WIRING_AGENT',
      'WIRING_ZORAXY',
      'SMOKE_TEST',
      'LIVE',
      'FAILED',
      'DECOMMISSIONING',
      'DECOMMISSIONED',
    ]);
  });

  it('messageAuthorRoleEnum has PM, AGENT, SYSTEM', () => {
    expect(messageAuthorRoleEnum.enumValues).toEqual(['PM', 'AGENT', 'SYSTEM']);
  });

  // ── 2. FK cascades: delete ticket → job + events + messages gone ───────
  it('deleting a ticket cascades to pipeline job, events, and messages', async () => {
    const f = await seedFixture(db, 1);
    createdUserIds.push(f.userId);
    createdProjectIds.push(f.projectId);

    await db.insert(pipelineJobs).values({ ticketId: f.ticketId, projectId: f.projectId });
    await db.insert(pipelineEvents).values({
      ticketId: f.ticketId,
      toState: 'QUEUED',
      detail: { traceId: 't-1', attempt: 0 },
    });
    await db.insert(agentMessages).values([
      { ticketId: f.ticketId, authorRole: 'PM', authorUserId: f.userId, body: 'ping' },
      { ticketId: f.ticketId, authorRole: 'AGENT', body: 'pong', idempotencyKey: `k-${RUN}-1` },
    ]);

    await db.delete(tickets).where(eq(tickets.id, f.ticketId));

    const [job] = await db.select().from(pipelineJobs).where(eq(pipelineJobs.ticketId, f.ticketId));
    const events = await db
      .select()
      .from(pipelineEvents)
      .where(eq(pipelineEvents.ticketId, f.ticketId));
    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.ticketId, f.ticketId));

    expect(job).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  // ── 2b. FK cascades: delete project → meta + onboarding events + prefs ──
  it('deleting a project cascades to meta, onboarding events, notification prefs, tokens', async () => {
    const f = await seedFixture(db, 2);
    createdUserIds.push(f.userId);

    await db.insert(projectAgentMeta).values({
      projectId: f.projectId,
      slug: `agent-meta-${RUN}-2`,
      subdomain: `agent-meta-${RUN}-2`,
      stack: 'node-express',
      teamKey: `AGENT-META-${RUN}-2`.toUpperCase(),
    });
    await db.insert(onboardingEvents).values({
      projectId: f.projectId,
      toState: 'PROVISIONING_LXC',
      detail: { ctid: 101 },
    });
    await db.insert(notificationPreferences).values({ userId: f.userId, projectId: f.projectId });
    await db
      .insert(agentTokens)
      .values({ tokenHash: `hash-${RUN}-2`, name: 'dispatcher-test', projectId: f.projectId });

    // Two core FKs lack ON DELETE CASCADE: project_sequences.projectId and
    // Tickets.projectId (core.ts) — drop them explicitly, then the project
    // delete cascades everything else (meta, events, prefs, tokens, members).
    await db.delete(tickets).where(eq(tickets.projectId, f.projectId));
    await db.delete(projectSequences).where(eq(projectSequences.projectId, f.projectId));
    await db.delete(projects).where(eq(projects.id, f.projectId));

    const [meta] = await db
      .select()
      .from(projectAgentMeta)
      .where(eq(projectAgentMeta.projectId, f.projectId));
    const events = await db
      .select()
      .from(onboardingEvents)
      .where(eq(onboardingEvents.projectId, f.projectId));
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.projectId, f.projectId));
    const [token] = await db
      .select()
      .from(agentTokens)
      .where(eq(agentTokens.tokenHash, `hash-${RUN}-2`));

    expect(meta).toBeUndefined();
    expect(events).toHaveLength(0);
    expect(prefs).toBeUndefined();
    expect(token).toBeUndefined();
  });

  // ── 3. Unique constraints ──────────────────────────────────────────────
  it('rejects a duplicate AgentTokens.tokenHash', async () => {
    const f = await seedFixture(db, 3);
    createdUserIds.push(f.userId);
    createdProjectIds.push(f.projectId);

    await db.insert(agentTokens).values({ tokenHash: `hash-${RUN}-3`, name: 'dispatcher-prod' });

    await expect(
      db.insert(agentTokens).values({ tokenHash: `hash-${RUN}-3`, name: 'dispatcher-clone' }),
    ).rejects.toSatisfy(duplicateKeyError);
  });

  it('rejects a duplicate ProjectAgentMeta.slug', async () => {
    const f = await seedFixture(db, 4);
    createdUserIds.push(f.userId);
    createdProjectIds.push(f.projectId);

    await db.insert(projectAgentMeta).values({
      projectId: f.projectId,
      slug: `agent-meta-${RUN}-4`,
      subdomain: 'sub-a',
      stack: 'node-express',
      teamKey: 'TEAM-A',
    });

    const g = await seedFixture(db, 5);
    createdUserIds.push(g.userId);
    createdProjectIds.push(g.projectId);

    await expect(
      db.insert(projectAgentMeta).values({
        projectId: g.projectId,
        slug: `agent-meta-${RUN}-4`, // same slug, different project
        subdomain: 'sub-b',
        stack: 'next',
        teamKey: 'TEAM-B',
      }),
    ).rejects.toSatisfy(duplicateKeyError);
  });

  // ── 4. Composite PK on NotificationPreferences ─────────────────────────
  it('rejects a second (userId, projectId) prefs row but allows the same user elsewhere', async () => {
    const f = await seedFixture(db, 6);
    createdUserIds.push(f.userId);
    createdProjectIds.push(f.projectId);

    await db.insert(notificationPreferences).values({ userId: f.userId, projectId: f.projectId });
    await expect(
      db.insert(notificationPreferences).values({ userId: f.userId, projectId: f.projectId }),
    ).rejects.toSatisfy(duplicateKeyError);

    const g = await seedFixture(db, 7);
    createdUserIds.push(g.userId);
    createdProjectIds.push(g.projectId);
    // Same user, different project — allowed by the composite PK.
    await db.insert(notificationPreferences).values({ userId: f.userId, projectId: g.projectId });
  });

  // ── 5. Idempotency: duplicate idempotencyKey rejected, NULLs coexist ───
  it('rejects a duplicate AgentMessages.idempotencyKey but allows multiple NULL keys', async () => {
    const f = await seedFixture(db, 8);
    createdUserIds.push(f.userId);
    createdProjectIds.push(f.projectId);

    await db.insert(agentMessages).values({
      ticketId: f.ticketId,
      authorRole: 'AGENT',
      body: 'first delivery',
      idempotencyKey: `idem-${RUN}-8`,
    });

    // Dispatcher retry with the same key must not double-insert.
    await expect(
      db.insert(agentMessages).values({
        ticketId: f.ticketId,
        authorRole: 'AGENT',
        body: 'retry delivery',
        idempotencyKey: `idem-${RUN}-8`,
      }),
    ).rejects.toSatisfy(duplicateKeyError);

    // PM + SYSTEM messages carry NULL keys — many must coexist.
    await db.insert(agentMessages).values([
      { ticketId: f.ticketId, authorRole: 'PM', authorUserId: f.userId, body: 'a' },
      { ticketId: f.ticketId, authorRole: 'SYSTEM', body: 'b' },
    ]);
  });

  // ── 6. Default values ──────────────────────────────────────────────────
  it('applies spec defaults on bare inserts', async () => {
    const f = await seedFixture(db, 9);
    createdUserIds.push(f.userId);
    createdProjectIds.push(f.projectId);

    const [meta] = await db
      .insert(projectAgentMeta)
      .values({
        projectId: f.projectId,
        slug: `agent-meta-${RUN}-9`,
        subdomain: 'defaults',
        stack: 'static',
        teamKey: 'DEFAULTS',
      })
      .returning();
    expect(meta?.sourceMode).toBe('new');
    expect(meta?.onboardingState).toBe('PENDING');
    expect(meta?.githubRepoCreated).toBe(false);

    const [job] = await db
      .insert(pipelineJobs)
      .values({ ticketId: f.ticketId, projectId: f.projectId })
      .returning();
    expect(job?.state).toBe('BACKLOG');
    expect(job?.needsPmAttention).toBe(false);
    expect(job?.priority).toBe(0);
    expect(job?.attempts).toBe(0);

    const g = await seedFixture(db, 10);
    createdUserIds.push(g.userId);
    createdProjectIds.push(g.projectId);
    const [prefs] = await db
      .insert(notificationPreferences)
      .values({ userId: g.userId, projectId: g.projectId })
      .returning();
    expect(prefs?.notifyOnDone).toBe(true);
    expect(prefs?.notifyOnBlockedHuman).toBe(true);
    expect(prefs?.notifyOnAgentWaiting).toBe(true);
  });

  // ── Dual-mode contract: agent tables exist only in agent-mode DBs ──────
  it('the migrated DB has all core tables and all 7 agent tables', async () => {
    const res = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    const names = (res.rows as Array<{ tablename: string }>).map((r) => r.tablename);

    for (const t of CORE_TABLES) {
      expect(names).toContain(t);
    }
    for (const t of AGENT_TABLES) {
      expect(names).toContain(t);
    }
  });
});
