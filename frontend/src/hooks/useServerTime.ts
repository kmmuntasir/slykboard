import { useQuery } from '@tanstack/react-query';

import { fetchServerTime } from '@/api/time';

// F20 T5: server wall-clock offset (serverNow - Date.now()). The live elapsed
// display adds this offset so it tracks the server-authoritative startTime
// rather than a potentially skewed client clock. staleTime 5min keeps probes
// infrequent; refetchOnWindowFocus re-syncs after the tab was backgrounded.
export function useServerTime() {
  const { data } = useQuery({
    queryKey: ['server-time'],
    queryFn: () => fetchServerTime(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const offset = data ? Date.parse(data.now) - Date.now() : 0;

  return { offset };
}
