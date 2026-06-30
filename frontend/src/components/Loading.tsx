export function Loading({ label = 'Loading…' }: { label?: string }) {
    return (
        <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 p-4 text-muted-foreground"
        >
            <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                aria-hidden="true"
            />
            <span className="text-sm">{label}</span>
        </div>
    );
}
