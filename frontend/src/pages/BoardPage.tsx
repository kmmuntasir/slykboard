import { useState } from 'react';
import { useParams } from 'react-router';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useBoard } from '@/hooks/useBoard';
import { useMoveTicket } from '@/hooks/useMoveTicket';
import { computeDestinationPosition, type MoveDescriptor } from '@/utils/boardReorder';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import { BoardColumn } from '@/components/BoardColumn';
import { UnsortedBucket } from '@/components/UnsortedBucket';
import { NewTicketButton } from '@/components/NewTicketButton';
import { EditTicketModal } from '@/components/EditTicketModal';
import { ApiClientError } from '@/api/client';

export function BoardPage() {
    const { slug } = useParams<{ slug: string }>();
    const { data: board, isLoading, error } = useBoard(slug);
    const { mutate } = useMoveTicket(slug);
    const setDragInProgress = useBoardUiStore((s) => s.setDragInProgress);
    const [editOpen, setEditOpen] = useState(false);
    const [editTicketId, setEditTicketId] = useState<string | null>(null);

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

    const handleEdit = (ticketId: string) => {
        setEditTicketId(ticketId);
        setEditOpen(true);
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
            <EditTicketModal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                ticketId={editTicketId}
                slug={slug}
            />
        </div>
    );
}
