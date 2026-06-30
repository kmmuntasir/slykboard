import { apiFetch } from './client';

export interface AuthResponseUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  displayName: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthResponseUser;
}

export function loginWithGoogle(code: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function fetchMe(): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/auth/me');
}

// D10: best-effort — never throw on logout (client-side clear is authoritative).
export async function logout(): Promise<void> {
  try {
    await apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
  } catch {
    // Swallow — useAuthStore.clear() is the real logout.
  }
}
