import { apiFetch } from './client';
import type { TimeReportResponse } from '@/types/report';

// F23 T2: GET /reports/time — per-user aggregated time over a weekly/monthly
// window. `period` selects the bucket size; `offset` shifts the window in
// whole periods (0 = current, -1 = previous). apiFetch unwraps `.data`.
export async function fetchTimeReport(
    period: 'weekly' | 'monthly',
    offset: number,
): Promise<TimeReportResponse> {
    return apiFetch<TimeReportResponse>(
        `/reports/time?period=${period}&offset=${offset}`,
    );
}
