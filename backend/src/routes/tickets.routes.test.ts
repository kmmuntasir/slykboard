import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as ticketService from '../services/ticketService';
import * as activityService from '../services/activityService';
import { UNSORTED_BUCKET_ID } from '../services/boardService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedMoveTicket = vi.mocked(ticketService.moveTicket);
const mockedGetTicket = vi.mocked(ticketService.getTicket);
const mockedUpdateTicket = vi.mocked(ticketService.updateTicket);
const mockedDeleteTicket = vi.mocked(ticketService.deleteTicket);
const mockedGetTicketActivity = vi.mocked(activityService.getTicketActivity);

beforeEach(() => {
  vi.clearAllMocks();
});

function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa: isPlatformAdmin, ver: 0 });
}

const VALID_TICKET_ID = '11111111-1111-4111-8111-111111111111';

function makeTicketRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_TICKET_ID,
    projectId: '22222222-2222-4222-8222-222222222222',
    ticketNumber: 1,
    title: 'T1',
    description: null,
    statusColumn: 'c1',
    position: 0,
    assigneeId: null,
    creatorId: '33333333-3333-4333-8333-333333333333',
    priority: 'MEDIUM' as const,
    labels: [] as string[],
    checklist: [] as Array<{ id: string; text: string; done: boolean }>,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('PATCH /api/tickets/:ticketId (F11)', () => {
  it('200 cross-column move', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c2', position: 50 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c2', position: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data.statusColumn).toBe('c2');
    expect(res.body.data.position).toBe(50);
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c2',
      position: 50,
      actingUserId: 'u1',
    });
  });

  it('200 same-column reorder', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c1', position: 25 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c1', position: 25 });

    expect(res.status).toBe(200);
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c1',
      position: 25,
      actingUserId: 'u1',
    });
  });

  it('200 rebalance result', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c1', position: 0 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c1', position: 0 });

    expect(res.status).toBe(200);
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c1',
      position: 0,
      actingUserId: 'u1',
    });
  });

  it('404 unknown ticket', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'));

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c1', position: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 statusColumn not in columns (service-level 400)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockRejectedValue(
      new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown column', {
        details: { statusColumn: 'Unknown column' },
      }),
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'ghost', position: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedMoveTicket).toHaveBeenCalled();
  });

  it('400 statusColumn === UNSORTED_BUCKET_ID', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockRejectedValue(
      new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown column', {
        details: { statusColumn: 'Unknown column' },
      }),
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: UNSORTED_BUCKET_ID, position: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('400 non-finite position (Infinity via raw JSON body)', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .set('Content-Type', 'application/json')
      .send('{"statusColumn":"c1","position":1e400}');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('400 missing position', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('400 missing statusColumn', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ position: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('401 no Bearer', async () => {
    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .send({ statusColumn: 'c1', position: 1 });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('400 invalid uuid path param', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch('/api/tickets/not-a-uuid')
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c1', position: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });
});

describe('GET /api/tickets/:ticketId (F13)', () => {
  it('200 returns ticket with description', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicket.mockResolvedValue(
      makeTicketRow({ description: 'edit-form content' }) as unknown as Awaited<
        ReturnType<typeof ticketService.getTicket>
      >,
    );

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VALID_TICKET_ID);
    expect(res.body.data.description).toBe('edit-form content');
    expect(mockedGetTicket).toHaveBeenCalledWith(VALID_TICKET_ID);
  });

  it('404 NOT_FOUND for missing ticket', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicket.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('401 without token', async () => {
    const res = await request(app).get(`/api/tickets/${VALID_TICKET_ID}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for non-uuid param', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/tickets/not-a-uuid')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetTicket).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tickets/:ticketId attributes (F13)', () => {
  it('200 title-only update', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ title: 'T1' }),
      new: makeTicketRow({ title: 'Updated Title' }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Title');
    expect(mockedUpdateTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      patch: {
        title: 'Updated Title',
        description: undefined,
        priority: undefined,
        assigneeId: undefined,
        labelIds: undefined,
        checklist: undefined,
      },
      actingUserId: 'u1',
    });
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('200 description is sanitized in response (service strips <script>)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ description: null }),
      new: makeTicketRow({ description: 'safe content' }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ description: '<script>alert("xss")</script>safe content' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('safe content');
    // Route passes raw description through; service owns sanitization (T2 tested it).
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          description: '<script>alert("xss")</script>safe content',
        }),
      }),
    );
  });

  it('400 priority "INVALID" rejected by enum', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ priority: 'INVALID' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('200 priority "LOW" accepted', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ priority: 'MEDIUM' }),
      new: makeTicketRow({ priority: 'LOW' }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ priority: 'LOW' });

    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe('LOW');
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ priority: 'LOW' }),
      }),
    );
  });

  it('200 assigneeId null unassigns', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ assigneeId: '44444444-4444-4444-8444-444444444444' }),
      new: makeTicketRow({ assigneeId: null }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ assigneeId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.assigneeId).toBeNull();
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ assigneeId: null }),
      }),
    );
  });

  it('400 assigneeId non-uuid rejected', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ assigneeId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('400 empty body rejected by refine', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('200 move-only (statusColumn + position) preserves F11 behavior', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c2', position: 100 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ statusColumn: 'c2', position: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data.statusColumn).toBe('c2');
    expect(res.body.data.position).toBe(100);
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c2',
      position: 100,
      actingUserId: 'u1',
    });
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when updateTicket throws on missing ticket', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'));

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'X' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('200 combined attributes + move: updateTicket then moveTicket, move wins response', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ title: 'T1', statusColumn: 'c1', position: 0 }),
      new: makeTicketRow({ title: 'Updated', statusColumn: 'c1', position: 0 }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ title: 'Updated', statusColumn: 'c2', position: 50 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    );

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ title: 'Updated', statusColumn: 'c2', position: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data.statusColumn).toBe('c2');
    expect(res.body.data.title).toBe('Updated');
    expect(mockedUpdateTicket).toHaveBeenCalledTimes(1);
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c2',
      position: 50,
      actingUserId: 'u1',
    });
  });
});

describe('PATCH /api/tickets/:ticketId labelIds (F14)', () => {
  it('200 replaces the label set via updateTicket', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow(),
      new: makeTicketRow(),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({
        labelIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      });

    expect(res.status).toBe(200);
    expect(mockedUpdateTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      patch: {
        title: undefined,
        description: undefined,
        priority: undefined,
        assigneeId: undefined,
        labelIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
        checklist: undefined,
      },
      actingUserId: 'u1',
    });
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for non-uuid labelId', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ labelIds: ['not-a-uuid'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for empty labelIds array is NOT raised (empty set clears)', async () => {
    // Empty array is a valid patch (clears labels) — should reach the service.
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow(),
      new: makeTicketRow(),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ labelIds: [] });

    expect(res.status).toBe(200);
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ labelIds: [] }),
      }),
    );
  });
});

describe('PATCH /api/tickets/:ticketId checklist (F15)', () => {
  const item = { id: '11111111-1111-4111-8111-111111111111', text: 'Build it', done: false };
  const checklist = [item];

  it('200 replaces the checklist via updateTicket (member role — no admin gate, REQ-3.3)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow(),
      new: makeTicketRow({ checklist }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ checklist });

    expect(res.status).toBe(200);
    expect(res.body.data.checklist).toEqual(checklist);
    expect(mockedUpdateTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      patch: {
        title: undefined,
        description: undefined,
        priority: undefined,
        assigneeId: undefined,
        labelIds: undefined,
        checklist,
      },
      actingUserId: 'u1',
    });
    expect(mockedMoveTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for non-uuid item id', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ checklist: [{ id: 'not-a-uuid', text: 'x', done: false }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for empty item text', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({
        checklist: [{ id: '11111111-1111-4111-8111-111111111111', text: '', done: false }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for text over 200 chars', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({
        checklist: [
          { id: '11111111-1111-4111-8111-111111111111', text: 'x'.repeat(201), done: false },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for more than 50 items', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, '1')}`,
      text: `item ${i}`,
      done: false,
    }));

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ checklist: tooMany });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('400 VALIDATION_FAILED for non-boolean done', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({
        checklist: [{ id: '11111111-1111-4111-8111-111111111111', text: 'x', done: 'yes' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdateTicket).not.toHaveBeenCalled();
  });

  it('200 empty [] checklist clears all items (no min count)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow(),
      new: makeTicketRow({ checklist: [] }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>);

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ checklist: [] });

    expect(res.status).toBe(200);
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ checklist: [] }) }),
    );
  });
});

describe('DELETE /api/tickets/:ticketId (F17)', () => {
  it('204 soft-deletes ticket when ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDeleteTicket.mockResolvedValue(undefined);

    const res = await request(app)
      .delete(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(mockedDeleteTicket).toHaveBeenCalledWith(VALID_TICKET_ID);
  });

  it('401 without token', async () => {
    const res = await request(app).delete(`/api/tickets/${VALID_TICKET_ID}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedDeleteTicket).not.toHaveBeenCalled();
  });

  it('403 FORBIDDEN when MEMBER', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .delete(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedDeleteTicket).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when service throws', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDeleteTicket.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'));

    const res = await request(app)
      .delete(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 VALIDATION_FAILED for non-uuid param', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/tickets/not-a-uuid')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedDeleteTicket).not.toHaveBeenCalled();
  });
});

describe('GET /api/tickets/:ticketId/activity (F19)', () => {
  const entry = {
    id: '55555555-5555-4555-8555-555555555555',
    createdAt: '2026-01-01T00:00:00.000Z',
    actionType: 'CREATED' as const,
    actor: null,
    from: null,
    to: null,
    message: null,
  };

  it('401 without token', async () => {
    const res = await request(app).get(`/api/tickets/${VALID_TICKET_ID}/activity`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetTicketActivity).not.toHaveBeenCalled();
  });

  it('200 returns success({ entries })', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketActivity.mockResolvedValue([entry]);

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/activity`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.entries).toEqual([entry]);
    expect(mockedGetTicketActivity).toHaveBeenCalledWith(VALID_TICKET_ID);
  });

  it('404 NOT_FOUND when service throws', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedGetTicketActivity.mockRejectedValue(
      new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'),
    );

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/activity`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 VALIDATION_FAILED for non-uuid param', async () => {
    mockedFindVersion.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/tickets/not-a-uuid/activity')
      .set('Authorization', `Bearer ${await tokenFor(false)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedGetTicketActivity).not.toHaveBeenCalled();
  });
});
