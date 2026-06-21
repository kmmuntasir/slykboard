import { Navigate, Outlet, useLocation } from 'react-router';
import { decodeJwt } from 'jose';
import { useAuthStore } from '@/stores/useAuthStore';

function isTokenExpired(token: string): boolean {
    try {
        const payload = decodeJwt(token);
        if (!payload.exp) return false; // no exp = never expires (defensive)
        return Date.now() >= payload.exp * 1000;
    } catch {
        return true; // malformed = treat as expired
    }
}

export function RequireAuth() {
    const user = useAuthStore((state) => state.user);
    const clear = useAuthStore((state) => state.clear);
    const location = useLocation();

    if (!user || isTokenExpired(user.token)) {
        clear();
        return <Navigate to="/login" replace state={{ from: location }} />;
    }
    return <Outlet />;
}
