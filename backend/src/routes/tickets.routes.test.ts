import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

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
}))

vi.mock('../config', () => ({ env: TEST_ENV }))
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}))
vi.mock('../services/projectService', () => ({
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getProjectBySlug: vi.fn(),
}))
vi.mock('../services/boardService', () => ({ getBoard: vi.fn(), UNSORTED_BUCKET_ID: '__unsorted__' }))
vi.mock('../services/ticketService', () => ({
  moveTicket: vi.fn(),
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
}))

import { app } from '../index'
import { signJwt } from '../utils/jwt'
import { AppError } from '../utils/appError'
import { ErrorCode } from '../utils/envelope'
import { findUserTokenVersion } from '../services/tokenVersion'
import * as ticketService from '../services/ticketService'
import { UNSORTED_BUCKET_ID } from '../services/boardService'

const mockedFindVersion = vi.mocked(findUserTokenVersion)
const mockedMoveTicket = vi.mocked(ticketService.moveTicket)
const mockedGetTicket = vi.mocked(ticketService.getTicket)
const mockedUpdateTicket = vi.mocked(ticketService.updateTicket)

beforeEach(() => {
  vi.clearAllMocks()
})

function tokenFor(role: 'ADMIN' | 'MEMBER') {
  return signJwt({ sub: 'u1', email: 'user@example.com', role, ver: 0 })
}

const VALID_TICKET_ID = '11111111-1111-4111-8111-111111111111'

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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
}

describe('PATCH /api/tickets/:ticketId (F11)', () => {
  it('200 cross-column move', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c2', position: 50 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c2', position: 50 })

    expect(res.status).toBe(200)
    expect(res.body.data.statusColumn).toBe('c2')
    expect(res.body.data.position).toBe(50)
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c2',
      position: 50,
    })
  })

  it('200 same-column reorder', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c1', position: 25 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c1', position: 25 })

    expect(res.status).toBe(200)
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c1',
      position: 25,
    })
  })

  it('200 rebalance result', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c1', position: 0 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c1', position: 0 })

    expect(res.status).toBe(200)
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c1',
      position: 0,
    })
  })

  it('404 unknown ticket', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'))

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c1', position: 1 })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('400 statusColumn not in columns (service-level 400)', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockRejectedValue(
      new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown column', {
        details: { statusColumn: 'Unknown column' },
      }),
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'ghost', position: 1 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedMoveTicket).toHaveBeenCalled()
  })

  it('400 statusColumn === UNSORTED_BUCKET_ID', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockRejectedValue(
      new AppError(ErrorCode.VALIDATION_FAILED, 'Unknown column', {
        details: { statusColumn: 'Unknown column' },
      }),
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: UNSORTED_BUCKET_ID, position: 1 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('400 non-finite position (Infinity via raw JSON body)', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .set('Content-Type', 'application/json')
      .send('{"statusColumn":"c1","position":1e400}')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('400 missing position', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c1' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('400 missing statusColumn', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ position: 5 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('401 no Bearer', async () => {
    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .send({ statusColumn: 'c1', position: 1 })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('400 invalid uuid path param', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch('/api/tickets/not-a-uuid')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c1', position: 1 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })
})

describe('GET /api/tickets/:ticketId (F13)', () => {
  it('200 returns ticket with description', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedGetTicket.mockResolvedValue(
      makeTicketRow({ description: 'edit-form content' }) as unknown as Awaited<
        ReturnType<typeof ticketService.getTicket>
      >,
    )

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(VALID_TICKET_ID)
    expect(res.body.data.description).toBe('edit-form content')
    expect(mockedGetTicket).toHaveBeenCalledWith(VALID_TICKET_ID)
  })

  it('404 NOT_FOUND for missing ticket', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedGetTicket.mockResolvedValue(null)

    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('401 without token', async () => {
    const res = await request(app).get(`/api/tickets/${VALID_TICKET_ID}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(mockedGetTicket).not.toHaveBeenCalled()
  })

  it('400 VALIDATION_FAILED for non-uuid param', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .get('/api/tickets/not-a-uuid')
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedGetTicket).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/tickets/:ticketId attributes (F13)', () => {
  it('200 title-only update', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ title: 'T1' }),
      new: makeTicketRow({ title: 'Updated Title' }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: 'Updated Title' })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Updated Title')
    expect(mockedUpdateTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      patch: {
        title: 'Updated Title',
        description: undefined,
        priority: undefined,
        assigneeId: undefined,
      },
      actingUserId: 'u1',
    })
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('200 description is sanitized in response (service strips <script>)', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ description: null }),
      new: makeTicketRow({ description: 'safe content' }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ description: '<script>alert("xss")</script>safe content' })

    expect(res.status).toBe(200)
    expect(res.body.data.description).toBe('safe content')
    // Route passes raw description through; service owns sanitization (T2 tested it).
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          description: '<script>alert("xss")</script>safe content',
        }),
      }),
    )
  })

  it('400 priority "INVALID" rejected by enum', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ priority: 'INVALID' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedUpdateTicket).not.toHaveBeenCalled()
  })

  it('200 priority "LOW" accepted', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ priority: 'MEDIUM' }),
      new: makeTicketRow({ priority: 'LOW' }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ priority: 'LOW' })

    expect(res.status).toBe(200)
    expect(res.body.data.priority).toBe('LOW')
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ priority: 'LOW' }),
      }),
    )
  })

  it('200 assigneeId null unassigns', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ assigneeId: '44444444-4444-4444-8444-444444444444' }),
      new: makeTicketRow({ assigneeId: null }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ assigneeId: null })

    expect(res.status).toBe(200)
    expect(res.body.data.assigneeId).toBeNull()
    expect(mockedUpdateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ assigneeId: null }),
      }),
    )
  })

  it('400 assigneeId non-uuid rejected', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ assigneeId: 'not-a-uuid' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedUpdateTicket).not.toHaveBeenCalled()
  })

  it('400 empty body rejected by refine', async () => {
    mockedFindVersion.mockResolvedValue(0)

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(mockedUpdateTicket).not.toHaveBeenCalled()
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('200 move-only (statusColumn + position) preserves F11 behavior', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ statusColumn: 'c2', position: 100 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ statusColumn: 'c2', position: 100 })

    expect(res.status).toBe(200)
    expect(res.body.data.statusColumn).toBe('c2')
    expect(res.body.data.position).toBe(100)
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c2',
      position: 100,
    })
    expect(mockedUpdateTicket).not.toHaveBeenCalled()
  })

  it('404 NOT_FOUND when updateTicket throws on missing ticket', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedUpdateTicket.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Ticket not found'))

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: 'X' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(mockedMoveTicket).not.toHaveBeenCalled()
  })

  it('200 combined attributes + move: updateTicket then moveTicket, move wins response', async () => {
    mockedFindVersion.mockResolvedValue(0)
    mockedUpdateTicket.mockResolvedValue({
      old: makeTicketRow({ title: 'T1', statusColumn: 'c1', position: 0 }),
      new: makeTicketRow({ title: 'Updated', statusColumn: 'c1', position: 0 }),
    } as unknown as Awaited<ReturnType<typeof ticketService.updateTicket>>)
    mockedMoveTicket.mockResolvedValue(
      makeTicketRow({ title: 'Updated', statusColumn: 'c2', position: 50 }) as unknown as Awaited<
        ReturnType<typeof ticketService.moveTicket>
      >,
    )

    const res = await request(app)
      .patch(`/api/tickets/${VALID_TICKET_ID}`)
      .set('Authorization', `Bearer ${await tokenFor('MEMBER')}`)
      .send({ title: 'Updated', statusColumn: 'c2', position: 50 })

    expect(res.status).toBe(200)
    expect(res.body.data.statusColumn).toBe('c2')
    expect(res.body.data.title).toBe('Updated')
    expect(mockedUpdateTicket).toHaveBeenCalledTimes(1)
    expect(mockedMoveTicket).toHaveBeenCalledWith({
      ticketId: VALID_TICKET_ID,
      statusColumn: 'c2',
      position: 50,
    })
  })
})
