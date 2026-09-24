import { apiFetch } from './client';
import type { Project, Column, CreateProjectDto, UpdateProjectDto } from '@/types/project';

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

// CR-01 (docs/change-requests-requirements.md): Project-Admin column
// management. Columns-only endpoint — rename and activation stay on the
// PA-only PATCH /projects/:slug (FR-01.4).
export function updateProjectColumns(slug: string, columns: Column[]): Promise<Project> {
  return apiFetch<Project>(`/projects/${slug}/columns`, {
    method: 'PATCH',
    body: JSON.stringify({ columns }),
  });
}
