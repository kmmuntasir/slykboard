import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMoveTicket, type MoveTicketVariables } from '@/hooks/useMoveTicket';
import { moveTicket } from '@/api/tickets';
import { ApiClientError } from '@/api/client';
import { boardKeys } from '@/api/queryKeys';
import { applyMoveToBoard } from '@/utils/boardReorder';
import type { BoardPayload, BoardColumn } from '@/types/board';
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
    assignee: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seedBoard(): BoardPayload {
  const c1: BoardColumn = {
    id: 'c1',
    name: 'To Do',
    isUnsorted: false,
    tickets: [makeTicket('t1', 'c1', 0), makeTicket('t2', 'c1', 65536)],
  };
  const c2: BoardColumn = {
    id: 'c2',
    name: 'In Progress',
    isUnsorted: false,
    tickets: [makeTicket('t3', 'c2', 0), makeTicket('t4', 'c2', 65536)],
  };
  return {
    project: { id: 'p1', name: 'Slyk', slug: SLUG },
    columns: [c1, c2],
  };
}

// Move t1 from c1[0] -> c2[1]. position is arbitrary for the API-call mock;
// applyMoveToBoard recomputes the real value for the optimistic cache write.
const vars: MoveTicketVariables = {
  ticketId: 't1',
  srcColumnId: 'c1',
  srcIndex: 0,
  dstColumnId: 'c2',
  dstIndex: 1,
  position: 32768,
};

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

describe('useMoveTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('optimistically updates the board cache, calls moveTicket, and invalidates on success', async () => {
    const board = seedBoard();
    const updatedTicket = makeTicket('t1', 'c2', 32768);
    vi.mocked(moveTicket).mockResolvedValue(updatedTicket);

    const queryClient = newQueryClient();
    queryClient.setQueryData(boardKeys.detail(SLUG), board);

    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useMoveTicket(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    // (a) onMutate cancels in-flight board queries.
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });

    // (b) optimistic write applied via applyMoveToBoard(seedBoard, vars). The
    // updater is a function at call-time; invoke the captured updater against the
    // seed board to confirm it produces the expected optimistic snapshot, and
    // also read the cache directly.
    const optimisticCall = setQueryDataSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(boardKeys.detail(SLUG)) &&
        typeof value === 'function',
    );
    expect(optimisticCall).toBeDefined();
    const updater = optimisticCall?.[1] as (curr: BoardPayload | undefined) => BoardPayload;
    expect(updater(board)).toEqual(applyMoveToBoard(board, vars));
    expect(queryClient.getQueryData(boardKeys.detail(SLUG))).toEqual(
      applyMoveToBoard(board, vars),
    );

    // (c) moveTicket called with the right (ticketId, { statusColumn, position }).
    expect(moveTicket).toHaveBeenCalledWith(vars.ticketId, {
      statusColumn: vars.dstColumnId,
      position: vars.position,
    });

    // (d) onSettled invalidates the board query family.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('rolls back the board cache to the previous snapshot on error', async () => {
    const board = seedBoard();
    vi.mocked(moveTicket).mockRejectedValue(
      new ApiClientError('boom', 500, 'INTERNAL_ERROR'),
    );

    const queryClient = newQueryClient();
    queryClient.setQueryData(boardKeys.detail(SLUG), board);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useMoveTicket(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(vars);
      } catch {
        // Swallow mutation rejection; we assert the rollback below.
      }
    });

    // onError restored the cache EXACTLY to the seed snapshot. We assert via the
    // captured setQueryData calls (onError writes the previousBoard reference)
    // because onSettled's invalidateQueries can GC the unobserved entry under
    // gcTime:0, making a post-settle getQueryData read unreliable.
    const restoreCall = setQueryDataSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(boardKeys.detail(SLUG)) &&
        typeof value !== 'function',
    );
    expect(restoreCall).toBeDefined();
    expect(restoreCall?.[1]).toEqual(board);

    // onSettled invalidate still fires on error.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('skips optimistic update when slug is undefined (no board query to touch)', async () => {
    const updatedTicket = makeTicket('t1', 'c2', 32768);
    vi.mocked(moveTicket).mockResolvedValue(updatedTicket);

    const queryClient = newQueryClient();
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useMoveTicket(undefined), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    // Guard returns early: no cancel, no setQueryData for the board.
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(setQueryDataSpy).not.toHaveBeenCalled();

    // moveTicket still fires; onSettled still invalidates.
    expect(moveTicket).toHaveBeenCalledWith(vars.ticketId, {
      statusColumn: vars.dstColumnId,
      position: vars.position,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });
});
