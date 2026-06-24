import { useState } from 'react';
import { useBlocker } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import { fetchTicket } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { formatTicketId } from '@/utils/formatTicketId';
import { formatDate } from '@/utils/formatDate';
import { useRequireRole } from '@/hooks/useRequireRole';
import { useDeleteTicket } from '@/hooks/useDeleteTicket';
import type { UpdateTicketDto } from '@/types/ticket';
import { Modal } from './Modal';
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';
import { DeleteTicketConfirm } from './DeleteTicketConfirm';
import { TicketAttributeForm } from './TicketAttributeForm';

// F16: the unified ticket detail modal. Read-only header (display ID, creator,
// timestamps) + the reused TicketAttributeForm edit body (F13/F14/F15). Wires the
// Modal a11y primitive, an unsaved-changes guard (isDirty + useBlocker +
// ConfirmDiscardDialog), and drift reconciliation (refetch while open).
//
// Deep-linked: BoardPage (T6) renders this over the mounted board when the route
// is `/projects/:slug/tickets/:ticketId`; onClose navigates back.
interface TicketDetailModalProps {
    slug: string;
    ticketId: string;
    onClose: () => void;
    onSubmit: (dto: UpdateTicketDto) => Promise<void>;
}

export function TicketDetailModal({ slug, ticketId, onClose, onSubmit }: TicketDetailModalProps) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const isAdmin = useRequireRole('ADMIN');
    const deleteTicketMutation = useDeleteTicket();

    // F16 D7: reconcile board/modal drift — refetch the detail while the modal is
    // open (30s, matching the board). RHF defaultValues are seeded once (below),
    // so a background refetch updates the cache but never overwrites unsaved input.
    const { data: ticket } = useQuery({
        queryKey: ticketKeys.detail(ticketId),
        queryFn: () => fetchTicket(ticketId),
        refetchInterval: 30_000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
    });

    // F16 D6: block route navigation (back/forward) while the form is dirty.
    const blocker = useBlocker(isDirty);

    // The confirm shows when the user tried to close (Esc/backdrop/button) while
    // dirty, OR when route navigation was blocked — derived, no setState-in-effect.
    const showConfirm = confirmOpen || blocker.state === 'blocked';

    // Esc / backdrop / close-button: confirm before close when dirty.
    const requestClose = () => {
        if (isDirty) setConfirmOpen(true);
        else onClose();
    };

    const handleDiscard = () => {
        setConfirmOpen(false);
        setIsDirty(false);
        if (blocker.state === 'blocked') blocker.proceed();
        onClose();
    };

    const handleCancelConfirm = () => {
        setConfirmOpen(false);
        if (blocker.state === 'blocked') blocker.reset();
    };

    // F17 T4: admin-only delete. Surfaces the destructive confirm; on confirm it
    // soft-deletes via the mutation, closes the confirm, then closes the modal.
    const handleConfirmDelete = async () => {
        await deleteTicketMutation.mutateAsync({ ticketId, slug });
        setDeleteConfirmOpen(false);
        onClose();
    };

    if (!ticket) return null;

    return (
        <>
            <Modal
                isOpen
                onClose={requestClose}
                onEsc={requestClose}
                titleId="ticket-detail-title"
                title={formatTicketId(slug, ticket.ticketNumber)}
                blockBackdropClose={isDirty}
            >
                {/* VIEW HEADER — display ID is the modal title; creator + timestamps read-only */}
                <dl className="mb-4 space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                        {ticket.creator && (
                            <>
                                {ticket.creator.avatarUrl && (
                                    <img
                                        src={ticket.creator.avatarUrl}
                                        alt=""
                                        className="h-5 w-5 rounded-full"
                                    />
                                )}
                                <span>Created by {ticket.creator.fullName}</span>
                            </>
                        )}
                    </div>
                    <div>Created: {formatDate(ticket.createdAt)}</div>
                    <div>Updated: {formatDate(ticket.updatedAt)}</div>
                </dl>

                {/* EDIT BODY — reuse the F13/F14/F15 form (D2). */}
                <TicketAttributeForm
                    mode="edit"
                    projectSlug={slug}
                    defaultValues={{
                        title: ticket.title,
                        description: ticket.description ?? '',
                        priority: ticket.priority,
                        assigneeId: ticket.assignee?.id ?? null,
                        labelIds: ticket.labels.map((l) => l.id),
                        checklist: ticket.checklist,
                    }}
                    onDirtyChange={setIsDirty}
                    onSubmit={async (values) => {
                        await onSubmit(values as UpdateTicketDto);
                        setIsDirty(false);
                        onClose();
                    }}
                    onCancel={requestClose}
                />

                {/* F17 T4: admin-only delete entry point. Members (isAdmin=false) render nothing. */}
                {isAdmin && (
                    <div className="mt-4 border-t border-gray-200 pt-4">
                        <button
                            type="button"
                            onClick={() => setDeleteConfirmOpen(true)}
                            className="text-sm text-red-600 hover:underline"
                        >
                            Delete ticket
                        </button>
                    </div>
                )}
                {/* F19 will render the activity feed here. */}
            </Modal>

            <ConfirmDiscardDialog
                isOpen={showConfirm}
                onDiscard={handleDiscard}
                onCancel={handleCancelConfirm}
            />
            <DeleteTicketConfirm
                isOpen={deleteConfirmOpen}
                isDeleting={deleteTicketMutation.isPending}
                onConfirm={handleConfirmDelete}
                onCancel={() => setDeleteConfirmOpen(false)}
            />
        </>
    );
}
