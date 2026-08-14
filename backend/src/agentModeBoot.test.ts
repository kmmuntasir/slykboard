import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// SLYK-0110 — /api/v1 mount scaffolding is comment-only until Phase 0, so
// agent paths must 404 (nothing mounted) and health must stay up in BOTH
// modes. Agent mode is read at module scope of index.ts, so each mode needs
// a fresh module instance (vi.resetModules + dynamic import).

async function bootApp(): Promise<Express> {
  const mod = await import('./index');
  return mod.app;
}

describe('agent-mode boot (/api/v1 mount block)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('plain mode: /api/health 200, /api/v1/internal/* 404 (nothing mounted)', async () => {
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'false');
    const app = await bootApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const res = await request(app).get('/api/v1/internal/anything');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('agent mode: /api/health 200, /api/v1/internal/* still 404 (mount block comment-only)', async () => {
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
    const app = await bootApp();

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const res = await request(app).get('/api/v1/internal/anything');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
