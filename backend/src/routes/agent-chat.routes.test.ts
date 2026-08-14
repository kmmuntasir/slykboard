import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// SLYK-0270/0280 — end-to-end coverage for the /api/v1/me mount.
// Route matrix (headers, 401/501, 404 access check) rides supertest like
// internal.routes.test.ts. The streaming assertions (state frame delivery,
// heartbeat, 50-cycle no-leak) need a REAL socket — supertest buffers the
// whole body and never fires 'close' the way a browser does — so those boot
// the app on an ephemeral http.Server and speak raw HTTP over a socket.

const { TEST_ENV } = vi.hoisted(() => ({
  TEST_ENV: {
    port: 3000,
    frontendUrl: 'http://localhost:5173',
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    jwtSecret: 'test-jwt-secret-test-jwt-secret-0000',
    jwtTtl: '8h',
    googleClientId: 'test-client-id.apps.googleusercontent.com',
    googleClientSecret: 'test-client-secret',
    googleCallbackUrl: 'postmessage',
    allowedDomain: undefined as string | undefined,
  },
}));

vi.mock('../config', () => ({
  env: TEST_ENV,
  // index.ts re-exports runtimeConfig from './config' — supply the shape it reads.
  runtimeConfig: { agentMode: true },
  SCHEMA_VERSION: 2,
}));
// Keep the real pino logger (pino-http needs its internals) but force
// isProd=false — vitest's NODE_ENV=test makes errorMiddleware mask 5xx
// messages, and the 501/401 bodies are assertion targets here.
vi.mock('../config/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/logger')>();
  return { ...actual, isProd: false };
});
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(async () => 0),
  bumpTokenVersion: vi.fn(),
}));

// Service seams: getTicketForUser = access check (404 unknown/non-member);
// getPipelineView = pipeline read (404 no job row). SSE delivery itself is
// covered against the real emitter below. Mocked here so the route matrix
// runs without a DB.
const ticketServiceMock = vi.hoisted(() => ({
  getTicketForUser: vi.fn(),
}));
vi.mock('../services/ticketService', () => ticketServiceMock);
const pipelineViewMock = vi.hoisted(() => ({
  getPipelineView: vi.fn(),
}));
vi.mock('../services/pipelineViewService', () => pipelineViewMock);
vi.mock('../services/pipelineViewService', () => pipelineViewMock);
// SLYK-0290 — the queue endpoint's service seam. SQL/state-machine behavior
// lives in ticketAgentService.test.ts; here we assert the route wiring only.
const ticketAgentMock = vi.hoisted(() => ({
  queueForAgent: vi.fn(),
}));
vi.mock('../services/ticketAgentService', () => ticketAgentMock);
// SLYK-0230 — the timeline read seam (SQL coverage lives in
// onboardingEventService.test.ts).
const onboardingEventServiceMock = vi.hoisted(() => ({
  getOnboardingTimeline: vi.fn(),
}));
vi.mock('../services/onboardingEventService', () => onboardingEventServiceMock);

// AppError identity across vi.resetModules: errorMiddleware (re-imported per
// boot) checks `err instanceof AppError`, so a rejection built from THIS
// module's class instance would fail the check (dual class identity →
// INTERNAL_ERROR 500). Constructing rejections through a fresh-module factory —
// same pattern as internal.routes.test.ts.
const freshAppError = vi.hoisted(() => ({
  build: null as null | ((code: string, message: string, details?: unknown) => Error),
}));

import { SignJWT } from 'jose';
import * as ticketService from '../services/ticketService';
import * as pipelineViewService from '../services/pipelineViewService';
import * as ticketAgentService from '../services/ticketAgentService';
import * as onboardingEventService from '../services/onboardingEventService';

afterEach(async () => {
  const mod = await import('../utils/appError');
  freshAppError.build = (code, message, details) =>
    new mod.AppError(code as never, message, details !== undefined ? { details } : undefined);
});

const mockedGetTicketForUser = vi.mocked(ticketService.getTicketForUser);
const mockedGetPipelineView = vi.mocked(pipelineViewService.getPipelineView);
const mockedQueueForAgent = vi.mocked(ticketAgentService.queueForAgent);
const mockedGetOnboardingTimeline = vi.mocked(onboardingEventService.getOnboardingTimeline);

const secretKey = new TextEncoder().encode(TEST_ENV.jwtSecret);

const PM = {
  id: 'u-pm',
  email: 'pm@example.com',
  isPlatformAdmin: false,
};
const OUTSIDER = {
  id: 'u-outsider',
  email: 'outsider@example.com',
  isPlatformAdmin: false,
};
const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const TRACE_ID = '9b7c6d5e-1111-4222-8333-444455556666';
const EVENTS_PATH = `/api/v1/me/tickets/${TICKET_ID}/events`;
const PIPELINE_PATH = `/api/v1/me/tickets/${TICKET_ID}/pipeline`;

async function sessionToken(user: typeof PM): Promise<string> {
  return new SignJWT({ email: user.email, pa: user.isPlatformAdmin, ver: 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer('slykboard')
    .setAudience('slykboard-web')
    .setExpirationTime('1h')
    .sign(secretKey);
}

async function bootAgentModeApp(): Promise<Express> {
  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
  vi.stubEnv('SLYKBOARD_DISPATCHER_URL', 'http://localhost:4001');
  vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', 'b'.repeat(64));
  const mod = await import('../index');
  return mod.app;
}

async function bootPlainModeApp(): Promise<Express> {
  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'false');
  const mod = await import('../index');
  return mod.app;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ── SLYK-0280: pipeline read (supertest) ───────────────────────────────────

describe('agent-mode GET /api/v1/me/tickets/:ticketId/pipeline (SLYK-0280)', () => {
  // Envelope shape per 05-backend-routes.md § me/tickets/:id/pipeline — full
  // job + event rows (internal.routes.ts returns full rows the same way),
  // wrapped in success() like every agent route.
  const view = {
    job: {
      ticketId: TICKET_ID,
      projectId: '33333333-3333-4333-8333-333333333333',
      state: 'MERGING',
      attempts: 0,
      githubPrNumber: 123,
      githubPrSha: 'abc1234',
      traceId: '9b7c6d5e-1111-4222-8333-444455556666',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    events: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        ticketId: TICKET_ID,
        fromState: 'PR_OPEN',
        toState: 'CI_RUNNING',
        detail: { durationMs: 4123 },
        traceId: '9b7c6d5e-1111-4222-8333-444455556666',
        createdAt: '2026-08-13T00:00:01.000Z',
      },
    ],
  };

  beforeEach(() => {
    mockedGetTicketForUser.mockReset();
    mockedGetPipelineView.mockReset();
    mockedGetTicketForUser.mockResolvedValue({ id: TICKET_ID } as never);
    mockedGetPipelineView.mockResolvedValue(view as never);
  });

  it('member → 200 { data: { job, events } } envelope, both services called with the ticketId', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: view });
    expect(mockedGetTicketForUser).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      userId: PM.id,
      isPlatformAdmin: false,
    });
    expect(mockedGetPipelineView).toHaveBeenCalledWith(TICKET_ID);
  });

  it('platform admin bypasses the membership probe (isPlatformAdmin=true)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH)
      .set('Authorization', `Bearer ${await sessionToken({ ...PM, isPlatformAdmin: true })}`);

    expect(res.status).toBe(200);
    expect(mockedGetTicketForUser).toHaveBeenCalledWith(
      expect.objectContaining({ isPlatformAdmin: true }),
    );
  });

  it('unknown ticket (access check 404) → 404 NOT_FOUND before the pipeline read', async () => {
    mockedGetTicketForUser.mockRejectedValue(
      freshAppError.build!('NOT_FOUND', `Ticket '${TICKET_ID}' not found`, {
        ticketId: TICKET_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('non-member (outsider) → 404 NOT_FOUND, indistinguishable from unknown ticket', async () => {
    mockedGetTicketForUser.mockRejectedValue(freshAppError.build!('NOT_FOUND', 'Ticket not found'));
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(OUTSIDER)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('no pipeline row (plain-mode ticket / not queued) → 404 NOT_FOUND', async () => {
    mockedGetPipelineView.mockRejectedValue(
      freshAppError.build!('NOT_FOUND', `Ticket '${TICKET_ID}' is not in the pipeline`, {
        ticketId: TICKET_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe(`Ticket '${TICKET_ID}' is not in the pipeline`);
  });

  it('non-uuid ticketId → 400 VALIDATION_FAILED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/me/tickets/not-a-uuid/pipeline')
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('no JWT → 401 UNAUTHENTICATED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).get(PIPELINE_PATH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('unknown /api/v1/me sub-path still 404s through the auth chain', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/me/nope')
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('plain mode — /api/v1/me requireAgentMode gate', () => {
  it('pipeline path → 501 "Agent mode is not enabled on this server" even with a valid JWT', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('pipeline path → 501 even without a JWT (gate before authenticate)', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app).get(PIPELINE_PATH);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('onboarding-events path → 501 before any service runs (SLYK-0230)', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app).get('/api/v1/me/projects/inventory-tracker/onboarding/events');

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(mockedGetOnboardingTimeline).not.toHaveBeenCalled();
  });
});

// SLYK-0230 — the doc-gap timeline read (06-frontend-ui.md polls it; this is
// the endpoint 05-backend-routes.md never defined). Same mount/auth chain as
// the pipeline GET above.
describe('agent-mode GET /api/v1/me/projects/:slug/onboarding/events (SLYK-0230)', () => {
  const SLUG = 'inventory-tracker';
  const PATH = `/api/v1/me/projects/${SLUG}/onboarding/events`;

  const view = {
    project: {
      name: 'Inventory Tracker',
      slug: SLUG,
      onboardingState: 'PROVISIONING_LXC',
      onboardingError: null,
    },
    events: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        projectId: '33333333-3333-4333-8333-333333333333',
        fromState: null,
        toState: 'PENDING',
        detail: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
      {
        id: '45454545-4545-4545-8555-454545454545',
        projectId: '33333333-3333-4333-8333-333333333333',
        fromState: 'PENDING',
        toState: 'PROVISIONING_LXC',
        detail: { ctid: 142, lanIp: '192.168.31.142' },
        createdAt: '2026-08-13T00:00:01.000Z',
      },
    ],
  };

  beforeEach(() => {
    mockedGetOnboardingTimeline.mockReset();
    mockedGetOnboardingTimeline.mockResolvedValue(view as never);
  });

  it('member → 200 { data: { project, events } } envelope, service called with the slug', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: view });
    expect(mockedGetOnboardingTimeline).toHaveBeenCalledWith(SLUG);
  });

  it('platform admin → 200 (same read; UI gates to admins but the route is member-scoped)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PATH)
      .set('Authorization', `Bearer ${await sessionToken({ ...PM, isPlatformAdmin: true })}`);

    expect(res.status).toBe(200);
    expect(res.body.data.project.slug).toBe(SLUG);
  });

  it('unknown slug → 404 NOT_FOUND envelope from the service', async () => {
    mockedGetOnboardingTimeline.mockRejectedValue(
      freshAppError.build!('NOT_FOUND', `Project 'ghost' not found`, { slug: 'ghost' }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/me/projects/ghost/onboarding/events')
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('uppercase slug fails the kebab pattern → 400 VALIDATION_FAILED before the service', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/me/projects/InventoryTracker/onboarding/events')
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetOnboardingTimeline).not.toHaveBeenCalled();
  });

  it('no JWT → 401 UNAUTHENTICATED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).get(PATH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetOnboardingTimeline).not.toHaveBeenCalled();
  });
});

// ── SLYK-0270: SSE route matrix (supertest) ────────────────────────────────

describe('GET /api/v1/me/tickets/:id/events — route matrix', () => {
  beforeEach(() => {
    mockedGetTicketForUser.mockReset();
    mockedGetTicketForUser.mockResolvedValue({ id: TICKET_ID } as never);
  });

  it('unauthenticated → 401 envelope before the stream opens', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).get(EVENTS_PATH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
  });

  it('plain mode → 501 NOT_IMPLEMENTED (requireAgentMode gate)', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .get(EVENTS_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
  });

  it('non-uuid :id → 400 VALIDATION_FAILED before auth or access check', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/me/tickets/not-a-uuid/events')
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
  });

  it('unknown ticket → 404 NOT_FOUND (never opens the stream)', async () => {
    mockedGetTicketForUser.mockRejectedValue(freshAppError.build!('NOT_FOUND', 'Ticket not found'));
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(EVENTS_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('non-member (outsider) → 404 NOT_FOUND, indistinguishable from unknown ticket', async () => {
    mockedGetTicketForUser.mockRejectedValue(freshAppError.build!('NOT_FOUND', 'Ticket not found'));
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(EVENTS_PATH)
      .set('Authorization', `Bearer ${await sessionToken(OUTSIDER)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // Byte-identical body to the unknown-ticket case — the anti-oracle.
    expect(res.body.error.message).toBe('Ticket not found');
    expect(mockedGetTicketForUser).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      userId: OUTSIDER.id,
      isPlatformAdmin: false,
    });
  });
});

// ── Streaming behavior (real socket — supertest buffers, browsers don't) ──

/** Boot the app on an ephemeral port; resolve with server + base URL. */
async function bootServer(): Promise<{ server: http.Server; url: string }> {
  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
  vi.stubEnv('SLYKBOARD_DISPATCHER_URL', 'http://localhost:4001');
  vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', 'b'.repeat(64));
  const mod = await import('../index');
  const server = http.createServer(mod.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

/** Open a raw SSE connection; `opened` resolves with the first chunk. */
interface SseStream {
  chunks: string[];
  close: () => void;
  opened: Promise<string>;
  ended: boolean;
  status: number;
  headers: http.IncomingHttpHeaders;
}

function openStream(url: string, token: string): SseStream {
  const chunks: string[] = [];
  let status = 0;
  let ended = false;
  let headers: http.IncomingHttpHeaders = {};
  let resolveOpened!: (first: string) => void;
  const opened = new Promise<string>((resolve) => {
    resolveOpened = resolve;
  });
  const req = http.get(`${url}${EVENTS_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  req.on('response', (res) => {
    status = res.statusCode ?? 0;
    headers = res.headers;
    res.on('data', (c: Buffer) => {
      const text = c.toString();
      chunks.push(text);
      if (text.includes('retry: 5000')) resolveOpened(chunks.join(''));
    });
    res.on('end', () => {
      ended = true;
    });
  });
  return {
    chunks,
    close: () => req.destroy(),
    opened,
    get ended() {
      return ended;
    },
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
  };
}

describe('GET /api/v1/me/tickets/:id/events — streaming (real socket)', () => {
  beforeEach(() => {
    mockedGetTicketForUser.mockReset();
    mockedGetTicketForUser.mockResolvedValue({ id: TICKET_ID } as never);
  });

  it('member → 200 with the SSE headers + retry hint (stream opens)', async () => {
    const { server, url } = await bootServer();
    const stream = openStream(url, await sessionToken(PM));

    expect(await stream.opened).toContain('retry: 5000');
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.headers['cache-control']).toBe('no-cache');
    expect(stream.headers['connection']).toBe('keep-alive');
    expect(stream.headers['x-accel-buffering']).toBe('no');
    expect(mockedGetTicketForUser).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      userId: PM.id,
      isPlatformAdmin: false,
    });

    stream.close();
    server.close();
  });

  it('a state change via the SIGNED internal route produces an event: state frame on the connected client (same process)', async () => {
    // Acceptance criterion: "State transition via internal endpoint appears
    // as SSE frame within the same process." This runs the REAL chain —
    // HMAC verify → validateRequest → pipelineJobService.updateJobState →
    // sseEmit → per-ticket fan-out — with only the Drizzle layer faked
    // (the same fluent-tx mock shape as pipelineJobService.test.ts).
    const { server, url } = await bootServer();
    const sseEmitter = await import('../services/sseEmitter');
    const token = await sessionToken(PM);
    const stream = openStream(url, token);
    await stream.opened;
    expect(sseEmitter.listenerCount(TICKET_ID)).toBe(1);

    // Minimal tx fake: updateJobState only needs the job load to resolve a
    // current row; the writes are irrelevant to the SSE assertion.
    const fakeTx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ ticketId: TICKET_ID, state: 'BACKLOG', attempts: 0 }],
          }),
        }),
      }),
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    };
    const dbMod = await import('../db/client');
    const dbMock = dbMod as unknown as { db: { transaction: unknown } };
    const realTransaction = dbMock.db.transaction;
    dbMock.db.transaction = async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx);
    try {
      const { createHmac } = await import('node:crypto');
      const body = JSON.stringify({ state: 'QUEUED', traceId: TRACE_ID });
      const signature = createHmac('sha256', 'b'.repeat(64)).update(body).digest('hex');
      const res = await fetch(`${url}/api/v1/internal/jobs/${TICKET_ID}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dispatcher-Signature': signature,
        },
        body,
      });
      expect(res.status).toBe(200);

      await vi.waitFor(() => {
        const body = stream.chunks.join('');
        expect(body).toContain('event: state\n');
        expect(body).toContain(`data: {"state":"QUEUED","traceId":"${TRACE_ID}"}`);
      });
    } finally {
      dbMock.db.transaction = realTransaction;
      stream.close();
    }
    server.close();
  });

  it('client disconnect unsubscribes — no listener leak across 50 connect/disconnect cycles', async () => {
    const { server, url } = await bootServer();
    const sseEmitter = await import('../services/sseEmitter');
    const token = await sessionToken(PM);

    for (let i = 0; i < 50; i += 1) {
      const stream = openStream(url, token);
      await stream.opened;
      await vi.waitFor(() => {
        expect(sseEmitter.listenerCount(TICKET_ID)).toBe(1);
      });
      stream.close();
      // req 'close' handler runs on the server side synchronously with the
      // socket teardown; wait for the unsubscribe to land before reconnecting.
      await vi.waitFor(() => {
        expect(sseEmitter.listenerCount(TICKET_ID)).toBe(0);
      });
    }

    expect(sseEmitter.listenerCount(TICKET_ID)).toBe(0);
    server.close();
  });

  it('heartbeat : ping every 15s (fake timers)', async () => {
    const { SSE_HEARTBEAT_MS } = await import('./agent-chat.routes');
    // Fake timers must be live BEFORE the connection: the route schedules its
    // setInterval while handling the request, and vitest only intercepts
    // timers created while fakes are installed.
    vi.useFakeTimers();
    try {
      const { server, url } = await bootServer();
      const stream = openStream(url, await sessionToken(PM));
      await stream.opened;

      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);
      await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);

      // Three ticks → three pings, one per 15s window.
      const pings = stream.chunks.join('').match(/: ping/g);
      expect(pings?.length).toBe(3);

      stream.close();
      server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('idle connection is closed by the server after 5 min', async () => {
    const { SSE_IDLE_TIMEOUT_MS } = await import('./agent-chat.routes');
    // Fake timers before connecting — see the heartbeat test's note.
    vi.useFakeTimers();
    let server: http.Server | undefined;
    try {
      const booted = await bootServer();
      server = booted.server;
      const stream = openStream(booted.url, await sessionToken(PM));
      await stream.opened;

      // Just under the ceiling: still open.
      await vi.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS - 1_000);
      expect(stream.chunks.join('').match(/: ping/g)?.length).toBeGreaterThan(0);

      // Crossing it fires res.end() → the client response completes.
      await vi.advanceTimersByTimeAsync(SSE_IDLE_TIMEOUT_MS + 1_000);
      await vi.waitFor(() => {
        expect(stream.ended).toBe(true);
      });

      // Both timers cleared by the close handler: no listener remains.
      const sseEmitter = await import('../services/sseEmitter');
      await vi.waitFor(() => {
        expect(sseEmitter.listenerCount(TICKET_ID)).toBe(0);
      });
      stream.close();
    } finally {
      vi.useRealTimers();
      server?.close();
    }
  });
});

// ── SLYK-0290: queue endpoint (supertest) ──────────────────────────────────

describe('agent-mode POST /api/v1/me/tickets/:ticketId/queue (SLYK-0290)', () => {
  const QUEUE_PATH = `/api/v1/me/tickets/${TICKET_ID}/queue`;

  const queuedJob = {
    ticketId: TICKET_ID,
    projectId: '33333333-3333-4333-8333-333333333333',
    state: 'QUEUED',
    attempts: 0,
    traceId: '9b7c6d5e-1111-4222-8333-444455556666',
  };

  beforeEach(() => {
    mockedGetTicketForUser.mockReset();
    mockedQueueForAgent.mockReset();
    mockedGetTicketForUser.mockResolvedValue({ id: TICKET_ID } as never);
    mockedQueueForAgent.mockResolvedValue(queuedJob as never);
  });

  it('member → 200 { data: job } with state QUEUED, both services called with the ticketId', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post(QUEUE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: queuedJob });
    expect(mockedGetTicketForUser).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      userId: PM.id,
      isPlatformAdmin: false,
    });
    expect(mockedQueueForAgent).toHaveBeenCalledWith(TICKET_ID);
  });

  it('unknown ticket (access check 404) → 404 NOT_FOUND before the queue service runs', async () => {
    mockedGetTicketForUser.mockRejectedValue(
      freshAppError.build!('NOT_FOUND', `Ticket '${TICKET_ID}' not found`, {
        ticketId: TICKET_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post(QUEUE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedQueueForAgent).not.toHaveBeenCalled();
  });

  it('non-member (outsider) → 404 NOT_FOUND, indistinguishable from unknown ticket', async () => {
    mockedGetTicketForUser.mockRejectedValue(freshAppError.build!('NOT_FOUND', 'Ticket not found'));
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post(QUEUE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(OUTSIDER)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedQueueForAgent).not.toHaveBeenCalled();
  });

  it('no job row → 404 NOT_FOUND ("is not in the pipeline")', async () => {
    mockedQueueForAgent.mockRejectedValue(
      freshAppError.build!('NOT_FOUND', `Ticket '${TICKET_ID}' is not in the pipeline`, {
        ticketId: TICKET_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post(QUEUE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe(`Ticket '${TICKET_ID}' is not in the pipeline`);
  });

  it('illegal source state (e.g. QUEUED ticket) → 409 CONFLICT with {from, to} details', async () => {
    mockedQueueForAgent.mockRejectedValue(
      freshAppError.build!('CONFLICT', 'Cannot transition from QUEUED to QUEUED', {
        from: 'QUEUED',
        to: 'QUEUED',
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post(QUEUE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ from: 'QUEUED', to: 'QUEUED' });
  });

  it('non-uuid ticketId → 400 VALIDATION_FAILED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/me/tickets/not-a-uuid/queue')
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedQueueForAgent).not.toHaveBeenCalled();
  });

  it('no JWT → 401 UNAUTHENTICATED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).post(QUEUE_PATH);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedQueueForAgent).not.toHaveBeenCalled();
  });

  it('plain mode → 501 NOT_IMPLEMENTED from requireAgentMode (no services run)', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .post(QUEUE_PATH)
      .set('Authorization', `Bearer ${await sessionToken(PM)}`);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedQueueForAgent).not.toHaveBeenCalled();
  });
});
