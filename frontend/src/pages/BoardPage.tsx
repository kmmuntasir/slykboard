import { useEffect } from 'react';
import { useNavigate, useParams, Outlet } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useBoard } from '@/hooks/useBoard';
import { useMoveTicket } from '@/hooks/useMoveTicket';
import { useUpdateTicket } from '@/hooks/useUpdateTicket';
import { computeDestinationPosition, type MoveDescriptor } from '@/utils/boardReorder';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import { BoardColumn } from '@/components/BoardColumn';
import { EmptyState } from '@/components/EmptyState';
import { UnsortedBucket } from '@/components/UnsortedBucket';
import { BoardFilters } from '@/components/BoardFilters';
import { NewTicketButton } from '@/components/NewTicketButton';
import { TicketDetailModal } from '@/components/TicketDetailModal';
import { BoardSkeleton } from '@/components/BoardSkeleton';
import { Retry } from '@/components/Retry';
import { ApiClientError } from '@/api/client';
import { fetchTicketByRef } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import type { UpdateTicketDto } from '@/types/ticket';

export function BoardPage() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { data: board, isLoading, error, refetch } = useBoard(slug);
    const { mutate } = useMoveTicket(slug);
    const setDragInProgress = useBoardUiStore((s) => s.setDragInProgress);
    const hasActiveFilters = useBoardUiStore(
        (s) =>
            s.searchQuery !== '' ||
            s.assigneeFilter !== null ||
            s.priorityFilter !== null ||
            s.labelFilter !== null,
    );
    const clearFilters = useBoardUiStore((s) => s.clearFilters);

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

    const filteredTicketCount = board?.columns.reduce((sum, c) => sum + c.tickets.length, 0) ?? 0;
    const isEmpty = filteredTicketCount === 0;

    return (
        <div className="flex h-full flex-col gap-4 p-4">
            <header className="flex items-center justify-between gap-4">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-2xl font-semibold">{board.project.name}</h1>
                    <span className="text-sm text-muted-foreground">{board.project.slug}</span>
                </div>
                <NewTicketButton slug={slug} />
            </header>

            <BoardFilters slug={slug} />

            {isEmpty && hasActiveFilters ? (
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
                        {board.columns.map((column) =>
                            column.isUnsorted ? (
                                <UnsortedBucket
                                    key={column.id}
                                    tickets={column.tickets}
                                    projectSlug={board.project.slug}
                                    onEdit={handleEdit}
                                />
                            ) : (
                                <BoardColumn
                                    key={column.id}
                                    id={column.id}
                                    name={column.name}
                                    tickets={column.tickets}
                                    projectSlug={board.project.slug}
                                    onEdit={handleEdit}
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

    const { data: ticket, isLoading, isError } = useQuery({
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
    if (isError || !ticket) return null; // malformed / not-found -> T4 not-found branch.

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
