import { apiFetch } from './client';
import type { Label, CreateLabelDto, UpdateLabelDto } from '../types/label';

// F14 T5: label catalog HTTP client.
// Reads:  GET    /projects/:slug/labels           (list, member-open)
// Create: POST   /projects/:slug/labels           (admin-only)
// Update: PATCH  /labels/:id                      (admin-only; rename/recolor)
// Delete: DELETE /labels/:id                      (admin-only; cascade-untags)

export async function listLabels(projectSlug: string): Promise<Label[]> {
  return apiFetch<Label[]>(`/projects/${projectSlug}/labels`);
}

export async function createLabel(
  projectSlug: string,
  dto: CreateLabelDto,
): Promise<Label> {
  return apiFetch<Label>(`/projects/${projectSlug}/labels`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function updateLabel(
  labelId: string,
  dto: UpdateLabelDto,
): Promise<Label> {
  return apiFetch<Label>(`/labels/${labelId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function deleteLabel(labelId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/labels/${labelId}`, {
    method: 'DELETE',
  });
}
