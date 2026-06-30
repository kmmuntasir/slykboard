import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { FormProvider } from 'react-hook-form';

import { fetchTicket, moveTicket } from '@/api/tickets';
import { fetchTimeEntries } from '@/api/timer';
import { ticketKeys, timerKeys, boardKeys } from '@/api/queryKeys';
import { formatTicketId } from '@/utils/formatTicketId';
import { formatDate } from '@/utils/formatDate';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { formatDuration } from '@/utils/formatDuration';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useCurrentProjectMembership } from '@/hooks/useProjectMembers';
import { useDeleteTicket } from '@/hooks/useDeleteTicket';
import { useTicketForm, type TicketFormValues } from '@/hooks/useTicketForm';
import type { UpdateTicketDto } from '@/types/ticket';
import { Avatar } from './ui/Avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/Tabs';
import { Button } from './ui/Button';
import { Modal } from './Modal';
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';
import { DeleteTicketConfirm } from './DeleteTicketConfirm';
import { ActivityFeed } from './ActivityFeed';
import { CommentsSection } from './CommentsSection';
import { TimerHeroCard } from './TimerHeroCard';
import { TimeLog } from './TimeLog';
import { ManualEntryForm } from './ManualEntryForm';
import { TicketModalSkeleton } from './TicketModalSkeleton';
import { Retry } from './Retry';
import {
    TitleField,
    DescriptionField,
    StatusField,
    PriorityField,
    AssigneeField,
    DueDateField,
    LabelsField,
    ChecklistField,
} from './ticket-fields';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/Collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';

// DEL-01 T7: restructured ticket detail modal. The modal now owns the single
// React Hook Form instance (via useTicketForm, extracted in T6) and renders a
// static-left / dynamic-right split inside one <FormProvider> + <form>:
//   LEFT (static across tabs)  — creator header + timestamps, Title, Description, Comments
//   RIGHT (dynamic, tabbed)    — Metadata · Time Tracking · Activity (forceMount+hidden)
//   FOOTER (spans both columns, inside the form, outside the Tabs) — Save changes + Delete ticket
//
// The split keeps RHF state alive across tab switches (FormProvider spans both
// DOM columns; TabsContent uses forceMount+hidden so the Metadata fields never
// unmount). Dirty-guard machinery (useBlocker, blockBackdropClose, requestClose,
// ConfirmDiscardDialog, DeleteTicketConfirm) is preserved — onDirtyChange flows
// from useTicketForm. The delete gate is widened to platform-OR-project-admin.
//
// Deep-linked: BoardPage renders this over the mounted board when the route is
// `/projects/:slug/tickets/:ticketId`; onClose navigates back.
interface TicketDetailModalProps {
    slug: string;
    ticketId: string;
    onClose: () => void;
    onSubmit: (dto: UpdateTicketDto) => Promise<void>;
}

type DetailTab = 'metadata' | 'time-tracking' | 'activity';

export function TicketDetailModal({ slug, ticketId, onClose, onSubmit }: TicketDetailModalProps) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    // DEL-01 T7: active detail tab. Defaults to 'metadata' on (re)mount; reset
    // to 'metadata' whenever the ticket changes while the modal stays open. We
    // reset during render (React docs "reset state when a prop changes" pattern)
    // rather than in an effect to avoid a cascading render.
    const [activeTab, setActiveTab] = useState<DetailTab>('metadata');
    const [activeTicketId, setActiveTicketId] = useState(ticketId);
    if (activeTicketId !== ticketId) {
        setActiveTicketId(ticketId);
        setActiveTab('metadata');
    }

    const isPlatformAdmin = useRequirePlatformAdmin();
    const { isProjectAdmin } = useCurrentProjectMembership(slug);
    // Widened gate: platform-OR-project admin can delete (was platform-only).
    const canDelete = isPlatformAdmin || isProjectAdmin;

    const deleteTicketMutation = useDeleteTicket();

    // D7: reconcile board/modal drift — refetch the detail while the modal is
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

    // statusColumn is NOT part of UpdateTicketDto — it moves via moveTicket
    // (handleStatusMove below). Everything else maps straight through.
    const handleSubmit = (values: TicketFormValues) => {
        const dto: UpdateTicketDto = {
            title: values.title,
            description: values.description,
            priority: values.priority,
            assigneeId: values.assigneeId,
            labelIds: values.labelIds,
            checklist: values.checklist,
            dueDate: values.dueDate ?? null,
        };
        return onSubmit(dto);
    };

    // The form methods. useTicketForm hoists isDirty via onDirtyChange so the
    // guard trio (useBlocker, requestClose, blockBackdropClose) stays armed.
    // Initialized with EMPTY defaults (hook order must be stable across the
    // loading/resolved states); the effect below seeds the real ticket values.
    const methods = useTicketForm({
        defaultValues: EMPTY_DEFAULT_VALUES,
        onSubmit: async (values) => {
            await handleSubmit(values);
            setIsDirty(false);
            onClose();
        },
        onDirtyChange: setIsDirty,
    });

    // Seed the form once per ticket. Keyed on ticketId (NOT on the `ticket`
    // reference, which changes on every 30s background refetch) so a drift
    // refetch never clobbers in-flight edits.
    const seededTicketId = useRef<string | null>(null);
    useEffect(() => {
        if (!ticket || seededTicketId.current === ticket.id) return;
        seededTicketId.current = ticket.id;
        methods.reset({
            title: ticket.title,
            description: ticket.description ?? '',
            priority: ticket.priority,
            assigneeId: ticket.assignee?.id ?? null,
            labelIds: ticket.labels.map((l) => l.id),
            checklist: ticket.checklist,
            statusColumn: ticket.statusColumn,
            dueDate: ticket.dueDate ?? null,
        });
    }, [ticket, methods]);

    // D6: block route navigation (back/forward) while the form is dirty.
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

    // F17 T4 + DEL-01: widened-delete confirm. Soft-deletes via the mutation,
    // closes the confirm, then closes the modal.
    const handleConfirmDelete = async () => {
        await deleteTicketMutation.mutateAsync({ ticketId, slug });
        setDeleteConfirmOpen(false);
        onClose();
    };

    // DEL-01 T7: status-change → moveTicket mutation (board DnD persists the
    // same PATCH). Called unconditionally (hook-order stability); the resolved
    // branch below wires it into StatusField.onMove with the ticket's id/position.
    const statusMoveMutate = useStatusMove(slug);

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
        const createdAbsolute = formatDate(ticket.createdAt);
        const updatedAbsolute = formatDate(ticket.updatedAt);

        modalBody = (
            <FormProvider {...methods}>
                <form onSubmit={methods.handleSubmit(async (values) => {
                    await handleSubmit(values);
                    setIsDirty(false);
                    onClose();
                })}>
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
                      DEL-01 T7: 2-column grid — static LEFT (title/description/
                      comments + the creator/timestamp header) and a dynamic
                      RIGHT sidebar (tabbed Metadata/Time Tracking/Activity) that
                      scrolls independently. The footer row spans both columns,
                      OUTSIDE the Tabs but INSIDE the <form> so submit is wired.
                    */}
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
                        {/* --- LEFT (static across tabs) ---------------------------- */}
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <time dateTime={ticket.createdAt}>
                                                {formatRelativeTime(ticket.createdAt)}
                                            </time>
                                        </TooltipTrigger>
                                        <TooltipContent>{createdAbsolute}</TooltipContent>
                                    </Tooltip>
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <Clock size={14} className="shrink-0" />
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <time dateTime={ticket.updatedAt}>
                                                {formatRelativeTime(ticket.updatedAt)}
                                            </time>
                                        </TooltipTrigger>
                                        <TooltipContent>{updatedAbsolute}</TooltipContent>
                                    </Tooltip>
                                </span>
                            </div>

                            <TitleField readOnly={ticket.deletedAt ? true : undefined} />
                            <DescriptionField readOnly={!!ticket.deletedAt} />

                            <CommentsSection
                                ticketId={ticket.id}
                                slug={slug}
                                disabled={!!ticket.deletedAt}
                            />
                        </div>

                        {/* --- RIGHT (dynamic sidebar) ----------------------------- */}
                        <div className="lg:max-h-[80vh] lg:overflow-y-auto">
                            {/*
                              CRITICAL (RHF form-state preservation): every
                              TabsContent uses forceMount and is hidden via the
                              `hidden` attribute when inactive — Radix never
                              unmounts a panel, so React Hook Form state (and
                              isDirty) stays alive across tab switches.
                            */}
                            <Tabs
                                value={activeTab}
                                onValueChange={(v) => setActiveTab(v as DetailTab)}
                            >
                                <TabsList>
                                    <TabsTrigger value="metadata">Metadata</TabsTrigger>
                                    <TabsTrigger
                                        value="time-tracking"
                                        disabled={!!ticket.deletedAt}
                                    >
                                        Time Tracking
                                    </TabsTrigger>
                                    <TabsTrigger value="activity">Activity</TabsTrigger>
                                </TabsList>

                                {/* --- Metadata --------------------------------------- */}
                                <TabsContent
                                    value="metadata"
                                    forceMount
                                    hidden={activeTab !== 'metadata'}
                                    className="mt-4 flex flex-col gap-4"
                                >
                                    <StatusField
                                        projectSlug={slug}
                                        ticketId={ticket.id}
                                        ticketPosition={ticket.position}
                                        onMove={(statusColumn) => {
                                            // Same-column = no-op (no spurious activity row).
                                            if (statusColumn === ticket.statusColumn) return;
                                            statusMoveMutate.mutate({
                                                ticketId: ticket.id,
                                                statusColumn,
                                                position: ticket.position,
                                            });
                                        }}
                                    />
                                    <PriorityField />
                                    <AssigneeField projectSlug={slug} />
                                    <DueDateField />
                                    <LabelsField projectSlug={slug} />
                                    <ChecklistField />
                                </TabsContent>

                                {/* --- Time Tracking --------------------------------- */}
                                <TabsContent
                                    value="time-tracking"
                                    forceMount
                                    hidden={activeTab !== 'time-tracking'}
                                    className="mt-4"
                                >
                                    {!ticket.deletedAt && (
                                        <TimerTrackingPanel ticketId={ticket.id} />
                                    )}
                                </TabsContent>

                                {/* --- Activity -------------------------------------- */}
                                <TabsContent
                                    value="activity"
                                    forceMount
                                    hidden={activeTab !== 'activity'}
                                    className="mt-4"
                                >
                                    <ActivityFeed ticketId={ticket.id} />
                                </TabsContent>
                            </Tabs>
                        </div>

                        {/* --- FOOTER (spans both columns, inside the form) -------- */}
                        <div className="col-span-full mt-2 flex items-center justify-end gap-2 border-t border-border pt-4">
                            {!ticket.deletedAt && (
                                <Button
                                    type="submit"
                                    variant="primary"
                                    disabled={methods.formState.isSubmitting}
                                >
                                    {methods.formState.isSubmitting ? 'Saving…' : 'Save changes'}
                                </Button>
                            )}
                            {canDelete && !ticket.deletedAt && (
                                <Button
                                    variant="destructive-outline"
                                    onClick={() => setDeleteConfirmOpen(true)}
                                >
                                    Delete ticket
                                </Button>
                            )}
                        </div>
                    </div>
                </form>
            </FormProvider>
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

// Sentinel defaultValues so useTicketForm can be called unconditionally (the
// resolved branch below seeds real values via `methods.reset` once the ticket
// loads). Keeps hook order stable across the loading/resolved states.
const EMPTY_DEFAULT_VALUES: TicketFormValues = {
    title: '',
    description: '',
    priority: 'LOW',
    assigneeId: null,
    labelIds: [],
    checklist: [],
    statusColumn: '',
    dueDate: null,
};

// DEL-01 T7: Status → moveTicket. Same-column is a no-op (no spurious activity)
// — the caller guards it before invoking. Reuses the api/tickets moveTicket
// (the same PATCH the board DnD hook persists) wrapped in a mutation that
// invalidates the board + ticket detail on success.
function useStatusMove(slug: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (vars: { ticketId: string; statusColumn: string; position: number }) =>
            moveTicket(vars.ticketId, {
                statusColumn: vars.statusColumn,
                position: vars.position,
            }),
        onSuccess: (_data, vars) => {
            void queryClient.invalidateQueries({ queryKey: boardKeys.detail(slug) });
            void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
            void queryClient.invalidateQueries({
                queryKey: ticketKeys.activity(vars.ticketId),
            });
        },
    });
}

// DEL-01 T7: the Time Tracking panel composition. TimerHeroCard renders the
// hero timer surface only; this panel adds the compact "Total tracked" summary
// (reusing TimeEntriesResponse.totalMs, mirroring TimeLog), the full <TimeLog>,
// and the collapsible <ManualEntryForm> (collapsed by default). Kept inline so
// the modal owns the panel layout; the card stays single-responsibility.
interface TimerTrackingPanelProps {
    ticketId: string;
}

function TimerTrackingPanel({ ticketId }: TimerTrackingPanelProps) {
    const { data } = useQuery({
        queryKey: timerKeys.entries(ticketId),
        queryFn: () => fetchTimeEntries(ticketId),
    });
    const totalMs = data?.totalMs ?? 0;

    return (
        <div className="flex flex-col gap-4">
            <TimerHeroCard ticketId={ticketId} />

            <p className="text-sm text-muted-foreground">
                Total tracked:{' '}
                <span className="font-mono tabular-nums text-foreground">
                    {formatDuration(totalMs)}
                </span>
            </p>

            <TimeLog ticketId={ticketId} />

            <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="text-sm text-primary hover:underline">
                    Manual entry ▾
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <ManualEntryForm ticketId={ticketId} />
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
