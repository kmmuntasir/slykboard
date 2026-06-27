import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';

interface HealthResponse {
  status: string;
  service: string;
}

export interface UseHealthResult {
  /** `true` when status==='ok' && !isError; `false` when unhealthy; `undefined` while loading. */
  ok: boolean | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Human-readable detail for the tooltip — the `service` field, or a fallback per state. */
  detail: string;
}

async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${env.apiBaseUrl}/health`, {
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

/**
 * F41 — server-state hook for the backend health check. Extracted from the
 * standalone HealthBadge's inline useQuery so the navbar indicator can render
 * a 3-state UI (loading / healthy / unhealthy) without a false red during the
 * initial fetch. Single source of truth; TopNav is a pure consumer.
 *
 * Query config preserved from HealthBadge: queryKey ['health'], GET /health,
 * staleTime 30s, NO refetchInterval (health is informational; spec doesn't
 * mandate live polling).
 */
export function useHealth(): UseHealthResult {
  const query = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 30_000,
  });

  const ok = query.isLoading ? undefined : query.data?.status === 'ok' && !query.isError;

  const detail = query.isLoading
    ? 'Checking…'
    : query.isError || query.data?.status !== 'ok'
      ? (query.data?.service ?? 'Service unavailable')
      : (query.data?.service ?? 'All systems operational');

  return {
    ok,
    isLoading: query.isLoading,
    isError: query.isError,
    detail,
  };
}
