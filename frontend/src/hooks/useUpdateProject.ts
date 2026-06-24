import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProject } from '@/api/projects';
import { projectKeys, boardKeys } from '@/api/queryKeys';
import type { UpdateProjectDto } from '@/types/project';

// F27: project rename + column management mutation.
// Rename and column changes both affect the board (column headers + ticket
// statusColumn) and the project detail/list caches, so invalidate all three.
export function useUpdateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateProjectDto) => updateProject(slug, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: projectKeys.lists() });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
