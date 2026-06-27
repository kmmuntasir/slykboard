import { apiFetch } from './client';
import type { TicketSummaryResponse, TimeReportResponse } from '@/types/report';

// F49: project-scoped report endpoints (F48). Each function targets
// /projects/:slug/reports/{time,tickets}, gated by requireProjectMember.
// `period` selects the bucket size; `offset` shifts the window in whole
// periods (0 = current, -1 = previous). apiFetch unwraps `.data`.
export async function fetchTimeReport(
    period: 'weekly' | 'monthly',
    offset: number,
    projectSlug: string,
): Promise<TimeReportResponse> {
    return apiFetch<TimeReportResponse>(
        `/projects/${projectSlug}/reports/time?period=${period}&offset=${offset}`,
    );
}

// F49: project-scoped resolved-ticket summary (F48). Same period/offset
// contract as fetchTimeReport. apiFetch unwraps `.data`.
export async function fetchTicketSummary(
    period: 'weekly' | 'monthly',
    offset: number,
    projectSlug: string,
): Promise<TicketSummaryResponse> {
    return apiFetch<TicketSummaryResponse>(
        `/projects/${projectSlug}/reports/tickets?period=${period}&offset=${offset}`,
    );
}
