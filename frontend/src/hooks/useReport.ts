import { useQuery } from '@tanstack/react-query';

import { fetchTicketSummary, fetchTimeReport } from '@/api/reports';
import { reportKeys } from '@/api/queryKeys';

// F49: project-scoped per-user time report over a weekly/monthly window.
// `period` selects the bucket size; `offset` shifts the window (0 = current,
// -1 = previous). `projectSlug` scopes the F48 endpoint and the cache key.
// Server returns users sorted by totalMs DESC.
export function useReport(period: 'weekly' | 'monthly', offset: number, projectSlug: string) {
  return useQuery({
    queryKey: reportKeys.time(period, offset, projectSlug),
    queryFn: () => fetchTimeReport(period, offset, projectSlug),
  });
}

// F49: project-scoped per-user resolved-ticket counts grouped by priority
// over a weekly/monthly window. Mirrors useReport's period/offset/slug contract.
export function useTicketSummary(
  period: 'weekly' | 'monthly',
  offset: number,
  projectSlug: string,
) {
  return useQuery({
    queryKey: reportKeys.tickets(period, offset, projectSlug),
    queryFn: () => fetchTicketSummary(period, offset, projectSlug),
  });
}
