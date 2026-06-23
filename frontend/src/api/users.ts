import { apiFetch } from './client';

export interface UserOption {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

// F13 T9: GET /users — workspace-wide user picker source. Excludes email/role.
export async function listUsers(): Promise<UserOption[]> {
  return apiFetch<UserOption[]>('/users');
}
