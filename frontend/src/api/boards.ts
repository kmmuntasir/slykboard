import { apiFetch } from './client';
import type { BoardPayload } from '@/types/board';

// F26: optional query string for server-side filtering (search/assignee/priority/label).
export function fetchBoard(
  slug: string,
  queryString?: string,
): Promise<BoardPayload> {
  const path = `/projects/${slug}/board`;
  return apiFetch<BoardPayload>(queryString ? `${path}?${queryString}` : path);
}
