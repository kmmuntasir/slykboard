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
    googleClientId: 'test-client-id.apps.googleusercontent.com',
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
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { findUserTokenVersion } from '../services/tokenVersion';
import { listUsers } from '../services/userService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedListUsers = vi.mocked(listUsers);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
});

function tokenFor(role: 'ADMIN' | 'MEMBER') {
  return signJwt({ sub: 'u1', email: 'user@example.com', role, ver: 0 });
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
      { id: 'u-a', fullName: 'Alice', avatarUrl: 'http://a' },
    ]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mockedListUsers).toHaveBeenCalledTimes(1);
  });

  it('excludes email and role from every item (PII guard)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([
      { id: 'u-a', fullName: 'Alice', avatarUrl: null },
      { id: 'u-b', fullName: 'Bob', avatarUrl: 'http://b' },
    ]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('fullName');
      expect(item).toHaveProperty('avatarUrl');
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('role');
    }
  });

  it('returns [] when no users exist', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('preserves the order returned by the service (sorted by fullName asc)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const sorted = [
      { id: 'u-a', fullName: 'Alice', avatarUrl: null },
      { id: 'u-b', fullName: 'Bob', avatarUrl: null },
      { id: 'u-c', fullName: 'Carol', avatarUrl: null },
    ];
    mockedListUsers.mockResolvedValue(sorted);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { id: string }) => u.id)).toEqual(['u-a', 'u-b', 'u-c']);
  });

  it('works for MEMBER (no role gate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedListUsers.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
  });
});
