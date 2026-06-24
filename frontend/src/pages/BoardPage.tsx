import { useNavigate, useParams, Outlet } from 'react-router';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useBoard } from '@/hooks/useBoard';
import { useMoveTicket } from '@/hooks/useMoveTicket';
import { useUpdateTicket } from '@/hooks/useUpdateTicket';
import { computeDestinationPosition, type MoveDescriptor } from '@/utils/boardReorder';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import { BoardColumn } from '@/components/BoardColumn';
import { UnsortedBucket } from '@/components/UnsortedBucket';
import { BoardFilters } from '@/components/BoardFilters';
import { NewTicketButton } from '@/components/NewTicketButton';
import { TicketDetailModal } from '@/components/TicketDetailModal';
import { ApiClientError } from '@/api/client';
import type { UpdateTicketDto } from '@/types/ticket';

export function BoardPage() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { data: board, isLoading, error } = useBoard(slug);
    const { mutate } = useMoveTicket(slug);
    const setDragInProgress = useBoardUiStore((s) => s.setDragInProgress);

    if (!slug) {
        return <div className="p-4">No project selected.</div>;
    }
    if (isLoading) {
        return <div className="p-4">Loading board…</div>;
    }
    if (error instanceof ApiClientError) {
        if (error.status === 404) {
            return <div className="p-4">Project '{slug}' not found.</div>;
        }
        return <div className="p-4 text-destructive">Failed to load board: {error.message}</div>;
    }
    if (!board) {
        return null;
    }

    // F16: card click deep-links to the ticket modal via the nested route
    // /projects/:slug/tickets/:id — BoardPage stays mounted under the modal.
    const handleEdit = (ticketId: string) => {
        navigate(`tickets/${ticketId}`);
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

    const totalTickets = board.columns.reduce((sum, c) => sum + c.tickets.length, 0);
    const isWholeBoardEmpty = totalTickets === 0;

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

            {isWholeBoardEmpty ? (
                <div
                    role="status"
                    className="rounded border border-dashed p-8 text-center text-muted-foreground"
                >
                    No tickets yet. Create one to get started.
                </div>
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

// F16: child route element for /projects/:slug/tickets/:ticketId. Renders the
// TicketDetailModal over the mounted board (BoardPage stays mounted via <Outlet/>).
export function TicketDetailRoute() {
    const { slug, ticketId } = useParams<{ slug: string; ticketId: string }>();
    const navigate = useNavigate();
    const updateTicket = useUpdateTicket();
    if (!slug || !ticketId) return null;
    return (
        <TicketDetailModal
            slug={slug}
            ticketId={ticketId}
            onClose={() => navigate(`/projects/${slug}`)}
            onSubmit={async (dto: UpdateTicketDto) => {
                await updateTicket.mutateAsync({ ticketId, dto, slug });
            }}
        />
    );
}
