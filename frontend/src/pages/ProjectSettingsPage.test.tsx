// F14 T9 / F27: ProjectSettingsPage test.
// Renders LabelManager with the slug extracted from the route via MemoryRouter.
// Mocks the project + mutation hooks so no QueryClientProvider is needed.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectSettingsPage } from './ProjectSettingsPage';
import type { Project } from '@/types/project';

// Capture the slug prop the page passes to LabelManager.
const { captured, mockState } = vi.hoisted(() => ({
    captured: { slug: '' as string },
    mockState: {
        project: {
            id: 'p1',
            name: 'Slyk',
            slug: 'SLYK',
            columns: [
                { id: 'c1', name: 'Todo' },
                { id: 'c2', name: 'Done' },
            ],
            creatorId: 'u1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
        } as Project,
        isAdmin: true,
    },
}));

vi.mock('@/components/LabelManager', () => ({
    LabelManager: ({ projectSlug }: { projectSlug: string }) => {
        captured.slug = projectSlug;
        return <div data-testid="label-manager">LabelManager for {projectSlug}</div>;
    },
}));

vi.mock('@/components/ProjectColumnsManager', () => ({
    ProjectColumnsManager: ({ projectSlug }: { projectSlug: string }) => (
        <div data-testid="columns-manager">ColumnsManager for {projectSlug}</div>
    ),
}));

vi.mock('@/hooks/useProjects', () => ({
    useProject: () => ({ data: mockState.project, isLoading: false }),
}));

vi.mock('@/hooks/useRequireRole', () => ({
    useRequireRole: () => mockState.isAdmin,
}));

vi.mock('@/hooks/useUpdateProject', () => ({
    useUpdateProject: () => ({
        mutateAsync: vi.fn(),
        mutate: vi.fn(),
        isPending: false,
        error: null,
    }),
}));

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/projects/:slug/settings" element={<ProjectSettingsPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('ProjectSettingsPage', () => {
    it('renders the heading + LabelManager', () => {
        renderAt('/projects/SLYK/settings');

        expect(
            screen.getByRole('heading', { name: 'Project Settings' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('label-manager')).toBeInTheDocument();
    });

    it('threads the slug from the route into LabelManager', () => {
        renderAt('/projects/ACME/settings');

        expect(captured.slug).toBe('ACME');
        expect(screen.getByText('LabelManager for ACME')).toBeInTheDocument();
    });

    it('renders the columns manager when admin', () => {
        renderAt('/projects/SLYK/settings');

        expect(screen.getByTestId('columns-manager')).toBeInTheDocument();
    });

    it('hides admin-only sections for non-admins', () => {
        mockState.isAdmin = false;
        renderAt('/projects/SLYK/settings');

        expect(screen.queryByTestId('columns-manager')).toBeNull();
        mockState.isAdmin = true;
    });
});
