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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
});

function tokenFor(role: 'ADMIN' | 'MEMBER') {
  return signJwt({ sub: 'u1', email: 'user@example.com', role, ver: 0 });
}

describe('projectsRouter (F08)', () => {
  it('GET / returns 200 + list of projects (authed ADMIN)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedList.mockResolvedValue([
      { id: 'p1', name: 'Slyk', slug: 'SLYK' },
      { id: 'p2', name: 'Other', slug: 'OTHER' },
    ] as unknown as Awaited<ReturnType<typeof projectService.listProjects>>);

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('GET / returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /:slug returns 200 when found', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue({
      id: 'p1',
      name: 'Slyk',
      slug: 'SLYK',
    } as unknown as Awaited<ReturnType<typeof projectService.getProjectBySlug>>);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('SLYK');
  });

  it('GET /:slug returns 404 NOT_FOUND when not found', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBySlug.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/projects/SLYK')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /:slug returns 400 VALIDATION_FAILED on invalid slug format', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/slyk')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.project.slug).toBe('SLYK');
    expect(res.body.data.columns).toHaveLength(1);
  });

  it('returns 404 NOT_FOUND when project absent', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBoard.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, "Project 'SLYK' not found"));

    const res = await request(app)
      .get('/api/projects/SLYK/board')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED on invalid slug', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/slyk/board')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
  });

  it('works for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetBoard.mockResolvedValue(
      boardPayload as unknown as Awaited<ReturnType<typeof boardService.getBoard>>,
    );

    const res = await request(app)
      .get('/api/projects/SLYK/board')
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: 'New' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED on empty title (createTicket NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreateTicket).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED on invalid priority BOGUS', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/SLYK/tickets')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: 'X', priority: 'BOGUS' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 VALIDATION_FAILED on invalid slug (lowercase slyk)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post('/api/projects/slyk/tickets')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: 'New' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ticketNumber).toBe(4);
    expect(mockedGetTicketByNumber).toHaveBeenCalledWith('SLYK', 4);
  });

  it('returns 404 NOT_FOUND on malformed displayId (getTicketByNumber NOT called)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/SLYK-abc')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedGetTicketByNumber).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when service returns null (miss)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketByNumber.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/projects/SLYK/tickets/SLYK-999')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`);

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
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
        .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
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
      .set('Authorization', `Bearer ${await tokenFor('ADMIN')}`)
      .send({
        name: 'Slykboard',
        columns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'To Do' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
