import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeleteTicket, type DeleteTicketVariables } from '@/hooks/useDeleteTicket';
import { deleteTicket } from '@/api/tickets';
import { ApiClientError } from '@/api/client';
import { boardKeys, ticketKeys } from '@/api/queryKeys';

vi.mock('@/api/tickets');

const SLUG = 'slyk';
const TICKET_ID = 't1';

// --- Harness ----------------------------------------------------------------

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

// --- Tests ------------------------------------------------------------------

describe('useDeleteTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls deleteTicket with the ticketId on mutate', async () => {
    vi.mocked(deleteTicket).mockResolvedValue(undefined);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useDeleteTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: DeleteTicketVariables = { ticketId: TICKET_ID, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    expect(deleteTicket).toHaveBeenCalledTimes(1);
    expect(deleteTicket).toHaveBeenCalledWith(TICKET_ID);
  });

  it('removes the ticket detail cache on success', async () => {
    vi.mocked(deleteTicket).mockResolvedValue(undefined);

    const queryClient = newQueryClient();
    const removeSpy = vi.spyOn(queryClient, 'removeQueries');

    const { result } = renderHook(() => useDeleteTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: DeleteTicketVariables = { ticketId: TICKET_ID, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ticketKeys.detail(TICKET_ID) });
  });

  it('invalidates the board family on success', async () => {
    vi.mocked(deleteTicket).mockResolvedValue(undefined);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: DeleteTicketVariables = { ticketId: TICKET_ID, slug: SLUG };
    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('surfaces a 403 FORBIDDEN ApiClientError on mutation.error', async () => {
    vi.mocked(deleteTicket).mockRejectedValue(new ApiClientError('forbidden', 403, 'FORBIDDEN'));

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useDeleteTicket(), {
      wrapper: createWrapper(queryClient),
    });

    const vars: DeleteTicketVariables = { ticketId: TICKET_ID, slug: SLUG };
    await act(async () => {
      try {
        await result.current.mutateAsync(vars);
      } catch {
        // swallowed — assert via mutation.error below
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect((result.current.error as ApiClientError).code).toBe('FORBIDDEN');
    expect((result.current.error as ApiClientError).status).toBe(403);
  });
});
