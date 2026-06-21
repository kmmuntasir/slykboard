import { describe, it, expect, vi, afterEach } from 'vitest';
import { ping } from './ping';

describe('ping', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the message from /api/ping', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { message: 'pong, world' } }), {
        status: 200,
      }),
    );
    const result = await ping();
    expect(result).toEqual({ message: 'pong, world' });
  });

  it('passes the name through encodeURIComponent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { message: 'x' } }), {
        status: 200,
      }),
    );
    await ping('a b&c');
    const url = spy.mock.calls[0]?.[0];
    expect(String(url)).toContain('?name=a%20b%26c');
  });
});
