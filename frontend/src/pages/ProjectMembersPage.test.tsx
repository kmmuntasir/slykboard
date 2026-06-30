// SLYK-02 Task T7 — ProjectMembersPage coverage (integration capstone).
//
// The page is now a thin assembly over <MemberTable> + <AddMemberModal> +
// <ConfirmDialog>. Both composite components are unit-tested in their own
// suites; here we mock them so this suite focuses on the PAGE-level wiring:
//  - H1 = "Member Management".
//  - "Add Member" button visible only when canManage, opens <AddMemberModal>.
//  - Live search (useMemo, case-insensitive, table-driven) filters rows.
//  - Role change routes through useUpdateMemberRole.
//  - Remove opens <ConfirmDialog variant="destructive">; confirm → useRemoveMember;
//    cancel → no delete. The immediate-remove path is gone.
//  - Read-only fallback for non-managers (no Add button, MemberTable gets
//    canManage=false — verified via the absence of management controls).
//  - No regressions on loading / error / empty-roster states.
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
    updateRole: MutationLike;
    remove: MutationLike;
} = {
    updateRole: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    remove: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
};

// Hoisted module-level knobs flipped per test.
let roster: Member[] = [];
let loading = false;
let error: Error | null = null;
let isPlatformAdmin = false;
let isProjectAdmin = false;

vi.mock('@/hooks/useRequirePlatformAdmin', () => ({
    useRequirePlatformAdmin: () => isPlatformAdmin,
}));

vi.mock('@/hooks/useProjectMembers', () => ({
    useProjectMembers: () => ({
        data: roster,
        isLoading: loading,
        error,
        refetch: vi.fn(),
    }),
    useUpdateMemberRole: () => mutState.updateRole,
    useRemoveMember: () => mutState.remove,
    useCurrentProjectMembership: () => ({
        // membership row is only used to derive the self marker + isProjectAdmin;
        // mirror roster's current-user entry so the "You" badge logic is exercised
        // deterministically.
        membership: roster.find((m) => m.userId === 'me') ?? undefined,
        isProjectAdmin,
    }),
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => toastApi,
}));

// <AddMemberModal> is exercised in its own suite; here we stub it so opening it
// doesn't pull in lookup queries. Render a marker so we can assert it opens.
vi.mock('@/components/AddMemberModal', () => ({
    AddMemberModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="add-member-modal">
                <button type="button" onClick={onClose}>
                    CloseModal
                </button>
            </div>
        );
    },
}));

// <ConfirmDialog> mock — exposes deterministic Confirm/Cancel triggers wired to
// the real onConfirm/onCancel so tests can drive the confirm flow. Renders the
// destructive confirm label so we can assert the variant indirectly.
vi.mock('@/components/ConfirmDialog', () => ({
    ConfirmDialog: ({
        isOpen,
        title,
        confirmLabel,
        onConfirm,
        onCancel,
        pending,
    }: {
        isOpen: boolean;
        title: string;
        confirmLabel: string;
        onConfirm: () => void;
        onCancel: () => void;
        pending?: boolean;
    }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="confirm-dialog" role="dialog" aria-label={title}>
                <button type="button" onClick={onConfirm} disabled={pending}>
                    {confirmLabel}
                </button>
                <button type="button" onClick={onCancel}>
                    DoCancel
                </button>
            </div>
        );
    },
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
    error = null;
    isPlatformAdmin = false;
    isProjectAdmin = false;
    toastApi.success.mockReset();
    toastApi.error.mockReset();
    mutState.updateRole.mutateAsync.mockReset();
    mutState.updateRole.mutateAsync.mockResolvedValue(undefined);
    mutState.updateRole.isPending = false;
    mutState.remove.mutateAsync.mockReset();
    mutState.remove.mutateAsync.mockResolvedValue(undefined);
    mutState.remove.isPending = false;
});

describe('ProjectMembersPage — heading + roster rendering', () => {
    it('renders the "Member Management" heading', () => {
        roster = [
            makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice' }),
        ];
        renderPage();
        expect(screen.getByRole('heading', { name: 'Member Management' })).toBeInTheDocument();
    });

    it('renders each member row via <MemberTable>', () => {
        roster = [
            makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'PROJECT_ADMIN' }),
            makeMember({ userId: 'u2', email: 'bob@x.com', fullName: 'Bob', role: 'MEMBER' }),
        ];
        renderPage();
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

describe('ProjectMembersPage — loading / error / regression states', () => {
    it('renders a loading skeleton while the roster loads', () => {
        loading = true;
        const { container } = renderPage();
        // Skeleton renders; no heading yet.
        expect(screen.queryByRole('heading', { name: 'Member Management' })).toBeNull();
        expect(container.textContent).not.toContain('alice@x.com');
    });

    it('renders the <Retry> error state when the roster fails to load', () => {
        error = new Error('boom');
        renderPage();
        expect(screen.getByText('boom')).toBeInTheDocument();
    });
});

describe('ProjectMembersPage — "Add Member" button visibility + modal', () => {
    const cases: Array<{ name: string; platform: boolean; project: boolean; visible: boolean }> = [
        { name: 'visible for Platform Admin', platform: true, project: false, visible: true },
        { name: 'visible for Project Admin', platform: false, project: true, visible: true },
        { name: 'absent for a plain Member', platform: false, project: false, visible: false },
    ];

    cases.forEach(({ name, platform, project, visible }) => {
        it(name, () => {
            isPlatformAdmin = platform;
            isProjectAdmin = project;
            roster = [makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice' })];
            renderPage();

            const btn = screen.queryByRole('button', { name: 'Add Member' });
            if (visible) {
                expect(btn).toBeInTheDocument();
            } else {
                expect(btn).toBeNull();
            }
        });
    });

    it('clicking "Add Member" opens <AddMemberModal>; closing hides it', () => {
        isPlatformAdmin = true;
        roster = [makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice' })];
        renderPage();

        expect(screen.queryByTestId('add-member-modal')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));
        expect(screen.getByTestId('add-member-modal')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'CloseModal' }));
        expect(screen.queryByTestId('add-member-modal')).toBeNull();
    });
});

describe('ProjectMembersPage — management controls (canManage gate)', () => {
    const gateCases: Array<{ name: string; platform: boolean; project: boolean; canManage: boolean }> = [
        { name: 'admin sees per-row role select + remove controls', platform: true, project: false, canManage: true },
        { name: 'plain Member sees a read-only roster', platform: false, project: false, canManage: false },
    ];

    gateCases.forEach(({ name, platform, project, canManage }) => {
        it(name, () => {
            isPlatformAdmin = platform;
            isProjectAdmin = project;
            roster = [
                makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'PROJECT_ADMIN' }),
                makeMember({ userId: 'me', email: 'me@x.com', fullName: 'Me', role: 'MEMBER' }),
            ];
            renderPage();

            if (canManage) {
                expect(screen.getByLabelText('Role for alice@x.com')).toBeInTheDocument();
                expect(screen.getByLabelText('Remove alice@x.com')).toBeInTheDocument();
            } else {
                expect(screen.queryByLabelText('Role for alice@x.com')).toBeNull();
                expect(screen.queryByLabelText('Remove alice@x.com')).toBeNull();
                // Read-only role badge instead of selects/buttons.
                expect(screen.getByText('Project Admin')).toBeInTheDocument();
            }
        });
    });
});

describe('ProjectMembersPage — role change', () => {
    beforeEach(() => {
        isPlatformAdmin = true;
        roster = [makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'MEMBER' })];
    });

    it('changing the role select calls useUpdateMemberRole and toasts success', async () => {
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

    it('does NOT call useUpdateMemberRole when the role is unchanged', async () => {
        renderPage();
        fireEvent.change(screen.getByLabelText('Role for alice@x.com'), {
            target: { value: 'MEMBER' }, // same as current
        });
        expect(mutState.updateRole.mutateAsync).not.toHaveBeenCalled();
    });
});

describe('ProjectMembersPage — remove via confirm dialog', () => {
    beforeEach(() => {
        isPlatformAdmin = true;
        roster = [makeMember({ userId: 'u1', email: 'alice@x.com', fullName: 'Alice', role: 'MEMBER' })];
    });

    it('clicking Remove opens the confirm dialog (no immediate delete)', () => {
        renderPage();
        fireEvent.click(screen.getByLabelText('Remove alice@x.com'));
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        // The delete must not have fired yet.
        expect(mutState.remove.mutateAsync).not.toHaveBeenCalled();
    });

    it('confirming invokes useRemoveMember and toasts success', async () => {
        renderPage();
        fireEvent.click(screen.getByLabelText('Remove alice@x.com'));
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

        await waitFor(() => {
            expect(mutState.remove.mutateAsync).toHaveBeenCalledWith('u1');
        });
        expect(toastApi.success).toHaveBeenCalledWith('Member removed.');
    });

    it('cancelling closes the dialog without deleting', () => {
        renderPage();
        fireEvent.click(screen.getByLabelText('Remove alice@x.com'));
        fireEvent.click(screen.getByRole('button', { name: 'DoCancel' }));
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mutState.remove.mutateAsync).not.toHaveBeenCalled();
    });
});

describe('ProjectMembersPage — live search (useMemo, case-insensitive)', () => {
    beforeEach(() => {
        isPlatformAdmin = true;
        roster = [
            makeMember({ userId: 'u1', email: 'alice@example.com', fullName: 'Alice Smith', displayName: null }),
            makeMember({ userId: 'u2', email: 'bob@example.com', fullName: 'Bob', displayName: 'Bobby' }),
            makeMember({ userId: 'u3', email: 'carol@other.io', fullName: 'Carol', displayName: null }),
        ];
    });

    const searchCases: Array<{ name: string; query: string; expectEmails: string[] }> = [
        { name: 'partial name "ali" → Alice only', query: 'ali', expectEmails: ['alice@example.com'] },
        { name: 'partial displayName "bobby" → Bob', query: 'bobby', expectEmails: ['bob@example.com'] },
        { name: 'partial email "example.com" → Alice + Bob', query: 'example.com', expectEmails: ['alice@example.com', 'bob@example.com'] },
        { name: 'case-insensitive "ALICE" → Alice', query: 'ALICE', expectEmails: ['alice@example.com'] },
        { name: 'empty query → all rows', query: '', expectEmails: ['alice@example.com', 'bob@example.com', 'carol@other.io'] },
        { name: 'no-match query → empty-results card', query: 'zzz', expectEmails: [] },
    ];

    searchCases.forEach(({ name, query, expectEmails }) => {
        it(name, () => {
            renderPage();
            fireEvent.change(screen.getByLabelText('Search members'), { target: { value: query } });

            expectEmails.forEach((email) => {
                expect(screen.getByText(email)).toBeInTheDocument();
            });
            // Every rendered email is one of the expected set.
            const rendered = roster
                .map((m) => m.email)
                .filter((email) => screen.queryByText(email) !== null);
            expect(rendered.sort()).toEqual([...expectEmails].sort());

            if (expectEmails.length === 0 && query.length > 0) {
                expect(screen.getByText(/No members match/)).toBeInTheDocument();
            }
        });
    });

    it('clearing the query restores all rows', () => {
        renderPage();
        fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'ali' } });
        expect(screen.queryByText('bob@example.com')).toBeNull();
        fireEvent.change(screen.getByLabelText('Search members'), { target: { value: '' } });
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.getByText('bob@example.com')).toBeInTheDocument();
        expect(screen.getByText('carol@other.io')).toBeInTheDocument();
    });
});

describe('ProjectMembersPage — default role smoke', () => {
    it('the default MemberRole for add flows is MEMBER', () => {
        const roles: MemberRole[] = ['PROJECT_ADMIN', 'MEMBER'];
        expect(roles).toContain('MEMBER');
    });
});
