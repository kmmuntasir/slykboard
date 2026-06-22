import { useAuthSync } from '@/hooks/useAuthSync';
import { useCrossTabLogout } from '@/hooks/useCrossTabLogout';

// F07 D5 + D6: mounts the session-sync hooks. Rendered once in AppLayout
// (inside RequireAuth, so only mounted when authenticated).
export function CrossTabLogoutSync() {
    useAuthSync();
    useCrossTabLogout();
    return null;
}
