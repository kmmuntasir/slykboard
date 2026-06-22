import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import type { AuthResponse } from '@/api/auth';
import type { AuthUser } from '@/stores/useAuthStore';
import { useAuthSync } from '@/hooks/useAuthSync';

const { navigateMock, fetchMeMock, registerMock, decodeJwtMock, broadcastLogoutMock } = vi.hoisted(
    () => ({
        navigateMock: vi.fn(),
        fetchMeMock: vi.fn(),
        registerMock: vi.fn(),
        decodeJwtMock: vi.fn(),
        broadcastLogoutMock: vi.fn(),
    }),
);

const setUserMock = vi.fn();
const clearMock = vi.fn();
const queryClientClearMock = vi.fn();

// Module-level controllable store state.
let currentUser: AuthUser | null = null;

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

vi.mock('@/api/auth', () => ({ fetchMe: fetchMeMock }));

vi.mock('@/api/client', () => ({ registerLogoutHandlers: registerMock }));

vi.mock('@/stores/useAuthStore', () => ({
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ user: currentUser, setUser: setUserMock, clear: clearMock }),
}));

vi.mock('jose', () => ({ decodeJwt: decodeJwtMock }));

vi.mock('@/hooks/useCrossTabLogout', () => ({ broadcastLogout: broadcastLogoutMock }));

const freshResponse: AuthResponse = {
    token: 'fresh-tok',
    user: {
        id: 'u1',
        email: 'e@x.com',
        fullName: 'New Name',
        role: 'MEMBER',
        avatarUrl: null,
    },
};

const fullUser: AuthUser = {
    token: 'old',
    id: 'u-orig',
    email: 'orig@x.com',
    name: 'Orig',
    role: 'MEMBER',
    avatarUrl: null,
};

function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
}

async function flushMicrotasks() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('useAuthSync', () => {
    beforeEach(() => {
        currentUser = null;
        navigateMock.mockReset();
        fetchMeMock.mockReset();
        registerMock.mockReset();
        decodeJwtMock.mockReset();
        setUserMock.mockReset();
        clearMock.mockReset();
        queryClientClearMock.mockReset();
        broadcastLogoutMock.mockReset();
        decodeJwtMock.mockReturnValue({ exp: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('boot rehydrates when token exists (fullName → name mapping)', async () => {
        currentUser = fullUser;
        fetchMeMock.mockResolvedValue(freshResponse);

        renderHook(() => useAuthSync(), { wrapper });
        await flushMicrotasks();

        expect(fetchMeMock).toHaveBeenCalledTimes(1);
        expect(setUserMock).toHaveBeenCalledWith({
            token: 'fresh-tok',
            id: 'u1',
            email: 'e@x.com',
            name: 'New Name',
            role: 'MEMBER',
            avatarUrl: null,
        });
    });

    it('boot clears + redirects when fetchMe fails', async () => {
        currentUser = fullUser;
        fetchMeMock.mockRejectedValue(new Error('boom'));

        renderHook(() => useAuthSync(), { wrapper });
        await flushMicrotasks();

        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('boot is a no-op when no token', async () => {
        currentUser = null;

        renderHook(() => useAuthSync(), { wrapper });
        await flushMicrotasks();

        expect(fetchMeMock).not.toHaveBeenCalled();
    });

    it('registers logout handlers with refresh + logout semantics', async () => {
        // No boot fetchMe noise: user has no token, but register effect still fires.
        currentUser = null;

        renderHook(() => useAuthSync(), { wrapper });
        await flushMicrotasks();

        expect(registerMock).toHaveBeenCalledTimes(1);
        const handlers = registerMock.mock.calls[0]?.[0] as {
            refresh: () => Promise<boolean>;
            logout: () => void;
        };
        expect(typeof handlers.refresh).toBe('function');
        expect(typeof handlers.logout).toBe('function');

        // (a) refresh success → true + setUser with mapped user.
        fetchMeMock.mockResolvedValue(freshResponse);
        let ok = false;
        await act(async () => {
            ok = await handlers.refresh();
        });
        expect(ok).toBe(true);
        expect(setUserMock).toHaveBeenCalledWith({
            token: 'fresh-tok',
            id: 'u1',
            email: 'e@x.com',
            name: 'New Name',
            role: 'MEMBER',
            avatarUrl: null,
        });

        // (b) refresh failure → false.
        fetchMeMock.mockRejectedValue(new Error('nope'));
        let failOk = true;
        await act(async () => {
            failOk = await handlers.refresh();
        });
        expect(failOk).toBe(false);

        // (c) logout → clears + queryClient.clear + broadcast + navigate.
        setUserMock.mockReset();
        await act(async () => {
            handlers.logout();
        });
        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('near-expiry refreshes within threshold', async () => {
        currentUser = fullUser;
        decodeJwtMock.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 120 }); // 2min future
        fetchMeMock.mockResolvedValue(freshResponse);

        vi.useFakeTimers();

        renderHook(() => useAuthSync(), { wrapper });
        // Let boot effect complete first.
        await flushMicrotasks();

        // Isolate the interval call.
        fetchMeMock.mockClear();

        await act(async () => {
            vi.advanceTimersByTime(60_000);
        });
        await flushMicrotasks();

        expect(fetchMeMock).toHaveBeenCalled();
    });
});
