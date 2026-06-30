import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';

import { fetchTicket } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { formatTicketId } from '@/utils/formatTicketId';
import { formatDate } from '@/utils/formatDate';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useDeleteTicket } from '@/hooks/useDeleteTicket';
import type { UpdateTicketDto } from '@/types/ticket';
import { Avatar } from './ui/Avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/Tabs';
import { Modal } from './Modal';
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';
import { DeleteTicketConfirm } from './DeleteTicketConfirm';
import { ActivityFeed } from './ActivityFeed';
import { TicketAttributeForm } from './TicketAttributeForm';
import { TimerControls } from './TimerControls';
import { TimeLog } from './TimeLog';
import { ManualEntryForm } from './ManualEntryForm';
import { TicketModalSkeleton } from './TicketModalSkeleton';
import { Retry } from './Retry';

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
    // SLYK-11 T3: active detail tab. Defaults to 'details' on (re)mount; reset to
    // 'details' whenever the ticket changes while the modal stays open. The modal
    // is unmounted on close, so a fresh mount naturally resets this state.
    const [activeTab, setActiveTab] = useState<'details' | 'time-tracking' | 'activity'>('details');
    useEffect(() => {
        setActiveTab('details');
    }, [ticketId]);
    const isAdmin = useRequirePlatformAdmin();
    const deleteTicketMutation = useDeleteTicket();

    // F16 D7: reconcile board/modal drift — refetch the detail while the modal is
    // open (30s, matching the board). RHF defaultValues are seeded once (below),
    // so a background refetch updates the cache but never overwrites unsaved input.
    const {
        data: ticket,
        isLoading,
        isError,
        error,
        refetch,
    } = useQuery({
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

    // The modal shell is always rendered while open; only the body branches on
    // the query state (loading / error / absent / resolved).
    const modalTitle = ticket ? formatTicketId(slug, ticket.ticketNumber) : 'Loading ticket…';

    let modalBody: React.ReactNode;
    if (isLoading) {
        modalBody = <TicketModalSkeleton />;
    } else if (isError) {
        modalBody = (
            <Retry
                message={error instanceof Error ? error.message : 'Failed to load ticket'}
                onRetry={() => void refetch()}
            />
        );
    } else if (!ticket) {
        modalBody = (
            <div className="flex flex-col items-center gap-4 p-8 text-center">
                <p className="text-base font-semibold text-foreground">Ticket not found</p>
                <p className="text-sm text-muted-foreground">
                    This ticket may have been deleted or no longer exists.
                </p>
                <button
                    type="button"
                    onClick={requestClose}
                    className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    Close
                </button>
            </div>
        );
    } else {
        modalBody = (
            <>
                {/* F17: deleted-ticket banner — shown when the ticket is soft-deleted. */}
                {ticket.deletedAt && (
                    <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-destructive-foreground">
                            Deleted
                        </span>
                        <span className="text-sm text-destructive">
                            This ticket was removed from the board. Its data is archived.
                        </span>
                    </div>
                )}

                {/*
                  SLYK-11 T3: the resolved modal body is split into three accessible
                  tabs (Details / Time Tracking / Activity). The Tabs root is CONTROLLED
                  (value/onValueChange) so we can drive the hidden attribute ourselves.
                  CRITICAL (RHF form-state preservation): every TabsContent uses
                  forceMount and is hidden via the `hidden` attribute when inactive —
                  Radix never unmounts a panel, so React Hook Form state (and isDirty)
                  stays alive across tab switches, preserving the unsaved-changes guard
                  trio: useBlocker(isDirty), requestClose, blockBackdropClose={isDirty}.
                */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                    <TabsList>
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="time-tracking" disabled={!!ticket.deletedAt}>
                            Time Tracking
                        </TabsTrigger>
                        <TabsTrigger value="activity">Activity</TabsTrigger>
                    </TabsList>

                    {/* --- Details ---------------------------------------------------------- */}
                    <TabsContent
                        value="details"
                        forceMount
                        hidden={activeTab !== 'details'}
                        className="mt-4"
                    >
                        {/* VIEW HEADER — display ID is the modal title; creator + timestamps read-only */}
                        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                                <Avatar
                                    src={ticket.creator?.avatarUrl ?? null}
                                    name={ticket.creator?.fullName ?? null}
                                    size="sm"
                                />
                                <span className="truncate">
                                    Created by {ticket.creator?.fullName ?? 'Unknown'}
                                </span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Clock size={14} className="shrink-0" />
                                <time dateTime={ticket.createdAt} title={formatDate(ticket.createdAt)}>
                                    {formatRelativeTime(ticket.createdAt)}
                                </time>
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Clock size={14} className="shrink-0" />
                                <time dateTime={ticket.updatedAt} title={formatDate(ticket.updatedAt)}>
                                    {formatRelativeTime(ticket.updatedAt)}
                                </time>
                            </span>
                        </div>

                        {/* EDIT BODY — reuse the F13/F14/F15 form (D2). */}
                        <TicketAttributeForm
                            mode="edit"
                            readOnly={!!ticket.deletedAt}
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

                        {/* SLYK-13: Comments section — not yet implemented */}
                        <section aria-label="Comments" className="mt-4">
                            <p className="text-sm text-muted-foreground">
                                Comments — coming soon (SLYK-13)
                            </p>
                        </section>

                        {/* F17 T4: admin-only delete entry point. Hidden for members + soft-deleted tickets. */}
                        {isAdmin && !ticket.deletedAt && (
                            <div className="mt-4 border-t border-border pt-4">
                                <button
                                    type="button"
                                    onClick={() => setDeleteConfirmOpen(true)}
                                    className="text-sm text-destructive hover:underline"
                                >
                                    Delete ticket
                                </button>
                            </div>
                        )}
                    </TabsContent>

                    {/* --- Time Tracking ---------------------------------------------------- */}
                    <TabsContent
                        value="time-tracking"
                        forceMount
                        hidden={activeTab !== 'time-tracking'}
                        className="mt-4"
                    >
                        {/* F20 T7: server-authoritative timer controls. Hidden for soft-deleted tickets. */}
                        {!ticket.deletedAt && <TimerControls ticketId={ticket.id} />}

                        {/* F20: time-tracking log (reverse-chrono entries + total). Hidden for soft-deleted tickets. */}
                        {!ticket.deletedAt && <TimeLog ticketId={ticketId} />}

                        {/* F21: manual time-entry form. Hidden for soft-deleted tickets. */}
                        {!ticket.deletedAt && <ManualEntryForm ticketId={ticketId} />}
                    </TabsContent>

                    {/* --- Activity --------------------------------------------------------- */}
                    <TabsContent
                        value="activity"
                        forceMount
                        hidden={activeTab !== 'activity'}
                        className="mt-4"
                    >
                        {/* F19 T5: reverse-chronological activity feed (REQ-5.1, REQ-5.2). */}
                        <ActivityFeed ticketId={ticketId} />
                    </TabsContent>
                </Tabs>
            </>
        );
    }

    return (
        <>
            <Modal
                isOpen
                onClose={requestClose}
                onEsc={requestClose}
                titleId="ticket-detail-title"
                title={modalTitle}
                blockBackdropClose={isDirty}
                size="full"
            >
                {modalBody}
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
