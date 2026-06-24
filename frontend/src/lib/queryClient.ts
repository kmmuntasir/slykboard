import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/api/client';
import { toast } from '@/hooks/useToast';

// F28 T2 (D5): single error→toast funnel shared by both query and mutation
// caches so all server-failure UX routes through one helper. Branches on the
// canonical ApiClientError.code; falls back to a generic message otherwise.
export function reportError(error: ApiClientError | Error): void {
  let message: string;
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK_ERROR') {
      message = "You're offline — check your connection.";
    } else if (error.code === 'FORBIDDEN') {
      message = "You don't have permission to do that.";
    } else {
      message = error.message || 'Something went wrong.';
    }
  } else {
    message = 'Action failed — please try again.';
  }
  toast.error(message);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => reportError(error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => reportError(error),
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
