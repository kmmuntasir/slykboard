import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// SLYK-13 T15: supertest HTTP matrix for the comment routes. Mirrors the
// tickets.routes.test.ts harness — mock config/tokenVersion/db/membership/
// services so the real Express app + middleware run without a live DB. The
// commentService is mocked per the project's routes-test convention (service
// layer stubbed, not db-seeded), so activity side-effects are asserted via the
// service spy / the recordActivity mock rather than a real row.
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

vi.mock('../config', () => ({ env: TEST_ENV }));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));

// resolveTicketProject / resolveCommentProject resolve+authorize via a
// db.select(projects) + membershipService probe inside db.transaction. Stub the
// db client with a passthrough tx + a configurable project row.
const projectRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
const membershipMock = vi.hoisted(() => ({
  isProjectMember: vi.fn(),
  getMemberRole: vi.fn(),
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
}));
vi.mock('../services/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProjectBySlug: vi.fn(),
}));
vi.mock('../services/boardService', () => ({
  getBoard: vi.fn(),
  UNSORTED_BUCKET_ID: '__unsorted__',
}));
vi.mock('../services/ticketService', () => ({
  moveTicket: vi.fn(),
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
}));
vi.mock('../services/activityService', () => ({ getTicketActivity: vi.fn() }));
vi.mock('../services/timerService', () => ({
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  getTimeEntries: vi.fn(),
  addManualEntry: vi.fn(),
}));

// commentService is the SUT-seam for these routes. Stub every export the routes
// + resolvers touch. listComments/createComment/updateComment/deleteComment are
// the route entry points; getComment backs resolveCommentProject.
const commentMock = vi.hoisted(() => ({
  listComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  getComment: vi.fn(),
}));
vi.mock('../services/commentService', () => commentMock);

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as ticketService from '../services/ticketService';
import * as commentService from '../services/commentService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedGetTicket = vi.mocked(ticketService.getTicket);
const mockedListComments = vi.mocked(commentService.listComments);
const mockedCreateComment = vi.mocked(commentService.createComment);
const mockedUpdateComment = vi.mocked(commentService.updateComment);
const mockedDeleteComment = vi.mocked(commentService.deleteComment);
const mockedGetComment = vi.mocked(commentService.getComment);

const VALID_TICKET_ID = '11111111-1111-4111-8111-111111111111';
const VALID_COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const AUTHOR_ID = 'u1'; // matches the JWT sub in tokenFor()

beforeEach(() => {
  vi.clearAllMocks();
  // Default resolution state: the ticket (and thus the comment's ticket) exists
  // and belongs to a project the caller is a MEMBER of. PA-caller tests bypass
  // via isPlatformAdmin=true; PROJECT_ADMIN tests override getMemberRole.
  mockedGetTicket.mockResolvedValue(makeTicketRow() as never);
  mockedGetComment.mockResolvedValue(makeCommentRow() as never);
  membershipMock.isProjectMember.mockResolvedValue(true);
  membershipMock.getMemberRole.mockResolvedValue('MEMBER');
  projectRows.rows = [{ id: PROJECT_ID, slug: 'SLYK', name: 'Slyk', isActive: true }];
});

function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({ sub: AUTHOR_ID, email: 'user@example.com', pa: isPlatformAdmin, ver: 0 });
}

function makeTicketRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_TICKET_ID,
    projectId: PROJECT_ID,
    ticketNumber: 1,
    title: 'T1',
    description: null,
    statusColumn: 'c1',
    position: 0,
    assigneeId: null,
    creatorId: AUTHOR_ID,
    priority: 'MEDIUM' as const,
    labels: [] as string[],
    checklist: [] as Array<{ id: string; text: string; done: boolean }>,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeCommentRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_COMMENT_ID,
    ticketId: VALID_TICKET_ID,
    authorId: AUTHOR_ID,
    body: 'hello',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

// supertest serializes Date -> ISO string over JSON, so DTO fixtures carry
// string timestamps (matching res.body.data) rather than Date objects.
function makeCommentDto(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_COMMENT_ID,
    ticketId: VALID_TICKET_ID,
    body: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    edited: false,
    author: { id: AUTHOR_ID, fullName: 'Muntasir', avatarUrl: null },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// GET /api/tickets/:ticketId/comments
// ---------------------------------------------------------------------------
describe('GET /api/tickets/:ticketId/comments (SLYK-13)', () => {
  it('200 member lists comments', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const dtos = [makeCommentDto()];
    mockedListComments.mockResolvedValue(dtos as never);

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(dtos);
    expect(mockedListComments).toHaveBeenCalledWith(VALID_TICKET_ID);
  });

  it('403 non-member denied (non-revealing FORBIDDEN from the resolver)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    membershipMock.isProjectMember.mockResolvedValue(false);

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedListComments).not.toHaveBeenCalled();
  });

  it('404 missing ticket (resolver emits the only NOT_FOUND)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicket.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedListComments).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/tickets/:ticketId/comments
// ---------------------------------------------------------------------------
describe('POST /api/tickets/:ticketId/comments (SLYK-13)', () => {
  it('201 member creates a comment and returns CommentDto', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const dto = makeCommentDto({ body: 'fresh', id: 'c-new' });
    mockedCreateComment.mockResolvedValue(dto as never);

    const res = await request(app)
      .post(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'fresh' });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(dto);
    expect(mockedCreateComment).toHaveBeenCalledWith(VALID_TICKET_ID, AUTHOR_ID, 'fresh');
  });

  it('403 non-member denied', async () => {
    mockedFindVersion.mockResolvedValue(0);
    membershipMock.isProjectMember.mockResolvedValue(false);

    const res = await request(app)
      .post(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'x' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedCreateComment).not.toHaveBeenCalled();
  });

  it('404 missing ticket', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicket.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'x' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedCreateComment).not.toHaveBeenCalled();
  });

  it('404 soft-deleted ticket (anti-oracle: createComment re-checks ticketIsLive)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreateComment.mockRejectedValue(
      new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'),
    );

    const res = await request(app)
      .post(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'x' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 empty body rejected at the edge', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .post(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreateComment).not.toHaveBeenCalled();
  });

  it('400 body over 5000 chars rejected at the edge', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .post(`/api/tickets/${VALID_TICKET_ID}/comments`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'x'.repeat(5001) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreateComment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/comments/:commentId
// ---------------------------------------------------------------------------
describe('PATCH /api/comments/:commentId (SLYK-13)', () => {
  it('200 author updates and returns CommentDto', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const dto = makeCommentDto({ body: 'edited' });
    mockedUpdateComment.mockResolvedValue(dto as never);

    const res = await request(app)
      .patch(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'edited' });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(dto);
    expect(mockedUpdateComment).toHaveBeenCalledWith(VALID_COMMENT_ID, AUTHOR_ID, 'edited');
  });

  it('403 non-author (service FORBIDDEN)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateComment.mockRejectedValue(
      new AppError(ErrorCode.FORBIDDEN, 'You can only edit your own comment'),
    );

    const res = await request(app)
      .patch(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'edited' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('404 unknown comment (resolver NOT_FOUND)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetComment.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'edited' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedUpdateComment).not.toHaveBeenCalled();
  });

  it('400 empty body rejected at the edge', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateComment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/comments/:commentId
// ---------------------------------------------------------------------------
describe('DELETE /api/comments/:commentId (SLYK-13)', () => {
  it('204 author deletes', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDeleteComment.mockResolvedValue({ id: VALID_COMMENT_ID } as never);

    const res = await request(app)
      .delete(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    // isPlatformAdmin=false, projectMember=MEMBER -> Project Admin flag false.
    expect(mockedDeleteComment).toHaveBeenCalledWith(VALID_COMMENT_ID, AUTHOR_ID, false, false);
  });

  it('403 non-author non-admin (service FORBIDDEN)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDeleteComment.mockRejectedValue(
      new AppError(ErrorCode.FORBIDDEN, 'You can only delete your own comment'),
    );

    const res = await request(app)
      .delete(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('204 Platform Admin deletes (PA bypass from the JWT `pa` claim)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDeleteComment.mockResolvedValue({ id: VALID_COMMENT_ID } as never);

    const res = await request(app)
      .delete(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(204);
    // isPlatformAdmin=true forwarded from req.user.isPlatformAdmin.
    expect(mockedDeleteComment).toHaveBeenCalledWith(VALID_COMMENT_ID, AUTHOR_ID, true, false);
  });

  it('204 Project Admin deletes (resolved membership tier forwarded)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    membershipMock.getMemberRole.mockResolvedValue('PROJECT_ADMIN');
    mockedDeleteComment.mockResolvedValue({ id: VALID_COMMENT_ID } as never);

    const res = await request(app)
      .delete(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(204);
    // projectMember === 'PROJECT_ADMIN' -> the Project Admin flag is true.
    expect(mockedDeleteComment).toHaveBeenCalledWith(VALID_COMMENT_ID, AUTHOR_ID, false, true);
  });

  it('404 unknown comment (resolver NOT_FOUND)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetComment.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedDeleteComment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Activity side-effect contract: the routes are HTTP-only and delegate to the
// service. Since the service is mocked here, we assert the route passes the
// right arguments through (no body content ever reaches an activity payload at
// this layer) by spying on the edit/delete call shapes — the service test
// (commentService.test.ts) owns the deeper null oldValue/newValue assertion.
// ---------------------------------------------------------------------------
describe('comment routes activity pass-through (SLYK-13)', () => {
  it('PATCH forwards only (commentId, actorId, body) — never an activity body leak at the route', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateComment.mockResolvedValue(makeCommentDto() as never);

    await request(app)
      .patch(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ body: 'new body text' });

    expect(mockedUpdateComment).toHaveBeenCalledTimes(1);
    const [, , body] = mockedUpdateComment.mock.calls[0]!;
    expect(body).toBe('new body text');
    // The route passes exactly 3 args — the activity decision lives in the
    // service, so the route never shapes an activity payload.
    expect(mockedUpdateComment.mock.calls[0]!).toHaveLength(3);
  });

  it('DELETE forwards (commentId, actorId, isPlatformAdmin, isProjectAdmin) — no body in the call', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDeleteComment.mockResolvedValue({ id: VALID_COMMENT_ID } as never);

    await request(app)
      .delete(`/api/comments/${VALID_COMMENT_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(mockedDeleteComment).toHaveBeenCalledTimes(1);
    const args = mockedDeleteComment.mock.calls[0]!;
    expect(args).toHaveLength(4);
    expect(args[0]).toBe(VALID_COMMENT_ID);
    expect(args[1]).toBe(AUTHOR_ID);
    expect(args[2]).toBe(false); // isPlatformAdmin
    expect(args[3]).toBe(false); // isProjectAdmin
    // No comment body is passed into the delete path — content cannot leak into
    // an activity row via the route.
  });
});
