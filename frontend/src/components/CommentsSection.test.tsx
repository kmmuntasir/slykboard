// SLYK-13 T13 — CommentsSection tests. End-to-end through a REAL QueryClient
// (mocking the api/client functions, not the hooks), so invalidation behavior
// (create → refetch) is exercised for real and not re-asserted from a mock.
// CommentItem's auth-gate dependencies are stubbed so the Delete action renders
// for the acting (author) user.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { CommentsSection } from './CommentsSection';
import type { CommentDto } from '@/types/comment';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

// CommentItem permission gate — stubbed; CommentsSection itself doesn't use it.
vi.mock('@/hooks/useProjectMembers', () => ({
    useCurrentProjectMembership: () => ({ membership: undefined, isProjectAdmin: false }),
}));

// HTTP layer — the section's hooks call these. Mocked per-test via mockFetch.
vi.mock('@/api/comments', () => ({
    fetchTicketComments: vi.fn(),
    createTicketComment: vi.fn(),
    updateTicketComment: vi.fn(),
    deleteTicketComment: vi.fn(),
}));

import {
    fetchTicketComments,
    createTicketComment,
    updateTicketComment,
    deleteTicketComment,
} from '@/api/comments';

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

function setUser(overrides: Partial<AuthUser> = {}): void {
    useAuthStore.getState().setUser({ ...baseUser, ...overrides });
}

function makeComment(overrides: Partial<CommentDto> = {}): CommentDto {
    return {
        id: 'c-1',
        ticketId: 't-1',
        body: 'Hello world',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        edited: false,
        author: { id: 'u-me', fullName: 'Me', avatarUrl: null },
        ...overrides,
    };
}

function mockFetch(comments: CommentDto[]) {
    (fetchTicketComments as ReturnType<typeof vi.fn>).mockResolvedValue(comments);
}

function wrapper() {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: qc }, children);
    }
    return Wrapper;
}

function renderSection(props?: Partial<Parameters<typeof CommentsSection>[0]>) {
    return render(
        <CommentsSection ticketId="t-1" slug="proj" {...props} />,
        { wrapper: wrapper() },
    );
}

describe('CommentsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setUser();
        mockFetch([]);
    });

    // --- empty / loading / error states ------------------------------------
    it('shows "No comments yet" when the thread is empty', async () => {
        renderSection();
        await waitFor(() =>
            expect(screen.getByText('No comments yet.')).toBeInTheDocument(),
        );
    });

    it('shows a loading message while the query is pending', () => {
        // Never-resolving fetch keeps the query in pending state.
        (fetchTicketComments as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
        renderSection();
        expect(screen.getByText('Loading comments…')).toBeInTheDocument();
    });

    it('shows an error message when the query fails', async () => {
        (fetchTicketComments as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
        renderSection();
        await waitFor(() =>
            expect(screen.getByText('Failed to load comments.')).toBeInTheDocument(),
        );
    });

    // --- rendering N items (table-driven) ----------------------------------
    it.each([
        { n: 1, label: 'a single comment' },
        { n: 3, label: 'multiple comments' },
    ])('renders $n comment items ($label)', async ({ n }) => {
        const comments = Array.from({ length: n }, (_, i) =>
            makeComment({ id: `c-${i}`, body: `Body ${i}` }),
        );
        mockFetch(comments);
        renderSection();
        await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(n));
    });

    // --- create box visibility ---------------------------------------------
    it('renders the create comment box by default', async () => {
        renderSection();
        expect(screen.getByLabelText('Write a comment')).toBeInTheDocument();
    });

    it('hides the create comment box when disabled is true', async () => {
        renderSection({ disabled: true });
        expect(screen.queryByLabelText('Write a comment')).not.toBeInTheDocument();
    });

    // --- create flow invalidates + refreshes -------------------------------
    it('a successful create invalidates the comments query and refreshes', async () => {
        mockFetch([]);
        renderSection();
        await waitFor(() =>
            expect(screen.getByText('No comments yet.')).toBeInTheDocument(),
        );
        expect(fetchTicketComments).toHaveBeenCalledTimes(1);

        (createTicketComment as ReturnType<typeof vi.fn>).mockResolvedValue(
            makeComment({ id: 'c-new', body: 'Fresh' }),
        );

        // After create settles the query invalidates → refetch fires.
        fireEvent.change(screen.getByLabelText('Write a comment'), {
            target: { value: 'Fresh' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

        await waitFor(() => expect(createTicketComment).toHaveBeenCalledWith('t-1', 'Fresh'));
        await waitFor(() => expect(fetchTicketComments).toHaveBeenCalledTimes(2));
    });

    // --- edit flow: swap → update → clear ----------------------------------
    it('edit swaps a row into the edit CommentForm, then updates and clears', async () => {
        const c1 = makeComment({ id: 'c-1', body: 'Original' });
        mockFetch([c1]);
        renderSection();
        await waitFor(() => expect(screen.getByText('Original')).toBeInTheDocument());

        // Enter edit mode for the row.
        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
        const editField = await screen.findByLabelText('Edit comment');
        expect(editField).toHaveValue('Original');

        // The static item body is replaced by the edit form's textarea.
        expect(editField).toBeInTheDocument();

        (updateTicketComment as ReturnType<typeof vi.fn>).mockResolvedValue(
            makeComment({ id: 'c-1', body: 'Updated' }),
        );
        fireEvent.change(editField, { target: { value: 'Updated' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(updateTicketComment).toHaveBeenCalledWith('c-1', 'Updated'),
        );
        // Edit form torn down after a successful update.
        await waitFor(() =>
            expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument(),
        );
    });

    it('edit Cancel clears editingId without mutating', async () => {
        const c1 = makeComment({ id: 'c-1', body: 'Original' });
        mockFetch([c1]);
        renderSection();
        await waitFor(() => expect(screen.getByText('Original')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument();
        expect(updateTicketComment).not.toHaveBeenCalled();
    });

    // --- delete flow: confirm then fire ------------------------------------
    it('delete opens a confirm dialog and fires deleteTicketComment on confirm', async () => {
        const c1 = makeComment({ id: 'c-1', body: 'Hello world' });
        mockFetch([c1]);
        renderSection();
        await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());

        // Row Delete opens the confirm dialog (not the API call yet).
        fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delete comment?')).toBeInTheDocument();
        expect(deleteTicketComment).not.toHaveBeenCalled();

        (deleteTicketComment as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(deleteTicketComment).toHaveBeenCalledWith('c-1'));
    });

    it('delete Cancel closes the dialog without deleting', async () => {
        const c1 = makeComment({ id: 'c-1', body: 'Hello world' });
        mockFetch([c1]);
        renderSection();
        await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(deleteTicketComment).not.toHaveBeenCalled();
    });
});
