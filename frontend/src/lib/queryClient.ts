import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/api/client';
import { toast } from '@/hooks/useToast';

// F28 T2 (D5) / F28 T12: a single error→toast funnel that runs ONLY for
// mutations. Query failures are no longer toasted globally — each page renders
// an inline <Retry> (T12), so toasting here too would double-surface. A
// mutation may carry a per-call meta.revertMessage to override the generic
// fallback; otherwise we branch on the canonical ApiClientError.code.
export function defaultMessage(error: ApiClientError | Error): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK_ERROR') {
      return "You're offline — check your connection.";
    } else if (error.code === 'FORBIDDEN') {
      return "You don't have permission to do that.";
    } else {
      return error.message || 'Something went wrong.';
    }
  }
  return 'Action failed — please try again.';
}

export function reportError(error: ApiClientError | Error): void {
  toast.error(defaultMessage(error));
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _onMutateResult, mutation) => {
      const meta = mutation.meta as { revertMessage?: string } | undefined;
      toast.error(meta?.revertMessage ?? defaultMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // F07 D6 / F28 T2: don't retry 401s (the apiFetch interceptor handles
      // refresh/logout) or 403s (role demotion is permanent now that backend
      // requireRole is live in F17/F25 — retrying only burns the budget).
      // Other errors retry up to 3 times (default).
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError) {
          if (error.status === 401 || error.code === 'FORBIDDEN') {
            return false;
          }
        }
        return failureCount < 3;
      },
    },
  },
});
