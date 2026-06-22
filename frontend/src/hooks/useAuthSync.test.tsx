import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import type { AuthResponse } from '@/api/auth';
import type { AuthUser } from '@/stores/useAuthStore';
import { useAuthSync } from '@/hooks/useAuthSync';

const {
    navigateMock,
    fetchMeMock,
    registerMock,
    decodeJwtMock,
    broadcastLogoutMock,
    logoutApiMock,
} = vi.hoisted(() => ({
    navigateMock: vi.fn(),
    fetchMeMock: vi.fn(),
    registerMock: vi.fn(),
    decodeJwtMock: vi.fn(),
    broadcastLogoutMock: vi.fn(),
    logoutApiMock: vi.fn(),
}));

const setUserMock = vi.fn();
const clearMock = vi.fn();
const queryClientClearMock = vi.fn();

// Module-level controllable store state.
let currentUser: AuthUser | null = null;
// L9: memoized snapshot for useSyncExternalStore — rebuilds only when currentUser
// changes, so React 19 does not warn "getSnapshot should be cached".
let lastUser: unknown; // sentinel distinct from any initial value
let snapshot: {
    user: AuthUser | null;
    setUser: typeof setUserMock;
    clear: typeof clearMock;
} | null = null;
function getSnapshot() {
    if (snapshot === null || lastUser !== currentUser) {
        snapshot = { user: currentUser, setUser: setUserMock, clear: clearMock };
        lastUser = currentUser;
    }
    return snapshot;
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

vi.mock('@/api/auth', () => ({ fetchMe: fetchMeMock, logout: logoutApiMock }));

vi.mock('@/api/client', () => ({ registerLogoutHandlers: registerMock }));

vi.mock('@/stores/useAuthStore', () => ({
    useAuthStore: Object.assign(
        (
            selector: (s: {
                user: AuthUser | null;
                setUser: typeof setUserMock;
                clear: typeof clearMock;
            }) => unknown,
        ) => selector(getSnapshot()),
        { getState: () => getSnapshot() },
    ),
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
        snapshot = null; // force snapshot rebuild
        lastUser = undefined;
        navigateMock.mockReset();
        fetchMeMock.mockReset();
        registerMock.mockReset();
        decodeJwtMock.mockReset();
        setUserMock.mockReset();
        clearMock.mockReset();
        queryClientClearMock.mockReset();
        broadcastLogoutMock.mockReset();
        logoutApiMock.mockReset();
        logoutApiMock.mockResolvedValue(undefined); // default: handler's await logoutApi() resolves
        decodeJwtMock.mockReturnValue({ exp: 0 }); // exp:0 → always near-expiry → boot /me fires
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
            logout: () => Promise<void>;
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

        // (c) logout → best-effort POST before clear; all four side-effects fire once.
        // Simulate a logged-in store so the idempotency guard allows the handler through.
        currentUser = fullUser;
        snapshot = null; // invalidate cache so getState() sees the logged-in user
        setUserMock.mockReset();
        await act(async () => {
            await handlers.logout();
        });
        // M5: logoutApi (POST /auth/logout) invoked BEFORE clear (token still in store).
        expect(logoutApiMock).toHaveBeenCalledTimes(1);
        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
        const [logoutApiOrder] = vi.mocked(logoutApiMock).mock.invocationCallOrder;
        const [clearOrder] = vi.mocked(clearMock).mock.invocationCallOrder;
        expect(logoutApiOrder).toBeDefined();
        expect(clearOrder).toBeDefined();
        expect(logoutApiOrder).toBeLessThan(clearOrder as number);
    });

    // M2: idempotency — the second logout() call (after the store is cleared) is a no-op.
    it('logout handler is idempotent (second call after clear is a no-op)', async () => {
        currentUser = fullUser;
        // Far-future exp so the near-expiry mount run is a no-op (isolates the handler).
        decodeJwtMock.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 60 * 60 });
        snapshot = null;

        renderHook(() => useAuthSync(), { wrapper });
        await flushMicrotasks();

        const handlers = registerMock.mock.calls[0]?.[0] as {
            logout: () => Promise<void>;
        };

        await act(async () => {
            await handlers.logout();
        });

        // Simulate the real store having been cleared by the first call.
        currentUser = null;
        snapshot = null;

        await act(async () => {
            await handlers.logout();
        });

        // Exactly one of each across both invocations.
        expect(logoutApiMock).toHaveBeenCalledTimes(1);
        expect(clearMock).toHaveBeenCalledTimes(1);
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledTimes(1);
    });

    it('near-expiry refreshes within threshold', async () => {
        currentUser = fullUser;
        // Far-from-expiry at mount (no /me on mount run), but within threshold after
        // we advance past the boundary. 6min future at mount; threshold is 5min, so
        // advancing 2min lands at 4min-to-expiry → inside threshold → tick fires /me.
        const futureExp = Math.floor(Date.now() / 1000) + 6 * 60;
        decodeJwtMock.mockReturnValue({ exp: futureExp });
        fetchMeMock.mockResolvedValue(freshResponse);

        vi.useFakeTimers();

        renderHook(() => useAuthSync(), { wrapper });
        // Mount run: token not yet near-expiry → fetchMe must NOT fire here.
        await flushMicrotasks();
        expect(fetchMeMock).not.toHaveBeenCalled();

        // Advance enough that the next interval tick sees msToExpiry ≤ threshold.
        await act(async () => {
            vi.advanceTimersByTime(60_000); // 1 tick later: 5min-to-expiry → boundary crossed
        });
        await flushMicrotasks();

        expect(fetchMeMock).toHaveBeenCalled();
    });
});
