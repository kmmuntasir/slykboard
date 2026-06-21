import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted above all imports; use vi.hoisted so the mock fns exist
// when the factory runs.
const { getToken, verifyIdToken } = vi.hoisted(() => ({
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('../config/googleClient', () => ({
  googleClient: {
    getToken,
    verifyIdToken,
  },
}));

import { exchangeCodeForUser } from './googleOAuth';
import { AppError } from '../utils/appError';

describe('exchangeCodeForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns normalized user info on success', async () => {
    getToken.mockResolvedValueOnce({ tokens: { id_token: 'x' } });
    verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g1', email: 'a@b.com', name: 'A B', picture: 'url' }),
    });

    const result = await exchangeCodeForUser('code-1');

    expect(result).toEqual({
      googleId: 'g1',
      email: 'a@b.com',
      fullName: 'A B',
      avatarUrl: 'url',
    });
  });

  it('falls back to email local-part when name missing', async () => {
    getToken.mockResolvedValueOnce({ tokens: { id_token: 'x' } });
    verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g2', email: 'a@b.com' }),
    });

    const result = await exchangeCodeForUser('code-2');

    expect(result.fullName).toBe('a');
  });

  it('stores null avatarUrl when picture missing', async () => {
    getToken.mockResolvedValueOnce({ tokens: { id_token: 'x' } });
    verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g3', email: 'a@b.com', name: 'A B' }),
    });

    const result = await exchangeCodeForUser('code-3');

    expect(result.avatarUrl).toBeNull();
  });

  it('throws AppError INTERNAL_ERROR on getToken rejection', async () => {
    getToken.mockRejectedValueOnce(new Error('network down'));

    const err = await exchangeCodeForUser('c').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
  });

  it('throws AppError INTERNAL_ERROR on verifyIdToken rejection', async () => {
    getToken.mockResolvedValueOnce({ tokens: { id_token: 'x' } });
    verifyIdToken.mockRejectedValueOnce(new Error('signature invalid'));

    await expect(exchangeCodeForUser('c')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
  });

  it('throws AppError INTERNAL_ERROR when id_token missing', async () => {
    getToken.mockResolvedValueOnce({ tokens: {} });

    await expect(exchangeCodeForUser('c')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
  });

  it('never leaks Google error message', async () => {
    getToken.mockRejectedValueOnce(new Error('invalid_grant: bad code'));

    const err = await exchangeCodeForUser('c').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('Authentication failed');
    expect(err.message).not.toContain('invalid_grant');
  });
});
