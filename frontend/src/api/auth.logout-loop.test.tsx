import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import type { AuthResponse } from '@/api/auth';
import type { AuthUser } from '@/stores/useAuthStore';
// NOTE: REAL @/api/client (apiFetch + registerLogoutHandlers) and REAL
// @/stores/useAuthStore are imported — this file exercises the actual
// interceptor ↔ registered-handler ↔ store loop (H4), unlike the per-piece
// unit suites which mock the client.
import { apiFetch, ApiClientError } from '@/api/client';
import { useAuthSync } from '@/hooks/useAuthSync';
import { useAuthStore } from '@/stores/useAuthStore';

const {
    navigateMock,
    fetchMeMock,
    logoutApiMock,
    decodeJwtMock,
    broadcastLogoutMock,
    queryClientClearMock,
} = vi.hoisted(() => ({
    navigateMock: vi.fn(),
    fetchMeMock: vi.fn(),
    logoutApiMock: vi.fn(),
    decodeJwtMock: vi.fn(),
    broadcastLogoutMock: vi.fn(),
    queryClientClearMock: vi.fn(),
}));

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return { ...actual, useQueryClient: () => ({ clear: queryClientClearMock }) };
});

vi.mock('@/api/auth', () => ({ fetchMe: fetchMeMock, logout: logoutApiMock }));
vi.mock('jose', () => ({ decodeJwt: decodeJwtMock }));
vi.mock('@/hooks/useCrossTabLogout', () => ({ broadcastLogout: broadcastLogoutMock }));

const fullUser: AuthUser = {
    token: 'stale-tok',
    id: 'u1',
    email: 'a@x.com',
    name: 'A',
    role: 'MEMBER',
    avatarUrl: null,
    blocked: false,
};

const freshResponse: AuthResponse = {
    token: 'fresh-tok',
    user: { id: 'u1', email: 'a@x.com', fullName: 'A', role: 'MEMBER', avatarUrl: null },
};

// Queue of HTTP statuses for non-/auth/ requests (the protected board call).
// Each protected request pops the front; default [401] reproduces a stale
// ver-mismatch token that never recovers.
let boardQueue: number[] = [];

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
}

async function flushMicrotasks() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('logout loop — real apiFetch interceptor ↔ registered handlers ↔ store (H4)', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        navigateMock.mockReset();
        fetchMeMock.mockReset();
        logoutApiMock.mockReset();
        decodeJwtMock.mockReset();
        queryClientClearMock.mockReset();
        broadcastLogoutMock.mockReset();

        // Far-future exp so useAuthSync's mount near-expiry check is a no-op —
        // isolates the test to the manual apiFetch call below.
        decodeJwtMock.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 });
        logoutApiMock.mockResolvedValue(undefined);
        fetchMeMock.mockRejectedValue(new Error('stale')); // refresh fails by default
        boardQueue = [401];

        // REAL store: seed a logged-in user, then reset localStorage.
        useAuthStore.getState().clear();
        localStorage.clear();
        useAuthStore.getState().setUser(fullUser);

        // global.fetch — the only network seam. /auth/* is never hit here
        // (fetchMe/logout are mocked); everything else drains boardQueue.
        global.fetch = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/auth/')) {
                return jsonResponse(200, { data: { ok: true } });
            }
            const status = boardQueue.shift() ?? 401;
            if (status === 401) {
                return jsonResponse(401, {
                    error: { code: 'UNAUTHENTICATED', message: 'Token version mismatch' },
                });
            }
            return jsonResponse(status, { data: { board: 'ok' } });
        }) as typeof fetch;

        // Mount the real hook so registerLogoutHandlers wires the real handlers
        // into the real client singleton before apiFetch is invoked.
        renderHook(() => useAuthSync(), { wrapper });
        await flushMicrotasks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('full loop: stale 401 → refresh fails → logout → state cleared + redirect + 401 thrown', async () => {
        let caught: unknown;
        await act(async () => {
            try {
                await apiFetch('/projects/1/board');
            } catch (e) {
                caught = e;
            }
        });

        // Interceptor attempted exactly one refresh (/me).
        expect(fetchMeMock).toHaveBeenCalledTimes(1);
        // Best-effort server bump fired (M5).
        expect(logoutApiMock).toHaveBeenCalledTimes(1);
        // Store cleared.
        expect(useAuthStore.getState().user).toBeNull();
        // All logout side-effects fired exactly once.
        expect(queryClientClearMock).toHaveBeenCalledTimes(1);
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
        // Caller sees a 401, not a hang or silent success.
        expect(caught).toBeInstanceOf(ApiClientError);
        expect((caught as ApiClientError).status).toBe(401);
    });

    it('concurrent stale 401s coalesce: one refresh, one logout, both reject (H2 through the loop)', async () => {
        let errA: unknown;
        let errB: unknown;
        await act(async () => {
            await Promise.all([
                apiFetch('/projects/1/board').catch((e) => {
                    errA = e;
                }),
                apiFetch('/projects/1/board').catch((e) => {
                    errB = e;
                }),
            ]);
        });

        expect(fetchMeMock).toHaveBeenCalledTimes(1); // single coalesced refresh
        expect(navigateMock).toHaveBeenCalledTimes(1); // single logout
        expect(logoutApiMock).toHaveBeenCalledTimes(1);
        expect(errA).toBeInstanceOf(ApiClientError);
        expect(errB).toBeInstanceOf(ApiClientError);
        expect((errA as ApiClientError).status).toBe(401);
        expect((errB as ApiClientError).status).toBe(401);
    });

    it('refresh succeeds → retry once → no logout, store refreshed, data returned', async () => {
        // Refresh lands a fresh token; the retried board call then succeeds.
        fetchMeMock.mockResolvedValue(freshResponse);
        boardQueue = [401, 200];

        let result: unknown;
        await act(async () => {
            result = await apiFetch('/projects/1/board');
        });

        expect(fetchMeMock).toHaveBeenCalledTimes(1);
        // No logout path taken.
        expect(logoutApiMock).not.toHaveBeenCalled();
        expect(queryClientClearMock).not.toHaveBeenCalled();
        expect(broadcastLogoutMock).not.toHaveBeenCalled();
        expect(navigateMock).not.toHaveBeenCalled();
        // Store holds the refreshed user (mapped fullName → name).
        expect(useAuthStore.getState().user?.token).toBe('fresh-tok');
        // The retried request's data surfaced to the caller.
        expect(result).toEqual({ board: 'ok' });
    });
});
