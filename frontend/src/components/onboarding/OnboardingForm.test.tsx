// SLYK-0230 — <OnboardingForm> test suite.
//
// Mocking strategy (mirrors AddMemberModal.test.tsx):
//  - api/onboarding.createProject is mocked so a REAL React Query mutation
//    runs against the REAL queryClient (invalidations exercise real code).
//  - useToast is mocked to assert the 5xx toast / no-toast-on-4xx split.
//  - react-router's useNavigate is stubbed via MemoryRouter + a navigate spy
//    passed through the component's navigate test seam.
//
// Coverage per the ticket's acceptance criteria: toggle switches repo-field
// visibility; validation mirrors backend rules (slug pattern, reserved
// subdomains, SSH/HTTPS URL); submit disabled until valid; 4xx inline vs 5xx
// toast; 201 → redirect to the timeline page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

import { queryClient } from '@/lib/queryClient';
import { ApiClientError } from '@/api/client';
import type { CreatedAgentProject } from '@/types/onboarding';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        createProject: vi.fn(),
        toastSuccess: vi.fn(),
        toastError: vi.fn(),
        navigate: vi.fn(),
    },
}));

vi.mock('@/api/onboarding', () => ({
    onboardingApi: {
        createProject: (...args: unknown[]) => mocks.createProject(...args),
    },
    onboardingKeys: {
        all: ['onboarding'],
        timeline: (slug: string) => ['onboarding', 'timeline', slug],
        adminProjects: () => ['onboarding', 'admin-projects'],
    },
    projectKeysRef: { all: ['projects'], lists: () => ['projects', 'list'] },
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
    toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { OnboardingForm } from './OnboardingForm';

const CREATED: CreatedAgentProject = {
    id: 'p-1',
    name: 'Inventory Tracker',
    slug: 'inventorytracker',
    creatorId: 'u-1',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
};

function renderForm() {
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <OnboardingForm navigate={mocks.navigate} />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

/** Fill every required field with valid values. */
function fillValid() {
    fireEvent.change(screen.getByLabelText(/Project name/i), {
        target: { value: 'Inventory Tracker' },
    });
    // slug auto-derives from the name; type it explicitly to be safe.
    fireEvent.change(screen.getByLabelText(/^Slug$/i), { target: { value: 'inventory-tracker' } });
    fireEvent.change(screen.getByLabelText(/Subdomain/i), {
        target: { value: 'inventory-tracker' },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('OnboardingForm — toggle UX', () => {
    it('repo URL field is hidden under the default "New from template" mode', () => {
        renderForm();
        expect(screen.queryByLabelText(/GitHub repo URL/i)).toBeNull();
    });

    it('switching to "Existing repo" reveals the URL field', () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        expect(screen.getByLabelText(/GitHub repo URL/i)).toBeTruthy();
    });

    it('switching back hides the field again', () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        fireEvent.click(screen.getByRole('button', { name: /New from template/i }));
        expect(screen.queryByLabelText(/GitHub repo URL/i)).toBeNull();
    });

    it('toggle buttons expose aria-pressed state', () => {
        renderForm();
        expect(
            screen.getByRole('button', { name: /New from template/i }).getAttribute('aria-pressed'),
        ).toBe('true');
        expect(
            screen.getByRole('button', { name: /Existing repo/i }).getAttribute('aria-pressed'),
        ).toBe('false');
    });
});

describe('OnboardingForm — slug auto-derivation', () => {
    it('typing a name seeds the slug (lowercased, hyphenated)', () => {
        renderForm();
        fireEvent.change(screen.getByLabelText(/Project name/i), {
            target: { value: 'Inventory Tracker!' },
        });
        expect((screen.getByLabelText(/^Slug$/i) as HTMLInputElement).value).toBe(
            'inventory-tracker',
        );
    });

    it('editing the slug disables auto-derivation', () => {
        renderForm();
        fireEvent.change(screen.getByLabelText(/^Slug$/i), { target: { value: 'custom' } });
        fireEvent.change(screen.getByLabelText(/Project name/i), {
            target: { value: 'Other Name' },
        });
        expect((screen.getByLabelText(/^Slug$/i) as HTMLInputElement).value).toBe('custom');
    });
});

describe('OnboardingForm — validation gates', () => {
    it('submit disabled with empty required fields', () => {
        renderForm();
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });

    it('valid required fields enable submit in "new" mode', () => {
        renderForm();
        fillValid();
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(false);
    });

    it('uppercase slug keeps submit disabled (kebab pattern)', () => {
        renderForm();
        fireEvent.change(screen.getByLabelText(/Project name/i), { target: { value: 'X' } });
        fireEvent.change(screen.getByLabelText(/^Slug$/i), { target: { value: 'BadSlug' } });
        fireEvent.change(screen.getByLabelText(/Subdomain/i), { target: { value: 'ok-sub' } });
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });

    it('reserved subdomain (admin) keeps submit disabled', () => {
        renderForm();
        fireEvent.change(screen.getByLabelText(/Project name/i), { target: { value: 'X' } });
        fireEvent.change(screen.getByLabelText(/^Slug$/i), { target: { value: 'x-slug' } });
        fireEvent.change(screen.getByLabelText(/Subdomain/i), { target: { value: 'admin' } });
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });

    it('existing mode requires a repo URL (submit disabled while empty)', () => {
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });

    it('SSH URL passes validation', () => {
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        fireEvent.change(screen.getByLabelText(/GitHub repo URL/i), {
            target: { value: 'git@github.com:org/repo.git' },
        });
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(false);
    });

    it('HTTPS .git URL passes validation', () => {
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        fireEvent.change(screen.getByLabelText(/GitHub repo URL/i), {
            target: { value: 'https://github.com/org/repo.git' },
        });
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(false);
    });

    it('non-.git web URL fails validation', () => {
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        fireEvent.change(screen.getByLabelText(/GitHub repo URL/i), {
            target: { value: 'https://github.com/org/repo' },
        });
        expect(
            (screen.getByRole('button', { name: /Create project/i }) as HTMLButtonElement).disabled,
        ).toBe(true);
    });
});

describe('OnboardingForm — submit flow', () => {
    it('sends the right payload and redirects to the timeline page on 201', async () => {
        mocks.createProject.mockResolvedValue(CREATED);
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Create project/i }));

        await waitFor(() =>
            expect(mocks.navigate).toHaveBeenCalledWith(
                '/admin/projects/inventory-tracker/onboarding',
            ),
        );

        expect(mocks.createProject).toHaveBeenCalledWith({
            name: 'Inventory Tracker',
            slug: 'inventory-tracker',
            subdomain: 'inventory-tracker',
            sourceMode: 'new',
            githubRepo: null,
            stack: 'node-express',
            agentBackend: null,
            visibility: 'internal',
            initialAgentContext: null,
        });
    });

    it('existing mode sends the SSH repo URL in the payload', async () => {
        mocks.createProject.mockResolvedValue(CREATED);
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Existing repo/i }));
        fireEvent.change(screen.getByLabelText(/GitHub repo URL/i), {
            target: { value: 'git@github.com:org/repo.git' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Create project/i }));

        await waitFor(() => expect(mocks.createProject).toHaveBeenCalled());
        expect(mocks.createProject.mock.calls[0]![0]).toMatchObject({
            sourceMode: 'existing',
            githubRepo: 'git@github.com:org/repo.git',
        });
    });

    it('4xx CONFLICT renders inline, no toast', async () => {
        mocks.createProject.mockRejectedValue(
            new ApiClientError("Slug 'inventory-tracker' already exists", 409, 'CONFLICT'),
        );
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Create project/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
        expect(screen.getByRole('alert').textContent).toContain('already exists');
        expect(mocks.toastError).not.toHaveBeenCalled();
        expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('5xx/502 dispatcher failure toasts, no inline error', async () => {
        // Agent-only codes (UPSTREAM_FAILED) aren't in the shared ErrorCode
        // vocabulary yet — INTERNAL_ERROR carries the same 5xx semantics here.
        mocks.createProject.mockRejectedValue(
            new ApiClientError('Dispatcher onboarding failed: unreachable', 502, 'INTERNAL_ERROR'),
        );
        renderForm();
        fillValid();
        fireEvent.click(screen.getByRole('button', { name: /Create project/i }));

        await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
        expect(mocks.toastError).toHaveBeenCalledWith(
            'Failed to start onboarding — see project page for details',
        );
        expect(screen.queryByRole('alert')).toBeNull();
        expect(mocks.navigate).not.toHaveBeenCalled();
    });
});

afterEach(() => {
    cleanup();
    queryClient.clear();
});
