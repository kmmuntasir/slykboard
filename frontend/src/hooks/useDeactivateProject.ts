import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProject } from '@/api/projects';
import { projectKeys, boardKeys } from '@/api/queryKeys';

// SLYK-04 T5: server-authoritative project deactivation.
// Inactive projects are hidden from normal listing but remain addressable by
// slug for admins. The member filter is server-authoritative, so NO optimistic
// update — invalidate the project detail/list + board families and let the
// refetch reconcile.
export function useDeactivateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => updateProject(slug, { isActive: false }),
    meta: { revertMessage: 'Project deactivated' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: projectKeys.lists() });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
