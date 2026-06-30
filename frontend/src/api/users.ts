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
  isPlatformAdmin: boolean;
  displayName?: string | null;
  avatarUrl: string | null;
  blocked: boolean;
}

// F13 T9: GET /users — workspace-wide user picker source. Excludes email/admin status.
export async function listUsers(): Promise<UserOption[]> {
  return apiFetch<UserOption[]>('/users');
}

// F25: GET /users — admin user-management roster. Returns the full user shape
// (email/isPlatformAdmin/blocked) for the management table.
export async function fetchUsers(): Promise<WorkspaceUser[]> {
  return apiFetch<WorkspaceUser[]>('/users');
}

// SLYK-01: PATCH /users/:userId/isPlatformAdmin — admin-only. Server guards the
// last-admin demote (409).
export async function updatePlatformAdmin(
  userId: string,
  isPlatformAdmin: boolean,
): Promise<WorkspaceUser> {
  return apiFetch<WorkspaceUser>(`/users/${userId}/isPlatformAdmin`, {
    method: 'PATCH',
    body: JSON.stringify({ isPlatformAdmin }),
  });
}

// F25: PATCH /users/:userId/blocked — admin-only activate/deactivate.
export async function setUserBlocked(userId: string, blocked: boolean): Promise<WorkspaceUser> {
  return apiFetch<WorkspaceUser>(`/users/${userId}/blocked`, {
    method: 'PATCH',
    body: JSON.stringify({ blocked }),
  });
}
