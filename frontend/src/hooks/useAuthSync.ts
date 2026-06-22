import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { decodeJwt } from 'jose';
import type { AuthResponse } from '@/api/auth';
import { fetchMe, logout as logoutApi } from '@/api/auth';
import { registerLogoutHandlers } from '@/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { broadcastLogout } from '@/hooks/useCrossTabLogout';
import type { AuthUser } from '@/stores/useAuthStore';

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if <5min to expiry
const POLL_INTERVAL_MS = 60 * 1000; // near-expiry check cadence

// Maps a fresh /me response into the store's AuthUser shape.
function toAuthUser(fresh: AuthResponse): AuthUser {
  return {
    token: fresh.token,
    id: fresh.user.id,
    email: fresh.user.email,
    name: fresh.user.fullName,
    role: fresh.user.role,
    avatarUrl: fresh.user.avatarUrl,
  };
}

// F07 D2: session sync. (a) near-expiry — interval checks decodeJwt(token).exp; if
// within threshold, call fetchMe. Runs the check once on mount and on each poll, so
// a token far from expiry triggers no /me on reload (M6). Also registers the logout
// handlers that apiFetch's 401 interceptor calls (D6). The logout handler is
// idempotent (M2) and best-effort POSTs /auth/logout before clearing (M5).
export function useAuthSync(): void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  // Register logout handlers (apiFetch imports these).
  useEffect(() => {
    registerLogoutHandlers({
      refresh: async () => {
        try {
          const fresh = await fetchMe();
          setUser(toAuthUser(fresh));
          return true;
        } catch {
          return false;
        }
      },
      // M2: idempotent — a second call after clear() is a no-op.
      // M5: best-effort POST /auth/logout runs while the token is still in the
      // store (the api client reads the token at fetch time); clear() comes after.
      logout: async () => {
        const wasLoggedIn = useAuthStore.getState().user !== null;
        if (!wasLoggedIn) return; // already logged out — no duplicate side-effects
        try {
          await logoutApi();
        } catch {
          // already logged out server-side; swallow
        }
        clear();
        queryClient.clear();
        broadcastLogout(); // tell other tabs
        navigate('/login', { replace: true });
      },
    });
  }, [clear, navigate, queryClient, setUser]);

  // Near-expiry proactive refresh. Runs the check once on mount and on each poll —
  // this is the single session-confirmation path, so a token with hours left skips
  // /me entirely on reload (M6).
  useEffect(() => {
    if (!user?.token) return;

    const refreshIfNearExpiry = () => {
      try {
        const payload = decodeJwt(user.token);
        // `exp == null` covers both missing and undefined; an `exp` of 0 (1970) is
        // treated as already expired so the proactive refresh kicks in.
        if (payload.exp == null) return;
        const msToExpiry = payload.exp * 1000 - Date.now();
        if (msToExpiry <= REFRESH_THRESHOLD_MS) {
          void fetchMe()
            .then((fresh) => setUser(toAuthUser(fresh)))
            .catch(() => {
              clear();
              navigate('/login', { replace: true });
            });
        }
      } catch {
        clear();
        navigate('/login', { replace: true });
      }
    };

    refreshIfNearExpiry(); // mount run replaces the old unconditional boot /me
    const interval = setInterval(refreshIfNearExpiry, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [user?.token, clear, navigate, setUser]);
}
