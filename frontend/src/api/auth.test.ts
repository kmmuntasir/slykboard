import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiClientError } from './client';
import { fetchMe, loginWithGoogle, logout } from './auth';
import type { AuthResponse } from './auth';

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, apiFetch: vi.fn() };
});

const apiFetchMock = vi.mocked(apiFetch);

function buildAuthResponse(): AuthResponse {
  return {
    token: 'tok',
    user: {
      id: 'u1',
      email: 'user@example.com',
      fullName: 'Test User',
      avatarUrl: null,
      role: 'MEMBER',
    },
  };
}

describe('auth api wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loginWithGoogle POSTs {code} and returns AuthResponse', async () => {
    const payload = buildAuthResponse();
    apiFetchMock.mockResolvedValueOnce(payload);

    const result = await loginWithGoogle('abc');

    expect(result).toEqual(payload);
    expect(apiFetch).toHaveBeenCalledWith('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ code: 'abc' }),
    });
  });

  it('fetchMe GETs /auth/me', async () => {
    const payload = buildAuthResponse();
    apiFetchMock.mockResolvedValueOnce(payload);

    const result = await fetchMe();

    expect(result).toEqual(payload);
    expect(apiFetch).toHaveBeenCalledWith('/auth/me');
  });

  it('logout POSTs /auth/logout', async () => {
    apiFetchMock.mockResolvedValueOnce({ success: true });

    await logout();

    expect(apiFetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  });

  it('logout swallows errors', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('boom'));

    await expect(logout()).resolves.toBeUndefined();
  });

  it('loginWithGoogle propagates ApiClientError', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiClientError('Unauthorized', 401, 'UNAUTHENTICATED'));

    await expect(loginWithGoogle('abc')).rejects.toBeInstanceOf(ApiClientError);
  });
});
