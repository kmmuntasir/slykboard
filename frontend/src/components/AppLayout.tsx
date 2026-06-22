import { Outlet } from 'react-router';
import { TopNav } from './TopNav';
import { HealthBadge } from './HealthBadge';
import { CrossTabLogoutSync } from './CrossTabLogoutSync';

export function AppLayout() {
    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <CrossTabLogoutSync />
            <TopNav />
            <HealthBadge />
            <main className="flex-1">
                <Outlet />
            </main>
        </div>
    );
}
