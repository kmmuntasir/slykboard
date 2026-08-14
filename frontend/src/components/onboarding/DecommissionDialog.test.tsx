// SLYK-0240 — <DecommissionDialog> test suite.
//
// Mocking strategy (mirrors OnboardingForm.test.tsx):
//  - api/onboarding.decommissionProject is mocked so a REAL React Query
//    mutation runs against a real queryClient (invalidations exercise the
//    shared onboardingKeys cache).
//  - useToast is mocked to assert the 502 toast / no-toast split.
//
// Coverage per the ticket's test list: slug-gate near-misses (case mismatch,
// extra space, wrong slug), exact-match enable, payload posted, bullet
// variation on githubRepoCreated=false, and 202/400/502 handling.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiClientError } from '@/api/client';
import type { ProjectAgentMeta } from '@/types/onboarding';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        decommissionProject: vi.fn(),
        toastSuccess: vi.fn(),
        toastError: vi.fn(),
    },
}));

vi.mock('@/api/onboarding', () => ({
    onboardingApi: {
        decommissionProject: (...args: unknown[]) => mocks.decommissionProject(...args),
    },
    onboardingKeys: {
        all: ['onboarding'],
        timeline: (slug: string) => ['onboarding', 'timeline', slug],
        adminProjects: () => ['onboarding', 'admin-projects'],
    },
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
    toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { DecommissionDialog } from './DecommissionDialog';
import type { DecommissionProjectInfo } from './DecommissionDialog';

// Fresh client per test — invalidation assertions must not leak cache state.
let queryClient: QueryClient;

const PROJECT: DecommissionProjectInfo = {
    slug: 'inventory-tracker',
    name: 'Inventory Tracker',
    subdomain: 'inventory-tracker',
    lxcCtid: 142,
    githubRepoCreated: true,
};

const META_ROW: ProjectAgentMeta = {
    projectId: 'p-1',
    slug: 'inventory-tracker',
    subdomain: 'inventory-tracker',
    sourceMode: 'new',
    githubRepo: null,
    githubRepoCreated: true,
    stack: 'node-express',
    teamKey: 'kmlab',
    agentBackend: null,
    initialAgentContext: null,
    lxcCtid: 142,
    lanIp: '192.168.31.142',
    systemdService: 'slyk-inventory-tracker',
    zoraxyProxyId: 'z-9',
    onboardingState: 'DECOMMISSIONING',
    onboardingError: null,
    onboardedAt: '2026-08-13T00:00:00.000Z',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
};

function renderDialog(
    project: DecommissionProjectInfo = PROJECT,
    props: Partial<{ isOpen: boolean; onClose: () => void }> = {},
) {
    return render(
        <QueryClientProvider client={queryClient}>
            <DecommissionDialog
                isOpen={props.isOpen ?? true}
                project={project}
                onClose={props.onClose ?? vi.fn()}
            />
        </QueryClientProvider>,
    );
}

function submitButton(): HTMLButtonElement {
    return screen.getByRole('button', { name: /Remove project/i }) as HTMLButtonElement;
}

function typeSlug(text: string) {
    fireEvent.change(screen.getByLabelText(/Type the project slug/i), {
        target: { value: text },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
});

afterEach(() => {
    cleanup();
    queryClient.clear();
});

describe('DecommissionDialog — slug-match gate', () => {
    it('Remove stays disabled while the input is empty', () => {
        renderDialog();
        expect(submitButton().disabled).toBe(true);
    });

    it.each([
        ['case mismatch', 'Inventory-Tracker'],
        ['extra leading space', ' inventory-tracker'],
        ['extra trailing space', 'inventory-tracker '],
        ['wrong slug', 'some-other-project'],
    ])('Remove stays disabled on near-miss: %s', (_name, typed) => {
        renderDialog();
        typeSlug(typed);
        expect(submitButton().disabled).toBe(true);
        expect(mocks.decommissionProject).not.toHaveBeenCalled();
    });

    it('Remove enables only on the exact slug', () => {
        renderDialog();
        typeSlug('inventory-tracker');
        expect(submitButton().disabled).toBe(false);
    });
});

describe('DecommissionDialog — consequences copy', () => {
    it('renders the four onboarding-created bullets (githubRepoCreated=true)', () => {
        renderDialog();
        expect(screen.getByText('This will:')).toBeTruthy();
        expect(screen.getByText(/destroy LXC container 142/i)).toBeTruthy();
        expect(
            screen.getByText(/delete Zoraxy proxy host inventory-tracker\.kmlab\.dev/i),
        ).toBeTruthy();
        expect(screen.getByText(/deregister the repo from the Cyrus agent/i)).toBeTruthy();
        expect(screen.getByText(/delete the GitHub repo \(created by onboarding\)/i)).toBeTruthy();
        expect(screen.getByText(/This action cannot be undone\./i)).toBeTruthy();
    });

    it('swaps the GitHub bullet when githubRepoCreated=false (repo left intact)', () => {
        renderDialog({ ...PROJECT, githubRepoCreated: false });
        expect(screen.getByText(/close any open onboarding PR \(repo left intact\)/i)).toBeTruthy();
        expect(screen.queryByText(/delete the GitHub repo/i)).toBeNull();
        // The other three bullets are unchanged.
        expect(screen.getByText(/destroy LXC container 142/i)).toBeTruthy();
        expect(screen.getByText(/deregister the repo from the Cyrus agent/i)).toBeTruthy();
    });

    it('renders the not-yet-provisioned container bullet when lxcCtid is null', () => {
        renderDialog({ ...PROJECT, lxcCtid: null });
        expect(screen.getByText(/destroy the LXC container \(not yet provisioned\)/i)).toBeTruthy();
        expect(screen.queryByText(/destroy LXC container 142/i)).toBeNull();
    });
});

describe('DecommissionDialog — submit + response handling', () => {
    it('posts the exact typed slug to the decommission endpoint', async () => {
        mocks.decommissionProject.mockResolvedValue(META_ROW);
        renderDialog();

        typeSlug('inventory-tracker');
        fireEvent.click(submitButton());

        await waitFor(() => expect(mocks.decommissionProject).toHaveBeenCalledTimes(1));
        expect(mocks.decommissionProject).toHaveBeenCalledWith('inventory-tracker', {
            confirmSlug: 'inventory-tracker',
        });
    });

    it('202 → closes the modal and invalidates the onboarding cache', async () => {
        mocks.decommissionProject.mockResolvedValue(META_ROW);
        const onClose = vi.fn();
        // Seed the shared timeline cache so invalidation is observable.
        void queryClient.prefetchQuery({
            queryKey: ['onboarding', 'timeline', PROJECT.slug],
            queryFn: () => Promise.resolve({ stale: true }),
        });
        await waitFor(() =>
            expect(
                queryClient.getQueryState(['onboarding', 'timeline', PROJECT.slug])?.data,
            ).toEqual({ stale: true }),
        );

        renderDialog(PROJECT, { onClose });
        typeSlug(PROJECT.slug);
        fireEvent.click(submitButton());

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        // Invalidate → the seeded entry flips to invalidated (fetchStatus idle,
        // isInvalidated true) — the timeline's next poll refetches.
        await waitFor(() =>
            expect(
                queryClient.getQueryState(['onboarding', 'timeline', PROJECT.slug])?.isInvalidated,
            ).toBe(true),
        );
        expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it('400 → inline error, modal stays open, no toast', async () => {
        mocks.decommissionProject.mockRejectedValue(
            new ApiClientError(
                'confirmSlug does not match the project slug',
                400,
                'VALIDATION_FAILED',
                { expected: 'inventory-tracker' },
            ),
        );
        const onClose = vi.fn();
        renderDialog(PROJECT, { onClose });

        typeSlug(PROJECT.slug);
        fireEvent.click(submitButton());

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('confirmSlug does not match');
        expect(onClose).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
        // The gate re-arms: still typed-matched, still enabled for a retry.
        expect(submitButton().disabled).toBe(false);
    });

    it('502 → closes the modal with the dispatcher-unavailable toast', async () => {
        mocks.decommissionProject.mockRejectedValue(
            new ApiClientError(
                'Dispatcher decommission failed: connect ECONNREFUSED',
                502,
                'UPSTREAM_FAILED',
            ),
        );
        const onClose = vi.fn();
        renderDialog(PROJECT, { onClose });

        typeSlug(PROJECT.slug);
        fireEvent.click(submitButton());

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(mocks.toastError).toHaveBeenCalledWith(
            'dispatcher unavailable — retry from project page',
        );
        // No inline error survives the close.
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('DecommissionDialog — cancel behavior', () => {
    it('Cancel button always closes, even before typing', () => {
        const onClose = vi.fn();
        renderDialog(PROJECT, { onClose });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.decommissionProject).not.toHaveBeenCalled();
    });

    it('Escape closes (Modal → useModalA11y Esc handling)', () => {
        const onClose = vi.fn();
        renderDialog(PROJECT, { onClose });

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('reopening (fresh mount, as the page keys it) starts with an empty gate', () => {
        const { unmount } = renderDialog(PROJECT);
        typeSlug('inventory-tracker');
        expect(submitButton().disabled).toBe(false);
        unmount();

        // The page remounts the dialog per open (key={seq}) — a fresh mount
        // must not inherit the previously typed slug.
        renderDialog(PROJECT);
        expect(submitButton().disabled).toBe(true);
        expect((screen.getByLabelText(/Type the project slug/i) as HTMLInputElement).value).toBe(
            '',
        );
    });
});
