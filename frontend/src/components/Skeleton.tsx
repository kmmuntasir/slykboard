interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            className={`animate-pulse rounded bg-neutral-200 ${className ?? ''}`}
            aria-hidden="true"
        />
    );
}

interface SkeletonCardProps {
    className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
    return <Skeleton className={`h-16 w-full ${className ?? ''}`} />;
}

interface SkeletonLineProps {
    className?: string;
}

export function SkeletonLine({ className }: SkeletonLineProps) {
    return <Skeleton className={`h-3 w-full ${className ?? ''}`} />;
}

interface SkeletonBlockProps {
    className?: string;
}

export function SkeletonBlock({ className }: SkeletonBlockProps) {
    return <Skeleton className={`h-24 w-full ${className ?? ''}`} />;
}
