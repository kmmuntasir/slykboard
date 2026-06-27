// F49: project-scoped ReportsPage tests. Covers the F49 acceptance surface:
//   - slug read from :slug route param (scoped route renders the page)
//   - D7: BE 403 (FORBIDDEN) → Navigate to /projects
//   - loading skeleton, error/retry, empty-state (lucide icon)
// Mocks the report hooks directly (not the API) so no network is needed and
// each test controls the { data, isLoading, error, refetch } shape precisely.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    ReportsPage,
} from './ReportsPage';
import { ApiClientError } from '@/api/client';

// Per-render hook state. Tests mutate before render.
type ReportState = {
    data?: { users: unknown[]; window: { label: string } } | undefined;
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
};

const { timeState, ticketState } = vi.hoisted(() => ({
    timeState: { data: undefined, isLoading: false, error: undefined, refetch: () => {} } as ReportState,
    ticketState: { data: undefined, isLoading: false, error: undefined, refetch: () => {} } as ReportState,
}));

vi.mock('@/hooks/useReport', () => ({
    useReport: () => timeState,
    useTicketSummary: () => ticketState,
}));

function resetState() {
    timeState.data = { users: [], window: { label: 'This week' } };
    timeState.isLoading = false;
    timeState.error = undefined;
    ticketState.data = { users: [], window: { label: 'This week' } };
    ticketState.isLoading = false;
    ticketState.error = undefined;
}

// Render at a scoped route so useParams<{ slug }> resolves. A trailing catch-all
// records navigations so the 403 redirect test can assert the target location.
function renderAt(path: string) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/projects/:slug/reports" element={<ReportsPage />} />
                    {/* D7 redirect target — surfaces as text the test can find. */}
                    <Route path="/projects" element={<div>projects-chooser</div>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('ReportsPage', () => {
    beforeEach(() => {
        resetState();
    });

    it('renders the heading at the scoped route', () => {
        renderAt('/projects/SLYK/reports');
        expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    });

    it('renders the time-report empty state when there are no users', () => {
        renderAt('/projects/SLYK/reports');
        // lucide Inbox renders as an <svg>; the empty copy is the stable hook.
        expect(screen.getByText('No time tracked in this period.')).toBeInTheDocument();
    });

    it('renders the ticket-summary empty state when there are no resolved tickets', () => {
        renderAt('/projects/SLYK/reports');
        expect(
            screen.getByText('No resolved tickets in this period.'),
        ).toBeInTheDocument();
    });

    it('renders a loading surface while reports load', () => {
        timeState.isLoading = true;
        ticketState.isLoading = true;
        timeState.data = undefined;
        ticketState.data = undefined;
        renderAt('/projects/SLYK/reports');
        // Skeletons are aria-hidden; assert the page chrome is present and no
        // empty-state copy leaks out during loading.
        expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
        expect(screen.queryByText('No time tracked in this period.')).toBeNull();
    });

    it('renders a Retry control on error', () => {
        timeState.error = new Error('boom');
        ticketState.error = new Error('boom');
        renderAt('/projects/SLYK/reports');
        const retries = screen.getAllByRole('alert');
        expect(retries.length).toBeGreaterThan(0);
        expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
    });

    // D7: a backend 403 from requireProjectMember bounces to /projects.
    it('redirects to /projects on a 403 FORBIDDEN (non-member)', () => {
        timeState.error = new ApiClientError('You do not have access', 403, 'FORBIDDEN');
        timeState.data = undefined;
        ticketState.error = new ApiClientError('You do not have access', 403, 'FORBIDDEN');
        ticketState.data = undefined;
        renderAt('/projects/SLYK/reports');
        expect(screen.getByText('projects-chooser')).toBeInTheDocument();
    });

    it('redirects to /projects on a 403 via status alone', () => {
        timeState.error = new ApiClientError('denied', 403, 'INTERNAL_ERROR');
        timeState.data = undefined;
        ticketState.data = { users: [], window: { label: 'This week' } };
        ticketState.error = undefined;
        renderAt('/projects/SLYK/reports');
        expect(screen.getByText('projects-chooser')).toBeInTheDocument();
    });
});
