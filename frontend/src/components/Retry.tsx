interface RetryProps {
    message?: string;
    onRetry: () => void;
}

export function Retry({ message, onRetry }: RetryProps) {
    return (
        <div role="alert" className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-sm text-muted-foreground">{message ?? 'Something went wrong'}</p>
            <button
                type="button"
                onClick={onRetry}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
                Retry
            </button>
        </div>
    );
}

export default Retry;
