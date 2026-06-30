import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProject } from '@/api/projects';
import { projectKeys, boardKeys } from '@/api/queryKeys';

// SLYK-04 T5: server-authoritative project reactivation.
// The member filter is server-authoritative, so NO optimistic update —
// invalidate the project detail/list + board families and let the refetch
// reconcile.
export function useReactivateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => updateProject(slug, { isActive: true }),
    meta: { revertMessage: 'Project reactivated' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: projectKeys.lists() });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
