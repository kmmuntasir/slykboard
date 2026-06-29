import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Hoisted mutable test env. Same pattern as projects.routes.test.ts — mocking
// '../config' with a full Config keeps REAL accessControl + REAL verifyJwt
// working while each test controls allowedDomain.
const { TEST_ENV } = vi.hoisted(() => ({
  TEST_ENV: {
    port: 3000,
    frontendUrl: 'http://localhost:5173',
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    jwtSecret: 'test-jwt-secret-test-jwt-secret-0000',
    jwtTtl: '8h',
    googleClientId: 'test-client-id.apps.usercontent.google',
    googleClientSecret: 'test-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
    allowedDomain: undefined as string | undefined,
  },
}));

vi.mock('../config', () => ({
  env: TEST_ENV,
}));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));
vi.mock('../services/userService', () => ({
  listUsers: vi.fn(),
  setUserBlocked: vi.fn(),
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { findUserTokenVersion } from '../services/tokenVersion';
import { listUsers, setUserBlocked } from '../services/userService';
import type { UserOption } from '../services/userService';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedListUsers = vi.mocked(listUsers);
const mockedSetBlocked = vi.mocked(setUserBlocked);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
});

function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa: isPlatformAdmin, ver: 0 });
}

describe('usersRouter — GET /api/users (F13 T5)', () => {
  it('returns 401 UNAUTHENTICATED without Bearer (listUsers NOT called)', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedListUsers).not.toHaveBeenCalled();
  });

  it('returns 200 + array of users with valid Bearer', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([
      {
        id: 'u-a',
        email: 'a@x.com',
        fullName: 'Alice',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: 'http://a',
        blocked: false,
      },
    ]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mockedListUsers).toHaveBeenCalledTimes(1);
  });

  it('exposes the full SLYK-01 shape {id, email, fullName, displayName, isPlatformAdmin, avatarUrl, blocked}', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([
      {
        id: 'u-a',
        email: 'a@x.com',
        fullName: 'Alice',
        isPlatformAdmin: true,
        displayName: null,
        avatarUrl: null,
        blocked: false,
      },
      {
        id: 'u-b',
        email: 'b@x.com',
        fullName: 'Bob',
        isPlatformAdmin: false,
        displayName: null,
        avatarUrl: 'http://b',
        blocked: true,
      },
    ]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('email');
      expect(item).toHaveProperty('fullName');
      expect(item).toHaveProperty('isPlatformAdmin');
      expect(item).toHaveProperty('avatarUrl');
      expect(item).toHaveProperty('blocked');
    }
  });

  it('returns [] when no users exist', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('preserves the order returned by the service (sorted by fullName asc)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const sorted: UserOption[] = [
      {
        id: 'u-a',
        email: 'a@x.com',
        fullName: 'Alice',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: null,
        blocked: false,
      },
      {
        id: 'u-b',
        email: 'b@x.com',
        fullName: 'Bob',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: null,
        blocked: false,
      },
      {
        id: 'u-c',
        email: 'c@x.com',
        fullName: 'Carol',
        displayName: null,
        isPlatformAdmin: false,
        avatarUrl: null,
        blocked: false,
      },
    ];
    mockedListUsers.mockResolvedValue(sorted);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { id: string }) => u.id)).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('works for MEMBER (no role gate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
  });
});


describe('usersRouter — PATCH /api/users/:userId/blocked (F25)', () => {
  it('returns 200 + updated user for ADMIN (block=true)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedSetBlocked.mockResolvedValue({
      id: 'u-target',
      googleId: 'g1',
      email: 't@x.com',
      fullName: 'Target',
      avatarUrl: null,
      isPlatformAdmin: false,
      tokenVersion: 1,
      blocked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof setUserBlocked>>);

    const res = await request(app)
      .patch('/api/users/u-target/blocked')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ blocked: true });

    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toBe(true);
    expect(mockedSetBlocked).toHaveBeenCalledWith({
      targetUserId: 'u-target',
      blocked: true,
    });
  });

  it('returns 200 for ADMIN (block=false reactivate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedSetBlocked.mockResolvedValue({
      id: 'u-target',
      googleId: 'g1',
      email: 't@x.com',
      fullName: 'Target',
      avatarUrl: null,
      isPlatformAdmin: false,
      tokenVersion: 2,
      blocked: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof setUserBlocked>>);

    const res = await request(app)
      .patch('/api/users/u-target/blocked')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ blocked: false });

    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toBe(false);
    expect(mockedSetBlocked).toHaveBeenCalledWith({
      targetUserId: 'u-target',
      blocked: false,
    });
  });

  it('returns 403 FORBIDDEN for MEMBER (role-gated)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/users/u-target/blocked')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ blocked: true });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedSetBlocked).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).patch('/api/users/u-target/blocked').send({ blocked: true });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedSetBlocked).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on non-boolean blocked', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/users/u-target/blocked')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ blocked: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedSetBlocked).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on missing blocked', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/users/u-target/blocked')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedSetBlocked).not.toHaveBeenCalled();
  });

  it('propagates NOT_FOUND (404) when target user absent', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedSetBlocked.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'User not found'));

    const res = await request(app)
      .patch('/api/users/u-ghost/blocked')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ blocked: true });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
