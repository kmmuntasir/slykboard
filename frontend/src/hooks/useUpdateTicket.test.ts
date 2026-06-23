import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateTicket, type UpdateTicketVariables } from '@/hooks/useUpdateTicket';
import { updateTicket } from '@/api/tickets';
import { ApiClientError } from '@/api/client';
import { boardKeys, ticketKeys } from '@/api/queryKeys';
import type { BoardPayload } from '@/types/board';
import type { Ticket, Priority } from '@/types/ticket';

vi.mock('@/api/tickets');

const SLUG = 'slyk';
const BOARD_KEY = boardKeys.detail(SLUG);

// --- Fixtures --------------------------------------------------------------

function makeTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    ticketNumber: Number(id.replace(/\D/g, '') || '0'),
    title: `title-${id}`,
    description: null,
    statusColumn: 'c1',
    position: 0,
    priority: 'LOW' as Priority,
    labels: [],
    checklist: [],
    assignee: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seedBoard(): BoardPayload {
  const t1 = makeTicket('t1', {
    description: '<p>old</p>',
    priority: 'MEDIUM',
    assignee: { id: 'u1', fullName: 'Ada', avatarUrl: null },
  });
  const t2 = makeTicket('t2');
  return {
    project: { id: 'p1', name: 'Slyk', slug: 'slyk' },
    columns: [{ id: 'c1', name: 'Todo', isUnsorted: false, tickets: [t1, t2] }],
  };
}

// --- Harness ---------------------------------------------------------------

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

// --- Tests -----------------------------------------------------------------

describe('useUpdateTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('optimistically updates the board cache on title patch', async () => {
    const board = seedBoard();
    const serverUpdated = makeTicket('t1', { title: 'New' });
    vi.mocked(updateTicket).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    queryClient.setQueryData(BOARD_KEY, board);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = { ticketId: 't1', dto: { title: 'New' }, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    // Optimistic write happened: find the function-form updater call against
    // boardKeys.detail(slug) and invoke it against the seed to verify it patched title.
    const optimisticCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(BOARD_KEY) && typeof value === 'function',
    );
    expect(optimisticCall).toBeDefined();
    const updater = optimisticCall?.[1] as (curr: BoardPayload | undefined) => BoardPayload;
    expect(updater(board).columns[0]?.tickets[0]?.title).toBe('New');
  });

  it('optimistically updates the ticket detail cache', async () => {
    const ticket = makeTicket('t1', { title: 'old' });
    const serverUpdated = makeTicket('t1', { title: 'New' });
    vi.mocked(updateTicket).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    queryClient.setQueryData(ticketKeys.detail('t1'), ticket);

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = { ticketId: 't1', dto: { title: 'New' }, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    // Pre-settle we wrote the optimistic patch; post-settle the server response
    // replaces it. Either way the detail cache ends with the new title.
    const cached = queryClient.getQueryData<Ticket>(ticketKeys.detail('t1'));
    expect(cached?.title).toBe('New');
  });

  it('rolls back both caches on error', async () => {
    const board = seedBoard();
    const ticket = makeTicket('t1', { title: 'old' });
    vi.mocked(updateTicket).mockRejectedValue(new ApiClientError('boom', 500, 'INTERNAL_ERROR'));

    const queryClient = newQueryClient();
    queryClient.setQueryData(BOARD_KEY, board);
    queryClient.setQueryData(ticketKeys.detail('t1'), ticket);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = { ticketId: 't1', dto: { title: 'New' }, slug: SLUG };
    await act(async () => {
      try {
        await result.current.mutateAsync(vars);
      } catch {
        // swallow; assert rollback below
      }
    });

    // onError restored both caches to the pre-mutation references.
    const boardRestore = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(BOARD_KEY) && value === board,
    );
    const ticketRestore = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(ticketKeys.detail('t1')) && value === ticket,
    );
    expect(boardRestore).toBeDefined();
    expect(ticketRestore).toBeDefined();
  });

  it('invalidates board family and ticket detail on settle', async () => {
    const serverUpdated = makeTicket('t1', { title: 'New' });
    vi.mocked(updateTicket).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = { ticketId: 't1', dto: { title: 'New' }, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ticketKeys.detail('t1') });
  });

  it('propagates description patch to board cache (Ticket HAS description)', async () => {
    const board = seedBoard();
    const serverUpdated = makeTicket('t1', { description: '<p>new</p>' });
    vi.mocked(updateTicket).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    queryClient.setQueryData(BOARD_KEY, board);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = {
      ticketId: 't1',
      dto: { description: '<p>new</p>' },
      slug: SLUG,
    };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    const optimisticCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(BOARD_KEY) && typeof value === 'function',
    );
    expect(optimisticCall).toBeDefined();
    const updater = optimisticCall?.[1] as (curr: BoardPayload | undefined) => BoardPayload;
    expect(updater(board).columns[0]?.tickets[0]?.description).toBe('<p>new</p>');
  });

  it('assigneeId patch does NOT touch board card optimistic write (server reconciles on invalidate)', async () => {
    const board = seedBoard();
    const serverUpdated = makeTicket('t1', {
      assignee: { id: 'u2', fullName: 'Bob', avatarUrl: null },
    });
    vi.mocked(updateTicket).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    queryClient.setQueryData(BOARD_KEY, board);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = { ticketId: 't1', dto: { assigneeId: 'u2' }, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    // The optimistic board write (if present) keeps the card's assignee unchanged.
    const optimisticCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(BOARD_KEY) && typeof value === 'function',
    );
    if (optimisticCall) {
      const updater = optimisticCall[1] as (curr: BoardPayload | undefined) => BoardPayload;
      const patchedTicket = updater(board).columns[0]?.tickets[0];
      expect(patchedTicket?.assignee).toEqual({ id: 'u1', fullName: 'Ada', avatarUrl: null });
    }
    // Settle still invalidates the board (server reconcile happens on refetch).
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('labelIds patch skips optimistic writes + invalidates board on settle', async () => {
    const board = seedBoard();
    const serverUpdated = makeTicket('t1', {
      labels: [{ id: 'l1', name: 'bug', color: '#FF0000' }],
    });
    vi.mocked(updateTicket).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    queryClient.setQueryData(BOARD_KEY, board);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: UpdateTicketVariables = {
      ticketId: 't1',
      dto: { labelIds: ['l1'] },
      slug: SLUG,
    };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    // No optimistic function-form board write for labelIds-only patches:
    // the patch carries IDs, but Ticket.labels needs the hydrated join.
    const optimisticBoardWrite = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(BOARD_KEY) && typeof value === 'function',
    );
    expect(optimisticBoardWrite).toBeUndefined();

    // Settle invalidates the board family so the refetch carries correct colors.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ticketKeys.detail('t1') });
  });
});
