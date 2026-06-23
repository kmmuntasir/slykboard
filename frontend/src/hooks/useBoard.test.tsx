import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useBoard } from '@/hooks/useBoard';
import { fetchBoard } from '@/api/boards';
import { ApiClientError } from '@/api/client';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
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
                    description: null,
                    statusColumn: 'c1',
                    position: 0,
                    priority: 'HIGH',
                    labels: [
                        {
                            id: '22222222-2222-2222-2222-222222222222',
                            name: 'infra',
                            color: '#6B7280',
                        },
                    ],
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

describe('useBoard polling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // jsdom default document.hidden is false; pin explicitly for determinism.
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
        useBoardUiStore.getState().setDragInProgress(false);
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('polls at POLL_INTERVAL_MS (default 30s)', async () => {
        vi.mocked(fetchBoard).mockResolvedValue({
            project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
            columns: [],
        });

        renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(newQueryClient()),
        });

        // RTL waitFor uses real setTimeout (faked here), so use vitest's vi.waitFor
        // which flushes microtasks under fake timers.
        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(2));

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(3));
    });

    it('respects VITE_POLL_INTERVAL_SECONDS (env wiring end-to-end)', async () => {
        vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', '10');
        vi.resetModules();
        const { useBoard: useBoardFresh } = await import('@/hooks/useBoard');
        const { fetchBoard: fetchBoardFresh } = await import('@/api/boards');
        vi.mocked(fetchBoardFresh).mockResolvedValue({
            project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
            columns: [],
        });

        renderHook(() => useBoardFresh('SLYK'), {
            wrapper: createWrapper(newQueryClient()),
        });

        await vi.waitFor(() => expect(vi.mocked(fetchBoardFresh)).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(10_000);
        await vi.waitFor(() => expect(vi.mocked(fetchBoardFresh)).toHaveBeenCalledTimes(2));
    });

    it('defers poll when dragInProgress is true (defer, not discard)', async () => {
        vi.mocked(fetchBoard).mockResolvedValue({
            project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
            columns: [],
        });

        const { rerender } = renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(newQueryClient()),
        });

        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(1));

        // While dragging, refetchInterval returns false -> interval clears (no poll).
        useBoardUiStore.getState().setDragInProgress(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(1);

        // Drag ends: F11's onDragEnd triggers a re-render that re-evaluates
        // refetchInterval (dragInProgress now false) -> interval resumes.
        useBoardUiStore.getState().setDragInProgress(false);
        rerender();
        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(2));
    });

    it('pauses poll when document.hidden is true (resume on unhide)', async () => {
        vi.mocked(fetchBoard).mockResolvedValue({
            project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
            columns: [],
        });

        renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(newQueryClient()),
        });

        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(1));

        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));

        await vi.advanceTimersByTimeAsync(60_000);
        expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() => expect(vi.mocked(fetchBoard)).toHaveBeenCalledTimes(2));
    });

    it('card appears in new column within one poll (acceptance #2)', async () => {
        const tA = {
            id: 'tA',
            ticketNumber: 2,
            title: 'Move me',
            description: null,
            statusColumn: 'c1',
            position: 0,
            priority: 'HIGH' as const,
            labels: [],
            assignee: null,
            creatorId: 'u1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        const first: BoardPayload = {
            project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
            columns: [{ id: 'c1', name: 'Todo', isUnsorted: false, tickets: [tA] }],
        };
        const second: BoardPayload = {
            project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
            columns: [
                { id: 'c1', name: 'Todo', isUnsorted: false, tickets: [] },
                { id: 'c2', name: 'Done', isUnsorted: false, tickets: [tA] },
            ],
        };

        vi.mocked(fetchBoard).mockResolvedValueOnce(first).mockResolvedValueOnce(second);

        const { result } = renderHook(() => useBoard('SLYK'), {
            wrapper: createWrapper(newQueryClient()),
        });

        await vi.waitFor(() => expect(result.current.data).toBeDefined());

        await vi.advanceTimersByTimeAsync(30_000);
        await vi.waitFor(() =>
            expect(result.current.data?.columns[1]?.tickets[0]?.id).toBe('tA'),
        );
    });
});
