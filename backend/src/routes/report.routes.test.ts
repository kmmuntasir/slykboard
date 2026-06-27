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
import { findUserTokenVersion } from '../services/tokenVersion';
import * as projectService from '../services/projectService';
import * as reportService from '../services/reportService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedGetBySlug = vi.mocked(projectService.getProjectBySlug);
const mockedGetTimeReport = vi.mocked(reportService.getTimeReport);
const mockedGetTicketSummary = vi.mocked(reportService.getTicketSummary);

beforeEach(() => {
  vi.clearAllMocks();
});

// sub 'u1' is the JWT subject; used as creatorId for the "member" case.
function tokenFor(role: 'ADMIN' | 'MEMBER') {
  return signJwt({ sub: 'u1', email: 'user@example.com', role, ver: 0 });
}

// A full ProjectRow shape (enough for requireProjectMember to attach). The
// creatorId controls membership: 'u1' = member, 'other' = non-member.
const projectRow = (creatorId = 'u1') => ({
  id: 'p1',
  name: 'Slyk',
  slug: 'SLYK',
  columns: [
    { id: 'c-todo', name: 'To Do' },
    { id: 'c-done', name: 'Done' },
  ],
  creatorId,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

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
  it('returns 200 + scoped data for a member (creator); passes projectId to the service', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow('u1') as never);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
    mockedGetBySlug.mockResolvedValue(projectRow('other') as never);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(mockedGetTimeReport).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });

  it('returns 403 FORBIDDEN for a non-member (reportService NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow('other') as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedGetTimeReport).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for an unknown slug (anti-oracle; reportService NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('forwards period=monthly & offset=-1 to the service', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(projectRow('u1') as never);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/time?period=monthly&offset=-1')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
    mockedGetBySlug.mockResolvedValue(projectRow('u1') as never);
    mockedGetTicketSummary.mockResolvedValue(ticketSummaryPayload as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/tickets')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
    mockedGetBySlug.mockResolvedValue(projectRow('other') as never);

    const res = await request(app)
      .get('/api/projects/SLYK/reports/tickets')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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

// ---------------------------------------------------------------------------
// F23/F24 (DEPRECATED per F48 D2): global endpoints — /api/reports/{time,tickets}
// Backward-compat: still mounted, still 200, but call the service WITHOUT
// projectId (global aggregation) and log a [DEPRECATED] warning.
// ---------------------------------------------------------------------------

describe('GET /api/reports/time (deprecated global, backward compat)', () => {
  it('returns 200 and calls service WITHOUT projectId', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTimeReport.mockResolvedValue(timeReportPayload as never);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .get('/api/reports/time')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    // No projectId key at all → global aggregation preserved.
    expect(mockedGetTimeReport).toHaveBeenCalledWith({ period: 'weekly', offset: 0 });
    expect(mockedGetTimeReport).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectId: expect.anything() }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[DEPRECATED]'));
    warnSpy.mockRestore();
  });

  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).get('/api/reports/time');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTimeReport).not.toHaveBeenCalled();
  });
});

describe('GET /api/reports/tickets (deprecated global, backward compat)', () => {
  it('returns 200 and calls service WITHOUT projectId', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketSummary.mockResolvedValue(ticketSummaryPayload as never);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .get('/api/reports/tickets')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users[0].counts.total).toBe(3);
    expect(mockedGetTicketSummary).toHaveBeenCalledWith({ period: 'weekly', offset: 0 });
    expect(mockedGetTicketSummary).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectId: expect.anything() }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[DEPRECATED]'));
    warnSpy.mockRestore();
  });
});
