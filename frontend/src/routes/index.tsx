import { Navigate, Outlet, createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { CrossTabLogoutSync } from '@/components/CrossTabLogoutSync';
import { RequireAuth } from '@/components/RequireAuth';
import { RequireRole } from '@/components/RequireRole';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { BoardPage, TicketDetailRoute } from '@/pages/BoardPage';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { useProjectStore } from '@/stores/useProjectStore';

function RootLayout() {
    return (
        <>
            <CrossTabLogoutSync />
            <Outlet />
        </>
    );
}

// F08 D-Current-Project: '/' redirects to the last selected project board,
// or to /projects if none. URL param is the source of truth; the store is the
// landing convenience.
function IndexRedirect() {
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    return (
        <Navigate to={lastSelectedSlug ? `/projects/${lastSelectedSlug}` : '/projects'} replace />
    );
}

// F49 D6: legacy /reports → scoped Reports. Target is the last-selected
// project's reports, or /projects if none. period/offset are component state,
// not URL params, so the redirect carries no query (D6 default: drop).
function ReportsRedirect() {
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    return (
        <Navigate
            to={lastSelectedSlug ? `/projects/${lastSelectedSlug}/reports` : '/projects'}
            replace
        />
    );
}

export const router = createBrowserRouter([
    {
        element: <RootLayout />,
        children: [
            {
                path: '/login',
                element: <LoginPage />,
            },
            {
                element: <RequireAuth />,
                children: [
                    {
                        element: <AppLayout />,
                        children: [
                            // SLYK-F28: catch render throws / query errors at the
                            // content boundary so chrome (nav, layout) survives.
                            {
                                element: (
                                    <RouteErrorBoundary>
                                        <Outlet />
                                    </RouteErrorBoundary>
                                ),
                                children: [
                                    { path: '/', element: <IndexRedirect /> },
                                    { path: '/projects', element: <ProjectsPage /> },
                                    {
                                        path: '/projects/:slug',
                                        element: <BoardPage />,
                                        children: [
                                            // F16: deep-link modal overlay over the mounted board.
                                            // F30 T3: param is now the human-readable SLYK-NNN display-ID.
                                            {
                                                path: 'tickets/:displayId',
                                                element: <TicketDetailRoute />,
                                            },
                                        ],
                                    },
                                    {
                                        path: '/projects/:slug/settings',
                                        element: <ProjectSettingsPage />,
                                    },
                                    // F49: Reports is project-scoped. Non-member
                                        // denial is handled in-page (D7: redirect
                                        // to /projects on BE 403).
                                    {
                                        path: '/projects/:slug/reports',
                                        element: <ReportsPage />,
                                    },
                                    // F49 D6: legacy /reports redirects to the
                                        // scoped route (or /projects if no slug).
                                    { path: '/reports', element: <ReportsRedirect /> },
                                    {
                                        path: '/settings',
                                        element: <RequireRole role="ADMIN" />,
                                        children: [{ index: true, element: <SettingsPage /> }],
                                    },
                                    // SLYK-F28: dedicated 403 page, reachable directly.
                                    { path: '/forbidden', element: <ForbiddenPage /> },
                                    { path: '*', element: <NotFoundPage /> },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
]);
