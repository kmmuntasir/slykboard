// F14 T9 / F27: ProjectSettingsPage test.
// Renders LabelManager with the slug extracted from the route via MemoryRouter.
// Mocks the project + mutation hooks so no QueryClientProvider is needed.
// Also covers the admin-only ProjectNameSection rename behavior: pre-fill,
// edit, trimmed Save, disabled-on-empty, and the isAdmin gate.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectSettingsPage } from './ProjectSettingsPage';
import type { Project } from '@/types/project';

// Capture the slug prop the page passes to LabelManager, and share a single
// assertable mutation mock across renders/tests.
const { captured, mockState, updateMut } = vi.hoisted(() => ({
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
    updateMut: {
        mutateAsync: vi.fn(),
        isPending: false,
        error: null as Error | null,
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
    useUpdateProject: () => updateMut,
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
    beforeEach(() => {
        updateMut.mutateAsync.mockReset();
        updateMut.isPending = false;
        updateMut.error = null;
        mockState.isAdmin = true;
    });

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

    it('renders the name input pre-filled with the project name (admin)', () => {
        renderAt('/projects/SLYK/settings');

        const input = screen.getByLabelText('Project name') as HTMLInputElement;
        expect(input).toBeInTheDocument();
        expect(input.value).toBe(mockState.project.name);

        fireEvent.change(input, { target: { value: 'New Name' } });
        expect(input.value).toBe('New Name');
    });

    it('clicking Save calls the update mutation with the trimmed name', async () => {
        renderAt('/projects/SLYK/settings');

        const input = screen.getByLabelText('Project name');
        fireEvent.change(input, { target: { value: '  Renamed Board  ' } });

        fireEvent.click(screen.getByRole('button', { name: 'Save Name' }));

        await waitFor(() => {
            expect(updateMut.mutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(updateMut.mutateAsync).toHaveBeenCalledWith({ name: 'Renamed Board' });
    });

    it.each(['', '   '])(
        'disables Save when the name is empty or whitespace-only (%j)',
        (value) => {
            renderAt('/projects/SLYK/settings');

            const input = screen.getByLabelText('Project name');
            fireEvent.change(input, { target: { value } });

            expect(screen.getByRole('button', { name: 'Save Name' })).toBeDisabled();
        },
    );

    it('renders the name section for admins', () => {
        renderAt('/projects/SLYK/settings');

        expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    });

    it('hides the name section for non-admins', () => {
        mockState.isAdmin = false;
        renderAt('/projects/SLYK/settings');

        expect(screen.queryByLabelText('Project name')).toBeNull();
    });
});
