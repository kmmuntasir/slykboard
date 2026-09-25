import type { Ticket } from '@/types/ticket';
import { BoardColumn } from './BoardColumn';

interface UnsortedBucketProps {
    tickets: Ticket[];
    projectSlug: string;
    onEdit?: (displayId: string) => void;
    // FR-10.6: orphaned tickets aren't in the last column, so they can be
    // overdue — forward the last-column id so the badge logic applies here too.
    lastColumnId?: string;
}

// F09 D-Unsorted-Bucket: trailing pseudo-column for tickets whose status_column
// matches no current column. Visually muted to signal it's not a real column.
//
// F11 D4 (drag direction): orphan cards here are draggable OUT (so a user can
// rescue one into a real column), while the unsorted droppable is isDropDisabled
// IN (nothing can be dropped INTO the sentinel). The isDropDisabled flag is
// wired by T5 on the <Droppable> rendered inside BoardColumn via the isUnsorted
// prop forwarded below; UnsortedBucket itself only forwards isUnsorted.
export function UnsortedBucket({
    tickets,
    projectSlug,
    onEdit,
    lastColumnId,
}: UnsortedBucketProps) {
    return (
        <div className="opacity-80">
            <BoardColumn
                id="__unsorted__"
                name="Unsorted"
                tickets={tickets}
                projectSlug={projectSlug}
                isUnsorted
                onEdit={onEdit}
                lastColumnId={lastColumnId}
            />
        </div>
    );
}
