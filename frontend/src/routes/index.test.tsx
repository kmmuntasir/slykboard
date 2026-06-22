import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useProjectStore } from '@/stores/useProjectStore';

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
