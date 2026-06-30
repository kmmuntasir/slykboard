import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// SLYK-01 Task O — the regression guard. A table-driven route inventory is
// looped across five access tiers (ANON, MEMBER, PROJECT_MEMBER, PROJECT_ADMIN,
// PLATFORM_ADMIN). For each row we assert 2xx for allowed tiers and 403 (401 for
// ANON) for disallowed tiers — confirming the entire route surface honours the
// three-tier permission model after the SLYK-01 migration. Services + the DB
// client are mocked at the edge; no real DB is hit.

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

vi.mock('../config', () => ({ env: TEST_ENV }));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));

// resolveTicketProject / resolveLabelProject resolve the owning project via
// db.select().from(projects).where().limit(1), then run the membership decision
// inside db.transaction. Provide a passthrough tx + a select chain returning a
// configurable project row so the real middleware runs without a live DB.
const projectRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
const membershipMock = vi.hoisted(() => ({
  isProjectMember: vi.fn(),
  getMemberRole: vi.fn(),
  addExistingMember: vi.fn(),
  createAndAddMember: vi.fn(),
  setMemberRole: vi.fn(),
  removeMember: vi.fn(),
  listProjectMembers: vi.fn(),
  promoteToProjectAdmin: vi.fn(),
  addMember: vi.fn(),
}));
vi.mock('../db/client', () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(projectRows.rows) }) }),
    }),
  },
}));
vi.mock('../services/membershipService', () => ({
  isProjectMember: membershipMock.isProjectMember,
  getMemberRole: membershipMock.getMemberRole,
  addExistingMember: membershipMock.addExistingMember,
  createAndAddMember: membershipMock.createAndAddMember,
  setMemberRole: membershipMock.setMemberRole,
  removeMember: membershipMock.removeMember,
  listProjectMembers: membershipMock.listProjectMembers,
  promoteToProjectAdmin: membershipMock.promoteToProjectAdmin,
  addMember: membershipMock.addMember,
}));
vi.mock('../services/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProjectBySlug: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock('../services/boardService', () => ({ getBoard: vi.fn(), UNSORTED_BUCKET_ID: '__unsorted__' }));
vi.mock('../services/ticketService', () => ({
  moveTicket: vi.fn(),
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
  createTicket: vi.fn(),
  getTicketByNumber: vi.fn(),
}));
vi.mock('../services/activityService', () => ({ getTicketActivity: vi.fn() }));
vi.mock('../services/timerService', () => ({
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  getTimeEntries: vi.fn(),
  addManualEntry: vi.fn(),
  getActiveTimer: vi.fn(),
}));
vi.mock('../services/labelService', () => ({
  getLabel: vi.fn(),
  listLabels: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));
vi.mock('../services/reportService', () => ({
  getTimeReport: vi.fn(),
  getTicketSummary: vi.fn(),
}));
vi.mock('../services/userService', () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  linkGoogleId: vi.fn(),
  createUser: vi.fn(),
  setPlatformAdmin: vi.fn(),
  setUserBlocked: vi.fn(),
  listUsers: vi.fn(),
}));
vi.mock('../services/googleOAuth', () => ({ exchangeCodeForUser: vi.fn() }));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as projectService from '../services/projectService';
import * as boardService from '../services/boardService';
import * as ticketService from '../services/ticketService';
import * as timerService from '../services/timerService';
import * as labelService from '../services/labelService';
import * as reportService from '../services/reportService';
import * as userService from '../services/userService';
import * as membershipService from '../services/membershipService';
import { exchangeCodeForUser } from '../services/googleOAuth';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedGetBySlug = vi.mocked(projectService.getProjectBySlug);

// --- Fixtures ---------------------------------------------------------------

const SLUG = 'SLYK';
const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const LABEL_ID = '00000000-0000-4000-8000-000000000000';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const projectRow = {
  id: 'p1',
  name: 'Slyk',
  slug: SLUG,
  columns: [{ id: 'c1', name: 'To Do' }],
  creatorId: 'u1',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ticketRow = {
  id: TICKET_ID,
  projectId: 'p1',
  ticketNumber: 1,
  title: 'T1',
  description: null,
  statusColumn: 'c1',
  position: 0,
  assigneeId: null,
  creatorId: 'u1',
  priority: 'MEDIUM',
  labels: [],
  checklist: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const userRow = {
  id: USER_ID,
  googleId: 'g1',
  email: 'target@example.com',
  fullName: 'Target',
  displayName: null,
  avatarUrl: null,
  isPlatformAdmin: false,
  tokenVersion: 0,
  blocked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Byte-identical non-revealing FORBIDDEN for an unknown slug vs a
// real-but-inaccessible project (anti-oracle).
const FORBIDDEN_PROJECT = new AppError(
  ErrorCode.FORBIDDEN,
  'You do not have access to this project',
);

type Tier = 'ANON' | 'MEMBER' | 'PROJECT_MEMBER' | 'PROJECT_ADMIN' | 'PLATFORM_ADMIN';
const ALL_TIERS: Tier[] = ['ANON', 'MEMBER', 'PROJECT_MEMBER', 'PROJECT_ADMIN', 'PLATFORM_ADMIN'];

function tokenFor(pa: boolean) {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa, ver: 0 });
}

// Configure the membership/gate mocks for a given tier. Called before each
// per-tier request so every middleware chain sees a consistent identity.
function applyTier(tier: Tier) {
  mockedFindVersion.mockResolvedValue(0);
  switch (tier) {
    case 'ANON':
      break; // no token sent
    case 'MEMBER':
      // Authed, pa=false, NOT a project member.
      mockedGetBySlug.mockImplementation(async () => {
        throw FORBIDDEN_PROJECT;
      });
      membershipMock.isProjectMember.mockResolvedValue(false);
      membershipMock.getMemberRole.mockResolvedValue(null);
      break;
    case 'PROJECT_MEMBER':
      mockedGetBySlug.mockResolvedValue(projectRow as never);
      membershipMock.isProjectMember.mockResolvedValue(true);
      membershipMock.getMemberRole.mockResolvedValue('MEMBER');
      break;
    case 'PROJECT_ADMIN':
      mockedGetBySlug.mockResolvedValue(projectRow as never);
      membershipMock.isProjectMember.mockResolvedValue(true);
      membershipMock.getMemberRole.mockResolvedValue('PROJECT_ADMIN');
      break;
    case 'PLATFORM_ADMIN':
      mockedGetBySlug.mockResolvedValue(projectRow as never);
      // PA bypasses the membership read; supply benign values either way.
      membershipMock.isProjectMember.mockResolvedValue(true);
      membershipMock.getMemberRole.mockResolvedValue(null);
      break;
  }
}

// Wire every handler-side service to a safe success value so an ALLOWED request
// reaches 2xx. Disallowed requests short-circuit at a gate before any of these.
function applyHandlerDefaults() {
  projectRows.rows = [projectRow];
  vi.mocked(projectService.listProjects).mockResolvedValue([]);
  vi.mocked(projectService.createProject).mockResolvedValue(projectRow as never);
  vi.mocked(projectService.updateProject).mockResolvedValue(projectRow as never);
  vi.mocked(boardService.getBoard).mockResolvedValue({} as never);
  vi.mocked(ticketService.createTicket).mockResolvedValue(ticketRow as never);
  vi.mocked(ticketService.getTicketByNumber).mockResolvedValue(ticketRow as never);
  vi.mocked(ticketService.getTicket).mockResolvedValue(ticketRow as never);
  vi.mocked(ticketService.moveTicket).mockResolvedValue(ticketRow as never);
  vi.mocked(ticketService.updateTicket).mockResolvedValue({
    old: ticketRow,
    new: ticketRow,
  } as never);
  vi.mocked(ticketService.deleteTicket).mockResolvedValue(undefined as never);
  vi.mocked(labelService.getLabel).mockResolvedValue({
    id: LABEL_ID,
    projectId: 'p1',
    name: 'Bug',
    color: '#FF0000',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  vi.mocked(labelService.listLabels).mockResolvedValue([]);
  vi.mocked(labelService.createLabel).mockResolvedValue({
    id: LABEL_ID,
    projectId: 'p1',
    name: 'Bug',
    color: '#FF0000',
  } as never);
  vi.mocked(labelService.updateLabel).mockResolvedValue({
    old: { id: LABEL_ID },
    new: { id: LABEL_ID, name: 'Bug', color: '#FF0000' },
  } as never);
  vi.mocked(labelService.deleteLabel).mockResolvedValue({ id: LABEL_ID } as never);
  vi.mocked(reportService.getTimeReport).mockResolvedValue({} as never);
  vi.mocked(reportService.getTicketSummary).mockResolvedValue({} as never);
  vi.mocked(timerService.startTimer).mockResolvedValue({ entry: {}, serverNow: 'now' } as never);
  vi.mocked(timerService.stopTimer).mockResolvedValue({} as never);
  vi.mocked(timerService.getTimeEntries).mockResolvedValue({} as never);
  vi.mocked(timerService.addManualEntry).mockResolvedValue({} as never);
  vi.mocked(timerService.getActiveTimer).mockResolvedValue(null as never);
  vi.mocked(userService.listUsers).mockResolvedValue([]);
  vi.mocked(userService.setPlatformAdmin).mockResolvedValue(userRow as never);
  vi.mocked(userService.setUserBlocked).mockResolvedValue(userRow as never);
  vi.mocked(userService.findUserById).mockResolvedValue(userRow as never);
  vi.mocked(userService.findUserByEmail).mockResolvedValue(userRow as never);
  vi.mocked(userService.linkGoogleId).mockResolvedValue(userRow as never);
  vi.mocked(userService.createUser).mockResolvedValue(userRow as never);
  vi.mocked(membershipService.listProjectMembers).mockResolvedValue([]);
  vi.mocked(membershipService.addExistingMember).mockResolvedValue({
    projectId: 'p1',
    userId: USER_ID,
    role: 'MEMBER',
    createdAt: new Date(),
  } as never);
  vi.mocked(membershipService.createAndAddMember).mockResolvedValue({
    user: { id: USER_ID, email: 'new@x.com', fullName: 'New', displayName: null, isPlatformAdmin: false },
    membership: { projectId: 'p1', userId: USER_ID, role: 'MEMBER', createdAt: new Date() },
  } as never);
  vi.mocked(membershipService.setMemberRole).mockResolvedValue(undefined);
  vi.mocked(membershipService.removeMember).mockResolvedValue(undefined);
}

// Build a supertest request for a tier (sets the Bearer header for non-ANON).
async function authed(req: request.Test, tier: Tier): Promise<request.Test> {
  if (tier === 'ANON') return req;
  const token = await tokenFor(tier === 'PLATFORM_ADMIN');
  return req.set('Authorization', `Bearer ${token}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  TEST_ENV.allowedDomain = undefined;
  applyHandlerDefaults();
});

// ---------------------------------------------------------------------------
// The route inventory — the matrix.
// ---------------------------------------------------------------------------

type Row = {
  label: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  body?: unknown;
  allowed: Tier[];
  // Success status for allowed tiers (default 2xx-any).
  successStatus?: number;
};

const MEMBER_PLUS: Tier[] = ['PROJECT_MEMBER', 'PROJECT_ADMIN', 'PLATFORM_ADMIN'];
const ADMIN_PLUS: Tier[] = ['PROJECT_ADMIN', 'PLATFORM_ADMIN'];
const PA_ONLY: Tier[] = ['PLATFORM_ADMIN'];

const ROWS: Row[] = [
  // --- Projects ---
  { label: 'POST /api/projects (create)', method: 'post', path: '/api/projects', allowed: PA_ONLY, body: { name: 'New', slug: 'NEW', columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }] }, successStatus: 201 },
  { label: 'PATCH /api/projects/:slug (rename)', method: 'patch', path: `/api/projects/${SLUG}`, allowed: PA_ONLY, body: { name: 'Renamed' } },
  { label: 'GET /api/projects/:slug', method: 'get', path: `/api/projects/${SLUG}`, allowed: MEMBER_PLUS },
  { label: 'GET /api/projects/:slug/board', method: 'get', path: `/api/projects/${SLUG}/board`, allowed: MEMBER_PLUS },
  { label: 'POST /api/projects/:slug/tickets', method: 'post', path: `/api/projects/${SLUG}/tickets`, allowed: MEMBER_PLUS, body: { title: 'T' }, successStatus: 201 },
  { label: 'GET /api/projects/:slug/tickets/:displayId', method: 'get', path: `/api/projects/${SLUG}/tickets/${SLUG}-1`, allowed: MEMBER_PLUS },

  // --- Labels ---
  { label: 'GET /api/projects/:slug/labels', method: 'get', path: `/api/projects/${SLUG}/labels`, allowed: MEMBER_PLUS },
  { label: 'POST /api/projects/:slug/labels', method: 'post', path: `/api/projects/${SLUG}/labels`, allowed: ADMIN_PLUS, body: { name: 'Bug', color: '#FF0000' }, successStatus: 201 },
  { label: 'PATCH /api/labels/:id', method: 'patch', path: `/api/labels/${LABEL_ID}`, allowed: ADMIN_PLUS, body: { name: 'Bug2' } },
  { label: 'DELETE /api/labels/:id', method: 'delete', path: `/api/labels/${LABEL_ID}`, allowed: ADMIN_PLUS },

  // --- Tickets (ticket-id scoped) ---
  { label: 'GET /api/tickets/:ticketId', method: 'get', path: `/api/tickets/${TICKET_ID}`, allowed: MEMBER_PLUS },
  { label: 'GET /api/tickets/:ticketId/activity', method: 'get', path: `/api/tickets/${TICKET_ID}/activity`, allowed: MEMBER_PLUS },
  { label: 'PATCH /api/tickets/:ticketId (move)', method: 'patch', path: `/api/tickets/${TICKET_ID}`, allowed: MEMBER_PLUS, body: { statusColumn: 'c1', position: 0 } },
  { label: 'DELETE /api/tickets/:ticketId', method: 'delete', path: `/api/tickets/${TICKET_ID}`, allowed: ADMIN_PLUS, successStatus: 204 },
  { label: 'POST /api/tickets/:ticketId/timer/start', method: 'post', path: `/api/tickets/${TICKET_ID}/timer/start`, allowed: MEMBER_PLUS },
  { label: 'POST /api/tickets/:ticketId/timer/stop', method: 'post', path: `/api/tickets/${TICKET_ID}/timer/stop`, allowed: MEMBER_PLUS },
  { label: 'GET /api/tickets/:ticketId/timer/entries', method: 'get', path: `/api/tickets/${TICKET_ID}/timer/entries`, allowed: MEMBER_PLUS },
  { label: 'POST /api/tickets/:ticketId/timer/manual', method: 'post', path: `/api/tickets/${TICKET_ID}/timer/manual`, allowed: MEMBER_PLUS, body: { minutes: 5 }, successStatus: 201 },

  // --- Users (workspace-wide) ---
  { label: 'GET /api/users', method: 'get', path: '/api/users', allowed: PA_ONLY },
  { label: 'PATCH /api/users/:userId/isPlatformAdmin', method: 'patch', path: `/api/users/${USER_ID}/isPlatformAdmin`, allowed: PA_ONLY, body: { isPlatformAdmin: true } },
  { label: 'PATCH /api/users/:userId/blocked', method: 'patch', path: `/api/users/${USER_ID}/blocked`, allowed: PA_ONLY, body: { blocked: true } },

  // --- Reports ---
  { label: 'GET /api/projects/:slug/reports/time', method: 'get', path: `/api/projects/${SLUG}/reports/time`, allowed: MEMBER_PLUS },
  { label: 'GET /api/projects/:slug/reports/tickets', method: 'get', path: `/api/projects/${SLUG}/reports/tickets`, allowed: MEMBER_PLUS },

  // --- Member management ---
  { label: 'GET /api/projects/:slug/members', method: 'get', path: `/api/projects/${SLUG}/members`, allowed: MEMBER_PLUS },
  { label: 'POST /api/projects/:slug/members (add existing)', method: 'post', path: `/api/projects/${SLUG}/members`, allowed: ADMIN_PLUS, body: { userId: USER_ID }, successStatus: 201 },
  { label: 'POST /api/projects/:slug/members/new (provision)', method: 'post', path: `/api/projects/${SLUG}/members/new`, allowed: ADMIN_PLUS, body: { email: 'new@allowed.com', fullName: 'New' }, successStatus: 201 },
  { label: 'PATCH /api/projects/:slug/members/:userId/role', method: 'patch', path: `/api/projects/${SLUG}/members/${USER_ID}/role`, allowed: ADMIN_PLUS, body: { role: 'MEMBER' } },
  { label: 'DELETE /api/projects/:slug/members/:userId', method: 'delete', path: `/api/projects/${SLUG}/members/${USER_ID}`, allowed: ADMIN_PLUS },
];

describe('permission matrix — three-tier access control', () => {
  ROWS.forEach((row) => {
    describe(row.label, () => {
      ALL_TIERS.forEach((tier) => {
        const allowed = row.allowed.includes(tier);
        it(`${tier} → ${allowed ? '2xx' : tier === 'ANON' ? '401' : '403'}`, async () => {
          applyTier(tier);
          const req = request(app)[row.method](row.path);
          if (row.body !== undefined) (req as request.Test).send(row.body as object);
          const res = await authed(req, tier);

          if (allowed) {
            // Allowed tiers must reach the handler (2xx).
            expect(
              res.status,
              `${row.label} expected 2xx for ${tier}, got ${res.status} (${res.body?.error?.code})`,
            ).toBeGreaterThanOrEqual(200);
            expect(res.status).toBeLessThan(300);
            if (row.successStatus) expect(res.status).toBe(row.successStatus);
          } else if (tier === 'ANON') {
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHENTICATED');
          } else {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
          }
        });
      });
    });
  });

  // Matrix row count surfaced for the report / regression-tripwire.
  it('matrix covers the full route inventory', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(26);
  });
});

// ---------------------------------------------------------------------------
// Non-revealing deep-equal: unknown slug vs real-but-non-member slug must be
// byte-identical (anti-oracle). Same status, same error.code, same message.
// ---------------------------------------------------------------------------

describe('non-revealing project access (anti-oracle)', () => {
  it('GET /api/projects/:slug returns IDENTICAL bodies for an unknown slug and a real-but-non-member slug', async () => {
    mockedFindVersion.mockResolvedValue(0);
    // getProjectBySlug throws the SAME non-revealing FORBIDDEN for both paths.
    mockedGetBySlug.mockImplementation(async () => {
      throw FORBIDDEN_PROJECT;
    });

    const resUnknown = await request(app)
      .get('/api/projects/DOESNOTEXIST')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    const resNonMember = await request(app)
      .get(`/api/projects/${SLUG}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    // Byte-identical: status + entire JSON body.
    expect(resUnknown.status).toBe(resNonMember.status);
    expect(resUnknown.body).toEqual(resNonMember.body);
    expect(resUnknown.status).toBe(403);
    expect(resUnknown.body.error.code).toBe('FORBIDDEN');
    expect(resUnknown.body.error.message).toBe('You do not have access to this project');
  });
});

// ---------------------------------------------------------------------------
// Login gate (auth.routes POST /google)
// ---------------------------------------------------------------------------

describe('login gate — POST /api/auth/google', () => {
  const linkedUser = {
    id: 'u1',
    googleId: 'g1',
    email: 'user@example.com',
    fullName: 'User One',
    displayName: 'Uno',
    avatarUrl: null,
    isPlatformAdmin: false,
    tokenVersion: 0,
    blocked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(exchangeCodeForUser).mockResolvedValue({
      googleId: 'g1',
      email: 'user@example.com',
      fullName: 'User One',
      avatarUrl: null,
    });
  });

  it('returns 401 UNAUTHENTICATED for an unknown email (no auto-create)', async () => {
    vi.mocked(userService.findUserByEmail).mockResolvedValue(undefined);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.message).toBe('No account for this email');
    expect(vi.mocked(userService.linkGoogleId)).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a blocked user (deactivation gate)', async () => {
    vi.mocked(userService.findUserByEmail).mockResolvedValue({ ...linkedUser, blocked: true } as never);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Account deactivated');
    expect(vi.mocked(userService.linkGoogleId)).not.toHaveBeenCalled();
  });

  it('first login links googleId and returns 200', async () => {
    vi.mocked(userService.findUserByEmail).mockResolvedValue({ ...linkedUser, googleId: null } as never);
    vi.mocked(userService.linkGoogleId).mockResolvedValue({ ...linkedUser, googleId: 'g1' } as never);
    // signJwt is real here (no jwt mock) — the route signs a real token.
    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe('user@example.com');
    expect(vi.mocked(userService.linkGoogleId)).toHaveBeenCalledWith('u1', 'g1');
  });

  it('googleId mismatch surfaces 403 FORBIDDEN "Account identity mismatch"', async () => {
    vi.mocked(userService.findUserByEmail).mockResolvedValue({ ...linkedUser, googleId: 'g-real' } as never);
    vi.mocked(userService.linkGoogleId).mockRejectedValue(
      new AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch'),
    );

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Account identity mismatch');
    expect(vi.mocked(userService.linkGoogleId)).toHaveBeenCalledWith('u1', 'g1');
  });

  it('does NOT re-check ALLOWED_DOMAIN on login for an existing off-domain user', async () => {
    TEST_ENV.allowedDomain = 'newdomain.com';
    const offdomain = { ...linkedUser, email: 'user@oldomain.com', googleId: 'g-off' };
    vi.mocked(exchangeCodeForUser).mockResolvedValue({
      googleId: 'g-off',
      email: 'user@oldomain.com',
      fullName: 'Existing',
      avatarUrl: null,
    });
    vi.mocked(userService.findUserByEmail).mockResolvedValue(offdomain as never);
    vi.mocked(userService.linkGoogleId).mockResolvedValue(offdomain as never);

    const res = await request(app).post('/api/auth/google').send({ code: 'valid' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });
});
