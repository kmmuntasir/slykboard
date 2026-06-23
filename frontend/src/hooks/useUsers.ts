import { useQuery } from '@tanstack/react-query';
import { listUsers } from '@/api/users';

// F13 T10: workspace-wide user picker source. Cached 60s to avoid refetching
// on every drawer open.
export function useUsers() {
  return useQuery({
    queryKey: ['users'] as const,
    queryFn: listUsers,
    staleTime: 60_000,
  });
}
