import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCode } from '../utils/envelope';
import { TEST_DISPATCHER_TOKEN } from '../test/hmac';

// SLYK-0280 — end-to-end supertest coverage for the /api/v1/me mount:
// requireAgentMode → authenticate (JWT) → validateRequest → getTicketForUser
// → getPipelineView. index.ts reads SLYKBOARD_AGENT_MODE at module scope, so
// each mode needs a fresh module instance (vi.resetModules + dynamic import —
// same pattern as internal.routes.test.ts). jose + tokenVersion lookups are
// mocked so `authenticate` works without a DB; the two service seams are
// mocked here (SQL coverage lives in pipelineViewService.test.ts).

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
// messages, and the 501 gate message is the assertion target here.
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
// The two service seams. getTicketForUser = access check (404 unknown ticket,
// non-revealing FORBIDDEN non-member); getPipelineView = pipeline read
// (404 no job row). SQL behavior lives in their own test files.
const ticketServiceMock = vi.hoisted(() => ({
  getTicketForUser: vi.fn(),
}));
vi.mock('../services/ticketService', () => ticketServiceMock);
const pipelineViewMock = vi.hoisted(() => ({
  getPipelineView: vi.fn(),
}));
vi.mock('../services/pipelineViewService', () => pipelineViewMock);

import { SignJWT } from 'jose';
import * as ticketService from '../services/ticketService';
import * as pipelineViewService from '../services/pipelineViewService';

const mockedGetTicketForUser = vi.mocked(ticketService.getTicketForUser);
const mockedGetPipelineView = vi.mocked(pipelineViewService.getPipelineView);

const secretKey = new TextEncoder().encode(TEST_ENV.jwtSecret);

// Sign a session JWT directly — `authenticate` only needs a well-formed,
// version-matching token (tokenVersion is mocked to 0 above).
async function sessionToken(isPlatformAdmin: boolean): Promise<string> {
  return new SignJWT({ email: 'pm@example.com', pa: isPlatformAdmin, ver: 0 })
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

describe('agent-mode GET /api/v1/me/tickets/:ticketId/pipeline (SLYK-0280)', () => {
  const TICKET_ID = '11111111-1111-4111-8111-111111111111';
  const PIPELINE_PATH = (ticketId: string) => `/api/v1/me/tickets/${ticketId}/pipeline`;

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
      .get(PIPELINE_PATH(TICKET_ID))
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: view });
    expect(mockedGetTicketForUser).toHaveBeenCalledWith(
      { id: 'u1', email: 'pm@example.com', isPlatformAdmin: false },
      TICKET_ID,
    );
    expect(mockedGetPipelineView).toHaveBeenCalledWith(TICKET_ID);
  });

  it('platform admin bypasses the membership probe (ctx.isPlatformAdmin=true)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH(TICKET_ID))
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(200);
    expect(mockedGetTicketForUser).toHaveBeenCalledWith(
      expect.objectContaining({ isPlatformAdmin: true }),
      TICKET_ID,
    );
  });

  it('unknown ticket (access check 404) → 404 NOT_FOUND before the pipeline read', async () => {
    mockedGetTicketForUser.mockRejectedValue(
      freshAppError.build!(ErrorCode.NOT_FOUND, `Ticket '${TICKET_ID}' not found`, {
        ticketId: TICKET_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH(TICKET_ID))
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('non-member (access check FORBIDDEN) → 403 non-revealing envelope', async () => {
    mockedGetTicketForUser.mockRejectedValue(
      freshAppError.build!(ErrorCode.FORBIDDEN, 'You do not have access to this project'),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH(TICKET_ID))
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('You do not have access to this project');
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('no pipeline row (plain-mode ticket / not queued) → 404 NOT_FOUND', async () => {
    mockedGetPipelineView.mockRejectedValue(
      freshAppError.build!(ErrorCode.NOT_FOUND, `Ticket '${TICKET_ID}' is not in the pipeline`, {
        ticketId: TICKET_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH(TICKET_ID))
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe(`Ticket '${TICKET_ID}' is not in the pipeline`);
  });

  it('non-uuid ticketId → 400 VALIDATION_FAILED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get(PIPELINE_PATH('not-a-uuid'))
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('no JWT → 401 UNAUTHENTICATED before any service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).get(PIPELINE_PATH(TICKET_ID));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('unknown /api/v1/me sub-path still 404s through the auth chain', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/me/nope')
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('plain mode — /api/v1/me requireAgentMode gate (SLYK-0280)', () => {
  it('pipeline path → 501 "Agent mode is not enabled on this server" even with a valid JWT', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .get('/api/v1/me/tickets/11111111-1111-4111-8111-111111111111/pipeline')
      .set('Authorization', `Bearer ${await sessionToken(false)}`);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedGetTicketForUser).not.toHaveBeenCalled();
    expect(mockedGetPipelineView).not.toHaveBeenCalled();
  });

  it('pipeline path → 501 even without a JWT (gate before authenticate)', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app).get(
      '/api/v1/me/tickets/11111111-1111-4111-8111-111111111111/pipeline',
    );

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
