import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { decodeJwt } from 'jose';
import type * as JwtModule from '../utils/jwt';

// Hoisted mutable test env. accessControl reads env.allowedDomain at call time;
// jwt reads env.jwtSecret at module load. Mocking the '../config' barrel with a
// full Config keeps REAL accessControl + REAL verifyJwt working while each test
// controls allowedDomain.
const { TEST_ENV } = vi.hoisted(() => ({
  TEST_ENV: {
    port: 3000,
    frontendUrl: 'http://localhost:5173',
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    jwtSecret: 'test-jwt-secret-test-jwt-secret-0000',
    jwtTtl: '8h',
    googleClientId: 'test-client-id.apps.googleusercontent.com',
    googleClientSecret: 'test-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
    allowedDomain: undefined as string | undefined,
  },
}));

vi.mock('../config', () => ({
  env: TEST_ENV,
}));
vi.mock('../services/googleOAuth', () => ({
  exchangeCodeForUser: vi.fn(),
}));
vi.mock('../services/userService', () => ({
  upsertByGoogleId: vi.fn(),
  findUserById: vi.fn(),
  findUserByGoogleId: vi.fn(),
}));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));
// Keep the REAL verifyJwt (authenticate needs it) — only mock signJwt.
vi.mock('../utils/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof JwtModule>();
  return { ...actual, signJwt: vi.fn() };
});

import { app } from '../index';
import { exchangeCodeForUser } from '../services/googleOAuth';
import { upsertByGoogleId, findUserById, findUserByGoogleId } from '../services/userService';
import { bumpTokenVersion, findUserTokenVersion } from '../services/tokenVersion';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

const mockedExchange = vi.mocked(exchangeCodeForUser);
const mockedUpsert = vi.mocked(upsertByGoogleId);
const mockedFindById = vi.mocked(findUserById);
const mockedFindByGoogleId = vi.mocked(findUserByGoogleId);
const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedBump = vi.mocked(bumpTokenVersion);
const mockedSign = vi.mocked(signJwt);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
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

  it('POST /google returns 200 ADMIN for first user when domain allowed', async () => {
    TEST_ENV.allowedDomain = 'allowed.com';
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'a@allowed.com',
      fullName: 'Admin One',
      avatarUrl: 'https://img/a.png',
    });
    mockedUpsert.mockResolvedValue({
      id: 'u1',
      googleId: 'g1',
      email: 'a@allowed.com',
      fullName: 'Admin One',
      avatarUrl: 'https://img/a.png',
      role: 'ADMIN',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof upsertByGoogleId>>);
    mockedSign.mockResolvedValue('jwt-admin');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(mockedUpsert).toHaveBeenCalled();
  });

  it('POST /google returns token whose decoded JWT ver === user.tokenVersion', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    mockedSign.mockImplementation((claims) => realSignJwt(claims));
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
      tokenVersion: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof upsertByGoogleId>>);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    const decoded = decodeJwt(res.body.data.token);
    expect(decoded.ver).toBe(2);
  });

  it('POST /google returns 403 FORBIDDEN on domain mismatch', async () => {
    TEST_ENV.allowedDomain = 'allowed.com';
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'a@blocked.com',
      fullName: 'Blocked User',
      avatarUrl: null,
    });

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Your Google account is not in the allowed workspace');
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it('POST /google returns 200 for existing user with disallowed domain (D1 grandfathering)', async () => {
    TEST_ENV.allowedDomain = 'newdomain.com';
    mockedExchange.mockResolvedValue({
      googleId: 'existing-google-id',
      email: 'user@oldomain.com',
      fullName: 'Existing User',
      avatarUrl: null,
    });
    const seededRow = {
      id: 'u-existing',
      googleId: 'existing-google-id',
      email: 'user@oldomain.com',
      fullName: 'Existing User',
      avatarUrl: null,
      role: 'MEMBER',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockedFindByGoogleId.mockResolvedValue(
      seededRow as unknown as Awaited<ReturnType<typeof findUserByGoogleId>>,
    );
    mockedUpsert.mockResolvedValue(
      seededRow as unknown as Awaited<ReturnType<typeof upsertByGoogleId>>,
    );
    mockedSign.mockResolvedValue('jwt-grandfathered');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('jwt-grandfathered');
    expect(res.body.data.user).toEqual({
      id: 'u-existing',
      email: 'user@oldomain.com',
      fullName: 'Existing User',
      avatarUrl: null,
      role: 'MEMBER',
    });
    expect(mockedFindByGoogleId).toHaveBeenCalledWith('existing-google-id');
    expect(mockedUpsert).toHaveBeenCalled();
  });

  it('POST /google returns 200 when env.allowedDomain unset (allow all)', async () => {
    TEST_ENV.allowedDomain = undefined;
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'anyone@anywhere.com',
      fullName: 'Any One',
      avatarUrl: null,
    });
    mockedUpsert.mockResolvedValue({
      id: 'u1',
      googleId: 'g1',
      email: 'anyone@anywhere.com',
      fullName: 'Any One',
      avatarUrl: null,
      role: 'MEMBER',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof upsertByGoogleId>>);
    mockedSign.mockResolvedValue('jwt-any');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(mockedUpsert).toHaveBeenCalled();
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

  it('POST /google returns 401 UNAUTHENTICATED on unverified email', async () => {
    TEST_ENV.allowedDomain = 'allowed.com';
    mockedExchange.mockRejectedValue(
      new AppError(ErrorCode.UNAUTHENTICATED, 'Email not verified by Google'),
    );

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    // exchangeCodeForUser threw before assertDomainAllowed + upsert ran (code order).
    expect(mockedUpsert).not.toHaveBeenCalled();
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
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue({
      id: 'u1',
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
      role: 'MEMBER',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof findUserById>>);
    mockedSign.mockResolvedValue('fresh-token');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('fresh-token');
    expect(res.body.data.user).toEqual({
      id: 'u1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
      role: 'MEMBER',
    });
  });

  it('GET /me returns 200 with DB-fresh role (DB-authoritative, not JWT)', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    // JWT claim says MEMBER, but the DB row says ADMIN — /me must emit ADMIN.
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      role: 'MEMBER',
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue({
      id: 'u1',
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'DB Fresh',
      avatarUrl: 'https://img/db.png',
      role: 'ADMIN',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof findUserById>>);
    mockedSign.mockResolvedValue('fresh-token');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(res.body.data.user.fullName).toBe('DB Fresh');
    expect(res.body.data.user.avatarUrl).toBe('https://img/db.png');
    expect(mockedFindById).toHaveBeenCalledWith('u1');
  });

  it('GET /me returns token whose decoded JWT ver === DB tokenVersion', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    mockedSign.mockImplementation((claims) => realSignJwt(claims));
    // Request JWT carries ver:0; DB-authoritative tokenVersion is 3.
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      role: 'MEMBER',
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue({
      id: 'u1',
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
      role: 'MEMBER',
      tokenVersion: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof findUserById>>);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    const decoded = decodeJwt(res.body.data.token);
    // /me re-signs from the DB row, so ver follows DB tokenVersion (3), not the request token's 0.
    expect(decoded.ver).toBe(3);
  });

  it('GET /me returns 401 UNAUTHENTICATED when user not found in DB', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'ghost',
      email: 'ghost@example.com',
      role: 'MEMBER',
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue(undefined);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('User no longer exists');
  });

  it('POST /logout returns 401 UNAUTHENTICATED without Bearer token', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('POST /logout bumps tokenVersion + returns success:true', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      role: 'MEMBER',
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedBump.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(mockedBump).toHaveBeenCalledWith('u1');
  });

  it('POST /logout returns 500 INTERNAL_ERROR when bumpTokenVersion rejects', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      role: 'MEMBER',
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedBump.mockRejectedValue(new AppError(ErrorCode.INTERNAL_ERROR, 'Version bump failed'));

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    // errorHandler rewrites >= 500 messages to 'Internal server error' in non-dev envs.
    expect(res.body.error.message).toBe('Internal server error');
    expect(mockedBump).toHaveBeenCalledWith('u1');
  });
});
