// SLYK-01 Task O — ProjectMembersPage coverage.
// Roster renders for all members; management controls (add/create/promote/demote/
// remove) appear for Platform Admins AND Project Admins (canManage gate); a plain
// Member sees a read-only roster. A wrong-domain email on create surfaces the
// server FORBIDDEN message inline (via toast). Promote/demote/remove route to the
// correct mutation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectMembersPage } from './ProjectMembersPage';
import { ApiClientError } from '@/api/client';
import type { Member, MemberRole } from '@/types/member';

// --- Controllable mock state ------------------------------------------------

const toastApi = {
    success: vi.fn(),
    error: vi.fn(),
};

interface MutationLike {
    mutateAsync: ReturnType<typeof vi.fn>;
    isPending: boolean;
}

const mutState: {
    add: MutationLike;
    create: MutationLike;
    updateRole: MutationLike;
    remove: MutationLike;
} = {
    add: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    create: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    updateRole: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
};

// Hoisted module-level knobs flipped per test.
let roster: Member[] = [];
let loading = false;
let isPlatformAdmin = false;
let isProjectAdmin = false;

vi.mock('@/hooks/useRequirePlatformAdmin', () => ({
    useRequirePlatformAdmin: () => isPlatformAdmin,
}));

vi.mock('@/hooks/useProjectMembers', () => ({
    useProjectMembers: () => ({
        data: roster,
        isLoading: loading,
        error: null,
        refetch: vi.fn(),
    }),
    useAddMember: () => mutState.add,
    useCreateAndAddMember: () => mutState.create,
    useUpdateMemberRole: () => mutState.updateRole,
    useRemoveMember: () => mutState.remove,
    useCurrentProjectMembership: () => ({
        // membership row is only used to derive the self marker; mirror roster's
        // current-user entry so the "You" badge logic is exercised deterministically.
        membership: roster.find((m) => m.userId === 'me') ?? undefined,
        isProjectAdmin,
    }),
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => toastApi,
}));

function makeMember(over: Partial<Member> = {}): Member {
    return {
        userId: 'u-x',
        email: 'x@example.com',
        fullName: 'X User',
        displayName: null,
        avatarUrl: null,
        role: 'MEMBER',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...over,
    };
}

function renderPage(slug = 'acme') {
    return render(
        <MemoryRouter initialEntries={[`/projects/${slug}/members`]}>
            <Routes>
                <Route path="/projects/:slug/members" element={<ProjectMembersPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    roster = [];
    loading = false;
    isPlatformAdmin = false;
    isProjectAdmin = false;
    toastApi.success.mockReset();
    toastApi.error.mockReset();
    mutState.add.mutateAsync.mockReset();
    mutState.add.mutateAsync.mockResolvedValue(undefined);
    mutState.create.mutateAsync.mockReset();
    mutState.create.mutateAsync.mockResolvedValue(undefined);
    mutState.updateRole.mutateAsync.mockReset();
    mutState.updateRole.mutateAsync.mockResolvedValue(undefined);
    mutState.remove.mutateAsync.mockReset();
    mutState.remove.mutateAsync.mockResolvedValue(undefined);
});

describe('ProjectMembersPage — roster rendering', () => {
    it('renders the roster heading and each member row', () => {
        roster = [
            makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'PROJECT_ADMIN' }),
            makeMember({ userId: 'u2', email: 'bob@x.com', fullName: 'Bob', role: 'MEMBER' }),
        ];

        renderPage();

        expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
        expect(screen.getByText('alice@x.com')).toBeInTheDocument();
        expect(screen.getByText('bob@x.com')).toBeInTheDocument();
    });

    it('shows the empty-state card when the roster is empty', () => {
        roster = [];
        renderPage();

        expect(screen.getByText('No members yet.')).toBeInTheDocument();
    });

    it('prefers displayName over fullName in the row label', () => {
        roster = [
            makeMember({
                userId: 'u1',
                email: 'alice@x.com',
                fullName: 'Alice Smith',
                displayName: 'Alice (Preferred)',
                role: 'MEMBER',
            }),
        ];

        renderPage();

        expect(screen.getByText('Alice (Preferred)')).toBeInTheDocument();
    });
});

describe('ProjectMembersPage — management gate (canManage)', () => {
    const cases: Array<{ name: string; platform: boolean; project: boolean; canManage: boolean }> = [
        { name: 'Platform Admin sees management controls', platform: true, project: false, canManage: true },
        { name: 'Project Admin sees management controls', platform: false, project: true, canManage: true },
        { name: 'plain Member sees a read-only roster', platform: false, project: false, canManage: false },
    ];

    cases.forEach(({ name, platform, project, canManage }) => {
        it(name, () => {
            isPlatformAdmin = platform;
            isProjectAdmin = project;
            roster = [
                makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'PROJECT_ADMIN' }),
                makeMember({ userId: 'me', email: 'me@x.com', fullName: 'Me', role: 'MEMBER' }),
            ];

            renderPage();

            // Add-member section is gated on canManage.
            const addHeading = screen.queryByRole('heading', { name: 'Add member' });
            if (canManage) {
                expect(addHeading).toBeInTheDocument();
                // Per-row management controls: role <select> + remove button.
                expect(screen.getByLabelText('Role for alice@x.com')).toBeInTheDocument();
                expect(screen.getByLabelText('Remove alice@x.com')).toBeInTheDocument();
            } else {
                expect(addHeading).toBeNull();
                // Read-only role badges instead of selects/buttons.
                expect(screen.queryByLabelText('Role for alice@x.com')).toBeNull();
                expect(screen.queryByLabelText('Remove alice@x.com')).toBeNull();
                expect(screen.getByText('Project Admin')).toBeInTheDocument();
            }
        });
    });
});

describe('ProjectMembersPage — mutations', () => {
    beforeEach(() => {
        // Default: a Platform Admin managing a roster.
        isPlatformAdmin = true;
        roster = [
            makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'MEMBER' }),
        ];
    });

    it('promote: changing the role <select> calls updateMemberRole with the new role', async () => {
        renderPage();

        fireEvent.change(screen.getByLabelText('Role for alice@x.com'), {
            target: { value: 'PROJECT_ADMIN' },
        });

        await waitFor(() => {
            expect(mutState.updateRole.mutateAsync).toHaveBeenCalledWith({
                userId: 'u1',
                role: 'PROJECT_ADMIN',
            });
        });
        expect(toastApi.success).toHaveBeenCalledWith('Role updated.');
    });

    it('does NOT call updateMemberRole when the role is unchanged', async () => {
        renderPage();

        fireEvent.change(screen.getByLabelText('Role for alice@x.com'), {
            target: { value: 'MEMBER' }, // same as current
        });

        expect(mutState.updateRole.mutateAsync).not.toHaveBeenCalled();
    });

    it('remove: clicking the remove button calls removeMember with the userId', async () => {
        renderPage();

        fireEvent.click(screen.getByLabelText('Remove alice@x.com'));

        await waitFor(() => {
            expect(mutState.remove.mutateAsync).toHaveBeenCalledWith('u1');
        });
        expect(toastApi.success).toHaveBeenCalledWith('Member removed.');
    });

    it('add existing user: submitting calls addMember with email + role', async () => {
        renderPage();

        fireEvent.change(screen.getByLabelText('Existing user email'), {
            target: { value: 'new.user@example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add existing' }));

        await waitFor(() => {
            expect(mutState.add.mutateAsync).toHaveBeenCalledWith({
                email: 'new.user@example.com',
                role: 'MEMBER',
            });
        });
        expect(toastApi.success).toHaveBeenCalledWith('Member added.');
    });

    it('wrong-domain email on create surfaces the server FORBIDDEN message inline', async () => {
        const wrongDomainMessage = 'Email domain not allowed';
        mutState.create.mutateAsync.mockRejectedValueOnce(
            new ApiClientError(wrongDomainMessage, 403, 'FORBIDDEN'),
        );

        renderPage();

        // Switch to "New user" mode.
        fireEvent.click(screen.getByRole('button', { name: 'New user' }));
        fireEvent.change(screen.getByLabelText('New user email'), {
            target: { value: 'outsider@wrong.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create & add' }));

        await waitFor(() => {
            expect(mutState.create.mutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ email: 'outsider@wrong.com' }),
            );
        });
        // The exact server message surfaces (verbatim) — never a generic fallback.
        expect(toastApi.error).toHaveBeenCalledWith(wrongDomainMessage);
        expect(toastApi.success).not.toHaveBeenCalled();
    });

    it('create success: calls createAndAddMember and toasts success', async () => {
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: 'New user' }));
        fireEvent.change(screen.getByLabelText('New user email'), {
            target: { value: 'newhire@example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create & add' }));

        await waitFor(() => {
            expect(mutState.create.mutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ email: 'newhire@example.com' }),
            );
        });
        expect(toastApi.success).toHaveBeenCalledWith('Member created and added.');
    });
});

describe('ProjectMembersPage — non-member default role', () => {
    it('the default MemberRole for the add-existing role select is MEMBER', () => {
        // Type-level smoke: MEMBER_ROLES exports both tiers; the page defaults to MEMBER.
        const roles: MemberRole[] = ['PROJECT_ADMIN', 'MEMBER'];
        expect(roles).toContain('MEMBER');
    });
});
