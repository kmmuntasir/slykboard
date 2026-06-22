import { Outlet, createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/AppLayout';
import { CrossTabLogoutSync } from '@/components/CrossTabLogoutSync';
import { RequireAuth } from '@/components/RequireAuth';
import { RequireRole } from '@/components/RequireRole';
import { BoardPage } from '@/pages/BoardPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

function RootLayout() {
    return (
        <>
            <CrossTabLogoutSync />
            <Outlet />
        </>
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
                            { path: '/', element: <BoardPage /> },
                            { path: '/reports', element: <ReportsPage /> },
                            {
                                path: '/settings',
                                element: <RequireRole role="ADMIN" />,
                                children: [{ index: true, element: <SettingsPage /> }],
                            },
                            { path: '*', element: <NotFoundPage /> },
                        ],
                    },
                ],
            },
        ],
    },
]);
