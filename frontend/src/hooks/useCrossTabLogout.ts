import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/useAuthStore';

const CHANNEL_NAME = 'slyk-auth';
const STORAGE_KEY = 'slyk-auth';

type AuthMessage = { type: 'logout' } | { type: 'login' };

// F07 D5: broadcast a logout to other tabs via the 'slyk-auth' channel. Opens,
// posts, closes — no channel leak. Called by the logout handler in useAuthSync
// (and TopNav.handleSignOut in T7).
export function broadcastLogout(): void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ type: 'logout' });
  channel.close();
}

// F07 D5: cross-tab logout listener. BroadcastChannel 'slyk-auth' {type:'logout'}
// from other tabs → clears state + query cache + redirects. Storage-event fallback:
// if another tab removes the 'slyk-auth' localStorage key, treat as logout.
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

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue === null) {
        handleRemoteLogout();
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
