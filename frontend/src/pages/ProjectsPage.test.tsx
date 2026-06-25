import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { useAuthStore } from '@/stores/useAuthStore';
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
};

const otherMock: Project = {
    id: 'p2',
    name: 'Other',
    slug: 'OTHER',
    columns: [],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
        navigateMock.mockReset();
        mockState.projectsValue = { data: [], isLoading: false, error: undefined, refetch: vi.fn() };
        mockState.createProjectValue = { mutateAsync: vi.fn(), isPending: false };
        useAuthStore.getState().setUser({
            token: 't',
            id: 'u1',
            email: 'e@x',
            name: 'Test',
            role: 'ADMIN',
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
        mockState.projectsValue = { data: [projectMock], isLoading: false, error: undefined, refetch: vi.fn() };
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
            role: 'MEMBER',
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
});
