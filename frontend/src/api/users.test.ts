import { describe, it, expect, vi, afterEach } from 'vitest';
import { listUsers, type UserOption } from './users';

describe('listUsers', () => {
  afterEach(() => vi.restoreAllMocks());

  const users: UserOption[] = [
    { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
    { id: 'u2', fullName: 'Alan Turing', avatarUrl: 'https://img/2.png' },
  ];

  it('GETs /users and returns the unwrapped data array', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: users }), { status: 200 }),
    );

    const result = await listUsers();

    expect(result).toEqual(users);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/users');
    expect(init?.method).toBeUndefined();
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'forbidden', code: 'FORBIDDEN' } }),
        { status: 403 },
      ),
    );

    await expect(listUsers()).rejects.toThrow('forbidden');
  });
});
