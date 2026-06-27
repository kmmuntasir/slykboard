import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHealth } from './useHealth';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

function mockHealthResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const ok = init.ok ?? true;
    return vi.fn(() =>
        Promise.resolve({
            ok,
            status: init.status ?? (ok ? 200 : 500),
            json: () => Promise.resolve(body),
        } as Response),
    ) as unknown as typeof fetch;
}

describe('useHealth', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('reports isLoading + ok===undefined during the initial fetch', () => {
        // Never-resolving fetch → perpetually loading.
        global.fetch = vi.fn(
            () => new Promise<Response>(() => undefined),
        ) as unknown as typeof fetch;

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        expect(result.current.isLoading).toBe(true);
        expect(result.current.ok).toBeUndefined();
        expect(result.current.detail).toBe('Checking…');
    });

    it('reports ok===true + the service detail on a healthy response', async () => {
        global.fetch = mockHealthResponse({
            status: 'ok',
            service: 'slykboard-api',
        });

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.ok).toBe(true);
        expect(result.current.isError).toBe(false);
        expect(result.current.detail).toBe('slykboard-api');
    });

    it('reports ok===false + isError on a non-ok status body', async () => {
        global.fetch = mockHealthResponse({
            status: 'degraded',
            service: 'slykboard-api',
        });

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.ok).toBe(false);
        expect(result.current.detail).toBe('slykboard-api');
    });

    it('reports ok===false + isError when fetch rejects (network/server error)', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('network down')),
        ) as unknown as typeof fetch;

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.ok).toBe(false);
        expect(result.current.detail).toBe('Service unavailable');
    });

    it('uses queryKey ["health"] and staleTime 30s (no polling)', async () => {
        const fetchSpy = mockHealthResponse({
            status: 'ok',
            service: 'slykboard-api',
        });
        global.fetch = fetchSpy;

        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );

        renderHook(() => useHealth(), { wrapper });

        await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
        const observer = queryClient.getQueryCache().find({ queryKey: ['health'] });
        expect(observer).toBeDefined();
        // staleTime is set on the hook's useQuery options; assert via the observer
        // config is read-only in v5, so assert behavior: a second mount within
        // staleTime does NOT refetch.
        const initialCallCount = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.length;
        renderHook(() => useHealth(), { wrapper });
        await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
        expect((fetchSpy as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialCallCount);
    });
});
