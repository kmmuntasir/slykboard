import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { broadcastLogout, useCrossTabLogout } from '@/hooks/useCrossTabLogout';
import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';
import { AUTH_STORAGE_KEY } from '@/constants/auth';

const { navigateMock } = vi.hoisted(() => ({
    navigateMock: vi.fn(),
}));

const queryClientClearMock = vi.fn();

const testUser: AuthUser = {
    token: 't',
    id: 'u1',
    email: 'a@b.c',
    name: 'N',
    role: 'ADMIN',
    avatarUrl: null,
};

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

function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useCrossTabLogout', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
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
        useAuthStore.getState().setUser(testUser);
        renderHook(() => useCrossTabLogout(), { wrapper });

        const channel = MockBroadcastChannel.lastInstance;
        expect(channel).not.toBeNull();

        act(() => {
            channel!.dispatchEvent(new MessageEvent('message', { data: { type: 'logout' } }));
        });

        expect(useAuthStore.getState().user).toBeNull();
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('storage event with newValue:null (real key removal) triggers remote logout', () => {
        useAuthStore.getState().setUser(testUser);
        renderHook(() => useCrossTabLogout(), { wrapper });

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', { key: AUTH_STORAGE_KEY, newValue: null }),
            );
        });

        expect(useAuthStore.getState().user).toBeNull();
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('storage event with a cleared envelope (parsed user===null) triggers remote logout', () => {
        useAuthStore.getState().setUser(testUser);
        renderHook(() => useCrossTabLogout(), { wrapper });

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: AUTH_STORAGE_KEY,
                    newValue: JSON.stringify({ state: { user: null }, version: 0 }),
                }),
            );
        });

        expect(useAuthStore.getState().user).toBeNull();
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('storage event for a different key does nothing', () => {
        useAuthStore.getState().setUser(testUser);
        renderHook(() => useCrossTabLogout(), { wrapper });

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: null }));
        });

        expect(useAuthStore.getState().user).not.toBeNull();
        expect(queryClientClearMock).not.toHaveBeenCalled();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('broadcastLogout() opens channel, posts {type:"logout"}, closes', () => {
        broadcastLogout();

        expect(MockBroadcastChannel.instances).toHaveLength(1);
        const channel = MockBroadcastChannel.lastInstance!;
        expect(channel.name).toBe(AUTH_STORAGE_KEY);
        expect(channel.postMessage).toHaveBeenCalledWith({ type: 'logout' });
        expect(channel.close).toHaveBeenCalledTimes(1);
    });
});
