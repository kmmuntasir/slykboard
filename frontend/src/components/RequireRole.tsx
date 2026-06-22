import { Navigate, Outlet, useLocation } from 'react-router';
import { useRequireRole } from '@/hooks/useRequireRole';
import type { Role } from '@/hooks/useRequireRole';

interface RequireRoleProps {
    role: Role;
}

// F07 D7: route guard. If the current user lacks the required role, redirect to
// '/' (board). The server-side requireRole middleware is the authoritative gate;
// this component prevents the flash of an admin-only page for MEMBERS.
export function RequireRole({ role }: RequireRoleProps) {
    const allowed = useRequireRole(role);
    const location = useLocation();

    if (!allowed) {
        return <Navigate to="/" replace state={{ from: location }} />;
    }
    return <Outlet />;
}
