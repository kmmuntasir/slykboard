import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { decodeJwt } from 'jose';
import type { AuthResponse } from '@/api/auth';
import { fetchMe } from '@/api/auth';
import { registerLogoutHandlers } from '@/api/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { broadcastLogout } from '@/hooks/useCrossTabLogout';
import type { AuthUser } from '@/stores/useAuthStore';

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if <5min to expiry

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

// F07 D2: session sync. (a) boot — if a token exists, rehydrate via /me. (b) near-expiry —
// interval checks decodeJwt(token).exp; if within threshold, call fetchMe. Also registers the
// logout handlers that apiFetch's 401 interceptor calls (D6).
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
      logout: () => {
        clear();
        queryClient.clear();
        broadcastLogout(); // tell other tabs
        navigate('/login', { replace: true });
      },
    });
  }, [clear, navigate, queryClient, setUser]);

  // Boot rehydration: if a token exists, refresh it on mount (slides window).
  useEffect(() => {
    if (user?.token) {
      void fetchMe()
        .then((fresh) => setUser(toAuthUser(fresh)))
        .catch(() => {
          clear();
          navigate('/login', { replace: true });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // boot only

  // Near-expiry proactive refresh.
  useEffect(() => {
    if (!user?.token) return;
    const interval = setInterval(() => {
      try {
        const payload = decodeJwt(user.token);
        if (!payload.exp) return;
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
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.token, clear, navigate, setUser]);
}
