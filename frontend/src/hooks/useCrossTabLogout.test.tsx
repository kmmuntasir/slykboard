import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { broadcastLogout, useCrossTabLogout } from '@/hooks/useCrossTabLogout';

const { navigateMock } = vi.hoisted(() => ({
    navigateMock: vi.fn(),
}));

const clearMock = vi.fn();
const queryClientClearMock = vi.fn();

// In-memory BroadcastChannel stub. jsdom v25 lacks BroadcastChannel.
class MockBroadcastChannel extends EventTarget {
    readonly name: string;
    static lastInstance: MockBroadcastChannel | null = null;
    static instances: MockBroadcastChannel[] = [];
    postMessage = vi.fn();
    close = vi.fn();
    constructor(name: string) {
        super();
        this.name = name;
        MockBroadcastChannel.instances.push(this);
        MockBroadcastChannel.lastInstance = this;
    }
}

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return {
        ...actual,
        useQueryClient: () => ({ clear: queryClientClearMock }),
    };
});

vi.mock('@/stores/useAuthStore', () => ({
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ user: null, setUser: vi.fn(), clear: clearMock }),
}));

function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useCrossTabLogout', () => {
    beforeEach(() => {
        clearMock.mockReset();
        queryClientClearMock.mockReset();
        navigateMock.mockReset();
        MockBroadcastChannel.instances = [];
        MockBroadcastChannel.lastInstance = null;
        vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('dispatching {type:"logout"} clears + clears query cache + navigates', () => {
        renderHook(() => useCrossTabLogout(), { wrapper });

        const channel = MockBroadcastChannel.lastInstance;
        expect(channel).not.toBeNull();

        act(() => {
            channel!.dispatchEvent(new MessageEvent('message', { data: { type: 'logout' } }));
        });

        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('dispatching {type:"login"} does nothing', () => {
        renderHook(() => useCrossTabLogout(), { wrapper });

        const channel = MockBroadcastChannel.lastInstance;
        expect(channel).not.toBeNull();

        act(() => {
            channel!.dispatchEvent(new MessageEvent('message', { data: { type: 'login' } }));
        });

        expect(clearMock).not.toHaveBeenCalled();
        expect(queryClientClearMock).not.toHaveBeenCalled();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('storage event removing slyk-auth key triggers logout', () => {
        renderHook(() => useCrossTabLogout(), { wrapper });

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'slyk-auth', newValue: null }));
        });

        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('storage event for a different key does nothing', () => {
        renderHook(() => useCrossTabLogout(), { wrapper });

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: null }));
        });

        expect(clearMock).not.toHaveBeenCalled();
        expect(queryClientClearMock).not.toHaveBeenCalled();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('broadcastLogout() opens channel, posts {type:"logout"}, closes', () => {
        broadcastLogout();

        expect(MockBroadcastChannel.instances).toHaveLength(1);
        const channel = MockBroadcastChannel.lastInstance!;
        expect(channel.name).toBe('slyk-auth');
        expect(channel.postMessage).toHaveBeenCalledWith({ type: 'logout' });
        expect(channel.close).toHaveBeenCalledTimes(1);
    });
});
