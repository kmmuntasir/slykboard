import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Hoisted mutable test env. accessControl reads env.allowedDomain at call
// time; jwt reads env.jwtSecret at module load. Mocking '../config' with a
// full Config keeps REAL accessControl + REAL verifyJwt working while each
// test controls allowedDomain. Mirrors projects.routes.test.ts.
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
}));
vi.mock('../services/membershipService', () => ({
  isProjectMember: membershipMock.isProjectMember,
  getMemberRole: membershipMock.getMemberRole,
}));
// requireProjectMember imports getProjectBySlug from projectService.
vi.mock('../services/projectService', () => ({
  getProjectBySlug: vi.fn(),
}));
vi.mock('../services/reportService', () => ({
  getTimeReport: vi.fn(),
  getTicketSummary: vi.fn(),
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as projectService from '../services/projectService';
import * as reportService from '../services/reportService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedGetBySlug = vi.mocked(projectService.getProjectBySlug);
const mockedGetTimeReport = vi.mocked(reportService.getTimeReport);
const mockedGetTicketSummary = vi.mocked(reportService.getTicketSummary);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the caller is a real MEMBER of the resolved project. Non-member
  // / unknown-slug cases override getProjectBySlug to reject with the
  // non-revealing FORBIDDEN (the service contract makes the two indistinguishable).
  membershipMock.getMemberRole.mockResolvedValue('MEMBER');
});

// sub 'u1' is the JWT subject; used as creatorId for the "member" case.
function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa: isPlatformAdmin, ver: 0 });
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

const timeReportPayload = {
  users: [{ id: 'u1', fullName: 'User One', avatarUrl: null, totalMs: 3_600_000 }],
  window: {
    start: '2026-06-23T00:00:00.000Z',
    end: '2026-06-30T00:00:00.000Z',
    label: 'Week of Jun 23, 2026',
  },
};

const ticketSummaryPayload = {
  users: [
    {
      id: 'u1',
      fullName: 'User One',
      avatarUrl: null,
      counts: { LOW: 0, MEDIUM: 2, HIGH: 1, URGENT: 0, CRITICAL: 0, total: 3 },
    },
  ],
  window: {
    start: '2026-06-23T00:00:00.000Z',
    end: '2026-06-30T00:00:00.000Z',
    label: 'Week of Jun 23, 2026',
  },
};

// ---------------------------------------------------------------------------
// F48: scoped endpoints — /api/projects/:slug/reports/{time,tickets}
// ---------------------------------------------------------------------------

describe('GET /api/projects/:slug/reports/time (F48 scoped)', () => {
  it('returns 200 + scoped data for a member; passes projectId to the service', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    // F48: service MUST receive the membership-gate's project id, not the slug.
    expect(mockedGetTimeReport).toHaveBeenCalledWith({
      period: 'weekly',
      offset: 0,
      projectId: 'p1',
    });
  });

  it('returns 200 for an ADMIN (admin override) and passes projectId', async () => {
    mockedFindVersion.mockResolvedValue(0);
    // creatorId 'other' — admin bypasses membership.
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    expect(mockedGetTimeReport).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });

  it('returns 403 FORBIDDEN for a non-member (reportService NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    // Non-member: the service contract makes this indistinguishable from an
    // unknown slug — both throw the non-revealing FORBIDDEN.
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedGetTimeReport).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for an unknown slug (anti-oracle; reportService NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedGetTimeReport).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHENTICATED without Bearer (services NOT called)', async () => {
    const res = await request(app).get('/api/projects/SLYK/reports/time');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetBySlug).not.toHaveBeenCalled();
    expect(mockedGetTimeReport).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on invalid slug format (lowercase)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/slyk/reports/time')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('forwards period=monthly & offset=-1 to the service', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time?period=monthly&offset=-1')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(mockedGetTimeReport).toHaveBeenCalledWith({
      period: 'monthly',
      offset: -1,
      projectId: 'p1',
    });
  });
});

describe('GET /api/projects/:slug/reports/tickets (F48 scoped)', () => {
  it('returns 200 + scoped data for a member; passes projectId to the service', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow() as never);
    mockedGetTicketSummary.mockResolvedValue(ticketSummaryPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users[0].counts.total).toBe(3);
    expect(mockedGetTicketSummary).toHaveBeenCalledWith({
      period: 'weekly',
      offset: 0,
      projectId: 'p1',
    });
  });

  it('returns 403 FORBIDDEN for a non-member (reportService NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedGetTicketSummary).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).get('/api/projects/SLYK/reports/tickets');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('SLYK-16: removed global report routes return 404', () => {
  const cases = [{ path: '/api/reports/time' }, { path: '/api/reports/tickets' }];
  cases.forEach(({ path }) => {
    it(`${path} → 404 for a MEMBER`, async () => {
      const res = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${await tokenFor(false)}`);
      expect(res.status).toBe(404);
      expect(mockedGetTimeReport).not.toHaveBeenCalled();
      expect(mockedGetTicketSummary).not.toHaveBeenCalled();
    });
    it(`${path} → 404 for a PLATFORM_ADMIN`, async () => {
      const res = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${await tokenFor(true)}`);
      expect(res.status).toBe(404);
      expect(mockedGetTimeReport).not.toHaveBeenCalled();
      expect(mockedGetTicketSummary).not.toHaveBeenCalled();
    });
  });
});
