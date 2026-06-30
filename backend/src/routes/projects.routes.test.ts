import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

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
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));
// requireProjectMember imports getProjectBySlug from projectService and reads
// the tier via membershipService.getMemberRole inside db.transaction. Mock the
// db client (passthrough tx) + membershipService so the real middleware runs
// without a live DB.
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
vi.mock('../services/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProjectBySlug: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock('../services/boardService', () => ({
  getBoard: vi.fn(),
}));
vi.mock('../services/ticketService', () => ({
  createTicket: vi.fn(),
  getTicketByNumber: vi.fn(),
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as projectService from '../services/projectService';
import * as boardService from '../services/boardService';
import * as ticketService from '../services/ticketService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedCreate = vi.mocked(projectService.createProject);
const mockedList = vi.mocked(projectService.listProjects);
const mockedGetBySlug = vi.mocked(projectService.getProjectBySlug);
const mockedUpdate = vi.mocked(projectService.updateProject);
const mockedGetBoard = vi.mocked(boardService.getBoard);
const mockedCreateTicket = vi.mocked(ticketService.createTicket);
const mockedGetTicketByNumber = vi.mocked(ticketService.getTicketByNumber);

// A full ProjectRow shape (enough for requireProjectMember to attach).
const projectRow = {
  id: 'p1',
  name: 'Slyk',
  slug: 'SLYK',
  columns: [{ id: 'c1', name: 'To Do' }],
  creatorId: 'u1',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Byte-identical non-revealing FORBIDDEN for not-found vs not-a-member.
const FORBIDDEN_PROJECT = new AppError(
  ErrorCode.FORBIDDEN,
  'You do not have access to this project',
);

beforeEach(() => {
  vi.clearAllMocks();
  // Default membership state: the caller is a real MEMBER of the resolved
  // project. PA-caller tests bypass membership via isPlatformAdmin=true;
  // non-member / unknown-slug tests override getProjectBySlug to reject with
  // the non-revealing FORBIDDEN (the service contract makes the two identical).
  membershipMock.getMemberRole.mockResolvedValue('MEMBER');
  mockedGetBySlug.mockResolvedValue(projectRow as never);
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
});

function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa: isPlatformAdmin, ver: 0 });
}

describe('projectsRouter (F08)', () => {
  it('GET / returns 200 + list of projects (authed ADMIN/PA)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedList.mockResolvedValue([
      { id: 'p1', name: 'Slyk', slug: 'SLYK' },
      { id: 'p2', name: 'Other', slug: 'OTHER' },
    ] as unknown as Awaited<ReturnType<typeof projectService.listProjects>>);

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    // SLYK-01 Task K: visibility args forwarded to the service.
    expect(mockedList).toHaveBeenCalledWith('u1', true);
  });

  it('GET / returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /:slug returns 200 + project for a member (reads req.project)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('SLYK');
    // requireProjectMember resolved+authorized via the non-revealing service call.
    expect(mockedGetBySlug).toHaveBeenCalledWith('SLYK', 'u1', false);
  });

  it('GET /:slug returns 403 FORBIDDEN for a non-member (non-revealing)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('You do not have access to this project');
  });

  it('GET /:slug returns 403 FORBIDDEN for an unknown slug (anti-oracle; no 404 leak)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('GET /:slug non-revealing: unknown slug and non-member return byte-identical envelopes', async () => {
    // Two separate requests: one where the slug is unknown, one where the slug is
    // real but the caller is not a member. Both go through the same non-revealing
    // service contract and MUST return identical JSON bodies.
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const unknown = await request(app)
      .get('/api/projects/GHOST')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    const nonMember = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(unknown.status).toBe(403);
    expect(nonMember.status).toBe(403);
    expect(unknown.body).toEqual(nonMember.body);
  });

  it('GET /:slug PA bypass returns 200 even without a membership row', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    // PA bypass: getMemberRole is never read.
    expect(membershipMock.getMemberRole).not.toHaveBeenCalled();
    expect(mockedGetBySlug).toHaveBeenCalledWith('SLYK', 'u1', true);
  });

  it('GET /:slug returns 400 VALIDATION_FAILED on invalid slug format', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/slyk')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetBySlug).not.toHaveBeenCalled();
  });

  it('POST / returns 201 + created project (ADMIN)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreate.mockResolvedValue({
      id: 'p1',
      name: 'Slyk',
      slug: 'SLYK',
      columns: [{ id: 'c1', name: 'To Do' }],
      creatorId: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Awaited<ReturnType<typeof projectService.createProject>>);

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'Slyk', slug: 'slyk' });

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('SLYK');
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ creatorId: 'u1', name: 'Slyk', slug: 'slyk' }),
    );
  });

  it('POST / returns 403 FORBIDDEN for MEMBER', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ name: 'Slyk', slug: 'slyk' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('POST / returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).post('/api/projects').send({ name: 'Slyk', slug: 'slyk' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('POST / returns 400 VALIDATION_FAILED on invalid body', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('POST / propagates CONFLICT (409) from service on duplicate slug', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreate.mockRejectedValue(
      new AppError(ErrorCode.CONFLICT, 'Project slug SLYK already exists', {
        details: { slug: 'SLYK' },
      }),
    );

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'Slyk', slug: 'slyk' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('GET /:slug/board (F09)', () => {
  const boardPayload = {
    project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
    columns: [{ id: 'c1', name: 'To Do', isUnsorted: false, tickets: [] }],
  };

  it('returns 200 + board payload (authed)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBoard.mockResolvedValue(
      boardPayload as unknown as Awaited<ReturnType<typeof boardService.getBoard>>,
    );

    const res = await request(app)
      .get('/api/projects/SLYK/board')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.project.slug).toBe('SLYK');
    expect(res.body.data.columns).toHaveLength(1);
  });

  it('returns 404 NOT_FOUND when project absent', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBoard.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, "Project 'SLYK' not found"));

    const res = await request(app)
      .get('/api/projects/SLYK/board')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED on invalid slug', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/slyk/board')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetBoard).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).get('/api/projects/SLYK/board');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetBoard).not.toHaveBeenCalled();
  });

  it('works for MEMBER (no role gate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBoard.mockResolvedValue(
      boardPayload as unknown as Awaited<ReturnType<typeof boardService.getBoard>>,
    );

    const res = await request(app)
      .get('/api/projects/SLYK/board')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
  });

  it('works for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBoard.mockResolvedValue(
      boardPayload as unknown as Awaited<ReturnType<typeof boardService.getBoard>>,
    );

    const res = await request(app)
      .get('/api/projects/SLYK/board')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /:slug/tickets (F12)', () => {
  const ticketPayload = {
    id: 't1',
    ticketNumber: 1,
    title: 'New',
    statusColumn: 'c1',
    position: 65536,
    creatorId: 'u1',
  };

  it('returns 201 + ticket (authed MEMBER)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockResolvedValue(
      ticketPayload as unknown as Awaited<ReturnType<typeof ticketService.createTicket>>,
    );
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticketNumber).toBe(1);
    expect(res.body.data.title).toBe('New');
  });

  it('sets creatorId from req.user.id', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockResolvedValue(
      ticketPayload as unknown as Awaited<ReturnType<typeof ticketService.createTicket>>,
    );
    await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New' });
    expect(mockedCreateTicket).toHaveBeenCalledWith({
      slug: 'SLYK',
      creatorId: 'u1',
      title: 'New',
    });
  });

  it('returns 404 NOT_FOUND on unknown slug (service throws)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockRejectedValue(
      new AppError(ErrorCode.NOT_FOUND, "Project 'BAD' not found"),
    );
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED on empty title (createTicket NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreateTicket).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on invalid priority BOGUS', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'X', priority: 'BOGUS' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 VALIDATION_FAILED on invalid slug (lowercase slyk)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/slyk/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 401 UNAUTHENTICATED without Bearer (createTicket NOT called)', async () => {
    const res = await request(app).post('/api/projects/SLYK/tickets').send({ title: 'New' });
    expect(res.status).toBe(401);
    expect(mockedCreateTicket).not.toHaveBeenCalled();
  });

  it('works for MEMBER (201) — proves not admin-gated (REQ-3.3)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockResolvedValue(
      ticketPayload as unknown as Awaited<ReturnType<typeof ticketService.createTicket>>,
    );
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New' });
    expect(res.status).toBe(201);
  });

  it('works for ADMIN (201)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockResolvedValue(
      ticketPayload as unknown as Awaited<ReturnType<typeof ticketService.createTicket>>,
    );
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ title: 'New' });
    expect(res.status).toBe(201);
  });

  it('returns 409 CONFLICT when project has no columns (service throws)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockRejectedValue(
      new AppError(ErrorCode.CONFLICT, "Project 'SLYK' has no columns"),
    );
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  // T1: dueDate on create flows through to createTicket.
  it('passes dueDate through to createTicket (ISO datetime)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockResolvedValue(
      ticketPayload as unknown as Awaited<ReturnType<typeof ticketService.createTicket>>,
    );
    const due = '2026-12-31T23:59:59.000Z';
    await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New', dueDate: due });
    expect(mockedCreateTicket).toHaveBeenCalledWith({
      slug: 'SLYK',
      creatorId: 'u1',
      title: 'New',
      dueDate: due,
    });
  });

  it('passes dueDate: null through to createTicket (no due date)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateTicket.mockResolvedValue(
      ticketPayload as unknown as Awaited<ReturnType<typeof ticketService.createTicket>>,
    );
    await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New', dueDate: null });
    expect(mockedCreateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: null }),
    );
  });

  it('returns 400 VALIDATION_FAILED for non-ISO dueDate (createTicket NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'New', dueDate: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreateTicket).not.toHaveBeenCalled();
  });
});

describe('GET /:slug/tickets/:displayId (F30)', () => {
  const hydratedTicketPayload = {
    id: 't1',
    projectId: 'p1',
    ticketNumber: 4,
    title: 'Readable URLs',
    statusColumn: 'c1',
    position: 65536,
    creatorId: 'u1',
    priority: 'MEDIUM',
    description: null,
    assigneeId: null,
    checklist: [],
    labels: [],
    creator: { id: 'u1', fullName: 'User One', avatarUrl: null },
    assignee: null,
  };

  it('returns 200 + ticket when found (authed MEMBER)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketByNumber.mockResolvedValue(
      hydratedTicketPayload as unknown as Awaited<
        ReturnType<typeof ticketService.getTicketByNumber>
      >,
    );

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/SLYK-4')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ticketNumber).toBe(4);
    expect(mockedGetTicketByNumber).toHaveBeenCalledWith('SLYK', 4);
  });

  it('returns 404 NOT_FOUND on malformed displayId (getTicketByNumber NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/SLYK-abc')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetTicketByNumber).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when service returns null (miss)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketByNumber.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/SLYK-999')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetTicketByNumber).toHaveBeenCalledWith('SLYK', 999);
  });

  it('returns 401 UNAUTHENTICATED without Bearer (getTicketByNumber NOT called)', async () => {
    const res = await request(app).get('/api/projects/SLYK/tickets/SLYK-4');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTicketByNumber).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND on prefix mismatch (getTicketByNumber NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/PX-4')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetTicketByNumber).not.toHaveBeenCalled();
  });

  it('strips leading zeros and queries number 4 for SLYK-004', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketByNumber.mockResolvedValue(
      hydratedTicketPayload as unknown as Awaited<
        ReturnType<typeof ticketService.getTicketByNumber>
      >,
    );

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/SLYK-004')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(mockedGetTicketByNumber).toHaveBeenCalledWith('SLYK', 4);
  });
});

describe('PATCH /api/projects/:slug (F27)', () => {
  const updatedProjectRow = {
    id: 'p1',
    name: 'Slykboard',
    slug: 'SLYK',
    columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('returns 403 FORBIDDEN for MEMBER (updateProject NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({
        name: 'Slykboard',
        columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 + updated project for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdate.mockResolvedValue(
      updatedProjectRow as unknown as Awaited<ReturnType<typeof projectService.updateProject>>,
    );

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({
        name: 'Slykboard',
        columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('SLYK');
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'SLYK',
        name: 'Slykboard',
        columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
      }),
    );
  });

  const malformedBodies: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: 'empty name string', body: { name: '' } },
    {
      name: 'column with empty name',
      body: { columns: [{ id: '11111111-1111-4111-8111-111111111111', name: '' }] },
    },
    {
      name: 'column missing id',
      body: { columns: [{ name: 'To Do' }] },
    },
    { name: 'columns array empty', body: { columns: [] } },
    { name: 'non-string name', body: { name: 123 } },
  ];

  malformedBodies.forEach(({ name, body }) => {
    it(`returns 400 VALIDATION_FAILED on malformed body — ${name}`, async () => {
      mockedFindVersion.mockResolvedValue(0);

      const res = await request(app)
        .patch('/api/projects/SLYK')
        .set('Authorization', `Bearer ${await tokenFor(true)}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });

  it('returns 401 UNAUTHENTICATED without Bearer (updateProject NOT called)', async () => {
    const res = await request(app)
      .patch('/api/projects/SLYK')
      .send({
        name: 'Slykboard',
        columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on duplicate column ids (updateProject NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({
        columns: [
          { id: '11111111-1111-4111-8111-111111111111', name: 'To Do' },
          { id: '11111111-1111-4111-8111-111111111111', name: 'Done' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on lowercase slug (updateProject NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/projects/slyk')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({
        name: 'Slykboard',
        columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  // ---- SLYK-04 / DEL-04: activation flag (isActive) on PATCH /:slug ----
  //
  // Authorization contract: requirePlatformAdmin guards the whole stack, so a
  // non-PA Member OR Project-Admin attempting to flip isActive is rejected with
  // 403 from the middleware BEFORE updateProject is called — the membership tier
  // the caller holds (MEMBER vs PROJECT_ADMIN) is irrelevant; only the PA bit
  // grants the write. Validation: isActive must be a real boolean — a string
  // 'true' is rejected by the Zod schema (400). The deep-link deny test pins
  // the non-revealing contract: a non-PA hitting a DEACTIVATED project's deep
  // link gets a 403 byte-identical to the non-member FORBIDDEN body; a PA
  // still reaches the deactivated row; reactivating restores the non-PA deep
  // link to 200.

  it('returns 200 + updated project for ADMIN patching isActive:false (deactivate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const deactivatedRow = { ...updatedProjectRow, isActive: false };
    mockedUpdate.mockResolvedValue(
      deactivatedRow as unknown as Awaited<ReturnType<typeof projectService.updateProject>>,
    );

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'SLYK', isActive: false }),
    );
  });

  it('returns 200 + updated project for ADMIN patching isActive:true (reactivate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const reactivatedRow = { ...updatedProjectRow, isActive: true };
    mockedUpdate.mockResolvedValue(
      reactivatedRow as unknown as Awaited<ReturnType<typeof projectService.updateProject>>,
    );

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
    expect(mockedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'SLYK', isActive: true }),
    );
  });

  it('returns 403 FORBIDDEN for MEMBER patching isActive (updateProject NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ isActive: false });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for a Project-Admin patching isActive (updateProject NOT called)', async () => {
    // requirePlatformAdmin keys off the JWT's PA bit, NOT the project_members
    // tier. A PROJECT_ADMIN is still a non-PA, so the middleware denies before
    // the service is reached.
    mockedFindVersion.mockResolvedValue(0);
    membershipMock.getMemberRole.mockResolvedValue('PROJECT_ADMIN');

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ isActive: false });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED when isActive is a string "true" (updateProject NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ isActive: 'true' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('deep-link deny: a DEACTIVATED project non-PA deep-link 403 is byte-identical to the non-member 403', async () => {
    // The non-revealing contract: a non-PA hitting a deactivated project must
    // get the same FORBIDDEN body as a non-member hitting any project. Both go
    // through the same service throw, so the envelopes must be deep-equal.
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);

    const deactivated = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    const nonMember = await request(app)
      .get('/api/projects/GHOST')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(deactivated.status).toBe(403);
    expect(nonMember.status).toBe(403);
    // Byte-identical assertion: deep-equal on the full response body.
    expect(deactivated.body).toEqual(nonMember.body);
    // And the literal message matches the contract.
    expect(deactivated.body.error.message).toBe('You do not have access to this project');
  });

  it('PA still reaches a DEACTIVATED project row (deep-link 200)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const deactivatedRow = { ...projectRow, isActive: false };
    mockedGetBySlug.mockResolvedValue(deactivatedRow as never);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(mockedGetBySlug).toHaveBeenCalledWith('SLYK', 'u1', true);
  });

  it('reactivating restores a previously-denying non-PA deep link to 200', async () => {
    // Phase 1: project is deactivated → non-PA deep link is denied (403).
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockRejectedValue(FORBIDDEN_PROJECT);
    const denied = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    expect(denied.status).toBe(403);

    // Phase 2: project reactivated (isActive:true) → the same non-PA member's
    // deep link now resolves (200). The service contract re-admits a member
    // once the row is active again.
    mockedGetBySlug.mockResolvedValue({ ...projectRow, isActive: true } as never);
    const restored = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.isActive).toBe(true);
  });
});
