import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useBoard } from '@/hooks/useBoard';
import { fetchBoard } from '@/api/boards';
import { ApiClientError } from '@/api/client';
import type { BoardPayload } from '@/types/board';

vi.mock('@/api/boards');

const boardPayloadMock: BoardPayload = {
    project: { id: 'p1', name: 'Slyk', slug: 'slyk' },
    columns: [
        {
            id: 'c1',
            name: 'Todo',
            isUnsorted: false,
            tickets: [
                {
                    id: 't1',
                    ticketNumber: 1,
                    title: 'Set up CI',
                    statusColumn: 'c1',
                    position: 0,
                    priority: 'HIGH',
                    labels: ['infra'],
                    assignee: {
                        id: 'u1',
                        fullName: 'Ada Lovelace',
                        avatarUrl: null,
                    },
                    creatorId: 'u1',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        },
    ],
};

function createWrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}

function newQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
        },
    });
}

describe('useBoard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns data on success', async () => {
        vi.mocked(fetchBoard).mockResolvedValue(boardPayloadMock);
        const queryClient = newQueryClient();

        const { result } = renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.data).toBeDefined());

        expect(result.current.data).toEqual(boardPayloadMock);
        expect(fetchBoard).toHaveBeenCalledWith('SLYK');
    });

    it('enabled only when slug present', async () => {
        vi.mocked(fetchBoard).mockResolvedValue(boardPayloadMock);

        // No slug: hook disabled, fetchBoard not called.
        const queryClientUndefined = newQueryClient();
        renderHook(() => useBoard(undefined), {
            wrapper: createWrapper(queryClientUndefined),
        });

        expect(fetchBoard).not.toHaveBeenCalled();

        // With slug: hook fetches.
        const queryClientSlug = newQueryClient();
        const { result } = renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(queryClientSlug),
        });

        await waitFor(() => expect(result.current.data).toBeDefined());

        expect(fetchBoard).toHaveBeenCalledWith('SLYK');
        expect(result.current.data).toEqual(boardPayloadMock);
    });

    it('propagates ApiClientError (status 404)', async () => {
        vi.mocked(fetchBoard).mockRejectedValue(new ApiClientError('not found', 404, 'NOT_FOUND'));
        const queryClient = newQueryClient();

        const { result } = renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => {
            const err = result.current.error as ApiClientError;
            expect(err).toBeInstanceOf(ApiClientError);
            expect(err.status).toBe(404);
        });
    });
});
