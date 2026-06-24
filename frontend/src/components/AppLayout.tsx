import { Outlet } from 'react-router';
import { TopNav } from './TopNav';
import { HealthBadge } from './HealthBadge';
import { OfflineBanner } from './OfflineBanner';

export function AppLayout() {
    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <OfflineBanner />
            <TopNav />
            <HealthBadge />
            <main id="app-root" className="flex-1">
                <Outlet />
            </main>
        </div>
    );
}
