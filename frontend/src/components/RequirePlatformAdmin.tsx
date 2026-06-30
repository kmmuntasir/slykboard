import { Outlet } from 'react-router';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

// SLYK-01 / SLYK-F28: route guard. If the current user is not a platform admin,
// render the 403 page instead of silently redirecting. The server-side guard is
// the authoritative gate; this component prevents the flash of an admin-only
// page for non-admins.
export function RequirePlatformAdmin() {
    const allowed = useRequirePlatformAdmin();

    if (!allowed) {
        return <ForbiddenPage />;
    }
    return <Outlet />;
}
