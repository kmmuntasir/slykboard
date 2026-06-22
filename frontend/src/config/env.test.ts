import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('config/env', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exposes apiBaseUrl from VITE_API_BASE_URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
    const { env } = await import('./env');
    expect(env.apiBaseUrl).toBe('http://localhost:3000/api');
  });

  it('env is frozen', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
    const { env } = await import('./env');
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('throws when VITE_API_BASE_URL missing', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    await expect(import('./env')).rejects.toThrow(/Missing VITE_API_BASE_URL/);
  });

  it('defaults pollIntervalSeconds to 30 when unset (PRD REQ-2.4)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
    const { env, POLL_INTERVAL_MS } = await import('./env');
    expect(env.pollIntervalSeconds).toBe(30);
    expect(POLL_INTERVAL_MS).toBe(30000);
  });

  it('coerces a valid numeric string for VITE_POLL_INTERVAL_SECONDS', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
    vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', '45');
    const { env, POLL_INTERVAL_MS } = await import('./env');
    expect(env.pollIntervalSeconds).toBe(45);
    expect(POLL_INTERVAL_MS).toBe(45000);
  });

  it('throws on a garbage VITE_POLL_INTERVAL_SECONDS (fail-fast)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
    vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', 'abc');
    await expect(import('./env')).rejects.toThrow(/Invalid VITE_POLL_INTERVAL_SECONDS/);
  });

  it('throws on a non-positive VITE_POLL_INTERVAL_SECONDS (0 and negatives)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');

    vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', '0');
    await expect(import('./env')).rejects.toThrow(/Invalid VITE_POLL_INTERVAL_SECONDS/);

    vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', '-5');
    await expect(import('./env')).rejects.toThrow(/Invalid VITE_POLL_INTERVAL_SECONDS/);
  });
});
