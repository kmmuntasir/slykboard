import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProjectColumns } from '@/api/projects';
import { projectKeys, boardKeys } from '@/api/queryKeys';
import type { Column } from '@/types/project';

// CR-01 (docs/change-requests-requirements.md): column management mutation for
// Project Admins (Platform Admins are admitted too via the backend PA bypass).
// Targets the columns-only PATCH /projects/:slug/columns — rename/activation
// stay on the PA-only useUpdateProject (FR-01.4). Column changes affect the
// board (column headers + ticket statusColumn) and the project detail/list
// caches, so invalidate all three — mirroring useUpdateProject.
export function useUpdateProjectColumns(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (columns: Column[]) => updateProjectColumns(slug, columns),
    meta: { revertMessage: "Couldn't save columns" },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: projectKeys.lists() });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
