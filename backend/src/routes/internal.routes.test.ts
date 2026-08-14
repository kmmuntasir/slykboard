import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac } from 'node:crypto';
import { ErrorCode } from '../utils/envelope';
import { dispatcherHeaders, signPayload, TEST_DISPATCHER_TOKEN } from '../test/hmac';

// SLYK-0150 — end-to-end supertest coverage for the /api/v1 mount: raw-body
// capture → requireAgentMode → agentTokenAuth (HMAC) → stub routers.
// index.ts reads SLYKBOARD_AGENT_MODE at module scope, so each mode needs a
// fresh module instance (vi.resetModules + dynamic import — same pattern as
// agentModeBoot.test.ts). jose + tokenVersion lookups are mocked so
// `authenticate` works without a DB.

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
}));
// Keep the real pino logger (pino-http needs its internals) but force
// isProd=false — vitest's NODE_ENV=test makes errorMiddleware mask 5xx
// messages, and the 501 stub bodies are the assertion target here.
vi.mock('../config/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/logger')>();
  return { ...actual, isProd: false };
});
// AppError identity across vi.resetModules: errorMiddleware (re-imported per
// boot) checks `err instanceof AppError`. An AppError built from THIS
// module's class instance fails that check after a reset (dual class
// identity → INTERNAL_ERROR 500). Constructing rejections through a
// fresh-module factory keeps both sides on the same class object.
const freshAppError = vi.hoisted(() => ({
  build: null as null | ((code: string, message: string, details?: unknown) => Error),
}));
afterEach(async () => {
  const mod = await import('../utils/appError');
  freshAppError.build = (code, message, details) =>
    new mod.AppError(code as never, message, details !== undefined ? { details } : undefined);
});
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(async () => 0),
  bumpTokenVersion: vi.fn(),
}));
// SLYK-0200 — the onboarding endpoints' service seam. Unit coverage of the
// SQL lives in onboardingEventService.test.ts; here we stub it so the route
// matrix (validation, envelope, auth chain) runs without a live DB.
const onboardingMock = vi.hoisted(() => ({
  recordOnboardingEvent: vi.fn(),
  getDeployTarget: vi.fn(),
}));
vi.mock('../services/onboardingEventService', () => onboardingMock);
// SLYK-0260 — same seam for the job-state endpoint. Transition semantics,
// attempts rule, and side effects live in pipelineJobService.test.ts; here
// we cover the route matrix (validation, envelope, auth chain, error mapping).
const pipelineJobMock = vi.hoisted(() => ({
  updateJobState: vi.fn(),
}));
vi.mock('../services/pipelineJobService', () => pipelineJobMock);

import { SignJWT } from 'jose';
import * as onboardingEventService from '../services/onboardingEventService';
import * as pipelineJobService from '../services/pipelineJobService';

const mockedRecord = vi.mocked(onboardingEventService.recordOnboardingEvent);
const mockedGetDeployTarget = vi.mocked(onboardingEventService.getDeployTarget);
const mockedUpdateJobState = vi.mocked(pipelineJobService.updateJobState);

const secretKey = new TextEncoder().encode(TEST_ENV.jwtSecret);

// Sign a session JWT directly (bypasses the login flow — here we only need
// `authenticate` to verify a well-formed token for the admin chain).
async function sessionToken(isPlatformAdmin: boolean): Promise<string> {
  return new SignJWT({ email: 'admin@example.com', pa: isPlatformAdmin, ver: 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .setIssuedAt()
    .setIssuer('slykboard')
    .setAudience('slykboard-web')
    .setExpirationTime('1h')
    .sign(secretKey);
}

async function bootAgentModeApp(): Promise<Express> {
  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
  vi.stubEnv('SLYKBOARD_DISPATCHER_URL', 'http://localhost:4001');
  vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', TEST_DISPATCHER_TOKEN);
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

describe('agent-mode /api/v1/internal — HMAC auth chain', () => {
  it('unsigned request → 401 UNAUTHENTICATED envelope', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .send({ state: 'QUEUED' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Missing dispatcher signature');
  });

  it('wrong-signature → 401', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .set('Content-Type', 'application/json')
      .set('X-Dispatcher-Signature', signPayload(body, 'b'.repeat(64)))
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Invalid dispatcher signature');
  });

  it('valid signature + body → 200 updated-job envelope (service called with both)', async () => {
    const jobRow = { ticketId: '11111111-1111-4111-8111-111111111111', state: 'QUEUED' };
    mockedUpdateJobState.mockResolvedValue(jobRow as never);
    const app = await bootAgentModeApp();
    const body = {
      state: 'QUEUED',
      detail: { attempt: 1 },
      traceId: '9b7c6d5e-1111-4222-8333-444455556666',
    };
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: jobRow });
    expect(mockedUpdateJobState).toHaveBeenCalledWith({
      ticketId: '11111111-1111-4111-8111-111111111111',
      body,
    });
  });

  it('tampered body after signing → 401 (raw-body capture over exact bytes)', async () => {
    const app = await bootAgentModeApp();
    const signedBody = { state: 'QUEUED' };
    const sentBody = { state: 'DONE' }; // same length, different content
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .set(dispatcherHeaders(signedBody, TEST_DISPATCHER_TOKEN))
      .send(sentBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Invalid dispatcher signature');
  });

  it('valid signature over non-ASCII body → 501 (multi-byte UTF-8 signed verbatim)', async () => {
    const app = await bootAgentModeApp();
    const body = { detail: { note: 'ファイル作成 — émoji 🚀 ünïcødé' } };
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/messages')
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('signature computed over re-serialized (whitespace-differing) body → 401', async () => {
    const app = await bootAgentModeApp();
    const raw = '{"state":"QUEUED"}';
    const sig = createHmac('sha256', TEST_DISPATCHER_TOKEN).update(raw).digest('hex');
    // Send the same JSON with a different shape — a client that re-serialized
    // differently than the server's captured bytes must fail verification.
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .set('Content-Type', 'application/json')
      .set('X-Dispatcher-Signature', sig)
      .send({ state: 'QUEUED', extra: 'field' });

    expect(res.status).toBe(401);
  });

  it('GET deploy-target with valid HMAC over empty body → 200 five-field envelope (SLYK-0200)', async () => {
    mockedGetDeployTarget.mockResolvedValue({
      lxcCtid: 142,
      lanIp: '192.168.31.142',
      systemdService: 'inventory-tracker-backend',
      subdomain: 'inventory-tracker',
      stack: 'node-express',
    });
    const app = await bootAgentModeApp();
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const res = await request(app)
      .get('/api/v1/internal/projects/inventory-tracker/deploy-target')
      .set('X-Dispatcher-Signature', emptySig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        lxcCtid: 142,
        lanIp: '192.168.31.142',
        systemdService: 'inventory-tracker-backend',
        subdomain: 'inventory-tracker',
        stack: 'node-express',
      },
    });
    expect(mockedGetDeployTarget).toHaveBeenCalledWith('inventory-tracker');
  });

  it('unknown internal sub-path still 404s through the auth chain', async () => {
    const app = await bootAgentModeApp();
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const res = await request(app)
      .get('/api/v1/internal/nope')
      .set('X-Dispatcher-Signature', emptySig);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('agent-mode onboarding endpoints (SLYK-0200)', () => {
  const EVENT_PATH = '/api/v1/internal/projects/inventory-tracker/onboarding/events';
  const DEPLOY_PATH = '/api/v1/internal/projects/inventory-tracker/deploy-target';

  const eventRow = {
    id: '44444444-4444-4444-8444-444444444444',
    projectId: '33333333-3333-4333-8333-333333333333',
    fromState: 'SMOKE_TEST',
    toState: 'LIVE',
    detail: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockedRecord.mockReset();
    mockedGetDeployTarget.mockReset();
    mockedRecord.mockResolvedValue(eventRow as never);
    mockedGetDeployTarget.mockResolvedValue({
      lxcCtid: 142,
      lanIp: '192.168.31.142',
      systemdService: 'inventory-tracker-backend',
      subdomain: 'inventory-tracker',
      stack: 'node-express',
    });
  });

  // ── POST /projects/:slug/onboarding/events ──────────────────────────────

  it('signed event POST → 200, service called with validated body', async () => {
    const app = await bootAgentModeApp();
    const body = { fromState: 'SMOKE_TEST', toState: 'LIVE', detail: { ok: true } };
    const res = await request(app)
      .post(EVENT_PATH)
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(eventRow);
    expect(mockedRecord).toHaveBeenCalledWith({
      slug: 'inventory-tracker',
      body: { fromState: 'SMOKE_TEST', toState: 'LIVE', detail: { ok: true } },
    });
  });

  it('fromState: null accepted (first lifecycle event)', async () => {
    const app = await bootAgentModeApp();
    const body = { fromState: null, toState: 'PROVISIONING_LXC' };
    const res = await request(app)
      .post(EVENT_PATH)
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(200);
    expect(mockedRecord).toHaveBeenCalledWith({ slug: 'inventory-tracker', body });
  });

  it('unknown slug (service 404) → 404 NOT_FOUND envelope', async () => {
    mockedRecord.mockRejectedValue(
      freshAppError.build!(ErrorCode.NOT_FOUND, "Project 'ghost' not found", { slug: 'ghost' }),
    );
    const app = await bootAgentModeApp();
    const body = { fromState: null, toState: 'LIVE' };
    const res = await request(app)
      .post('/api/v1/internal/projects/ghost/onboarding/events')
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('invalid toState → 400 VALIDATION_FAILED before the service runs', async () => {
    const app = await bootAgentModeApp();
    const body = { fromState: null, toState: 'NOT_A_STATE' };
    const res = await request(app)
      .post(EVENT_PATH)
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  it('missing toState → 400 VALIDATION_FAILED', async () => {
    const app = await bootAgentModeApp();
    const body = { fromState: null };
    const res = await request(app)
      .post(EVENT_PATH)
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('unsigned event POST → 401 (auth chain still first)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).post(EVENT_PATH).send({ fromState: null, toState: 'LIVE' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedRecord).not.toHaveBeenCalled();
  });

  // Duplicate same-state POSTs are NOT deduped here — the service appends
  // rows by design (append-only log; idempotency is the dispatcher's job).
  it('duplicate same-state POST calls the service again (append-only log)', async () => {
    const app = await bootAgentModeApp();
    const body = { fromState: 'LIVE', toState: 'LIVE' };
    const first = await request(app)
      .post(EVENT_PATH)
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);
    const second = await request(app)
      .post(EVENT_PATH)
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockedRecord).toHaveBeenCalledTimes(2);
  });

  // ── GET /projects/:slug/deploy-target ───────────────────────────────────

  it('LIVE project → 200 with the five deploy fields', async () => {
    mockedGetDeployTarget.mockResolvedValue({
      lxcCtid: 142,
      lanIp: '192.168.31.142',
      systemdService: 'inventory-tracker-backend',
      subdomain: 'inventory-tracker',
      stack: 'node-express',
    });
    const app = await bootAgentModeApp();
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const res = await request(app).get(DEPLOY_PATH).set('X-Dispatcher-Signature', emptySig);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      lxcCtid: 142,
      lanIp: '192.168.31.142',
      systemdService: 'inventory-tracker-backend',
      subdomain: 'inventory-tracker',
      stack: 'node-express',
    });
  });

  it('non-LIVE project (service 409) → 409 CONFLICT envelope', async () => {
    mockedGetDeployTarget.mockRejectedValue(
      freshAppError.build!(ErrorCode.CONFLICT, 'Project is not ready for deploys', {
        slug: 'inventory-tracker',
        onboardingState: 'PROVISIONING_LXC',
      }),
    );
    const app = await bootAgentModeApp();
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const res = await request(app).get(DEPLOY_PATH).set('X-Dispatcher-Signature', emptySig);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({
      slug: 'inventory-tracker',
      onboardingState: 'PROVISIONING_LXC',
    });
  });

  it('unknown slug (service 404) → 404 NOT_FOUND envelope', async () => {
    mockedGetDeployTarget.mockRejectedValue(
      freshAppError.build!(ErrorCode.NOT_FOUND, "Project 'ghost' not found"),
    );
    const app = await bootAgentModeApp();
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const res = await request(app)
      .get('/api/v1/internal/projects/ghost/deploy-target')
      .set('X-Dispatcher-Signature', emptySig);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('unsigned deploy-target GET → 401', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).get(DEPLOY_PATH);

    expect(res.status).toBe(401);
    expect(mockedGetDeployTarget).not.toHaveBeenCalled();
  });
});

describe('agent-mode job-state endpoint (SLYK-0260)', () => {
  const STATE_PATH = (ticketId: string) => `/api/v1/internal/jobs/${ticketId}/state`;
  const TICKET_ID = '11111111-1111-4111-8111-111111111111';

  const jobRow = {
    ticketId: TICKET_ID,
    projectId: '33333333-3333-4333-8333-333333333333',
    state: 'DONE',
    attempts: 0,
    needsPmAttention: false,
  };

  beforeEach(() => {
    mockedUpdateJobState.mockReset();
    mockedUpdateJobState.mockResolvedValue(jobRow as never);
  });

  it('legal transition → 200 with the updated job row', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'DONE' };
    const res = await request(app)
      .post(STATE_PATH(TICKET_ID))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: jobRow });
  });

  // Illegal transitions surface as the dedicated wire code (05-backend-routes
  // § error envelope). Representative cells only — the 15×15 matrix is
  // exhaustively covered in pipelineStateService.test.ts (SLYK-0250).
  it.each([
    { name: 'DONE → MERGING (terminal state)', from: 'DONE', to: 'MERGING' },
    { name: 'same-state replay QUEUED → QUEUED', from: 'QUEUED', to: 'QUEUED' },
    { name: 'over-cap FAILED_AGENT → QUEUED', from: 'FAILED_AGENT', to: 'QUEUED' },
  ])('$name → 400 INVALID_STATE_TRANSITION with {from, to}', async ({ from, to }) => {
    mockedUpdateJobState.mockRejectedValue(
      freshAppError.build!(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot transition from ${from} to ${to}`,
        { from, to },
      ),
    );
    const app = await bootAgentModeApp();
    const body = { state: to };
    const res = await request(app)
      .post(STATE_PATH(TICKET_ID))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(res.body.error.details).toEqual({ from, to });
  });

  it('unknown ticketId (service 404) → 404 NOT_FOUND envelope', async () => {
    mockedUpdateJobState.mockRejectedValue(
      freshAppError.build!(ErrorCode.NOT_FOUND, `Ticket '${TICKET_ID}' is not in the pipeline`),
    );
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(STATE_PATH('22222222-2222-4222-8222-222222222222'))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('bad state string → 400 VALIDATION_FAILED before the service runs', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'NOT_A_STATE' };
    const res = await request(app)
      .post(STATE_PATH(TICKET_ID))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateJobState).not.toHaveBeenCalled();
  });

  it('missing state → 400 VALIDATION_FAILED', async () => {
    const app = await bootAgentModeApp();
    const body = { detail: { x: 1 } };
    const res = await request(app)
      .post(STATE_PATH(TICKET_ID))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('non-uuid ticketId → 400 VALIDATION_FAILED (params schema)', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(STATE_PATH('not-a-uuid'))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateJobState).not.toHaveBeenCalled();
  });

  it('malformed traceId → 400 VALIDATION_FAILED', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED', traceId: 'nope' };
    const res = await request(app)
      .post(STATE_PATH(TICKET_ID))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('unsigned → 401 before the service runs (auth chain first)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).post(STATE_PATH(TICKET_ID)).send({ state: 'QUEUED' });

    expect(res.status).toBe(401);
    expect(mockedUpdateJobState).not.toHaveBeenCalled();
  });

  // 07-dispatcher-contract.md § Retry semantics: slykboard must be idempotent
  // on inbound calls, but the mechanism is "same state twice = illegal
  // self-loop → 400" — the dispatcher dedups upstream (it retries only on
  // lost responses, carrying the same traceId). Documented here so the
  // behavior is pinned, not accidental.
  it('same-state replay is a 400 self-loop, not a silent no-op (dispatcher dedups upstream)', async () => {
    mockedUpdateJobState.mockRejectedValue(
      freshAppError.build!(
        ErrorCode.INVALID_STATE_TRANSITION,
        'Cannot transition from QUEUED to QUEUED',
        { from: 'QUEUED', to: 'QUEUED' },
      ),
    );
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(STATE_PATH(TICKET_ID))
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('plain mode — requireAgentMode gate', () => {
  it('same internal path → 501 "Agent mode is not enabled on this server"', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .send({ state: 'QUEUED' });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
  });

  it('admin path → 501 from requireAgentMode (before authenticate runs)', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app).post('/api/v1/admin/projects').send({});

    expect(res.status).toBe(501);
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
  });

  it('onboarding endpoints → 501 in plain mode even when signed', async () => {
    const app = await bootPlainModeApp();
    const body = { fromState: null, toState: 'LIVE' };
    const eventRes = await request(app)
      .post('/api/v1/internal/projects/inventory-tracker/onboarding/events')
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const deployRes = await request(app)
      .get('/api/v1/internal/projects/inventory-tracker/deploy-target')
      .set('X-Dispatcher-Signature', emptySig);

    expect(eventRes.status).toBe(501);
    expect(eventRes.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(deployRes.status).toBe(501);
    expect(deployRes.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(mockedGetDeployTarget).not.toHaveBeenCalled();
  });
});

describe('agent-mode /api/v1/admin — authenticate + platform admin', () => {
  it('no JWT → 401 UNAUTHENTICATED', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).post('/api/v1/admin/projects').send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('valid non-admin JWT → 403 FORBIDDEN', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(false)}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  // SLYK-0190 implemented the create-project route — an empty body now runs
  // the real Zod validation (400) instead of the old 501 stub. Full behavior
  // coverage (happy path, dispatcher failures, validation table) lives in
  // admin-agent.routes.test.ts with the service + dispatcher client mocked.
  it('valid admin JWT + invalid body → 400 VALIDATION_FAILED (real route)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('admin decommission stub → 501; agent-tokens stub → 501 Phase 5', async () => {
    const app = await bootAgentModeApp();
    const token = await sessionToken(true);

    const decommission = await request(app)
      .post('/api/v1/admin/projects/inventory-tracker/decommission')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmSlug: 'inventory-tracker' });
    expect(decommission.status).toBe(501);
    expect(decommission.body.error.message).toBe('Not implemented until Phase 0.5');

    const tokens = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dispatcher-prod' });
    expect(tokens.status).toBe(501);
    expect(tokens.body.error.message).toBe('Not implemented until Phase 5');
  });
});
