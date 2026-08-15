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
    // SLYK-0130 cross-field rule: agent mode requires the dispatcher pair, so
    // the boot must stub them (env validation throws otherwise).
    vi.stubEnv('SLYKBOARD_DISPATCHER_URL', 'http://dispatcher.local:4001');
    vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', 'a'.repeat(64));
    const app = await bootApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const res = await request(app).get('/api/v1/internal/anything');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  // SLYK-0440 — the polling reconciler arms at boot in agent mode ONLY.
  // start() is main-gated, so startAgentBackgroundJobs is the exported seam
  // standing in for the boot sequence; it must arm the loop under agent mode
  // and stay silent in plain mode.
  it('agent mode boots the pipeline reconciler; plain mode never arms it', async () => {
    // Plain mode: nothing arms — the reconciler module is never even loaded
    // (dynamic import behind the runtimeConfig.agentMode branch).
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'false');
    const plain = await bootApp();
    expect(plain).toBeDefined();
    const plainReconciler = await import('./services/pipelineReconciler');
    expect(plainReconciler.reconcilerIsRunning()).toBe(false);

    // Agent mode: the same boot seam arms the loop (and stops cleanly).
    vi.resetModules();
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
    vi.stubEnv('SLYKBOARD_DISPATCHER_URL', 'http://dispatcher.local:4001');
    vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', 'a'.repeat(64));
    const agentMod = await import('./index');
    await agentMod.startAgentBackgroundJobs();
    const agentReconciler = await import('./services/pipelineReconciler');
    expect(agentReconciler.reconcilerIsRunning()).toBe(true);
    agentReconciler.stopPipelineReconciler();
    expect(agentReconciler.reconcilerIsRunning()).toBe(false);
  });
});
