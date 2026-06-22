import { apiFetch } from './client';
import type { Project, CreateProjectDto } from '@/types/project';

export function listProjects(): Promise<Project[]> {
  return apiFetch<Project[]>('/projects');
}

export function getProjectBySlug(slug: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${slug}`);
}

export function createProject(dto: CreateProjectDto): Promise<Project> {
  return apiFetch<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}
