import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { decodeJwt } from 'jose';
import type * as JwtModule from '../utils/jwt';

// Hoisted mutable test env. jwt reads env.jwtSecret at module load. Mocking the
// '../config' barrel with a full Config keeps REAL verifyJwt working while each
// test controls allowedDomain (kept only to assert login does NOT consult it).
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
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  linkGoogleId: vi.fn(),
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
import { findUserByEmail, findUserById, linkGoogleId } from '../services/userService';
import { bumpTokenVersion, findUserTokenVersion } from '../services/tokenVersion';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

const mockedExchange = vi.mocked(exchangeCodeForUser);
const mockedFindByEmail = vi.mocked(findUserByEmail);
const mockedFindById = vi.mocked(findUserById);
const mockedLinkGoogleId = vi.mocked(linkGoogleId);
const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedBump = vi.mocked(bumpTokenVersion);
const mockedSign = vi.mocked(signJwt);

// A canonical existing-user row fixture (returning user, already linked).
const linkedUser = {
  id: 'u1',
  googleId: 'g1',
  email: 'user@example.com',
  fullName: 'User One',
  avatarUrl: 'https://img/u.png',
  isPlatformAdmin: false,
  displayName: 'Uno',
  blocked: false,
  tokenVersion: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
});

describe('auth routes — POST /google login gate (SLYK-01 Task H)', () => {
  it('returns 401 UNAUTHENTICATED for an unknown email (no auto-create)', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g-new',
      email: 'nobody@example.com',
      fullName: 'Nobody',
      avatarUrl: null,
    });
    mockedFindByEmail.mockResolvedValue(undefined);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('No account for this email');
    expect(mockedFindByEmail).toHaveBeenCalledWith('nobody@example.com');
    expect(mockedLinkGoogleId).not.toHaveBeenCalled();
    expect(mockedSign).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a blocked user (deactivation gate)', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g-blocked',
      email: 'blocked@example.com',
      fullName: 'Blocked',
      avatarUrl: null,
    });
    mockedFindByEmail.mockResolvedValue({ ...linkedUser, blocked: true } as never);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Account deactivated');
    // Gate sits BEFORE linkGoogleId + signJwt.
    expect(mockedLinkGoogleId).not.toHaveBeenCalled();
    expect(mockedSign).not.toHaveBeenCalled();
  });

  it('first login (googleId null) links googleId and returns 200', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g-new',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
    });
    const unlinked = { ...linkedUser, googleId: null };
    mockedFindByEmail.mockResolvedValue(unlinked as never);
    const linked = { ...linkedUser, googleId: 'g-new' };
    mockedLinkGoogleId.mockResolvedValue(linked as never);
    mockedSign.mockResolvedValue('jwt-xyz');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('jwt-xyz');
    expect(res.body.data.user).toEqual({
      id: 'u1',
      email: 'user@example.com',
      fullName: 'User One',
      displayName: 'Uno',
      avatarUrl: 'https://img/u.png',
      isPlatformAdmin: false,
    });
    expect(mockedLinkGoogleId).toHaveBeenCalledWith('u1', 'g-new');
    expect(mockedSign).toHaveBeenCalledWith({
      sub: 'u1',
      email: 'user@example.com',
      pa: false,
      ver: 0,
    });
  });

  it('stored googleId mismatch surfaces 403 FORBIDDEN from linkGoogleId', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g-attacker',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: null,
    });
    // Account already linked to a DIFFERENT googleId.
    mockedFindByEmail.mockResolvedValue({ ...linkedUser, googleId: 'g-real' } as never);
    mockedLinkGoogleId.mockRejectedValue(
      new AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch'),
    );

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Account identity mismatch');
    expect(mockedLinkGoogleId).toHaveBeenCalledWith('u1', 'g-attacker');
    expect(mockedSign).not.toHaveBeenCalled();
  });

  it('returning user (googleId already matches) succeeds without re-linking write', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
    });
    mockedFindByEmail.mockResolvedValue(linkedUser as never);
    // linkGoogleId is idempotent: returns the same row when googleId matches.
    mockedLinkGoogleId.mockResolvedValue(linkedUser as never);
    mockedSign.mockResolvedValue('jwt-return');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('jwt-return');
    expect(res.body.data.user.isPlatformAdmin).toBe(false);
    expect(res.body.data.user.displayName).toBe('Uno');
    expect(mockedLinkGoogleId).toHaveBeenCalledWith('u1', 'g1');
  });

  it('returns isPlatformAdmin=true for a platform-admin account', async () => {
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'admin@example.com',
      fullName: 'Admin One',
      avatarUrl: null,
    });
    const admin = { ...linkedUser, id: 'admin1', email: 'admin@example.com', isPlatformAdmin: true };
    mockedFindByEmail.mockResolvedValue(admin as never);
    mockedLinkGoogleId.mockResolvedValue(admin as never);
    mockedSign.mockResolvedValue('jwt-admin');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.isPlatformAdmin).toBe(true);
    expect(mockedSign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'admin1', pa: true }),
    );
  });

  it('does NOT consult ALLOWED_DOMAIN on the login path for existing users', async () => {
    // Existing user whose email domain differs from the (tightened) allowed
    // domain must still log in — domain gating is creation-time only.
    TEST_ENV.allowedDomain = 'newdomain.com';
    const offdomain = {
      ...linkedUser,
      email: 'user@oldomain.com',
      googleId: 'g-off',
    };
    mockedExchange.mockResolvedValue({
      googleId: 'g-off',
      email: 'user@oldomain.com',
      fullName: 'Existing User',
      avatarUrl: null,
    });
    mockedFindByEmail.mockResolvedValue(offdomain as never);
    mockedLinkGoogleId.mockResolvedValue(offdomain as never);
    mockedSign.mockResolvedValue('jwt-grandfathered');

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('jwt-grandfathered');
  });

  it('returns a token whose decoded JWT ver === user.tokenVersion', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    mockedSign.mockImplementation((claims) => realSignJwt(claims));
    mockedExchange.mockResolvedValue({
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: 'https://img/u.png',
    });
    const withVer = { ...linkedUser, tokenVersion: 2 };
    mockedFindByEmail.mockResolvedValue(withVer as never);
    mockedLinkGoogleId.mockResolvedValue(withVer as never);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    const decoded = decodeJwt(res.body.data.token);
    expect(decoded.ver).toBe(2);
    expect(decoded.pa).toBe(false);
  });

  it('returns 400 VALIDATION_FAILED on missing code', async () => {
    const res = await request(app).post('/api/auth/google').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 VALIDATION_FAILED on empty code', async () => {
    const res = await request(app).post('/api/auth/google').send({ code: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 UNAUTHENTICATED on unverified email (exchangeCodeForUser throws)', async () => {
    mockedExchange.mockRejectedValue(
      new AppError(ErrorCode.UNAUTHENTICATED, 'Email not verified by Google'),
    );

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    // Threw before any user lookup ran.
    expect(mockedFindByEmail).not.toHaveBeenCalled();
  });

  it('returns 500 INTERNAL_ERROR when exchangeCodeForUser throws', async () => {
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
});

describe('auth routes — GET /me', () => {
  it('returns 401 UNAUTHENTICATED without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 200 with fresh token + user on valid token', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      pa: false,
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue(linkedUser as never);
    mockedSign.mockResolvedValue('fresh-token');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('fresh-token');
    expect(res.body.data.user).toEqual({
      id: 'u1',
      email: 'user@example.com',
      fullName: 'User One',
      displayName: 'Uno',
      avatarUrl: 'https://img/u.png',
      isPlatformAdmin: false,
    });
  });

  it('returns 200 with DB-fresh isPlatformAdmin (DB-authoritative, not JWT)', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    // JWT claim says pa:false, but the DB row says isPlatformAdmin:true.
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      pa: false,
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue({
      ...linkedUser,
      isPlatformAdmin: true,
      fullName: 'DB Fresh',
      avatarUrl: 'https://img/db.png',
    } as never);
    mockedSign.mockResolvedValue('fresh-token');

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.isPlatformAdmin).toBe(true);
    expect(res.body.data.user.fullName).toBe('DB Fresh');
    expect(res.body.data.user.avatarUrl).toBe('https://img/db.png');
    expect(mockedFindById).toHaveBeenCalledWith('u1');
  });

  it('returns a token whose decoded JWT ver === DB tokenVersion', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    mockedSign.mockImplementation((claims) => realSignJwt(claims));
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      pa: false,
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue({ ...linkedUser, tokenVersion: 3 } as never);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(200);
    const decoded = decodeJwt(res.body.data.token);
    // /me re-signs from the DB row, so ver follows DB tokenVersion (3).
    expect(decoded.ver).toBe(3);
  });

  it('returns 401 UNAUTHENTICATED when user not found in DB', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'ghost',
      email: 'ghost@example.com',
      pa: false,
      ver: 0,
    });
    mockedFindVersion.mockResolvedValue(0);
    mockedFindById.mockResolvedValue(undefined);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${realToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('User no longer exists');
  });
});

describe('auth routes — POST /logout', () => {
  it('returns 401 UNAUTHENTICATED without Bearer token', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('bumps tokenVersion + returns success:true', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      pa: false,
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

  it('returns 500 INTERNAL_ERROR when bumpTokenVersion rejects', async () => {
    const { signJwt: realSignJwt } =
      await vi.importActual<typeof import('../utils/jwt')>('../utils/jwt');
    const realToken = await realSignJwt({
      sub: 'u1',
      email: 'user@example.com',
      pa: false,
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
