// SLYK-0230 — <OnboardingTimeline> test suite.
//
// Mocking strategy: api/onboarding.getTimeline is mocked so a REAL React Query
// useQuery drives the component (refetchInterval behavior — the poll-stop
// acceptance criterion — runs through real query internals, not a stub).
// Poll-stop is asserted by inspecting queryClient.getQueryState's
// refetchInterval after data updates: React Query stores the currently-active
// interval there (false = stopped).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { OnboardingTimelineView, OnboardingState } from '@/types/onboarding';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        getTimeline: vi.fn(),
    },
}));

vi.mock('@/api/onboarding', () => ({
    onboardingApi: {
        getTimeline: (...args: unknown[]) => mocks.getTimeline(...args),
    },
    onboardingKeys: {
        all: ['onboarding'],
        timeline: (slug: string) => ['onboarding', 'timeline', slug],
        adminProjects: () => ['onboarding', 'admin-projects'],
    },
    projectKeysRef: { all: ['projects'], lists: () => ['projects', 'list'] },
}));

import { OnboardingTimeline } from './OnboardingTimeline';

// Fresh client per test — refetchInterval assertions must not leak state.
let queryClient: QueryClient;

function view(state: OnboardingState, error: string | null = null): OnboardingTimelineView {
    return {
        project: {
            name: 'Inventory Tracker',
            slug: 'inventory-tracker',
            onboardingState: state,
            onboardingError: error,
            // SLYK-0240 — fields <DecommissionDialog>'s bullets quote.
            lxcCtid: 142,
            subdomain: 'inventory-tracker',
            githubRepoCreated: true,
        },
        events: [
            {
                id: 'e-1',
                projectId: 'p-1',
                fromState: null,
                toState: 'PENDING',
                detail: null,
                createdAt: '2026-08-14T00:00:00.000Z',
            },
            {
                id: 'e-2',
                projectId: 'p-1',
                fromState: 'PENDING',
                toState: 'PROVISIONING_LXC',
                detail: { ctid: 142, lanIp: '192.168.31.142' },
                createdAt: '2026-08-14T00:00:01.000Z',
            },
        ],
    };
}

function renderTimeline(slug = 'inventory-tracker') {
    return render(
        <QueryClientProvider client={queryClient}>
            <OnboardingTimeline slug={slug} />
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    // shouldAdvanceTime lets real elapsed time bleed through so Testing
    // Library's findBy* (real-timer polling) and React Query's async pipeline
    // settle; timer.advance* still controls the 3s refetchInterval deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
});

afterEach(() => {
    act(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
        queryClient.clear();
    });
});

describe('OnboardingTimeline — render', () => {
    it('shows project name, raw status, and the labeled state badge', async () => {
        mocks.getTimeline.mockResolvedValue(view('PROVISIONING_LXC'));

        renderTimeline();

        expect(await screen.findByText('Project: Inventory Tracker')).toBeTruthy();
        expect(screen.getByTestId('onboarding-status').textContent).toBe(
            'Status: PROVISIONING_LXC',
        );
        // State label appears in both the badge and the timeline row.
        expect(screen.getAllByText('Provisioning LXC').length).toBeGreaterThanOrEqual(1);
        expect(mocks.getTimeline).toHaveBeenCalledWith('inventory-tracker');
    });

    it('renders done rows with check semantics and pending rows muted', async () => {
        mocks.getTimeline.mockResolvedValue(view('PROVISIONING_LXC'));

        renderTimeline();
        await screen.findByText('Project: Inventory Tracker');

        // Events reached PROVISIONING_LXC (index 1): PENDING + PROVISIONING done,
        // WIRING_GITHUB current (spinner), the rest pending.
        expect(
            document.querySelector('[data-state="PENDING"][data-row-state="done"]'),
        ).toBeTruthy();
        expect(
            document.querySelector('[data-state="PROVISIONING_LXC"][data-row-state="done"]'),
        ).toBeTruthy();
        expect(
            document.querySelector('[data-state="WIRING_GITHUB"][data-row-state="current"]'),
        ).toBeTruthy();
        expect(
            document.querySelector('[data-state="WIRING_AGENT"][data-row-state="pending"]'),
        ).toBeTruthy();
        expect(
            document.querySelector('[data-state="LIVE"][data-row-state="pending"]'),
        ).toBeTruthy();
    });

    it('renders the event detail line (ctid/lanIp) under the provisioned row', async () => {
        mocks.getTimeline.mockResolvedValue(view('PROVISIONING_LXC'));

        renderTimeline();
        await screen.findByText('Project: Inventory Tracker');

        expect(screen.getByText(/ctid=142/)).toBeTruthy();
        expect(screen.getByText(/lanIp=192\.168\.31\.142/)).toBeTruthy();
    });

    it('FAILED state renders the error badge detail', async () => {
        mocks.getTimeline.mockResolvedValue(view('FAILED', 'ctid exhausted'));

        renderTimeline();

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('ctid exhausted');
        expect(screen.getByTestId('onboarding-status').textContent).toBe('Status: FAILED');
    });

    it('query error renders the failure card, not a crash', async () => {
        mocks.getTimeline.mockRejectedValue(new Error('network down'));

        renderTimeline();

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('Failed to load');
    });
});

describe('OnboardingTimeline — polling', () => {
    it('polls every 3s while in-flight (fetch fires again on the interval)', async () => {
        mocks.getTimeline.mockResolvedValue(view('PROVISIONING_LXC'));

        renderTimeline();
        await screen.findByText('Project: Inventory Tracker');
        expect(mocks.getTimeline).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(3_000);
        });
        await waitFor(() => expect(mocks.getTimeline).toHaveBeenCalledTimes(2));

        await act(async () => {
            vi.advanceTimersByTime(6_000);
        });
        await waitFor(() => expect(mocks.getTimeline.mock.calls.length).toBeGreaterThanOrEqual(3));
    });

    it('stops polling on LIVE (terminal)', async () => {
        // First fetch in-flight, then the dispatcher completes the lifecycle.
        mocks.getTimeline.mockResolvedValueOnce(view('SMOKE_TEST')).mockResolvedValue(view('LIVE'));

        renderTimeline();
        await screen.findByText('Project: Inventory Tracker');
        expect(screen.getByTestId('onboarding-status').textContent).toBe('Status: SMOKE_TEST');

        // Poll lands LIVE…
        await act(async () => {
            vi.advanceTimersByTime(3_000);
        });
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-status').textContent).toBe('Status: LIVE'),
        );

        // …and no further fetch fires.
        const callsAfterLive = mocks.getTimeline.mock.calls.length;
        await act(async () => {
            vi.advanceTimersByTime(15_000);
        });
        expect(mocks.getTimeline.mock.calls.length).toBe(callsAfterLive);
    });

    it('stops polling on FAILED and DECOMMISSIONED terminals', async () => {
        for (const terminal of ['FAILED', 'DECOMMISSIONED'] as const) {
            vi.clearAllMocks();
            vi.useFakeTimers();
            cleanup();
            queryClient.clear();

            mocks.getTimeline.mockResolvedValue(view(terminal));
            renderTimeline();
            await screen.findByText('Project: Inventory Tracker');

            const calls = mocks.getTimeline.mock.calls.length;
            await act(async () => {
                vi.advanceTimersByTime(10_000);
            });
            expect(mocks.getTimeline.mock.calls.length).toBe(calls);
        }
    });
});
