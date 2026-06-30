// F14 T9 / F27 / SLYK-03 T2: ProjectSettingsPage test.
// Two-column settings page — sidebar (General/Members/Labels) drives the right
// content pane. Management UI is gated on the broadened (Platform Admin OR
// Project Admin) gate via useCurrentProjectMembership; membership loading is
// read separately from useProjectMembers so management UI never flashes.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectSettingsPage } from './ProjectSettingsPage';
import type { Project } from '@/types/project';

// Capture the slug prop the page passes to LabelManager, and share a single
// assertable mutation mock across renders/tests. Membership state is controlled
// per-case via membershipState (isProjectAdmin) and membershipLoading.
const { captured, mockState, updateMut, membershipState, statusMuts } = vi.hoisted(() => ({
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
            isActive: true,
        } as Project,
        isAdmin: true,
    },
    updateMut: {
        mutateAsync: vi.fn(),
        isPending: false,
        error: null as Error | null,
    },
    membershipState: {
        isProjectAdmin: false,
        isLoading: false,
    },
    statusMuts: {
        deactivate: {
            mutate: vi.fn(),
            isPending: false,
        },
        reactivate: {
            mutate: vi.fn(),
            isPending: false,
        },
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
    useProject: () => ({
        data: mockState.project,
        isLoading: false,
        error: undefined,
        refetch: vi.fn(),
    }),
}));

vi.mock('@/hooks/useRequirePlatformAdmin', () => ({
    useRequirePlatformAdmin: () => mockState.isAdmin,
}));

vi.mock('@/hooks/useUpdateProject', () => ({
    useUpdateProject: () => updateMut,
}));

vi.mock('@/hooks/useDeactivateProject', () => ({
    useDeactivateProject: () => statusMuts.deactivate,
}));

vi.mock('@/hooks/useReactivateProject', () => ({
    useReactivateProject: () => statusMuts.reactivate,
}));

// Single source of truth for the membership hooks. useProjectMembers drives the
// loading branch; useCurrentProjectMembership drives the project-admin gate.
vi.mock('@/hooks/useProjectMembers', () => ({
    useProjectMembers: () => ({ isLoading: membershipState.isLoading }),
    useCurrentProjectMembership: () => ({ isProjectAdmin: membershipState.isProjectAdmin }),
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
        mockState.project.isActive = true;
        membershipState.isProjectAdmin = false;
        membershipState.isLoading = false;
        statusMuts.deactivate.mutate.mockReset();
        statusMuts.deactivate.isPending = false;
        statusMuts.reactivate.mutate.mockReset();
        statusMuts.reactivate.isPending = false;
    });

    it('renders the heading + all three sidebar sections', () => {
        renderAt('/projects/SLYK/settings');

        expect(screen.getByRole('heading', { name: 'Project Settings' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Labels' })).toBeInTheDocument();
    });

    it('defaults to the General section with name + columns visible (admin)', () => {
        renderAt('/projects/SLYK/settings');

        // General is active and marked aria-current.
        const general = screen.getByRole('button', { name: 'General' });
        expect(general).toHaveAttribute('aria-current', 'page');

        expect(screen.getByLabelText('Project name')).toBeInTheDocument();
        expect(screen.getByTestId('columns-manager')).toBeInTheDocument();
    });

    it("clicking 'Members' switches to the Members pane (Link, not embed)", () => {
        renderAt('/projects/SLYK/settings');

        fireEvent.click(screen.getByRole('button', { name: 'Members' }));

        // The navigation link to the members page is shown.
        const link = screen.getByRole('link', { name: 'Manage members' });
        expect(link).toHaveAttribute('href', '/projects/SLYK/members');
        // No manager surfaces bleed through into this pane.
        expect(screen.queryByTestId('columns-manager')).toBeNull();
        expect(screen.queryByTestId('label-manager')).toBeNull();
    });

    it("clicking 'Labels' shows LabelManager and threads the route slug", () => {
        captured.slug = '';
        renderAt('/projects/ACME/settings');

        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));

        expect(screen.getByTestId('label-manager')).toBeInTheDocument();
        expect(captured.slug).toBe('ACME');
    });

    it('gate (canManage) shows management UI for a project admin', () => {
        // Platform-admin false, project-admin true → canManage true.
        mockState.isAdmin = false;
        membershipState.isProjectAdmin = true;
        renderAt('/projects/SLYK/settings');

        expect(screen.getByLabelText('Project name')).toBeInTheDocument();
        expect(screen.getByTestId('columns-manager')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        expect(screen.getByTestId('label-manager')).toBeInTheDocument();
    });

    it('gate hides management UI for a non-admin (read-only), but nav still works', () => {
        mockState.isAdmin = false;
        membershipState.isProjectAdmin = false;
        renderAt('/projects/SLYK/settings');

        // Management controls are suppressed; section is read-only.
        expect(screen.queryByLabelText('Project name')).toBeNull();
        expect(screen.queryByTestId('columns-manager')).toBeNull();
        expect(screen.getByText(/admin access to rename/i)).toBeInTheDocument();

        // Labels also read-only.
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        expect(screen.queryByTestId('label-manager')).toBeNull();

        // But navigation across all three sections still works.
        fireEvent.click(screen.getByRole('button', { name: 'Members' }));
        expect(screen.getByRole('link', { name: 'Manage members' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'General' }));
        expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute(
            'aria-current',
            'page',
        );
    });

    it('does not flash management UI while membership is loading', () => {
        // Platform-admin false with membership still loading → no management UI,
        // no read-only note yet (still resolving).
        mockState.isAdmin = false;
        membershipState.isProjectAdmin = false;
        membershipState.isLoading = true;
        renderAt('/projects/SLYK/settings');

        expect(screen.queryByLabelText('Project name')).toBeNull();
        expect(screen.queryByTestId('columns-manager')).toBeNull();
        expect(screen.queryByText(/admin access/i)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        expect(screen.queryByTestId('label-manager')).toBeNull();
    });

    it('renders the name input pre-filled with the project name (admin)', () => {
        renderAt('/projects/SLYK/settings');

        const input = screen.getByLabelText('Project name') as HTMLInputElement;
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
});

// SLYK-04 T6: Platform-Admin-only Project Status section (deactivate/reactivate).
// Gated on isPlatformAdmin (mockState.isAdmin), NOT canManage. The T5 mutation
// hooks (useDeactivateProject / useReactivateProject) are mocked here.
describe('ProjectSettingsPage — platform-admin status section', () => {
    beforeEach(() => {
        mockState.isAdmin = true;
        mockState.project.isActive = true;
        statusMuts.deactivate.mutate.mockReset();
        statusMuts.deactivate.isPending = false;
        statusMuts.reactivate.mutate.mockReset();
        statusMuts.reactivate.isPending = false;
    });

    it('a Platform Admin sees the Project Status section + Deactivate project when active', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = true;
        renderAt('/projects/SLYK/settings');

        expect(screen.getByRole('heading', { name: 'Project Status' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Deactivate project' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reactivate project' })).toBeNull();
    });

    it('a Platform Admin sees Reactivate project when the project is inactive', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = false;
        renderAt('/projects/SLYK/settings');

        expect(screen.getByRole('button', { name: 'Reactivate project' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Deactivate project' })).toBeNull();
    });

    it('a non-Platform-Admin sees NO status section even when canManage (project admin)', () => {
        mockState.isAdmin = false;
        membershipState.isProjectAdmin = true; // canManage true via project admin
        mockState.project.isActive = true;
        renderAt('/projects/SLYK/settings');

        expect(screen.queryByRole('heading', { name: 'Project Status' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Deactivate project' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reactivate project' })).toBeNull();
    });

    it('clicking Deactivate opens the confirm dialog; confirming fires the mutation', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = true;
        renderAt('/projects/SLYK/settings');

        fireEvent.click(screen.getByRole('button', { name: 'Deactivate project' }));
        // Dialog rendered with the required destructive copy.
        expect(
            screen.getByText(/Running timers are stopped and members lose access/i),
        ).toBeInTheDocument();
        expect(statusMuts.deactivate.mutate).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
        expect(statusMuts.deactivate.mutate).toHaveBeenCalledTimes(1);
    });

    it('cancelling the dialog does NOT fire the mutation', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = true;
        renderAt('/projects/SLYK/settings');

        fireEvent.click(screen.getByRole('button', { name: 'Deactivate project' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(statusMuts.deactivate.mutate).not.toHaveBeenCalled();
    });

    it('reactivate confirm fires the reactivate mutation', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = false;
        renderAt('/projects/SLYK/settings');

        fireEvent.click(screen.getByRole('button', { name: 'Reactivate project' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

        expect(statusMuts.reactivate.mutate).toHaveBeenCalledTimes(1);
        expect(statusMuts.deactivate.mutate).not.toHaveBeenCalled();
    });

    it('isPending disables the action button', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = true;
        statusMuts.deactivate.isPending = true;
        renderAt('/projects/SLYK/settings');

        expect(screen.getByRole('button', { name: 'Deactivate project' })).toBeDisabled();
    });

    it('isPending disables the confirm button when the dialog is open', () => {
        mockState.isAdmin = true;
        mockState.project.isActive = true;
        const view = renderAt('/projects/SLYK/settings');

        // Open the dialog (pending still false here so the action button is
        // clickable), then flip pending and re-render the SAME tree so the
        // dialog stays open and the confirm button reflects the pending state.
        fireEvent.click(screen.getByRole('button', { name: 'Deactivate project' }));
        statusMuts.deactivate.isPending = true;
        view.rerender(
            <MemoryRouter initialEntries={['/projects/SLYK/settings']}>
                <Routes>
                    <Route
                        path="/projects/:slug/settings"
                        element={<ProjectSettingsPage />}
                    />
                </Routes>
            </MemoryRouter>,
        );

        // ConfirmDialog appends '…' to the confirm label while pending.
        expect(screen.getByRole('button', { name: /Deactivate…/ })).toBeDisabled();
    });
});
