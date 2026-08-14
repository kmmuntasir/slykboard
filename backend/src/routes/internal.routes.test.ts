import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac } from 'node:crypto';
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
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(async () => 0),
  bumpTokenVersion: vi.fn(),
}));

import { SignJWT } from 'jose';

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

  it('valid signature → passes auth, hits the stub → 501 naming Phase 1', async () => {
    const app = await bootAgentModeApp();
    const body = { state: 'QUEUED' };
    const res = await request(app)
      .post('/api/v1/internal/jobs/11111111-1111-4111-8111-111111111111/state')
      .set(dispatcherHeaders(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Not implemented until Phase 1');
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

  it('GET deploy-target with valid HMAC over empty body → 501 Phase 0.5', async () => {
    const app = await bootAgentModeApp();
    const emptySig = createHmac('sha256', TEST_DISPATCHER_TOKEN)
      .update(Buffer.alloc(0))
      .digest('hex');
    const res = await request(app)
      .get('/api/v1/internal/projects/inventory-tracker/deploy-target')
      .set('X-Dispatcher-Signature', emptySig);

    expect(res.status).toBe(501);
    expect(res.body.error.message).toBe('Not implemented until Phase 0.5');
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

  it('valid admin JWT → stub 501 Phase 0.5', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({});

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Not implemented until Phase 0.5');
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
