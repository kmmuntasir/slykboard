import { useEffect, useState } from 'react';

// F28 T8: online/offline detection. SSR-safe init reads navigator.onLine once;
// thereafter a window 'online'/'offline' subscription keeps the value fresh.
// Returns the current online status so any component can react to connectivity.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine,
  );

  useEffect(() => {
    const update = (event: Event) => setOnline(event.type === 'online');
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
