import { useParams } from 'react-router';
import { useBoard } from '@/hooks/useBoard';
import { BoardColumn } from '@/components/BoardColumn';
import { UnsortedBucket } from '@/components/UnsortedBucket';
import { ApiClientError } from '@/api/client';

export function BoardPage() {
    const { slug } = useParams<{ slug: string }>();
    const { data: board, isLoading, error } = useBoard(slug);

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

    const totalTickets = board.columns.reduce((sum, c) => sum + c.tickets.length, 0);
    const isWholeBoardEmpty = totalTickets === 0;

    return (
        <div className="flex h-full flex-col gap-4 p-4">
            <header className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">{board.project.name}</h1>
                <span className="text-sm text-muted-foreground">{board.project.slug}</span>
            </header>

            {isWholeBoardEmpty ? (
                <div
                    role="status"
                    className="rounded border border-dashed p-8 text-center text-muted-foreground"
                >
                    No tickets yet — F12 will add creation.
                </div>
            ) : (
                <div className="flex gap-4 overflow-x-auto">
                    {board.columns.map((column) =>
                        column.isUnsorted ? (
                            <UnsortedBucket
                                key={column.id}
                                tickets={column.tickets}
                                projectSlug={board.project.slug}
                            />
                        ) : (
                            <BoardColumn
                                key={column.id}
                                id={column.id}
                                name={column.name}
                                tickets={column.tickets}
                                projectSlug={board.project.slug}
                            />
                        ),
                    )}
                </div>
            )}
        </div>
    );
}
