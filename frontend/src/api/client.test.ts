import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiClientError } from './client';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

const MOCK_USER_STALE: AuthUser = {
  token: 'stale',
  id: 'u1',
  email: 'e',
  name: 'n',
  role: 'MEMBER',
  avatarUrl: null,
};

describe('apiFetch', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps { data } on 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await apiFetch<{ ok: boolean }>('/test');
    expect(result).toEqual({ ok: true });
  });

  it('throws ApiClientError on 4xx with error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'bad',
          },
        }),
        { status: 400 },
      ),
    );
    await expect(apiFetch('/x')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
      message: 'bad',
    });
  });

  it('injects Authorization when token is set', async () => {
    useAuthStore.getState().setUser({
      token: 'abc',
      id: 'u1',
      email: 'e',
      name: 'n',
      role: 'MEMBER',
      avatarUrl: null,
    });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: null }), { status: 200 }));
    await apiFetch('/x');
    const init = spy.mock.calls[0]?.[1];
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer abc');
  });

  it('throws NETWORK_ERROR on fetch rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));
    await expect(apiFetch('/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('throws ApiClientError instances (not generic Error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), { status: 404 }),
    );
    try {
      await apiFetch('/x');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
    }
  });
});

describe('apiFetch 401 interceptor', () => {
  // F07 D6: logoutHandlers + isLoggingOut are MODULE-LEVEL in client.ts — they
  // persist across tests. resetModules + dynamic import gives each test a fresh
  // module so the 6 scenarios don't leak state into one another. The store is
  // captured from the SAME dynamic import (client.ts imports useAuthStore), so
  // setUser/clear mutate the exact instance the client under test reads from.
  let apiFetch: typeof import('./client').apiFetch;
  let ApiClientError: typeof import('./client').ApiClientError;
  let registerLogoutHandlers: typeof import('./client').registerLogoutHandlers;
  let authStore: typeof import('@/stores/useAuthStore').useAuthStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./client');
    apiFetch = mod.apiFetch;
    ApiClientError = mod.ApiClientError;
    registerLogoutHandlers = mod.registerLogoutHandlers;
    authStore = (await import('@/stores/useAuthStore')).useAuthStore;
    authStore.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refresh succeeds → retries request with fresh token', async () => {
    authStore.getState().setUser(MOCK_USER_STALE);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // First call: 401. Second call (retry): 200.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }), {
        status: 401,
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    registerLogoutHandlers({
      refresh: async () => {
        // Simulate /me refresh landing a fresh token in the store.
        authStore.getState().setUser({ ...MOCK_USER_STALE, token: 'fresh' });
        return true;
      },
      logout: vi.fn(),
    });

    const result = await apiFetch<{ ok: boolean }>('/tickets');
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const retryInit = fetchSpy.mock.calls[1]?.[1];
    expect(retryInit?.headers).toBeInstanceOf(Headers);
    expect((retryInit?.headers as Headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('refresh fails → calls logout once and throws 401', async () => {
    authStore.getState().setUser(MOCK_USER_STALE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }), {
        status: 401,
      }),
    );
    const logout = vi.fn();
    registerLogoutHandlers({
      refresh: async () => false,
      logout,
    });

    let caught: unknown;
    try {
      await apiFetch('/tickets');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
    expect((caught as ApiClientError).status).toBe(401);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('N concurrent requests → logout called once (dedupe)', async () => {
    authStore.getState().setUser(MOCK_USER_STALE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }), {
        status: 401,
      }),
    );
    const logout = vi.fn();
    registerLogoutHandlers({
      refresh: async () => false,
      logout,
    });

    const results = await Promise.allSettled([
      apiFetch('/a'),
      apiFetch('/b'),
      apiFetch('/c'),
    ]);
    results.forEach((r) => {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(ApiClientError);
        expect(r.reason.status).toBe(401);
      }
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('/auth/* paths exempt: no refresh, no logout', async () => {
    authStore.getState().setUser(MOCK_USER_STALE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }), {
        status: 401,
      }),
    );
    const refresh = vi.fn();
    const logout = vi.fn();
    registerLogoutHandlers({ refresh, logout });

    await expect(apiFetch('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('no handlers registered: 401 throws without side-effects', async () => {
    authStore.getState().setUser(MOCK_USER_STALE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }), {
        status: 401,
      }),
    );
    // NOTE: registerLogoutHandlers NOT called (state reset via resetModules).

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 401 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('non-401 errors unaffected (refresh/logout not called)', async () => {
    authStore.getState().setUser(MOCK_USER_STALE);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'FORBIDDEN', message: 'no' } }),
        { status: 403 },
      ),
    );
    const refresh = vi.fn();
    const logout = vi.fn();
    registerLogoutHandlers({ refresh, logout });

    await expect(apiFetch('/tickets')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
