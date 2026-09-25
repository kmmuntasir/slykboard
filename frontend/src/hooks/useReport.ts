import { useQuery } from '@tanstack/react-query';

import {
  fetchNodeBreakdown,
  fetchNodeEntries,
  fetchNodeRollup,
  fetchTicketSummary,
  fetchTimeReport,
} from '@/api/reports';
import type { TimeReportFilters } from '@/api/reports';
import { reportKeys } from '@/api/queryKeys';

// F49: project-scoped per-user time report over a weekly/monthly window.
// `period` selects the bucket size; `offset` shifts the window (0 = current,
// -1 = previous). `projectSlug` scopes the F48 endpoint and the cache key.
// Server returns users sorted by totalMs DESC.
// CR-06 FR-06.3: `filters` (member/source/type) recompute the report
// server-side, so they are part of both the cache key and the request.
export function useReport(
  period: 'weekly' | 'monthly',
  offset: number,
  projectSlug: string,
  filters: TimeReportFilters = {},
) {
  const filterKey = `${filters.member ?? ''}|${filters.source ?? ''}|${filters.type ?? ''}`;
  return useQuery({
    queryKey: reportKeys.time(period, offset, projectSlug, filterKey),
    queryFn: () => fetchTimeReport(period, offset, projectSlug, filters),
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

// CR-04: windowed roll-up total for a node + its live subtree. Shares the
// period/offset window contract with useReport.
export function useNodeRollup(
  period: 'weekly' | 'monthly',
  offset: number,
  projectSlug: string,
  node: string | null,
  filters: { member?: string | null; source?: 'auto' | 'manual' | null } = {},
) {
  const filterKey = `${filters.member ?? ''}|${filters.source ?? ''}`;
  return useQuery({
    queryKey: reportKeys.rollup(period, offset, projectSlug, node ?? '', filterKey),
    queryFn: () => fetchNodeRollup(projectSlug, { period, offset, node: node!, ...filters }),
    enabled: Boolean(node),
  });
}

// CR-05: per-ticket rows (own + folded descendant time) + per-member summary.
export function useNodeBreakdown(
  period: 'weekly' | 'monthly',
  offset: number,
  projectSlug: string,
  node: string | null,
  filters: { member?: string | null; source?: 'auto' | 'manual' | null } = {},
) {
  const filterKey = `${filters.member ?? ''}|${filters.source ?? ''}`;
  return useQuery({
    queryKey: reportKeys.breakdown(period, offset, projectSlug, node ?? '', filterKey),
    queryFn: () => fetchNodeBreakdown(projectSlug, { period, offset, node: node!, ...filters }),
    enabled: Boolean(node),
  });
}

// CR-05.2: raw entries behind a breakdown row (scoped to that row's subtree).
export function useNodeEntries(
  period: 'weekly' | 'monthly',
  offset: number,
  projectSlug: string,
  node: string | null,
  ticket: string | null,
  filters: { member?: string | null; source?: 'auto' | 'manual' | null } = {},
) {
  const filterKey = `${filters.member ?? ''}|${filters.source ?? ''}`;
  return useQuery({
    queryKey: reportKeys.entries(period, offset, projectSlug, node ?? '', filterKey, ticket ?? ''),
    queryFn: () =>
      fetchNodeEntries(projectSlug, { period, offset, node: node!, ticket, ...filters }),
    // Only fetch when a row is expanded (ticket set) — the unexpanded table
    // never needs the raw list.
    enabled: Boolean(node) && Boolean(ticket),
  });
}
