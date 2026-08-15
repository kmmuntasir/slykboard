// SLYK-0430 — /admin/projects dashboard tests: multi-select state chips,
// 300ms-debounced search, FAILED-row error detail + timeline link.
// api/projects + api/onboarding are mocked; the runtime store is seeded to
// agentMode so the queries enable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        listProjects: vi.fn(),
        getTimeline: vi.fn(),
    },
}));

vi.mock('@/api/projects', () => ({ listProjects: mocks.listProjects }));
vi.mock('@/api/onboarding', () => ({
    onboardingApi: { getTimeline: mocks.getTimeline },
    onboardingKeys: { timeline: (slug: string) => ['onboarding', 'timeline', slug] },
}));

import { AdminProjectsPage } from './AdminProjectsPage';
import { useRuntimeConfigStore } from '@/stores/useRuntimeConfigStore';
import type { OnboardingState, OnboardingTimelineView } from '@/types/onboarding';

let queryClient: QueryClient;

function timeline(state: OnboardingState, error: string | null = null): OnboardingTimelineView {
    return {
        project: {
            name: state,
            slug: state.toLowerCase(),
            onboardingState: state,
            onboardingError: error,
            lxcCtid: null,
            subdomain: state.toLowerCase(),
            githubRepoCreated: false,
        },
        events: [],
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <QueryClientProvider client={queryClient}>
                <AdminProjectsPage />
            </QueryClientProvider>
        </MemoryRouter>,
    );
}

const PROJECTS = [
    { id: 'p1', name: 'Inventory Tracker', slug: 'INVENTORYTRACKER', isActive: true },
    { id: 'p2', name: 'Blog Engine', slug: 'BLOGENGINE', isActive: true },
    { id: 'p3', name: 'Old Thing', slug: 'OLDTHING', isActive: false },
];

beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    useRuntimeConfigStore.getState().set({ agentMode: true, dispatcherUrl: null });

    mocks.listProjects.mockResolvedValue(PROJECTS);
    // Slug-indexed timeline map; null = 404 (not an agent project).
    const timelines: Record<string, OnboardingTimelineView | null> = {
        inventorytracker: timeline('LIVE'),
        blogengine: timeline('FAILED', 'LXC provisioning timed out'),
        oldthing: null,
    };
    mocks.getTimeline.mockImplementation(async (slug: string) => {
        const t = timelines[slug];
        if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
        return t;
    });
});

afterEach(() => {
    cleanup();
    useRuntimeConfigStore.getState().set({ agentMode: false, dispatcherUrl: null });
});

async function rows(): Promise<string[]> {
    // Wait for at least one row to settle (the list re-renders synchronously
    // from cached query data after a filter toggle).
    await waitFor(() => {
        expect(screen.queryAllByRole('listitem').length + screen.queryAllByText(/No agent-mode projects/).length).toBeGreaterThan(0);
    });
    return screen
        .getAllByRole('listitem')
        .map((li) => li.textContent ?? '');
}

describe('AdminProjectsPage dashboard (SLYK-0430)', () => {
    it('renders agent projects with badges; inactive + non-agent rows drop out', async () => {
        renderPage();

        const text = (await rows()).join('\n');
        expect(text).toContain('Inventory Tracker');
        expect(text).toContain('Blog Engine');
        expect(text).not.toContain('Old Thing');
        // Badge (not the filter chip) carries the state text.
        expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    });

    it('FAILED row shows the onboarding error detail', async () => {
        renderPage();
        await rows();

        expect(screen.getByText(/LXC provisioning timed out/)).toBeInTheDocument();
    });

    it('single + multi state-chip filters narrow the list', async () => {
        renderPage();
        expect(((await rows())).length).toBe(2);

        // Single: only FAILED survives.
        fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
        let text = (await rows()).join('\n');
        expect(text).not.toContain('Inventory Tracker');
        expect(text).toContain('Blog Engine');

        // Multi: FAILED + Live shows both again.
        fireEvent.click(screen.getByRole('button', { name: 'Live' }));
        text = (await rows()).join('\n');
        expect(text).toContain('Inventory Tracker');
        expect(text).toContain('Blog Engine');

        // Untoggle → all states.
        fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
        fireEvent.click(screen.getByRole('button', { name: 'Live' }));
        expect(((await rows())).length).toBe(2);
    });

    it('search debounces 300ms and matches name or slug case-insensitively', async () => {
        vi.useFakeTimers();
        try {
            renderPage();
            await vi.waitFor(() => screen.getByText('Inventory Tracker'));

            fireEvent.change(screen.getByLabelText(/Search projects/i), {
                target: { value: 'blog' },
            });
            // Pre-debounce: both rows still present.
            expect(screen.getByText('Inventory Tracker')).toBeInTheDocument();

            await vi.advanceTimersByTimeAsync(301);
            await vi.waitFor(() => {
                expect(screen.queryByText('Inventory Tracker')).toBeNull();
            });
            expect(screen.getByText('Blog Engine')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});
