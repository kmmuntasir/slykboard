import { Link } from 'react-router';

export function NotFoundPage() {
    return (
        <section
            role="alert"
            className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center"
        >
            <h1 className="text-4xl font-semibold">404 — Page Not Found</h1>
            <p className="text-sm text-muted-foreground">
                The page you&apos;re looking for doesn&apos;t exist or may have moved.
            </p>
            <Link to="/" className="text-sm text-primary underline">
                Back to board
            </Link>
        </section>
    );
}
