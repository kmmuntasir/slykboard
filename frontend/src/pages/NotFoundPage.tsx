import { Link } from 'react-router';

export function NotFoundPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
            <h1 className="text-4xl font-semibold">404</h1>
            <p className="text-sm text-muted">That page doesn't exist.</p>
            <Link to="/" className="text-sm text-primary underline">
                Back to board
            </Link>
        </div>
    );
}
