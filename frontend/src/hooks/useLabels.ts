import { useQuery } from '@tanstack/react-query';
import { listLabels } from '@/api/labels';
import { labelKeys } from '@/api/queryKeys';

// F14 T6: project-scoped label catalog read hook.
// staleTime 60s mirrors the board polling cadence to avoid label list thrash.
export function useLabels(projectSlug: string) {
  return useQuery({
    queryKey: labelKeys.forProject(projectSlug),
    queryFn: () => listLabels(projectSlug),
    staleTime: 60_000,
  });
}
