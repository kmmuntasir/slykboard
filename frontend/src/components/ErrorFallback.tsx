import type { FallbackProps } from 'react-error-boundary';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
    return (
        <div
            role="alert"
            className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground"
        >
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
            <p className="max-w-md text-sm text-muted">
                {error.message || 'An unexpected error occurred.'}
            </p>
            <button
                type="button"
                onClick={() => resetErrorBoundary()}
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-background"
            >
                Try again
            </button>
        </div>
    );
}
