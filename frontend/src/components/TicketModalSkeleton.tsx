import { Skeleton, SkeletonBlock, SkeletonLine } from './Skeleton';

export function TicketModalSkeleton() {
    return (
        <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" aria-hidden="true">
            <div className="mb-4 flex items-center justify-between">
                <SkeletonLine className="h-6 w-32" />
            </div>
            <dl className="mb-4 space-y-1">
                <SkeletonLine className="h-4 w-40" />
                <SkeletonLine className="h-4 w-48" />
            </dl>
            <div className="space-y-4">
                <SkeletonLine className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
                <SkeletonLine className="h-4 w-24" />
                <SkeletonBlock className="h-24 w-full" />
            </div>
        </div>
    );
}
