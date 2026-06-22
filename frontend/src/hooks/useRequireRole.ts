import { useAuthStore } from '@/stores/useAuthStore';

export type Role = 'ADMIN' | 'MEMBER';

// F07 D7: client-side role check. Returns true if the current user's role is
// in the allowed set. The server-side requireRole middleware is the real gate;
// this hook is for UX (hide/show UI elements, redirect away from admin routes).
export function useRequireRole(...allowedRoles: Role[]): boolean {
    const role = useAuthStore((s) => s.user?.role);
    if (!role) return false;
    return allowedRoles.includes(role);
}
