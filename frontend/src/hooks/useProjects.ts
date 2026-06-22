import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listProjects, getProjectBySlug, createProject } from '@/api/projects';
import { projectKeys } from '@/api/queryKeys';
import type { CreateProjectDto } from '@/types/project';

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: listProjects,
  });
}

export function useProject(slug: string | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(slug ?? ''),
    queryFn: () => getProjectBySlug(slug!),
    enabled: !!slug,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProjectDto) => createProject(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}
