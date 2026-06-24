import { useQuery } from '@tanstack/react-query';

import { fetchTimeReport } from '@/api/reports';
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
