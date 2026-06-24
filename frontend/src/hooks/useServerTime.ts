import { useQuery } from '@tanstack/react-query';

import { fetchServerTime } from '@/api/time';

// F20: server wall-clock offset (serverNow - clientNow). The live elapsed
// display adds this offset so it tracks the server-authoritative startTime
// rather than a potentially skewed client clock. The offset is computed
// INSIDE the queryFn (not in render) to keep the render path pure.
// staleTime 5min keeps probes infrequent; refetchOnWindowFocus re-syncs.
export function useServerTime() {
  const { data } = useQuery({
    queryKey: ['server-time'],
    queryFn: async () => {
      const t0 = Date.now();
      const resp = await fetchServerTime();
      const t1 = Date.now();
      // RTT-compensated offset (Cristian's algorithm — midpoint approximates one-way delay).
      return { offset: Date.parse(resp.now) - Math.round((t0 + t1) / 2) };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return { offset: data?.offset ?? 0 };
}
