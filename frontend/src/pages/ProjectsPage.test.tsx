import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { ApiClientError } from '@/api/client';
import type { Project } from '@/types/project';

const { navigateMock, mockState } = vi.hoisted(() => ({
    navigateMock: vi.fn(),
    mockState: {
        projectsValue: {
            data: [] as Project[],
            isLoading: false,
            error: undefined as unknown,
            refetch: vi.fn(),
        },
        createProjectValue: { mutateAsync: vi.fn(), isPending: false },
    },
}));

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/hooks/useProjects', () => ({
    useProjects: () => mockState.projectsValue,
    useCreateProject: () => mockState.createProjectValue,
}));

const projectMock: Project = {
    id: 'p1',
    name: 'Slyk',
    slug: 'SLYK',
    columns: [],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isActive: true,
};

const otherMock: Project = {
    id: 'p2',
    name: 'Other',
    slug: 'OTHER',
    columns: [],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isActive: true,
};

function renderPage() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <ProjectsPage />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('ProjectsPage', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
        useProjectStore.getState().clear();
        navigateMock.mockReset();
        mockState.projectsValue = {
            data: [],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        mockState.createProjectValue = { mutateAsync: vi.fn(), isPending: false };
        useAuthStore.getState().setUser({
            token: 't',
            id: 'u1',
            email: 'e@x',
            name: 'Test',
            isPlatformAdmin: true,
            displayName: null,
            avatarUrl: null,
            blocked: false,
        });
    });

    it('renders project list', () => {
        mockState.projectsValue = {
            data: [projectMock, otherMock],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        expect(screen.getByText('Slyk')).toBeInTheDocument();
        expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('clicking a project navigates', () => {
        mockState.projectsValue = {
            data: [projectMock],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: /Slyk/i }));

        expect(navigateMock).toHaveBeenCalledWith('/projects/SLYK');
    });

    it('create form visible for ADMIN', () => {
        renderPage();

        expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    });

    it('create form hidden for MEMBER', () => {
        useAuthStore.getState().setUser({
            token: 't',
            id: 'u1',
            email: 'e@x',
            name: 'Test',
            isPlatformAdmin: false,
            displayName: null,
            avatarUrl: null,
            blocked: false,
        });
        renderPage();

        expect(screen.queryByLabelText('Project name')).toBeNull();
    });

    it('create form submits + navigates on success', async () => {
        mockState.createProjectValue = {
            mutateAsync: vi.fn().mockResolvedValue(projectMock),
            isPending: false,
        };
        renderPage();

        fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Slyk' } });
        fireEvent.change(screen.getByLabelText('Project slug'), { target: { value: 'SLYK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/projects/SLYK'));
        expect(mockState.createProjectValue.mutateAsync).toHaveBeenCalledWith({
            name: 'Slyk',
            slug: 'SLYK',
        });
    });

    it('create form shows error on CONFLICT', async () => {
        mockState.createProjectValue = {
            mutateAsync: vi
                .fn()
                .mockRejectedValue(new ApiClientError('Slug already exists', 409, 'CONFLICT')),
            isPending: false,
        };
        renderPage();

        fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Slyk' } });
        fireEvent.change(screen.getByLabelText('Project slug'), { target: { value: 'SLYK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));

        expect(await screen.findByText('Slug already exists')).toBeInTheDocument();
    });

    it('renders skeleton loading state', () => {
        mockState.projectsValue = {
            data: [],
            isLoading: true,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        // ProjectsPage renders <SkeletonLine /> placeholders while loading.
        expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
        // The page heading is only rendered in the loaded branch.
        expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
    });

    it('renders the empty state with a Create-project CTA for ADMIN', () => {
        mockState.projectsValue = {
            data: [],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        const status = screen.getByRole('status');
        expect(within(status).getByText('No projects yet')).toBeInTheDocument();
        expect(within(status).getByRole('button', { name: 'Create project' })).toBeInTheDocument();
    });

    it('renders Retry (role=alert) on a query error and refetches on retry', () => {
        const refetch = vi.fn();
        mockState.projectsValue = {
            data: [],
            isLoading: false,
            error: new ApiClientError('Projects unavailable', 500, 'INTERNAL_ERROR'),
            refetch,
        };
        renderPage();

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Projects unavailable')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    // --- SLYK-04: Deactivated badge, member empty-state, reconcile effect -----

    it('shows a Deactivated badge for an inactive project when ADMIN', () => {
        const inactive: Project = { ...projectMock, isActive: false };
        mockState.projectsValue = {
            data: [inactive],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        expect(screen.getByText('Deactivated')).toBeInTheDocument();
    });

    it('does NOT show a Deactivated badge for a non-admin even when inactive', () => {
        const inactive: Project = { ...projectMock, isActive: false };
        useAuthStore.getState().setUser({
            token: 't',
            id: 'u1',
            email: 'e@x',
            name: 'Test',
            isPlatformAdmin: false,
            displayName: null,
            avatarUrl: null,
            blocked: false,
        });
        mockState.projectsValue = {
            data: [inactive],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        expect(screen.queryByText('Deactivated')).toBeNull();
    });

    it('member empty-state shows "Contact an Admin" copy with NO action button', () => {
        useAuthStore.getState().setUser({
            token: 't',
            id: 'u1',
            email: 'e@x',
            name: 'Test',
            isPlatformAdmin: false,
            displayName: null,
            avatarUrl: null,
            blocked: false,
        });
        mockState.projectsValue = {
            data: [],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        const status = screen.getByRole('status');
        expect(within(status).getByText('You have no Projects')).toBeInTheDocument();
        expect(
            within(status).getByText('Contact an Admin to get access to a project.'),
        ).toBeInTheDocument();
        // No Create action for members.
        expect(within(status).queryByRole('button')).toBeNull();
    });

    it('admin empty list still shows the Create-project CTA', () => {
        mockState.projectsValue = {
            data: [],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        const status = screen.getByRole('status');
        expect(within(status).getByText('No projects yet')).toBeInTheDocument();
        expect(within(status).getByRole('button', { name: 'Create project' })).toBeInTheDocument();
    });

    it('reconcile effect clears a stale lastSelectedSlug exactly once', () => {
        useProjectStore.getState().setLastSelectedSlug('gone');
        mockState.projectsValue = {
            data: [projectMock],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        // Stale slug not in the loaded list → cleared.
        expect(useProjectStore.getState().lastSelectedSlug).toBeNull();
    });

    it('reconcile effect does NOT clear a valid lastSelectedSlug', () => {
        useProjectStore.getState().setLastSelectedSlug('SLYK');
        mockState.projectsValue = {
            data: [projectMock],
            isLoading: false,
            error: undefined,
            refetch: vi.fn(),
        };
        renderPage();

        expect(useProjectStore.getState().lastSelectedSlug).toBe('SLYK');
    });
});
