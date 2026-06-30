import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Hoisted mutable test env. accessControl reads env.allowedDomain at call
// time; jwt reads env.jwtSecret at module load. Mocking '../config' with a
// full Config keeps REAL accessControl + REAL verifyJwt working while each
// test controls allowedDomain. Mirrors projects.routes.test.ts /
// report.routes.test.ts.
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
// requireProjectMember imports getProjectBySlug from projectService and reads
// the tier via membershipService.getMemberRole inside db.transaction. Mock both
// so the real middleware runs without a live DB.
vi.mock('../db/client', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
  },
}));
const membershipMock = vi.hoisted(() => ({
  isProjectMember: vi.fn(),
  getMemberRole: vi.fn(),
  // The roster route calls listProjectMembers; mock so unrelated suites stay green.
  listProjectMembers: vi.fn(),
  // SLYK-05 Task-10: DELETE/PATCH member routes call these. Mocked per-test so
  // the real middleware/handler chain runs without a live DB. Cleared by the
  // suite-wide vi.clearAllMocks() in beforeEach like the rest of the bag.
  removeMember: vi.fn(),
  setMemberRole: vi.fn(),
}));
vi.mock('../services/membershipService', () => ({
  isProjectMember: membershipMock.isProjectMember,
  getMemberRole: membershipMock.getMemberRole,
  listProjectMembers: membershipMock.listProjectMembers,
  removeMember: membershipMock.removeMember,
  setMemberRole: membershipMock.setMemberRole,
}));
// requireProjectMember imports getProjectBySlug from projectService.
vi.mock('../services/projectService', () => ({
  getProjectBySlug: vi.fn(),
}));
// The lookup handler calls findUserByEmail directly. Mock it per-test.
const userMock = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
}));
vi.mock('../services/userService', () => ({
  findUserByEmail: userMock.findUserByEmail,
  findUserById: userMock.findUserById,
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as projectService from '../services/projectService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedGetBySlug = vi.mocked(projectService.getProjectBySlug);
const mockedFindUserByEmail = vi.mocked(userMock.findUserByEmail);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the caller is a real PROJECT_ADMIN of the resolved project so the
  // admins-only lookup gate passes. Non-admin cases override getMemberRole.
  membershipMock.getMemberRole.mockResolvedValue('PROJECT_ADMIN');
});

// Acting user id. Must be a valid UUID: the DELETE/PATCH :userId path params
// are validated with z.uuid() (memberUserIdParamSchema), and the self-remove /
// self-role-change FORBIDDEN checks compare URL :userId === req.user.id, so the
// JWT `sub` and the self-target URL must BOTH be a UUID. The existing /lookup
// suite never asserts on `sub`, so widening it from 'u1' to a UUID is safe.
const ACTING_USER_ID = '911c0405-9761-441d-89d6-c1a64989c160';
const OTHER_USER_ID = 'af07cbb8-6820-4cf9-a20f-8572f5bb37a7';
const GHOST_USER_ID = '3fd6227c-7245-4d51-aa36-cd1b3f995c39';

function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({
    sub: ACTING_USER_ID,
    email: 'admin@example.com',
    pa: isPlatformAdmin,
    ver: 0,
  });
}

// A full ProjectRow shape (enough for requireProjectMember to attach).
const projectRow = () => ({
  id: 'p1',
  name: 'Slyk',
  slug: 'SLYK',
  columns: [
    { id: 'c-todo', name: 'To Do' },
    { id: 'c-done', name: 'Done' },
  ],
  creatorId: 'u1',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// The byte-identical non-revealing FORBIDDEN thrown by getProjectBySlug for both
// an unknown slug and a real-but-inaccessible project (anti-oracle).
const FORBIDDEN_PROJECT = new AppError(
  ErrorCode.FORBIDDEN,
  'You do not have access to this project',
);

// Minimal-but-realistic UserRow the lookup handler projects down. Carries the
// sensitive fields the response MUST strip (tokenVersion / googleId / blocked).
const userRow = () => ({
  id: 'u-target',
  email: 'jane@example.com',
  fullName: 'Jane Doe',
  displayName: 'Jane',
  isPlatformAdmin: false,
  // Sensitive — must NEVER appear in the response payload.
  tokenVersion: 7,
  googleId: 'google-sub-123',
  blocked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// SLYK-02 T1: GET /api/projects/:slug/members/lookup
// Read-only email probe powering the Add-Member modal auto-search.
// Admins-only. 200 in BOTH found/not-found branches; minimal payload.
// ---------------------------------------------------------------------------

describe('GET /api/projects/:slug/members/lookup (SLYK-02 T1)', () => {
  it('200 + {data:{exists:true,user:{...}}} for a known email (PROJECT_ADMIN caller)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedFindUserByEmail.mockResolvedValue(userRow() as never);

    const res = await request(app)
      .get('/api/projects/SLYK/members/lookup?email=jane@example.com')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      exists: true,
      user: {
        id: 'u-target',
        email: 'jane@example.com',
        fullName: 'Jane Doe',
        displayName: 'Jane',
        isPlatformAdmin: false,
      },
    });
    // Privacy / anti-oracle: sensitive fields must NOT leak.
    expect(res.body.data.user).not.toHaveProperty('tokenVersion');
    expect(res.body.data.user).not.toHaveProperty('googleId');
    expect(res.body.data.user).not.toHaveProperty('blocked');
    // The service receives the validated email string verbatim.
    expect(mockedFindUserByEmail).toHaveBeenCalledWith('jane@example.com');
  });

  it('200 for a Platform Admin caller (PA bypasses the project-admin tier check)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedFindUserByEmail.mockResolvedValue({ ...userRow(), isPlatformAdmin: true } as never);

    const res = await request(app)
      .get('/api/projects/SLYK/members/lookup?email=jane@example.com')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.exists).toBe(true);
    expect(res.body.data.user.isPlatformAdmin).toBe(true);
  });

  it('200 + {data:{exists:false}} for an unknown email (no user key)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedFindUserByEmail.mockResolvedValue(undefined);

    const res = await request(app)
      .get('/api/projects/SLYK/members/lookup?email=nobody@example.com')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ exists: false });
    expect(res.body.data).not.toHaveProperty('user');
  });

  it.each([
    { name: 'missing email query', qs: '' },
    { name: 'malformed email', qs: 'email=not-an-email' },
  ])('400 VALIDATION_FAILED on invalid email query ($name)', async ({ qs }) => {
    mockedFindVersion.mockResolvedValue(0);

    const path = qs ? `/api/projects/SLYK/members/lookup?${qs}` : '/api/projects/SLYK/members/lookup';
    const res = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED on invalid slug format (lowercase)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/slyk/members/lookup?email=jane@example.com')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('403 FORBIDDEN for a non-admin MEMBER (findUserByEmail NOT called — anti-oracle)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    membershipMock.getMemberRole.mockResolvedValue('MEMBER');

    const res = await request(app)
      .get('/api/projects/SLYK/members/lookup?email=jane@example.com')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });

  it('403 FORBIDDEN for a non-member / unknown slug (anti-oracle; findUserByEmail NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const res = await request(app)
      .get('/api/projects/SLYK/members/lookup?email=jane@example.com')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });

  it('401 UNAUTHENTICATED without Bearer (findUserByEmail NOT called)', async () => {
    const res = await request(app).get('/api/projects/SLYK/members/lookup?email=jane@example.com');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedFindUserByEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SLYK-05 Task-10: DELETE /api/projects/:slug/members/:userId
// Removes a member. Admins-only (PA or PROJECT_ADMIN). removeMember throws
// FORBIDDEN on self-remove and NOT_FOUND 'User not found' on a missing row.
// ---------------------------------------------------------------------------

describe('DELETE /api/projects/:slug/members/:userId (SLYK-05 Task-10)', () => {
  it('403 FORBIDDEN on self-remove (acting user id passed as actingUserId)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    membershipMock.removeMember.mockRejectedValueOnce(
      new AppError(ErrorCode.FORBIDDEN, 'You cannot remove yourself from a project'),
    );

    const res = await request(app)
      .delete(`/api/projects/SLYK/members/${ACTING_USER_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // Handler forwards (projectId, targetUserId, actingUserId) to the service.
    expect(membershipMock.removeMember).toHaveBeenCalledWith(
      'p1',
      ACTING_USER_ID,
      ACTING_USER_ID,
    );
  });

  it('200 + {data:{userId}} on a valid other-target remove (forwards actingUserId)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    membershipMock.removeMember.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete(`/api/projects/SLYK/members/${OTHER_USER_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ userId: OTHER_USER_ID });
    expect(membershipMock.removeMember).toHaveBeenCalledWith(
      'p1',
      OTHER_USER_ID,
      ACTING_USER_ID,
    );
  });

  it('404 NOT_FOUND propagation when the target is not a member', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    membershipMock.removeMember.mockRejectedValueOnce(
      new AppError(ErrorCode.NOT_FOUND, 'User not found'),
    );

    const res = await request(app)
      .delete(`/api/projects/SLYK/members/${GHOST_USER_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// SLYK-05 Task-10: PATCH /api/projects/:slug/members/:userId/role
// Promote/demote an existing member. Admins-only. setMemberRole throws
// FORBIDDEN on self-role-change and NOT_FOUND 'User not found' on a non-member.
// Role is validated at the edge (memberRoleSchema enum) → 400 VALIDATION_FAILED.
// ---------------------------------------------------------------------------

describe('PATCH /api/projects/:slug/members/:userId/role (SLYK-05 Task-10)', () => {
  it('403 FORBIDDEN on self role-change (acting user id passed as actingUserId)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    membershipMock.setMemberRole.mockRejectedValueOnce(
      new AppError(ErrorCode.FORBIDDEN, 'You cannot change your own role'),
    );

    const res = await request(app)
      .patch(`/api/projects/SLYK/members/${ACTING_USER_ID}/role`)
      .send({ role: 'MEMBER' })
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(membershipMock.setMemberRole).toHaveBeenCalledWith(
      'p1',
      ACTING_USER_ID,
      'MEMBER',
      ACTING_USER_ID,
    );
  });

  it('200 + {data:{userId,role}} on a valid other-target role change (forwards actingUserId)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    membershipMock.setMemberRole.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch(`/api/projects/SLYK/members/${OTHER_USER_ID}/role`)
      .send({ role: 'PROJECT_ADMIN' })
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ userId: OTHER_USER_ID, role: 'PROJECT_ADMIN' });
    expect(membershipMock.setMemberRole).toHaveBeenCalledWith(
      'p1',
      OTHER_USER_ID,
      'PROJECT_ADMIN',
      ACTING_USER_ID,
    );
  });

  it('400 VALIDATION_FAILED on an out-of-enum role (setMemberRole NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/projects/SLYK/members/${OTHER_USER_ID}/role`)
      .send({ role: 'SUPERUSER' })
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(membershipMock.setMemberRole).not.toHaveBeenCalled();
  });
});
