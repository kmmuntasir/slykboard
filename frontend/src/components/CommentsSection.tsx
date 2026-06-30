// SLYK-13 T13 — top-level comments section for a ticket. This component OWNS
// the data: it wires useTicketComments (read) + the three comment mutation hooks
// (create/update/delete) and the local editingId / delete-confirm state. The
// child primitives stay presentational:
//   - CommentForm (create + edit modes) owns only its draft + trim validation.
//   - CommentItem owns the author/admin permission gate + renders a row.
//
// State machine:
//   editingId        — when set, the matching row swaps CommentItem → edit-mode
//                      CommentForm (initialValue = comment.body). Submit fires
//                      the update mutation then clears editingId; Cancel clears it.
//   deleteTarget     — when set, a destructive <ConfirmDialog> is shown. Confirm
//                      fires the delete mutation then clears the target. This is
//                      the project's section-level delete-confirm convention
//                      (see ProjectMembersPage remove-member flow).
//
// The create box is hidden entirely when `disabled` is true (e.g. read-only /
// archived ticket view). Loading/error/empty states follow ActivityFeed's
// conventions so the detail panel's sub-sections read consistently.
import { useState } from 'react';

import { ConfirmDialog } from './ConfirmDialog';
import { CommentForm } from './CommentForm';
import { CommentItem } from './CommentItem';
import { useTicketComments } from '@/hooks/useTicketComments';
import {
    useCreateComment,
    useUpdateComment,
    useDeleteComment,
} from '@/hooks/useCommentMutations';
import type { CommentDto } from '@/types/comment';

const DELETE_DIALOG_TITLE_ID = 'delete-comment-title';

export interface CommentsSectionProps {
    ticketId: string;
    /** Project slug — forwarded to CommentItem for the Project-Admin delete gate. */
    slug: string;
    /** When true the create box is hidden (read-only / archived tickets). */
    disabled?: boolean;
}

export function CommentsSection({ ticketId, slug, disabled = false }: CommentsSectionProps) {
    const { data: comments, isLoading, isError } = useTicketComments(ticketId);
    const createMut = useCreateComment(ticketId);
    const updateMut = useUpdateComment(ticketId);
    const deleteMut = useDeleteComment(ticketId);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<CommentDto | null>(null);

    const list = comments ?? [];

    function handleCreate(body: string) {
        createMut.mutate(body);
    }

    function handleEditSubmit(commentId: string, body: string) {
        updateMut.mutate(
            { commentId, body },
            { onSuccess: () => setEditingId(null) },
        );
    }

    function handleConfirmDelete() {
        if (!deleteTarget) return;
        deleteMut.mutate(deleteTarget.id);
        setDeleteTarget(null);
    }

    return (
        <section className="mt-4 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Comments</h3>

            {/* Create box — hidden entirely in read-only mode. */}
            {!disabled && (
                <div className="mb-3">
                    <CommentForm
                        mode="create"
                        isPending={createMut.isPending}
                        onSubmit={handleCreate}
                    />
                </div>
            )}

            {isLoading && <p className="text-sm text-muted-foreground">Loading comments…</p>}
            {isError && <p className="text-sm text-destructive">Failed to load comments.</p>}
            {!isLoading && !isError && list.length === 0 && (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}

            {list.length > 0 && (
                <ul className="divide-y divide-border">
                    {list.map((comment) =>
                        editingId === comment.id ? (
                            <li key={comment.id} className="py-3">
                                <CommentForm
                                    mode="edit"
                                    initialValue={comment.body}
                                    isPending={updateMut.isPending}
                                    onSubmit={(body) => handleEditSubmit(comment.id, body)}
                                    onCancel={() => setEditingId(null)}
                                />
                            </li>
                        ) : (
                            <CommentItem
                                key={comment.id}
                                comment={comment}
                                slug={slug}
                                onEdit={(c) => setEditingId(c.id)}
                                onDelete={(c) => setDeleteTarget(c)}
                            />
                        ),
                    )}
                </ul>
            )}

            <ConfirmDialog
                isOpen={deleteTarget !== null}
                title="Delete comment?"
                titleId={DELETE_DIALOG_TITLE_ID}
                variant="destructive"
                confirmLabel="Delete"
                cancelLabel="Cancel"
                pending={deleteMut.isPending}
                message="This comment will be permanently removed. This cannot be undone."
                onConfirm={handleConfirmDelete}
                onCancel={() => setDeleteTarget(null)}
            />
        </section>
    );
}
