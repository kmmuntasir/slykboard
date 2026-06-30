// SLYK-03: Generic "Coming Soon" placeholder.
// Pure presentational leaf — no hooks, no data fetching, no routing. Reused as
// the stub for any not-yet-built surface, so copy stays feature-agnostic.
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';

export interface ComingSoonPageProps {
    title?: string;
}

export function ComingSoonPage({ title = 'Coming Soon' }: ComingSoonPageProps) {
    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <Card className={cn('p-4')}>
                <p className="text-sm text-muted-foreground">
                    This section isn't available yet.
                </p>
            </Card>
        </div>
    );
}
