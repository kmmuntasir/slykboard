import { useAuthStore } from '@/stores/useAuthStore';

// SLYK-01: client-side platform-admin check. Returns true if the current user is
// a platform admin. The server-side guard is the real gate; this hook is for UX
// (hide/show UI elements, redirect away from admin routes).
export function useRequirePlatformAdmin(): boolean {
    return !!useAuthStore((s) => s.user?.isPlatformAdmin);
}
