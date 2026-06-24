import { apiFetch } from './client';

export interface UserOption {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

// F25: full workspace user as returned by GET /users (admin user-management).
export interface WorkspaceUser {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'MEMBER';
  avatarUrl: string | null;
  blocked: boolean;
}

// F13 T9: GET /users — workspace-wide user picker source. Excludes email/role.
export async function listUsers(): Promise<UserOption[]> {
  return apiFetch<UserOption[]>('/users');
}

// F25: GET /users — admin user-management roster. Returns the full user shape
// (email/role/blocked) so SettingsPage can render the management table.
export async function fetchUsers(): Promise<WorkspaceUser[]> {
  return apiFetch<WorkspaceUser[]>('/users');
}

// F25: PATCH /users/:userId/role — admin-only. Server guards the last-admin demote.
export async function updateUserRole(userId: string, role: 'ADMIN' | 'MEMBER'): Promise<WorkspaceUser> {
  return apiFetch<WorkspaceUser>(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

// F25: PATCH /users/:userId/blocked — admin-only activate/deactivate.
export async function setUserBlocked(userId: string, blocked: boolean): Promise<WorkspaceUser> {
  return apiFetch<WorkspaceUser>(`/users/${userId}/blocked`, {
    method: 'PATCH',
    body: JSON.stringify({ blocked }),
  });
}
