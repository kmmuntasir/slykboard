import { Navigate, Outlet, createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { CrossTabLogoutSync } from '@/components/CrossTabLogoutSync';
import { RequireAuth } from '@/components/RequireAuth';
import { RequirePlatformAdmin } from '@/components/RequirePlatformAdmin';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { AccountSettingsPage } from '@/pages/AccountSettingsPage';
import { BoardPage, TicketDetailRoute } from '@/pages/BoardPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { ProjectMembersPage } from '@/pages/ProjectMembersPage';
import { ReportsPage } from '@/pages/ReportsPage';
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

// SLYK-0120: agent-route spread site (docs/agentic-automation/06-frontend-ui.md
// §Routing). Agent routes are `React.lazy(() => import(...))` entries appended
// here in later phases; `__AGENT_MODE__` is a build-time constant, so plain
// builds (`SLYKBOARD_AGENT_MODE=false`) statically prune this spread — agent
// chunks are never emitted. Empty for now: this only establishes the pattern.
const agentRoutes: RouteObject[] = [];

const routes: RouteObject[] = [
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
                                    // SLYK-01 Task N: project member management.
                                    // Same RequireAuth + AppLayout wrapper as the
                                    // other /projects/:slug routes; non-member
                                    // denial is centralized in apiFetch (403 →
                                    // /projects).
                                    {
                                        path: '/projects/:slug/members',
                                        element: <ProjectMembersPage />,
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
                                        element: <RequirePlatformAdmin />,
                                        children: [
                                            {
                                                index: true,
                                                element: <ComingSoonPage title="Settings" />,
                                            },
                                        ],
                                    },
                                    // KMM-5: per-user Account Settings — authenticated only, no
                                    // platform-admin guard. UI-only (no backend yet).
                                    { path: '/account', element: <AccountSettingsPage /> },
                                    // SLYK-F28: dedicated 403 page, reachable directly.
                                    { path: '/forbidden', element: <ForbiddenPage /> },
                                    // Agent routes (agent mode only). Empty until later
                                    // phases populate `agentRoutes` above.
                                    ...(__AGENT_MODE__ ? agentRoutes : []),
                                    { path: '*', element: <NotFoundPage /> },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    ...(__AGENT_MODE__ ? agentRoutes : []),
];

export const router = createBrowserRouter(routes);
