import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type * as JwtModule from '../utils/jwt';

vi.mock('../services/googleOAuth', () => ({
  exchangeCodeForUser: vi.fn(),
}));
vi.mock('../services/userService', () => ({
  upsertByGoogleId: vi.fn(),
}));
// Keep the REAL verifyJwt (authenticate needs it) — only mock signJwt.
vi.mock('../utils/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof JwtModule>();
  return { ...actual, signJwt: vi.fn() };
});

import { app } from '../index';
import { exchangeCodeForUser } from '../services/googleOAuth';
import { upsertByGoogleId } from '../services/userService';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

const mockedExchange = vi.mocked(exchangeCodeForUser);
const mockedUpsert = vi.mocked(upsertByGoogleId);
const mockedSign = vi.mocked(signJwt);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth routes', () => {
  it('POST /google returns 200 with token + user on valid code', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
    });
    mockedUpsert.mockResolvedValue({
      id: 'u1',
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
      role: 'MEMBER',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof upsertByGoogleId>>);
    mockedSign.mockResolvedValue('jwt-xyz');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('jwt-xyz');
    expect(res.body.data.user).toEqual({
      id: 'u1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
      role: 'MEMBER',
    });
    expect(mockedExchange).toHaveBeenCalledWith('valid');
  });

  it('POST /google returns 400 VALIDATION_FAILED on missing code', async () => {
    const res = await request(app).post('/api/auth/google').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /google returns 400 VALIDATION_FAILED on empty code', async () => {
    const res = await request(app).post('/api/auth/google').send({ code: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST /google returns 500 INTERNAL_ERROR when exchangeCodeForUser throws', async () => {
    mockedExchange.mockRejectedValue(
      new AppError(ErrorCode.INTERNAL_ERROR, 'Authentication failed'),
    );

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    // isProd=true in test env (NODE_ENV='test' !== 'development'); errorHandler
    // rewrites any status >= 500 message to 'Internal server error'.
    expect(res.body.error.message).toBe('Internal server error');
  });

  it('GET /me returns 401 UNAUTHENTICATED without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /me returns 200 with fresh token + user on valid token', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      role: 'MEMBER',
    });
    mockedSign.mockResolvedValue('fresh-token');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('fresh-token');
    expect(res.body.data.user).toEqual({ id: 'u1', email: 'user@example.com', role: 'MEMBER' });
  });

  it('POST /logout returns 200 with success:true', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
  });
});
