// SLYK-13 T12 — CommentItem table-driven tests.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CommentItem } from './CommentItem';
import { TooltipProvider } from '@/components/ui/Tooltip';
import type { CommentDto } from '@/types/comment';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

// The project-admin hook is mocked so the delete-gate matrix is driven directly
// from the test matrix without standing up a TanStack Query cache.
vi.mock('@/hooks/useProjectMembers', () => ({
    useCurrentProjectMembership: vi.fn((slug: string) => ({
        membership: undefined,
        isProjectAdmin: slug === 'admin-project',
    })),
}));

const baseUser: AuthUser = {
    token: 'tok-1',
    id: 'u-me',
    email: 'me@example.com',
    name: 'Me',
    isPlatformAdmin: false,
    displayName: null,
    avatarUrl: null,
    blocked: false,
};

function setUser(overrides: Partial<AuthUser> = {}): AuthUser {
    const user = { ...baseUser, ...overrides };
    useAuthStore.getState().setUser(user);
    return user;
}

function makeComment(overrides: Partial<CommentDto> = {}): CommentDto {
    return {
        id: 'c-1',
        ticketId: 't-1',
        body: 'Hello world',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        edited: false,
        author: { id: 'u-author', fullName: 'Ada Lovelace', avatarUrl: null },
        ...overrides,
    };
}

function renderComment(comment: CommentDto, slug = 'some-project') {
    // TooltipProvider is mounted app-wide in main.tsx (production). Tests render an
    // isolated subtree, so mount it here too — Radix Tooltip throws without it.
    return render(
        <TooltipProvider>
            <CommentItem
                comment={comment}
                slug={slug}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />
        </TooltipProvider>,
    );
}

describe('CommentItem', () => {
    // --- author + avatar rendering ------------------------------------------
    it.each([
        {
            name: 'avatar image when avatarUrl is present',
            author: { id: 'u-1', fullName: 'Ada Lovelace', avatarUrl: 'https://x/a.png' },
        },
        {
            name: 'initials placeholder when avatarUrl is null',
            author: { id: 'u-1', fullName: 'Ada Lovelace', avatarUrl: null },
        },
    ])('renders the author full name + avatar ($name)', ({ author }) => {
        setUser();
        renderComment(makeComment({ author }));
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });

    it("renders 'Unknown user' for the null-author sentinel", () => {
        setUser();
        renderComment(
            makeComment({
                author: { id: '', fullName: null, avatarUrl: null },
            }),
        );
        expect(screen.getByText('Unknown user')).toBeInTheDocument();
    });

    // --- (edited) marker ----------------------------------------------------
    it.each([
        { edited: true, shown: true },
        { edited: false, shown: false },
    ])('shows the (edited) marker only when edited===true (edited=$edited)', ({ edited, shown }) => {
        setUser();
        renderComment(makeComment({ edited }));
        if (shown) {
            expect(screen.getByText('(edited)')).toBeInTheDocument();
        } else {
            expect(screen.queryByText('(edited)')).not.toBeInTheDocument();
        }
    });

    // --- relative time + tooltip -------------------------------------------
    it('renders a relative <time> element with dateTime preserved (T6: title moved to Tooltip)', () => {
        setUser();
        renderComment(makeComment({ createdAt: '2024-01-01T00:00:00.000Z' }));
        const time = screen.getByText(/ago|^now$/);
        expect(time.tagName).toBe('TIME');
        // T6: the absolute time moved from a native title= attr to Radix Tooltip
        // content (portalled, interaction-gated). The machine-readable dateTime
        // is preserved on the <time> element.
        expect(time).toHaveAttribute('dateTime', '2024-01-01T00:00:00.000Z');
    });

    // --- Edit/Delete gate matrix -------------------------------------------
    type MatrixCase = {
        name: string;
        currentUser?: Partial<AuthUser>;
        authorId: string;
        slug?: string;
        editShown: boolean;
        deleteShown: boolean;
    };

    it.each<MatrixCase>([
        {
            name: 'author sees Edit AND Delete',
            currentUser: { id: 'u-author' },
            authorId: 'u-author',
            editShown: true,
            deleteShown: true,
        },
        {
            name: 'non-author non-admin sees NEITHER',
            currentUser: { id: 'u-other' },
            authorId: 'u-author',
            editShown: false,
            deleteShown: false,
        },
        {
            name: 'Platform Admin (non-author) sees Delete only',
            currentUser: { id: 'u-pa', isPlatformAdmin: true },
            authorId: 'u-author',
            editShown: false,
            deleteShown: true,
        },
        {
            name: 'Project Admin (non-author) sees Delete only',
            currentUser: { id: 'u-projadmin' },
            authorId: 'u-author',
            slug: 'admin-project',
            editShown: false,
            deleteShown: true,
        },
    ])(
        'permission matrix: $name',
        ({ currentUser, authorId, slug, editShown, deleteShown }) => {
            setUser(currentUser);
            renderComment(
                makeComment({ author: { id: authorId, fullName: 'Ada', avatarUrl: null } }),
                slug ?? 'some-project',
            );
            const edit = screen.queryByRole('button', { name: /^edit$/i });
            const del = screen.queryByRole('button', { name: /^delete$/i });
            if (editShown) {
                expect(edit).toBeInTheDocument();
            } else {
                expect(edit).not.toBeInTheDocument();
            }
            if (deleteShown) {
                expect(del).toBeInTheDocument();
            } else {
                expect(del).not.toBeInTheDocument();
            }
        },
    );

    // --- null-author can never be edited, but admins can still delete --------
    it('null-author sentinel: not editable by anyone, deletable by a Platform Admin', () => {
        setUser({ id: 'u-pa', isPlatformAdmin: true });
        renderComment(
            makeComment({
                author: { id: '', fullName: null, avatarUrl: null },
            }),
        );
        expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    });

    // --- callbacks ----------------------------------------------------------
    it('bubbles onEdit(comment) and onDelete(comment) to the parent', () => {
        setUser({ id: 'u-author' });
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        const comment = makeComment({ author: { id: 'u-author', fullName: 'Ada', avatarUrl: null } });
        render(
            <TooltipProvider>
                <CommentItem
                    comment={comment}
                    slug="some-project"
                    onEdit={onEdit}
                    onDelete={onDelete}
                />
            </TooltipProvider>,
        );
        screen.getByRole('button', { name: /^edit$/i }).click();
        expect(onEdit).toHaveBeenCalledWith(comment);
        screen.getByRole('button', { name: /^delete$/i }).click();
        expect(onDelete).toHaveBeenCalledWith(comment);
    });
});
