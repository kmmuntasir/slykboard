import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// SLYK-0110/0150 — /api/v1 mounts are real (stub routers behind the auth
// chain), so health stays up in BOTH modes and agent paths answer through the
// chain instead of 404ing: plain mode → 501 from requireAgentMode; agent mode
// → 401 from agentTokenAuth without a signature. Agent mode is read at module
// scope of index.ts, so each mode needs a fresh module instance
// (vi.resetModules + dynamic import).

// Keep the real pino logger (pino-http needs its internals) but force
// isProd=false — vitest's NODE_ENV=test makes errorMiddleware mask 5xx
// messages; the 501 gate message is the assertion target here.
vi.mock('./config/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config/logger')>();
  return { ...actual, isProd: false };
});

async function bootApp(): Promise<Express> {
  const mod = await import('./index');
  return mod.app;
}

describe('agent-mode boot (/api/v1 mount block)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('plain mode: /api/health 200, /api/v1/internal/* 501 (requireAgentMode gate)', async () => {
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'false');
    const app = await bootApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const res = await request(app).get('/api/v1/internal/anything');
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
  });

  it('agent mode: /api/health 200, /api/v1/internal/* 401 without signature (routes mounted)', async () => {
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
    vi.stubEnv('SLYKBOARD_DISPATCHER_URL', 'http://localhost:4001');
    vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', 'a'.repeat(64));
    const app = await bootApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const res = await request(app).get('/api/v1/internal/anything');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
