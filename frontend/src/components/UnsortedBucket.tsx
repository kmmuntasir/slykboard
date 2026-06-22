import type { Ticket } from '@/types/ticket';
import { BoardColumn } from './BoardColumn';

interface UnsortedBucketProps {
    tickets: Ticket[];
    projectSlug: string;
}

// F09 D-Unsorted-Bucket: trailing pseudo-column for tickets whose status_column
// matches no current column. Visually muted to signal it's not a real column.
export function UnsortedBucket({ tickets, projectSlug }: UnsortedBucketProps) {
    return (
        <div className="opacity-80">
            <BoardColumn
                id="__unsorted__"
                name="Unsorted"
                tickets={tickets}
                projectSlug={projectSlug}
                isUnsorted
            />
        </div>
    );
}
