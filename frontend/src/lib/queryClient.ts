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
      // SLYK-02 T6: double-toast suppression mechanism.
      // A mutation may carry meta.suppressGlobalToast: true when the caller owns
      // the error UX inline (e.g. AddMemberModal renders a role="alert" region).
      // When set, the global toast funnel is skipped entirely so the user does
      // not see both an inline message AND a generic toast. This is now the
      // preferred project-wide convention for locally-handled mutation errors;
      // meta.revertMessage still overrides text-only for callers that keep the toast.
      const meta = mutation.meta as {
        revertMessage?: string;
        suppressGlobalToast?: boolean;
      } | undefined;
      if (meta?.suppressGlobalToast) return;
      toast.error(meta?.revertMessage ?? defaultMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // F07 D6 / F28 T2: don't retry 401s (the apiFetch interceptor handles
      // refresh/logout) or 403s (platform-admin demotion is permanent now that
      // the backend guard is live in F17/F25 — retrying only burns the budget).
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
