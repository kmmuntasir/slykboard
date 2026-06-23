import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  moveTicket,
  fetchTicket,
  updateTicket,
  type MoveTicketRequest,
} from './tickets';
import type { Ticket, UpdateTicketDto } from '../types/ticket';

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

const sampleTicket: Ticket = {
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

describe('fetchTicket', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GETs /tickets/:id and returns the unwrapped ticket', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: sampleTicket }), { status: 200 }),
    );

    const result = await fetchTicket('t1');

    expect(result).toEqual(sampleTicket);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toContain('/tickets/t1');
    expect(init?.method).toBeUndefined();
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'not found', code: 'NOT_FOUND' } }),
        { status: 404 },
      ),
    );

    await expect(fetchTicket('t1')).rejects.toThrow('not found');
  });
});

describe('updateTicket', () => {
  afterEach(() => vi.restoreAllMocks());

  const cases: Array<{ name: string; dto: UpdateTicketDto }> = [
    { name: 'title only', dto: { title: 'new title' } },
    { name: 'description', dto: { description: 'desc' } },
    { name: 'clear description', dto: { description: null } },
    { name: 'priority', dto: { priority: 'URGENT' } },
    { name: 'assignee', dto: { assigneeId: 'u2' } },
    { name: 'clear assignee', dto: { assigneeId: null } },
    { name: 'multi-field', dto: { title: 't', description: 'd', priority: 'HIGH' } },
  ];

  cases.forEach(({ name, dto }) => {
    it(`PATCHes /tickets/:id with ${name}`, async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: sampleTicket }), { status: 200 }),
      );

      const result = await updateTicket('t1', dto);

      expect(result).toEqual(sampleTicket);

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] ?? [];
      expect(String(url)).toContain('/tickets/t1');
      expect(init?.method).toBe('PATCH');
      expect(init?.body).toBe(JSON.stringify(dto));
    });
  });

  it('throws ApiClientError when the server responds non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'conflict', code: 'CONFLICT' } }),
        { status: 409 },
      ),
    );

    await expect(updateTicket('t1', { title: 'x' })).rejects.toThrow('conflict');
  });
});
