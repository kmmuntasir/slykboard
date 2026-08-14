import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { TEST_DISPATCHER_TOKEN } from '../test/hmac';

// SLYK-0300 — Phase 1 e2e per 10-mock-dispatcher.md § Test integration:
// "bring up the mock on a random port, point slykboard at it via env, drive
// HTTP against slykboard, and assert state changes propagate." Unlike
// internal.routes.test.ts (service seams mocked), this suite runs the REAL
// route→service→repository stack against the real test Postgres
// (backend/vitest.config.ts DATABASE_URL):
//
//   POST /api/projects/:slug/tickets
//     → autoQueueOnCreate: BACKLOG job row + signed ticket_created webhook
//     → live mock acks 202, streams the scenario's state_update.* callbacks
//     → /api/v1/internal/jobs/:ticketId/state applies each transition
//     → job reaches DONE (ticket flips to the Done column) / BLOCKED_HUMAN.
//
// Requires the agent tables in the test DB (make bootstrap / db:migrate).
//
// Boot order breaks the mock↔slykboard URL circularity by reserving
// slykboard's port first (bind :0, read it, close, reuse): the mock needs
// slykboard's URL at buildApp() time, slykboard needs the mock's URL at
// module-load time. The reservation race is a non-issue on loopback with
// Node's default SO_REUSEADDR.
//
// Scenario delays are real product values (500-3000ms/step; blocked-human
// totals ~27s). sleepImpl caps each step at E2E_SLEEP_CAP_MS — ordering and
// per-step pacing are the unit suite's concern; here only propagation order
// and terminal state matter.

const E2E_SLEEP_CAP_MS = 15;
const POLL_INTERVAL_MS = 100;
const TERMINAL_TIMEOUT_MS = 15_000;

// Real pino stays (pino-http internals); force isProd=false so 5xx bodies
// stay legible if a state write is rejected. tokenVersion mocked so
// `authenticate` verifies without a user-row lookup.
vi.mock('../config/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/logger')>();
  return { ...actual, isProd: false };
});
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(async () => 0),
  bumpTokenVersion: vi.fn(),
}));

import { buildApp, loadScenario } from '../../tools/mock-dispatcher/index';
import { db, pool } from '../db/client';
import {
  projectAgentMeta,
  projectMembers,
  projectSequences,
  projects,
  tickets,
  users,
} from '../db/schema';
import { insertProjectInTx } from '../services/projectService';

const JWT_SECRET = 'test-secret-at-least-32-characters-long-aaaa';
const secretKey = new TextEncoder().encode(JWT_SECRET);

// ── Fixture seeding ─────────────────────────────────────────────────────────
// Per-scenario identity: each describe boots a fresh slykboard module, so a
// shared user row would collide on the second scenario's insert.

async function sessionToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email, pa: false, ver: 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('slykboard')
    .setAudience('slykboard-web')
    .setExpirationTime('1h')
    .sign(secretKey);
}

interface E2eProject {
  slug: string;
  projectId: string;
  userId: string;
  doneColumnId: string;
  auth: string;
}

/** Insert user + core project (To Do / In Progress / Done) + membership + LIVE meta. */
async function seedProject(index: number): Promise<E2eProject> {
  const email = `slyk0300-${index}-${randomUUID().slice(0, 8)}@e2e.test`;
  // Core slug format is strict uppercase alphanumerics (F08 D-Slug-Format),
  // unlike the kebab agent slug on ProjectAgentMeta.
  const slug = `E2E${randomUUID()
    .replace(/[^A-Z0-9]/gi, '')
    .slice(0, 10)
    .toUpperCase()}`;
  const [user] = await db
    .insert(users)
    .values({
      googleId: email,
      email,
      fullName: 'E2E Creator',
      displayName: 'E2E Creator',
      isPlatformAdmin: false,
    })
    .returning();
  const doneColumnId = randomUUID();
  // insertProjectInTx = the real creation path: projects row + its
  // projectSequences counter atomically (F12 D1 — ticket numbering needs it)
  // + default columns. Done column id is pinned so the kanban-move assertion
  // can compare against the exact id.
  const project = await db.transaction((tx) =>
    insertProjectInTx(tx, {
      name: `E2E ${slug}`,
      slug,
      columns: [
        { id: randomUUID(), name: 'To Do' },
        { id: randomUUID(), name: 'In Progress' },
        { id: doneColumnId, name: 'Done' }, // last entry = Done (F48 D6)
      ],
      creatorId: user!.id,
    }),
  );
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user!.id, role: 'PROJECT_ADMIN' });
  // LIVE meta so the ticket_created payload carries slug/teamKey/agentBackend
  // (07-dispatcher-contract.md § ticket_created) — the contract shape even
  // though streaming keys on ticket.id alone.
  await db.insert(projectAgentMeta).values({
    projectId: project.id,
    slug,
    subdomain: slug,
    sourceMode: 'new',
    stack: 'node-express',
    teamKey: slug.toUpperCase().replace(/-/g, ''),
    onboardingState: 'LIVE',
  });
  return {
    slug,
    projectId: project.id,
    userId: user!.id,
    doneColumnId,
    auth: `Bearer ${await sessionToken(user!.id, email)}`,
  };
}

// ── Live servers ────────────────────────────────────────────────────────────
// Outbound state-callback statuses recorded via a wrapping fetchImpl — the
// zero-401 acceptance criterion needs an assertion surface beyond the DB.
const stateCallbackStatuses: number[] = [];

function recordingFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init).then((res) => {
    if (url.endsWith('/state')) stateCallbackStatuses.push(res.status);
    return res;
  });
}

const cappedSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, E2E_SLEEP_CAP_MS)));

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Bind :0, read the port, close — reserves an ephemeral port for reuse. */
async function reservePort(): Promise<number> {
  const holder = createServer();
  const port = await listen(holder);
  await new Promise<void>((resolve) => holder.close(() => resolve()));
  return port;
}

// Per-scenario pair: one mock (one process, one scenario — doc 10) + one
// freshly-imported slykboard app (index.ts reads SLYKBOARD_* at load).
let mockServer: Server;
let slykServer: Server;
let project: E2eProject;
let slykPort: number;

async function bootPair(scenarioName: string): Promise<void> {
  const reserved = await reservePort();
  mockServer = createServer(
    buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario(scenarioName),
      slykboardUrl: `http://127.0.0.1:${reserved}`,
      fetchImpl: recordingFetch as never,
      sleepImpl: cappedSleep,
    }),
  );
  const mockPort = await listen(mockServer);

  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
  vi.stubEnv('SLYKBOARD_DISPATCHER_URL', `http://127.0.0.1:${mockPort}`);
  vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', TEST_DISPATCHER_TOKEN);
  vi.resetModules();
  const mod = await import('../index');
  slykServer = createServer(mod.app);
  slykPort = await listen(slykServer, reserved);
}

async function closePair(): Promise<void> {
  await new Promise<void>((resolve) => slykServer.close(() => resolve()));
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  vi.unstubAllEnvs();
  vi.resetModules();
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${slykPort}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: project.auth },
    body: JSON.stringify(body),
  });
}

async function createTicket(): Promise<string> {
  const res = await post(`/api/projects/${project.slug}/tickets`, {
    title: 'Add CSV import',
    description: 'Bulk-import inventory from CSV.',
    priority: 'HIGH',
  });
  const body = (await res.json()) as { data: { id: string } };
  expect(res.status).toBe(201);
  return body.data.id;
}

interface JobRow {
  state: string;
  attempts: number;
}

async function jobRow(ticketId: string): Promise<JobRow | undefined> {
  const { rows } = await pool.query(
    'SELECT state, attempts FROM "PipelineJobs" WHERE ticket_id = $1',
    [ticketId],
  );
  return rows[0] as JobRow | undefined;
}

async function waitForJobState(
  ticketId: string,
  wanted: string[],
  timeoutMs = TERMINAL_TIMEOUT_MS,
): Promise<JobRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await jobRow(ticketId);
    if (row && wanted.includes(row.state)) return row;
    if (Date.now() > deadline) {
      throw new Error(
        `ticket ${ticketId} never reached ${wanted.join('/')} within ${timeoutMs}ms — last: ${JSON.stringify(row)}`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function ticketColumn(ticketId: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT status_column FROM "Tickets" WHERE id = $1', [
    ticketId,
  ]);
  return (rows[0] as { status_column: string | null } | undefined)?.status_column ?? null;
}

async function eventStates(ticketId: string): Promise<string[]> {
  const { rows } = await pool.query(
    'SELECT to_state FROM "PipelineEvents" WHERE ticket_id = $1 ORDER BY created_at ASC, from_state ASC',
    [ticketId],
  );
  return rows.map((r) => r.to_state as string);
}

// ── Suites ──────────────────────────────────────────────────────────────────
let scenarioIndex = 0;

describe.each([
  { scenario: 'happy-path', terminal: 'DONE', attempts: 0 },
  { scenario: 'failed-ci-retry', terminal: 'DONE', attempts: 1 },
  { scenario: 'blocked-human', terminal: 'BLOCKED_HUMAN', attempts: 2 },
])('SLYK-0300 e2e — $scenario → $terminal', ({ scenario, terminal, attempts }) => {
  beforeAll(async () => {
    scenarioIndex += 1;
    project = await seedProject(scenarioIndex);
    await bootPair(scenario);
  });

  afterAll(async () => {
    await closePair();
    // Teardown: Tickets and project_sequences have NO onDelete cascade from
    // Projects (soft-delete model), so they go explicitly first; agent rows
    // (jobs/events/meta) cascade off the ticket/project deletes.
    await db.delete(tickets).where(eq(tickets.projectId, project.projectId));
    await db.delete(projectSequences).where(eq(projectSequences.projectId, project.projectId));
    await db.delete(projects).where(eq(projects.id, project.projectId));
    await db.delete(users).where(eq(users.id, project.userId));
  });

  it('ticket create → mock streams every state → job terminal, ticket moved, zero 401s', async () => {
    const ticketId = await createTicket();

    const job = await waitForJobState(ticketId, [terminal]);
    expect(job.attempts).toBe(attempts);

    // Kanban auto-move on DONE (the last column = Done, F48 D6 convention).
    // BLOCKED_HUMAN leaves the ticket where it was created.
    if (terminal === 'DONE') {
      expect(await ticketColumn(ticketId)).toBe(project.doneColumnId);
    } else {
      expect(await ticketColumn(ticketId)).not.toBe(project.doneColumnId);
    }

    // Every scripted state landed in the append-only event log, in order —
    // the scenario's first step IS the BACKLOG→QUEUED write, so the log is
    // exactly the scenario sequence.
    const states = await eventStates(ticketId);
    const scripted = loadScenario(scenario).ticketCreatedStateSequence!.map((s) => s.state);
    expect(states).toEqual(scripted);

    // Zero-401 acceptance criterion: every outbound state callback the mock
    // made came back 2xx (a 401 would mean a signing break).
    const stateCalls = stateCallbackStatuses.slice(-scripted.length);
    expect(stateCalls).toHaveLength(scripted.length);
    for (const status of stateCalls) {
      expect(status).toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(300);
    }
  });
});

// File teardown: the global pool singleton (db/client.ts) is the ONLY pool —
// the re-imported slykboard modules share it — so one end() closes them all
// and lets the vitest worker exit.
afterAll(async () => {
  await pool.end();
});
