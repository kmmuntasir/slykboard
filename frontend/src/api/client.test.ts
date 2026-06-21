import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiClientError } from './client';
import { useAuthStore } from '@/stores/useAuthStore';

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
      email: 'e',
      name: 'n',
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
