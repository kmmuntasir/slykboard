import { apiFetch } from './client';

export interface AuthResponseUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
  displayName: string | null;
}

// SLYK-0160: dual-mode runtime config served by /api/auth/me (02-dual-mode.md
// Layer 3). Defaults to plain mode — older/plain backends may omit the key.
export interface RuntimeConfig {
  agentMode: boolean;
  dispatcherUrl: string | null;
}

export interface AuthResponse {
  token: string;
  user: AuthResponseUser;
  config?: RuntimeConfig;
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
