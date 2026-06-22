import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // F07 D6: don't retry 401s (the apiFetch interceptor handles refresh/logout).
      // Other errors retry up to 3 times (default).
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError && error.status === 401) {
          return false;
        }
        return failureCount < 3;
      },
    },
  },
});
