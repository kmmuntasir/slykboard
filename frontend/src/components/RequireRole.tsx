import { Outlet } from 'react-router';
import { useRequireRole } from '@/hooks/useRequireRole';
import type { Role } from '@/hooks/useRequireRole';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

interface RequireRoleProps {
    role: Role;
}

// F07 D7 / SLYK-F28: route guard. If the current user lacks the required role,
// render the 403 page instead of silently redirecting. The server-side
// requireRole middleware is the authoritative gate; this component prevents the
// flash of an admin-only page for MEMBERS.
export function RequireRole({ role }: RequireRoleProps) {
    const allowed = useRequireRole(role);

    if (!allowed) {
        return <ForbiddenPage />;
    }
    return <Outlet />;
}
