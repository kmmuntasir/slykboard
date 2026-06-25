import { Link } from 'react-router';

export function ForbiddenPage() {
    return (
        <section
            role="alert"
            className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center"
        >
            <h1 className="text-4xl font-semibold">403 — Forbidden</h1>
            <p className="text-sm text-muted">You don&apos;t have permission to view this page.</p>
            <Link to="/" className="text-sm text-primary underline">
                Back to board
            </Link>
        </section>
    );
}
