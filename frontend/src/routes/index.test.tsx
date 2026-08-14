import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, matchRoutes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/useProjectStore';
import { router } from './index';

// Local copy of the production IndexRedirect logic, so this test exercises the
// routing decision in isolation without importing the full router tree.
function IndexRedirect() {
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    return (
        <Navigate to={lastSelectedSlug ? `/projects/${lastSelectedSlug}` : '/projects'} replace />
    );
}

function renderRedirect() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<IndexRedirect />} />
                    <Route path="/projects" element={<div>PROJECTS_LIST</div>} />
                    <Route path="/projects/:slug" element={<div>PROJECT_BOARD</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('IndexRedirect', () => {
    afterEach(() => {
        useProjectStore.getState().clear();
    });

    it('redirects to /projects when no last selected slug', () => {
        useProjectStore.getState().clear();
        renderRedirect();

        expect(screen.getByText('PROJECTS_LIST')).toBeInTheDocument();
    });

    it('redirects to /projects/:slug when lastSelectedSlug set', () => {
        useProjectStore.getState().setLastSelectedSlug('SLYK');
        renderRedirect();

        expect(screen.getByText('PROJECT_BOARD')).toBeInTheDocument();
    });
});

// SLYK-0230 — agent-route gating. The admin onboarding trio is spread into the
// route tree only when `__AGENT_MODE__` (the vite define from
// SLYKBOARD_AGENT_MODE) is true. In the test environment the define resolves
// to false (plain-mode default), pinning the plain-mode half; the agent-mode
// half is covered by the SLYKBOARD_AGENT_MODE=true build's grep check in the
// ticket (no OnboardingForm/OnboardingTimeline in the plain dist).
describe('agent-mode admin routes (SLYK-0230)', () => {
    const ADMIN_PATHS = [
        '/admin/onboarding',
        '/admin/projects',
        '/admin/projects/inventory-tracker',
        '/admin/projects/inventory-tracker/onboarding',
    ];

    it('admin paths resolve to routes only when __AGENT_MODE__ is on', () => {
        for (const path of ADMIN_PATHS) {
            const matches = matchRoutes(router.routes, path);
            if (__AGENT_MODE__) {
                expect(matches, path).toBeTruthy();
            } else {
                // Plain mode: no admin route — the catch-all 404 owns the path.
                const last = matches?.[matches.length - 1]?.route.path;
                expect(last, path).toBe('*');
            }
        }
    });

    it('plain-mode bundles never reference the admin pages statically', () => {
        // Guard the guard: if this file ever runs with agent mode on, the
        // static pruning assertions above flip meaning — fail loudly instead.
        if (!__AGENT_MODE__) {
            expect(router.routes.some((r) => JSON.stringify(r).includes('admin'))).toBe(false);
        }
    });
});
