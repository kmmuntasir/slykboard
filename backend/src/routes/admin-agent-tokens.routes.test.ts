import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac } from 'node:crypto';
import { ErrorCode } from '../utils/envelope';
import { TEST_DISPATCHER_TOKEN } from '../test/hmac';

// SLYK-0370 — end-to-end supertest coverage for the agent-token trio
// (POST/GET/DELETE /api/v1/admin/agent-tokens) and the dual-source
// agentTokenAuth round-trip: generate → sign internal call with the DB
// token → 200; revoke → 401; env token still works. Service DB seams are
// mocked here (unit SQL coverage lives in agentTokenService.test.ts);
// index.ts reads SLYKBOARD_AGENT_MODE at module scope → fresh module per
// mode (vi.resetModules + dynamic import — admin-agent.routes.test.ts
// pattern). Config is NOT mocked — env vars are stubbed per boot, which
// also satisfies SLYK-0130 agent-mode env validation.

// Force isProd=false so errorMiddleware keeps 5xx messages (assertion target).
vi.mock('../config/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/logger')>();
  return { ...actual, isProd: false };
});
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(async () => 0),
  bumpTokenVersion: vi.fn(),
}));

// The service's DB seams — everything below the routes is stubbed here.
// hashToken stays REAL (pure node:crypto) — the middleware and this test
// must agree on the digest of a mocked raw token.
const serviceMock = vi.hoisted(() => ({
  createAgentToken: vi.fn(),
  listAgentTokens: vi.fn(),
  revokeAgentToken: vi.fn(),
  listActiveTokenHashes: vi.fn(),
}));
vi.mock('../services/agentTokenService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agentTokenService')>();
  return { ...actual, ...serviceMock };
});

import { SignJWT } from 'jose';
import * as agentTokenService from '../services/agentTokenService';
import { hashToken } from '../services/agentTokenService';

const mockedCreate = vi.mocked(agentTokenService.createAgentToken);
const mockedList = vi.mocked(agentTokenService.listAgentTokens);
const mockedRevoke = vi.mocked(agentTokenService.revokeAgentToken);
const mockedActiveHashes = vi.mocked(agentTokenService.listActiveTokenHashes);

// Must match backend/vitest.config.ts JWT_SECRET — the real config reads it.
const JWT_SECRET = 'test-secret-at-least-32-characters-long-aaaa';
const secretKey = new TextEncoder().encode(JWT_SECRET);

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

// appError identity across vi.resetModules — build fresh-module AppErrors
// (same pattern as admin-agent.routes.test.ts).
const freshAppError = vi.hoisted(() => ({
  build: null as null | ((code: string, message: string, details?: unknown) => Error),
}));
async function refreshAppErrorFactory(): Promise<void> {
  const mod = await import('../utils/appError');
  freshAppError.build = (code, message, details) =>
    new mod.AppError(code as never, message, details !== undefined ? { details } : undefined);
}
beforeEach(refreshAppErrorFactory);
afterEach(refreshAppErrorFactory);

const TOKEN_ID = '55555555-5555-4555-8555-555555555555';
const TICKET_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  mockedCreate.mockReset();
  mockedList.mockReset();
  mockedRevoke.mockReset();
  mockedActiveHashes.mockReset();
  // Default: no DB tokens — env-only auth (path 1) unless a test seeds rows.
  mockedActiveHashes.mockResolvedValue([]);
});

// ── POST /api/v1/admin/agent-tokens ────────────────────────────────────────

describe('POST /api/v1/admin/agent-tokens — generate', () => {
  it('admin JWT + valid body → 201 {data: {token, id, name}}; createdBy from req.user', async () => {
    mockedCreate.mockResolvedValue({
      token: 'c'.repeat(64),
      id: TOKEN_ID,
      name: 'dispatcher-prod',
    });
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({ name: 'dispatcher-prod', projectId: null });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      data: { token: 'c'.repeat(64), id: TOKEN_ID, name: 'dispatcher-prod' },
    });
    expect(mockedCreate).toHaveBeenCalledWith({
      body: { name: 'dispatcher-prod', projectId: null },
      createdBy: 'u1',
    });
  });

  it.each([
    { name: 'missing name', body: { projectId: null } },
    { name: 'empty name', body: { name: '', projectId: null } },
    { name: 'name > 200 chars', body: { name: 'x'.repeat(201), projectId: null } },
    { name: 'missing projectId', body: { name: 'dispatcher-prod' } },
    { name: 'non-uuid projectId', body: { name: 'dispatcher-prod', projectId: 'not-a-uuid' } },
    { name: 'name not a string', body: { name: 42, projectId: null } },
  ])('$name → 400 VALIDATION_FAILED, service never called', async ({ body }) => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('scoped projectId (uuid) passes validation', async () => {
    mockedCreate.mockResolvedValue({ token: 'c'.repeat(64), id: TOKEN_ID, name: 'scoped' });
    const app = await bootAgentModeApp();
    const projectId = '33333333-3333-4333-8333-333333333333';
    const res = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({ name: 'scoped', projectId });

    expect(res.status).toBe(201);
    expect(mockedCreate).toHaveBeenCalledWith({
      body: { name: 'scoped', projectId },
      createdBy: 'u1',
    });
  });

  // AC: duplicate names are allowed (not unique per schema) — the route has
  // no name-uniqueness gate; the service insert is the only write.
  it('duplicate name generates a second token (no uniqueness gate at the route)', async () => {
    mockedCreate.mockResolvedValue({
      token: 'd'.repeat(64),
      id: TOKEN_ID,
      name: 'dispatcher-prod',
    });
    const app = await bootAgentModeApp();
    const token = await sessionToken(true);
    const first = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dispatcher-prod', projectId: null });
    const second = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dispatcher-prod', projectId: null });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });

  it('no JWT → 401 UNAUTHENTICATED', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .send({ name: 'x', projectId: null });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('non-admin JWT → 403 FORBIDDEN, service never called', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(false)}`)
      .send({ name: 'x', projectId: null });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('plain mode → 501 NOT_IMPLEMENTED from requireAgentMode', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({ name: 'x', projectId: null });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

// ── GET /api/v1/admin/agent-tokens ─────────────────────────────────────────

describe('GET /api/v1/admin/agent-tokens — list', () => {
  it('returns rows WITHOUT hash fields ({data: [...]})', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    mockedList.mockResolvedValue([
      {
        id: TOKEN_ID,
        name: 'dispatcher-prod',
        projectId: null,
        createdBy: 'u1',
        revokedAt: null,
        createdAt,
      },
    ]);
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(200);
    // Wire form: dates ISO-serialized by res.json.
    expect(res.body).toEqual({
      data: [
        {
          id: TOKEN_ID,
          name: 'dispatcher-prod',
          projectId: null,
          createdBy: 'u1',
          revokedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    // Hashes never leave the DB — assert on the serialized wire form too.
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('empty table → 200 {data: []}', async () => {
    mockedList.mockResolvedValue([]);
    const app = await bootAgentModeApp();
    const res = await request(app)
      .get('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('non-admin → 403; no JWT → 401; plain mode → 501', async () => {
    const forbidden = await request(await bootAgentModeApp())
      .get('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(false)}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const unauth = await request(await bootAgentModeApp()).get('/api/v1/admin/agent-tokens');
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe('UNAUTHENTICATED');

    const plain = await request(await bootPlainModeApp())
      .get('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`);
    expect(plain.status).toBe(501);
    expect(plain.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedList).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/v1/admin/agent-tokens/:id ──────────────────────────────────

describe('DELETE /api/v1/admin/agent-tokens/:id — revoke', () => {
  it('live token → 204 No Content (empty body)', async () => {
    mockedRevoke.mockResolvedValue(undefined);
    const app = await bootAgentModeApp();
    const res = await request(app)
      .delete(`/api/v1/admin/agent-tokens/${TOKEN_ID}`)
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(mockedRevoke).toHaveBeenCalledWith(TOKEN_ID);
  });

  it('unknown id (service 404) → 404 NOT_FOUND envelope', async () => {
    mockedRevoke.mockRejectedValue(
      freshAppError.build!(ErrorCode.NOT_FOUND, `Agent token '${TOKEN_ID}' not found`, {
        id: TOKEN_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .delete(`/api/v1/admin/agent-tokens/${TOKEN_ID}`)
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.details).toEqual({ id: TOKEN_ID });
  });

  it('already revoked (service 409) → 409 CONFLICT envelope', async () => {
    mockedRevoke.mockRejectedValue(
      freshAppError.build!(ErrorCode.CONFLICT, 'Agent token is already revoked', {
        id: TOKEN_ID,
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .delete(`/api/v1/admin/agent-tokens/${TOKEN_ID}`)
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('non-uuid id → 400 VALIDATION_FAILED before the service runs', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .delete('/api/v1/admin/agent-tokens/not-a-uuid')
      .set('Authorization', `Bearer ${await sessionToken(true)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedRevoke).not.toHaveBeenCalled();
  });

  it('non-admin → 403; no JWT → 401; plain mode → 501', async () => {
    const forbidden = await request(await bootAgentModeApp())
      .delete(`/api/v1/admin/agent-tokens/${TOKEN_ID}`)
      .set('Authorization', `Bearer ${await sessionToken(false)}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const unauth = await request(await bootAgentModeApp()).delete(
      `/api/v1/admin/agent-tokens/${TOKEN_ID}`,
    );
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe('UNAUTHENTICATED');

    const plain = await request(await bootPlainModeApp())
      .delete(`/api/v1/admin/agent-tokens/${TOKEN_ID}`)
      .set('Authorization', `Bearer ${await sessionToken(true)}`);
    expect(plain.status).toBe(501);
    expect(plain.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedRevoke).not.toHaveBeenCalled();
  });
});

// ── Dual-source agentTokenAuth round-trip (AC #2 + #3) ──────────────────────
// Generate (mocked DB write) → the RAW token + its hash drive the inbound
// candidate set → sign an internal call with the DB token → not-401. Then
// revoke (candidate set empties) → 401 while the env token still passes.

describe('agentTokenAuth — DB token round-trip (dual sources)', () => {
  const internalState = (ticketId: string) => `/api/v1/internal/jobs/${ticketId}/state`;

  // A REAL 64-hex token standing in for what createAgentToken returns on
  // the wire; its sha256 is what listActiveTokenHashes would hold.
  const DB_TOKEN = 'e'.repeat(64);

  function dbTokenHeaders(body: unknown, token: string) {
    return {
      'Content-Type': 'application/json',
      'X-Dispatcher-Signature': createHmac('sha256', token)
        .update(JSON.stringify(body))
        .digest('hex'),
      'X-Dispatcher-Token': token,
    };
  }

  it('generate → sign internal call with the DB token → passes auth (not 401)', async () => {
    // Step 1: generate through the admin route (service mocked to a
    // deterministic raw token whose hash we can also compute).
    mockedCreate.mockResolvedValue({ token: DB_TOKEN, id: TOKEN_ID, name: 'dispatcher-prod' });
    mockedActiveHashes.mockResolvedValue([hashToken(DB_TOKEN)]);
    const app = await bootAgentModeApp();
    const gen = await request(app)
      .post('/api/v1/admin/agent-tokens')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({ name: 'dispatcher-prod', projectId: null });
    expect(gen.status).toBe(201);
    expect(mockedActiveHashes).not.toHaveBeenCalled(); // not during the admin call

    // Step 2: internal call signed with the DB token + presented raw.
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(internalState(TICKET_ID))
      .set(dbTokenHeaders(body, DB_TOKEN))
      .send(body);

    // 200 (service row) or 501 — anything but 401: the ticket's AC is
    // "passes agentTokenAuth". pipelineJobService is NOT mocked here, so a
    // 500 from the missing DB would also prove auth passed; we assert
    // strictly not-401 and 200-shape via the envelope when present.
    expect(res.status).not.toBe(401);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('data');
    }
  });

  it('DB token signature over different bytes → 401 (possession still proven, integrity fails)', async () => {
    mockedActiveHashes.mockResolvedValue([hashToken(DB_TOKEN)]);
    const app = await bootAgentModeApp();
    const signed = { state: 'QUEUED' };
    const sent = { state: 'DONE' };
    const res = await request(app)
      .post(internalState(TICKET_ID))
      .set(dbTokenHeaders(signed, DB_TOKEN))
      .send(sent);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('Invalid dispatcher signature');
  });

  it('presented token NOT in the DB set → falls through to env → 401 (env signature absent)', async () => {
    mockedActiveHashes.mockResolvedValue([hashToken(DB_TOKEN)]);
    const app = await bootAgentModeApp();
    const unknown = 'f'.repeat(64);
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(internalState(TICKET_ID))
      .set(dbTokenHeaders(body, unknown))
      .send(body);

    expect(res.status).toBe(401);
    expect(mockedActiveHashes).toHaveBeenCalledTimes(1);
  });

  it('revoked DB token (candidate set empty) → 401; env token still works', async () => {
    // Revoke: active hashes no longer include the DB token.
    mockedActiveHashes.mockResolvedValue([]);
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };

    const revoked = await request(app)
      .post(internalState(TICKET_ID))
      .set(dbTokenHeaders(body, DB_TOKEN))
      .send(body);
    expect(revoked.status).toBe(401);

    // Env token (path 1) — no X-Dispatcher-Token header at all.
    const envSigned = await request(app)
      .post(internalState(TICKET_ID))
      .set({
        'Content-Type': 'application/json',
        'X-Dispatcher-Signature': createHmac('sha256', TEST_DISPATCHER_TOKEN)
          .update(JSON.stringify(body))
          .digest('hex'),
      })
      .send(body);
    expect(envSigned.status).not.toBe(401);
  });

  it('env token works even while DB tokens exist (both sources coexist)', async () => {
    mockedActiveHashes.mockResolvedValue([hashToken(DB_TOKEN)]);
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(internalState(TICKET_ID))
      .set({
        'Content-Type': 'application/json',
        'X-Dispatcher-Signature': createHmac('sha256', TEST_DISPATCHER_TOKEN)
          .update(JSON.stringify(body))
          .digest('hex'),
      })
      .send(body);

    expect(res.status).not.toBe(401);
    // No X-Dispatcher-Token presented → the DB candidate query never ran;
    // the env fallback carried this request alone.
    expect(mockedActiveHashes).not.toHaveBeenCalled();
  });

  it('no X-Dispatcher-Token header → env path only, no DB query', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post(internalState(TICKET_ID))
      .set({
        'Content-Type': 'application/json',
        'X-Dispatcher-Signature': createHmac('sha256', TEST_DISPATCHER_TOKEN)
          .update(JSON.stringify(body))
          .digest('hex'),
      })
      .send(body);

    expect(res.status).not.toBe(401);
    expect(mockedActiveHashes).not.toHaveBeenCalled();
  });
});
