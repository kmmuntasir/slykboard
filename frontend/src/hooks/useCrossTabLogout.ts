import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/useAuthStore';
import { AUTH_STORAGE_KEY } from '@/constants/auth';

const CHANNEL_NAME = AUTH_STORAGE_KEY;
const STORAGE_KEY = AUTH_STORAGE_KEY;

type AuthMessage = { type: 'logout' };

// F07 D5: broadcast a logout to other tabs via the auth BroadcastChannel. Opens,
// posts, closes — no channel leak. Called by the logout handler in useAuthSync
// (and TopNav.handleSignOut in T7).
export function broadcastLogout(): void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: 'logout' });
  channel.close();
}

// F07 D5: cross-tab logout listener. BroadcastChannel {type:'logout'} from other
// tabs → clears state + query cache + redirects. Storage-event fallback: if another
// tab removes the auth localStorage key (or writes a cleared envelope), treat as logout.
export function useCrossTabLogout(): void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    const handleRemoteLogout = () => {
      clear();
      queryClient.clear();
      navigate('/login', { replace: true });
    };

    const channel = new BroadcastChannel(CHANNEL_NAME);
    const onMessage = (event: MessageEvent<AuthMessage>) => {
      if (event.data?.type === 'logout') {
        handleRemoteLogout();
      }
    };
    channel.addEventListener('message', onMessage);

    // Belt-and-suspenders: fires on a real key removal (newValue === null) AND on a
    // non-null cleared envelope ({state:{user:null}}) for browsers that write one.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === null) return handleRemoteLogout();
      try {
        const parsed = JSON.parse(event.newValue) as { state?: { user?: unknown } };
        if (parsed?.state?.user === null) handleRemoteLogout();
      } catch {
        /* ignore malformed newValue */
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
      window.removeEventListener('storage', onStorage);
    };
  }, [clear, navigate, queryClient]);
}
