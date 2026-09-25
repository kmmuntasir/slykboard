import { useEffect, useState } from 'react';
import { useNavigate, useParams, Outlet } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useBoard } from '@/hooks/useBoard';
import { useMoveTicket } from '@/hooks/useMoveTicket';
import { useUpdateTicket } from '@/hooks/useUpdateTicket';
import { toast } from '@/hooks/useToast';
import { computeDestinationPosition, type MoveDescriptor } from '@/utils/boardReorder';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import { BoardColumn } from '@/components/BoardColumn';
import { EmptyState } from '@/components/EmptyState';
import { UnsortedBucket } from '@/components/UnsortedBucket';
import { BoardFilters } from '@/components/BoardFilters';
import { NewTicketButton } from '@/components/NewTicketButton';
import { TicketDetailModal } from '@/components/TicketDetailModal';
import { TicketNotFound } from '@/components/TicketNotFound';
import { BoardSkeleton } from '@/components/BoardSkeleton';
import { Retry } from '@/components/Retry';
import { ApiClientError } from '@/api/client';
import { fetchTicketByRef } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { formatTicketId } from '@/utils/formatTicketId';
import { formatDuration } from '@/utils/formatDuration';
import type { BoardPayload } from '@/types/board';
import type { UpdateTicketDto } from '@/types/ticket';

export function BoardPage() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { data: board, isLoading, error, refetch } = useBoard(slug);
    const { mutate } = useMoveTicket(slug);
    const setDragInProgress = useBoardUiStore((s) => s.setDragInProgress);
    const typeFilter = useBoardUiStore((s) => s.typeFilter);
    const epicFilter = useBoardUiStore((s) => s.epicFilter);
    const hasActiveFilters = useBoardUiStore(
        (s) =>
            s.searchQuery !== '' ||
            s.assigneeFilter !== null ||
            s.priorityFilter !== null ||
            s.labelFilter !== null ||
            s.typeFilter !== null ||
            s.epicFilter !== null,
    );
    const clearFilters = useBoardUiStore((s) => s.clearFilters);
    // CR-03 FR-03.8: Board | Epics view toggle (local UI state).
    const [view, setView] = useState<'board' | 'epics'>('board');

    if (!slug) {
        return <div className="p-4">No project selected.</div>;
    }
    if (isLoading) {
        return <BoardSkeleton />;
    }
    if (error instanceof ApiClientError) {
        if (error.status === 404) {
            return <div className="p-4">Project '{slug}' not found.</div>;
        }
        return (
            <div className="p-4">
                <Retry message={error.message} onRetry={refetch} />
            </div>
        );
    }
    if (!board) {
        return null;
    }

    // F16: card click deep-links to the ticket modal via the nested route
    // /projects/:slug/tickets/:displayId. F30 T3: TicketCard now passes the
    // human-readable SLYK-NNN display-ID; BoardPage stays mounted under the modal.
    const handleEdit = (displayId: string) => {
        navigate(`tickets/${displayId}`);
    };

    const handleDragStart = () => setDragInProgress(true);

    const handleDragEnd = (result: DropResult) => {
        if (!result.destination) {
            return;
        }
        const { source, destination, draggableId } = result;
        if (source.droppableId === destination.droppableId && source.index === destination.index) {
            return;
        }
        if (!board) {
            return;
        }

        // CR-03 FR-03.10: a ticket with live children has a derived column —
        // cross-column drops are refused client-side (the server rejects them
        // too; this avoids the doomed request + optimistic churn). Vertical
        // reordering within the same column stays allowed.
        if (source.droppableId !== destination.droppableId) {
            const dragged = board.columns
                .flatMap((column) => column.tickets)
                .find((ticket) => ticket.id === draggableId);
            if (dragged && (dragged.childCount ?? 0) > 0) {
                toast.error(
                    'This ticket\u2019s column follows its children — move the children instead.',
                );
                setDragInProgress(false);
                return;
            }
        }

        const move: MoveDescriptor = {
            ticketId: draggableId,
            srcColumnId: source.droppableId,
            srcIndex: source.index,
            dstColumnId: destination.droppableId,
            dstIndex: destination.index,
        };
        const position = computeDestinationPosition(board, move);
        mutate({ ...move, position });
        // D5: release the poll-pause AFTER kicking off the optimistic persist.
        setDragInProgress(false);
    };

    // CR-03: client-side hierarchy filters (type + epic) applied to the fetched
    // board before rendering. Server-side filters (search/assignee/priority/
    // label) are already baked into the query response.
    const applyHierarchyFilters = (columns: BoardPayload['columns']): BoardPayload['columns'] =>
        columns.map((column) => ({
            ...column,
            tickets: column.tickets.filter(
                (ticket) =>
                    (typeFilter === null || ticket.type === typeFilter) &&
                    (epicFilter === null || ticket.epic?.id === epicFilter),
            ),
        }));
    const lastColumnId = board
        ? (board.columns.filter((column) => !column.isUnsorted).at(-1)?.id ?? undefined)
        : undefined;
    const filteredColumns = board
        ? applyHierarchyFilters(board.columns).filter(
              // Drop columns that ended up empty ONLY due to filters when any
              // hierarchy filter is active — keeps the board focused.
              (column) => (typeFilter === null && epicFilter === null) || column.tickets.length > 0,
          )
        : [];

    const filteredTicketCount = filteredColumns.reduce((sum, c) => sum + c.tickets.length, 0);
    const isEmpty = filteredTicketCount === 0;

    return (
        <div className="flex h-full flex-col gap-4 p-4">
            <header className="flex items-center justify-between gap-4">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-2xl font-semibold">{board.project.name}</h1>
                    <span className="text-sm text-muted-foreground">{board.project.slug}</span>
                </div>
                {/* CR-03 FR-03.8: Board | Epics view toggle. */}
                <div className="flex items-center gap-2">
                    <div
                        role="tablist"
                        aria-label="Board view"
                        className="flex rounded-md border border-border p-0.5"
                    >
                        {(['board', 'epics'] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                role="tab"
                                aria-selected={view === option}
                                onClick={() => setView(option)}
                                className={
                                    view === option
                                        ? 'rounded bg-muted px-3 py-1 text-sm font-medium capitalize'
                                        : 'rounded px-3 py-1 text-sm capitalize text-muted-foreground hover:text-foreground'
                                }
                            >
                                {option === 'board' ? 'Board' : 'Epics'}
                            </button>
                        ))}
                    </div>
                    <NewTicketButton slug={slug} />
                </div>
            </header>

            <BoardFilters slug={slug} />

            {view === 'epics' ? (
                <EpicsView
                    slug={slug}
                    epics={board.epics ?? []}
                    onEdit={(displayId) => navigate(`tickets/${displayId}`)}
                />
            ) : isEmpty && hasActiveFilters ? (
                <EmptyState
                    title="No tickets match your filters"
                    description="Try adjusting or clearing your filters."
                    action={{ label: 'Clear filters', onClick: clearFilters }}
                />
            ) : isEmpty ? (
                <EmptyState
                    title="No tickets yet"
                    description="Create one to get started."
                    action={<NewTicketButton slug={slug} />}
                />
            ) : (
                <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <div className="flex gap-4 overflow-x-auto">
                        {filteredColumns.map((column) =>
                            column.isUnsorted ? (
                                <UnsortedBucket
                                    key={column.id}
                                    tickets={column.tickets}
                                    projectSlug={board.project.slug}
                                    onEdit={handleEdit}
                                    lastColumnId={lastColumnId}
                                />
                            ) : (
                                <BoardColumn
                                    key={column.id}
                                    id={column.id}
                                    name={column.name}
                                    tickets={column.tickets}
                                    projectSlug={board.project.slug}
                                    onEdit={handleEdit}
                                    lastColumnId={lastColumnId}
                                />
                            ),
                        )}
                    </div>
                </DragDropContext>
            )}
            {/* F16: nested route renders TicketDetailRoute → TicketDetailModal here. */}
            <Outlet />
        </div>
    );
}

// CR-03 FR-03.8: the Epics view — one row per epic with descendant completion
// progress. Tracked-time roll-ups join this table when CR-04 lands.
interface EpicsViewProps {
    slug: string;
    epics: BoardPayload['epics'];
    onEdit: (displayId: string) => void;
}

function EpicsView({ slug, epics, onEdit }: EpicsViewProps) {
    if (epics.length === 0) {
        return (
            <EmptyState
                title="No epics yet"
                description="Create a ticket with type Epic to group stories, tasks, and subtasks."
            />
        );
    }
    return (
        <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm" aria-label="Epics">
                <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Epic</th>
                        <th className="px-4 py-2 font-medium">Progress</th>
                        <th className="px-4 py-2 font-medium">Done</th>
                        <th className="px-4 py-2 font-medium">Tracked</th>
                    </tr>
                </thead>
                <tbody>
                    {epics.map((epic) => {
                        const pct =
                            epic.descendantCount === 0
                                ? 0
                                : Math.round(
                                      (epic.doneDescendantCount / epic.descendantCount) * 100,
                                  );
                        return (
                            <tr
                                key={epic.id}
                                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                                onClick={() => onEdit(formatTicketId(slug, epic.ticketNumber))}
                            >
                                <td className="px-4 py-2">
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {formatTicketId(slug, epic.ticketNumber, { padded: true })}
                                    </span>{' '}
                                    {epic.title}
                                </td>
                                <td className="px-4 py-2">
                                    <div
                                        className="h-2 w-40 overflow-hidden rounded-full bg-muted"
                                        role="progressbar"
                                        aria-valuenow={pct}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label={`${epic.title} progress`}
                                    >
                                        <div
                                            className="h-full rounded-full bg-primary"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </td>
                                <td className="px-4 py-2 tabular-nums">
                                    {epic.doneDescendantCount}/{epic.descendantCount} ({pct}%)
                                </td>
                                <td
                                    className="px-4 py-2 tabular-nums"
                                    title="Tracked time including sub-tickets"
                                >
                                    {epic.trackedTotalMs > 0
                                        ? formatDuration(epic.trackedTotalMs)
                                        : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// F16: child route element for /projects/:slug/tickets/:displayId. Renders the
// TicketDetailModal over the mounted board (BoardPage stays mounted via <Outlet/>).
// F30 T3: the URL param is the human-readable SLYK-NNN display-ID; the route
// resolves it to a full Ticket once and seeds the modal's UUID-keyed detail
// cache (TicketDetailModal hydrates by UUID — its contract is unchanged).
export function TicketDetailRoute() {
    const { slug, displayId } = useParams<{ slug: string; displayId: string }>();
    const navigate = useNavigate();
    const updateTicket = useUpdateTicket();
    const queryClient = useQueryClient();

    const {
        data: ticket,
        isLoading,
        isError,
    } = useQuery({
        queryKey: ticketKeys.detailByRef(slug ?? '', displayId ?? ''),
        queryFn: () => fetchTicketByRef(slug as string, displayId as string),
        enabled: Boolean(slug && displayId),
    });

    // D2: resolve SLYK-NNN -> UUID once at the route layer, then seed the modal's
    // UUID-keyed detail cache so TicketDetailModal hydrates by UUID (contract
    // unchanged) without a second round-trip.
    useEffect(() => {
        if (ticket) {
            queryClient.setQueryData(ticketKeys.detail(ticket.id), ticket);
        }
    }, [queryClient, ticket]);

    if (!slug || !displayId) return null;
    if (isLoading) return null; // minimal pending state; T4 owns not-found UI.
    if (isError || !ticket) {
        return <TicketNotFound onClose={() => navigate(`/projects/${slug}`)} />;
    }

    return (
        <TicketDetailModal
            slug={slug}
            ticketId={ticket.id}
            onClose={() => navigate(`/projects/${slug}`)}
            onSubmit={async (dto: UpdateTicketDto) => {
                await updateTicket.mutateAsync({ ticketId: ticket.id, dto, slug });
            }}
        />
    );
}
