import { useQuery } from '@tanstack/react-query';

import { fetchTicketSummary, fetchTimeReport } from '@/api/reports';
import { reportKeys } from '@/api/queryKeys';

// F23 T4: aggregated per-user time report over a weekly/monthly window.
// `period` selects the bucket size; `offset` shifts the window (0 = current,
// -1 = previous). Server returns users sorted by totalMs DESC.
export function useReport(period: 'weekly' | 'monthly', offset: number) {
    return useQuery({
        queryKey: reportKeys.time(period, offset),
        queryFn: () => fetchTimeReport(period, offset),
    });
}

// F24: per-user resolved-ticket counts grouped by priority over a
// weekly/monthly window. Mirrors useReport's period/offset contract.
export function useTicketSummary(period: 'weekly' | 'monthly', offset: number) {
    return useQuery({
        queryKey: reportKeys.tickets(period, offset),
        queryFn: () => fetchTicketSummary(period, offset),
    });
}
