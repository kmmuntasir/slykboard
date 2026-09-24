import { apiFetch } from './client';
import type {
  ColumnTimeReport,
  NodeBreakdownResponse,
  NodeEntriesResponse,
  NodeRollupResponse,
  TicketSummaryResponse,
  TimeReportResponse,
} from '@/types/report';

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

// CR-04 / CR-05: hierarchy time endpoints. `node` addresses the roll-up root by
// display id (SLYK-42); member/source filters apply to every aggregate the
// server returns (totals, rows, members, entries) so the numbers stay coherent.
export interface HierarchyQuery {
  period: 'weekly' | 'monthly';
  offset: number;
  node: string;
  member?: string | null;
  source?: 'auto' | 'manual' | null;
}

function hierarchyParams(q: HierarchyQuery): string {
  const params = new URLSearchParams();
  params.set('node', q.node);
  params.set('period', q.period);
  params.set('offset', String(q.offset));
  if (q.member) params.set('member', q.member);
  if (q.source) params.set('source', q.source);
  return params.toString();
}

export async function fetchNodeRollup(
  projectSlug: string,
  q: HierarchyQuery,
): Promise<NodeRollupResponse> {
  return apiFetch<NodeRollupResponse>(
    `/projects/${projectSlug}/reports/time/rollup?${hierarchyParams(q)}`,
  );
}

export async function fetchNodeBreakdown(
  projectSlug: string,
  q: HierarchyQuery,
): Promise<NodeBreakdownResponse> {
  return apiFetch<NodeBreakdownResponse>(
    `/projects/${projectSlug}/reports/time/breakdown?${hierarchyParams(q)}`,
  );
}

export async function fetchNodeEntries(
  projectSlug: string,
  q: HierarchyQuery & { ticket?: string | null },
): Promise<NodeEntriesResponse> {
  const params = new URLSearchParams(hierarchyParams(q));
  if (q.ticket) params.set('ticket', q.ticket);
  return apiFetch<NodeEntriesResponse>(
    `/projects/${projectSlug}/reports/time/entries?${params.toString()}`,
  );
}

// CR-08: per-column residence + tracked time for one ticket. `period` omitted
// returns the ticket's whole lifetime; `member`/`source` narrow tracked only.
export async function fetchColumnTimeReport(
  projectSlug: string,
  q: {
    ticket: string;
    period?: 'weekly' | 'monthly' | null;
    member?: string | null;
    source?: 'auto' | 'manual' | null;
  },
): Promise<ColumnTimeReport> {
  const params = new URLSearchParams();
  params.set('ticket', q.ticket);
  if (q.period) params.set('period', q.period);
  if (q.member) params.set('member', q.member);
  if (q.source) params.set('source', q.source);
  return apiFetch<ColumnTimeReport>(
    `/projects/${projectSlug}/reports/column-time?${params.toString()}`,
  );
}
