import { apiFetch } from './client';
import type { BoardPayload } from '@/types/board';

export function fetchBoard(slug: string): Promise<BoardPayload> {
  return apiFetch<BoardPayload>(`/projects/${slug}/board`);
}
