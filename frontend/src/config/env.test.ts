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
});
