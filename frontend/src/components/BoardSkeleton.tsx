import { SkeletonCard, SkeletonLine } from './Skeleton';

interface BoardSkeletonProps {
    columnCount?: number;
}

const DEFAULT_COLUMN_COUNT = 3;
const CARDS_PER_COLUMN = 3;

export function BoardSkeleton({ columnCount = DEFAULT_COLUMN_COUNT }: BoardSkeletonProps) {
    return (
        <div className="flex gap-4 overflow-x-auto">
            {Array.from({ length: columnCount }).map((_, columnIndex) => (
                <div
                    key={columnIndex}
                    data-testid="board-skeleton-column"
                    aria-hidden="true"
                    className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
                >
                    <div className="flex items-center justify-between px-1">
                        <SkeletonLine className="h-4 w-20" />
                        <SkeletonLine className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col gap-2">
                        {Array.from({ length: CARDS_PER_COLUMN }).map((_, cardIndex) => (
                            <SkeletonCard key={cardIndex} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
