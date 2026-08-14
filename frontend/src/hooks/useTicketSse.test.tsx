import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTicketSse } from './useTicketSse';
import { pipelineKeys, boardKeys } from '@/api/queryKeys';
import { useAuthStore } from '@/stores/useAuthStore';

// SLYK-0310 — SSE wrapper tests with a fake EventSource (jsdom has none).
// Asserts: URL + access_token, close on unmount, `state` frame invalidates
// the pipeline key (board additionally on DONE), malformed frames ignored.
// Invalidation is asserted by spying on queryClient.invalidateQueries — the
// real refetch machinery is React Query's concern, not this hook's.

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    static CLOSED: FakeEventSource[] = [];
    url: string;
    listeners = new Map<string, Listener[]>();
    constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data: string) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(new MessageEvent(type, { data }));
        }
    }
    close() {
        FakeEventSource.CLOSED.push(this);
    }
}

vi.stubGlobal('EventSource', FakeEventSource);

const TOKEN = 'jwt-token-123';
const TICKET_ID = 't-1';
const SLUG = 'SLYK';

function seedAuth() {
    useAuthStore.setState({
        user: {
            token: TOKEN,
            id: 'u1',
            email: 'ada@example.com',
            name: 'Ada',
            isPlatformAdmin: false,
            displayName: 'Ada',
            avatarUrl: null,
            blocked: false,
        },
    });
}

describe('useTicketSse', () => {
    let queryClient: QueryClient;
    let invalidateSpy: MockInstance;

    function createWrapper(client: QueryClient) {
        return ({ children }: { children: ReactNode }) =>
            createElement(QueryClientProvider, { client }, children);
    }

    beforeEach(() => {
        FakeEventSource.instances = [];
        FakeEventSource.CLOSED = [];
        seedAuth();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        invalidateSpy = vi
            .spyOn(queryClient, 'invalidateQueries')
            .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('opens one EventSource on the ticket events URL with the JWT as access_token', () => {
        const { unmount } = renderHook(() => useTicketSse({ ticketId: TICKET_ID }), {
            wrapper: createWrapper(queryClient),
        });

        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0]!.url).toBe(
            `http://localhost:3000/api/v1/me/tickets/${TICKET_ID}/events?access_token=${TOKEN}`,
        );
        unmount();
    });

    it('closes the EventSource on unmount', () => {
        const { unmount } = renderHook(() => useTicketSse({ ticketId: TICKET_ID }), {
            wrapper: createWrapper(queryClient),
        });
        unmount();

        expect(FakeEventSource.CLOSED).toHaveLength(1);
    });

    it('opens nothing without a token', () => {
        useAuthStore.setState({ user: null });
        renderHook(() => useTicketSse({ ticketId: TICKET_ID }), {
            wrapper: createWrapper(queryClient),
        });

        expect(FakeEventSource.instances).toHaveLength(0);
    });

    it('a state frame invalidates the pipeline query only', () => {
        renderHook(() => useTicketSse({ ticketId: TICKET_ID, boardSlug: SLUG }), {
            wrapper: createWrapper(queryClient),
        });

        act(() => {
            FakeEventSource.instances[0]!.emit(
                'state',
                JSON.stringify({ state: 'QUEUED', traceId: 'tr' }),
            );
        });

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.detail(TICKET_ID) });
        expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: boardKeys.detail(SLUG) });
    });

    it('a DONE frame invalidates the pipeline AND board queries', () => {
        renderHook(() => useTicketSse({ ticketId: TICKET_ID, boardSlug: SLUG }), {
            wrapper: createWrapper(queryClient),
        });

        act(() => {
            FakeEventSource.instances[0]!.emit(
                'state',
                JSON.stringify({ state: 'DONE', traceId: null }),
            );
        });

        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.detail(TICKET_ID) });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.detail(SLUG) });
    });

    it('a malformed state frame is ignored without invalidating', () => {
        renderHook(() => useTicketSse({ ticketId: TICKET_ID }), {
            wrapper: createWrapper(queryClient),
        });

        act(() => {
            FakeEventSource.instances[0]!.emit('state', 'not-json{{');
        });

        expect(invalidateSpy).not.toHaveBeenCalled();
    });
});
