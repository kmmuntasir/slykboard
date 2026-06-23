import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateTicket } from '@/hooks/useCreateTicket';
import { createTicket } from '@/api/tickets';
import { ApiClientError } from '@/api/client';
import { boardKeys } from '@/api/queryKeys';
import type { BoardPayload } from '@/types/board';
import type { Ticket, Priority } from '@/types/ticket';

vi.mock('@/api/tickets');

const SLUG = 'slyk';

// --- Fixtures -------------------------------------------------------------

function makeTicket(
  id: string,
  statusColumn: string,
  position: number,
  overrides: Partial<Ticket> = {},
): Ticket {
  return {
    id,
    ticketNumber: Number(id.replace(/\D/g, '') || '0'),
    title: id,
    description: null,
    statusColumn,
    position,
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
  return {
    project: { id: 'p1', name: 'Slyk', slug: SLUG },
    columns: [
      {
        id: 'c1',
        name: 'To Do',
        isUnsorted: false,
        tickets: [],
      },
    ],
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
      queries: { retry: false, gcTime: 0 },
    },
  });
}

// --- Tests -----------------------------------------------------------------

describe('useCreateTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onSuccess appends the created ticket to the board cache via applyCreateToBoard', async () => {
    const board = seedBoard();
    const createdTicket = makeTicket('t1', 'c1', 0, {
      ticketNumber: 1,
      title: 'New ticket',
    });
    vi.mocked(createTicket).mockResolvedValue(createdTicket);

    const queryClient = newQueryClient();
    queryClient.setQueryData(boardKeys.detail(SLUG), board);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTicket(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ title: 'New ticket' });
    });

    // onSuccess appended the server-created ticket to column c1.
    const updated = queryClient.getQueryData<BoardPayload>(boardKeys.detail(SLUG));
    expect(updated).toBeDefined();
    expect(updated!.columns[0]?.tickets.length).toBe(1);
    expect(updated!.columns[0]?.tickets[0]?.ticketNumber).toBe(1);

    // onSettled invalidates the board query family.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('onError restores previous board (rollback path runs — no-op here since onMutate wrote no placeholder)', async () => {
    const board = seedBoard();
    vi.mocked(createTicket).mockRejectedValue(new ApiClientError('boom', 500, 'INTERNAL_ERROR'));

    const queryClient = newQueryClient();
    queryClient.setQueryData(boardKeys.detail(SLUG), board);

    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useCreateTicket(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ title: 'New ticket' });
      } catch {
        // Swallow mutation rejection; we assert the rollback below.
      }
    });

    // onError restored the cache to the previousBoard snapshot. Assert via the
    // captured non-function setQueryData call — onSettled's invalidateQueries
    // can GC the unobserved entry under gcTime:0, so post-settle getQueryData
    // is unreliable.
    const restoreCall = setQueryDataSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(boardKeys.detail(SLUG)) &&
        typeof value !== 'function',
    );
    expect(restoreCall).toBeDefined();
    expect(restoreCall?.[1]).toEqual(board);
  });

  it('onSettled invalidates boardKeys.all', async () => {
    const board = seedBoard();
    const createdTicket = makeTicket('t1', 'c1', 0, { ticketNumber: 1, title: 'New ticket' });
    vi.mocked(createTicket).mockResolvedValue(createdTicket);

    const queryClient = newQueryClient();
    queryClient.setQueryData(boardKeys.detail(SLUG), board);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTicket(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ title: 'New ticket' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('mutationFn calls createTicket(slug, dto)', async () => {
    const board = seedBoard();
    const createdTicket = makeTicket('t1', 'c1', 0, { ticketNumber: 1, title: 'New ticket' });
    vi.mocked(createTicket).mockResolvedValue(createdTicket);

    const queryClient = newQueryClient();
    queryClient.setQueryData(boardKeys.detail(SLUG), board);

    const { result } = renderHook(() => useCreateTicket(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ title: 'New ticket' });
    });

    expect(createTicket).toHaveBeenCalledWith(SLUG, { title: 'New ticket' });
  });
});
