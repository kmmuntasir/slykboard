import { apiFetch } from './client';
import type { Project, CreateProjectDto, UpdateProjectDto } from '@/types/project';

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

// F27: admin-only project rename + column management.
export function updateProject(slug: string, dto: UpdateProjectDto): Promise<Project> {
  return apiFetch<Project>(`/projects/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
