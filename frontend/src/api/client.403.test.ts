// SLYK-01 Task O — covers the centralized project-access 403 handler in
// apiFetch (client.ts). The handler is registered via registerForbiddenHandler
// and fires ONLY when ALL of: status 403, code 'FORBIDDEN', the byte-identical
// project-access-denied message, AND a project-scoped path (/projects/:slug...).
// It must NOT trigger the 401 refresh cycle (403 ≠ 401) and must NOT fire on a
// non-project-scoped 403. The caller still receives the ApiClientError so query/
// mutation handlers resolve normally.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiClientError, registerForbiddenHandler, registerLogoutHandlers } from './client';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

const PROJECT_ACCESS_DENIED = 'You do not have access to this project';

const MOCK_USER: AuthUser = {
    token: 'tok',
    id: 'u1',
    email: 'e',
    name: 'n',
    isPlatformAdmin: false,
    displayName: null,
    avatarUrl: null,
    blocked: false,
};

function forbiddenResponse(message: string): Response {
    return new Response(
        JSON.stringify({ error: { code: 'FORBIDDEN', message } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
}

describe('apiFetch 403 project-access handler', () => {
    let onProjectAccessDenied: ReturnType<typeof vi.fn>;
    let refresh: ReturnType<typeof vi.fn>;
    let logout: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        useAuthStore.getState().clear();
        useAuthStore.getState().setUser(MOCK_USER);
        onProjectAccessDenied = vi.fn();
        refresh = vi.fn();
        logout = vi.fn();
        // Register BOTH handlers so we can assert the 401 refresh cycle is NOT
        // touched by a 403 (refresh/logout must remain uncalled).
        registerLogoutHandlers({ refresh, logout });
        registerForbiddenHandler({ onProjectAccessDenied });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        registerForbiddenHandler(null);
    });

    it('project-scoped 403 with the access-denied message fires the handler (toast + nav source)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            forbiddenResponse(PROJECT_ACCESS_DENIED),
        );

        await expect(
            apiFetch('/projects/acme/members'),
        ).rejects.toBeInstanceOf(ApiClientError);

        expect(onProjectAccessDenied).toHaveBeenCalledTimes(1);
        // Byte-identical message passed to the handler (toast renders it verbatim).
        expect(onProjectAccessDenied).toHaveBeenCalledWith(PROJECT_ACCESS_DENIED);
    });

    it('project-scoped 403 with a DIFFERENT message (wrong-domain email) does NOT fire the handler', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            forbiddenResponse('Email domain not allowed'),
        );

        await expect(
            apiFetch('/projects/acme/members/new'),
        ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

        expect(onProjectAccessDenied).not.toHaveBeenCalled();
    });

    it('non-project-scoped 403 (e.g. /users) does NOT fire the handler even with the same message', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            forbiddenResponse(PROJECT_ACCESS_DENIED),
        );

        await expect(apiFetch('/users')).rejects.toMatchObject({ status: 403 });

        expect(onProjectAccessDenied).not.toHaveBeenCalled();
    });

    it('a 403 never triggers the 401 refresh cycle (refresh + logout stay uncalled)', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            forbiddenResponse(PROJECT_ACCESS_DENIED),
        );

        await expect(apiFetch('/projects/acme/board')).rejects.toMatchObject({ status: 403 });

        expect(refresh).not.toHaveBeenCalled();
        expect(logout).not.toHaveBeenCalled();
    });

    it('caller still receives the ApiClientError (status + message) after the handler fires', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            forbiddenResponse(PROJECT_ACCESS_DENIED),
        );

        let caught: unknown;
        try {
            await apiFetch('/projects/acme/labels');
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(ApiClientError);
        expect((caught as ApiClientError).status).toBe(403);
        expect((caught as ApiClientError).message).toBe(PROJECT_ACCESS_DENIED);
        expect((caught as ApiClientError).code).toBe('FORBIDDEN');
    });

    it('no handler registered: project-scoped 403 still rejects (no throw, no crash)', async () => {
        registerForbiddenHandler(null);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            forbiddenResponse(PROJECT_ACCESS_DENIED),
        );

        await expect(
            apiFetch('/projects/acme/members'),
        ).rejects.toMatchObject({ status: 403, message: PROJECT_ACCESS_DENIED });
        expect(onProjectAccessDenied).not.toHaveBeenCalled();
    });
});
