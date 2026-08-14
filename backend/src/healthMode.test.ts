import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// SLYK-0160 — health must report agentMode in BOTH modes. Mode is baked into
// the frozen env at module scope, so each mode needs a fresh module instance
// (vi.resetModules + dynamic import), mirroring agentModeBoot.test.ts. Agent
// mode additionally stubs the dispatcher pair required by the SLYK-0130
// cross-field rule (URL + token).

const AGENT_ENV = {
  SLYKBOARD_AGENT_MODE: 'true',
  SLYKBOARD_DISPATCHER_URL: 'http://dispatcher.local:4001',
  SLYKBOARD_DISPATCHER_TOKEN: 'a'.repeat(64),
} as const;

async function bootApp(): Promise<Express> {
  const mod = await import('./index');
  return mod.app;
}

describe('GET /api/health — agentMode/schemaVersion per mode (SLYK-0160)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('plain mode: agentMode false, schemaVersion 1', async () => {
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'false');
    const app = await bootApp();

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.agentMode).toBe(false);
    expect(res.body.schemaVersion).toBe(1);
  });

  it('agent mode: agentMode true, schemaVersion 1', async () => {
    vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
    vi.stubEnv('SLYKBOARD_DISPATCHER_URL', AGENT_ENV.SLYKBOARD_DISPATCHER_URL);
    vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', AGENT_ENV.SLYKBOARD_DISPATCHER_TOKEN);
    const app = await bootApp();

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.agentMode).toBe(true);
    expect(res.body.schemaVersion).toBe(1);
  });
});
