import { apiFetch } from './client';
import type { TicketSummaryResponse, TimeReportResponse } from '@/types/report';

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

// F24: GET /reports/tickets — per-user resolved-ticket counts grouped by
// priority over a weekly/monthly window. apiFetch unwraps `.data`.
export async function fetchTicketSummary(
    period: 'weekly' | 'monthly',
    offset: number,
): Promise<TicketSummaryResponse> {
    return apiFetch<TicketSummaryResponse>(
        `/reports/tickets?period=${period}&offset=${offset}`,
    );
}
