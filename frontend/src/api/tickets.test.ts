import { describe, it, expect, vi, afterEach } from 'vitest';
import { moveTicket, type MoveTicketRequest } from './tickets';
import type { Ticket } from '../types/ticket';

describe('moveTicket', () => {
  afterEach(() => vi.restoreAllMocks());

  const dto: MoveTicketRequest = { statusColumn: 'c2', position: 32768 };

  it('PATCHes /tickets/:id with the dto body and unwraps the envelope', async () => {
    const returned: Ticket = {
      id: 't1',
      ticketNumber: 1,
      title: 't1',
      description: null,
      statusColumn: 'c2',
      position: 32768,
      priority: 'LOW',
      labels: [],
      assignee: null,
      creatorId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: returned }), { status: 200 }),
    );

    const result = await moveTicket('t1', dto);

    // Envelope unwrapped.
    expect(result).toEqual(returned);

    // Correct path + method.
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/tickets/t1');
    expect(init?.method).toBe('PATCH');

    // Body is JSON.stringify(dto) and Content-Type set by the client.
    expect(init?.body).toBe(JSON.stringify(dto));
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'nope', code: 'INTERNAL_ERROR' } }),
        { status: 500 },
      ),
    );

    await expect(moveTicket('t1', dto)).rejects.toThrow('nope');
  });
});
