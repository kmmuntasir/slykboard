import { beforeEach, describe, expect, it, vi } from 'vitest'

const bag = vi.hoisted(() => ({
  loadTicket: vi.fn(), // db.select().from(tickets).where().limit()
  loadProject: vi.fn(), // db.select({columns}).from(projects).where().limit()
  loadColumn: vi.fn(), // tx.select().from(tickets).where(...).orderBy()  (destination column re-read)
  loadTicketFinal: vi.fn(), // tx.select().from(tickets).where(eq(id)).limit()  (returned row)
  updateSets: [] as Array<Record<string, unknown>>, // captured .set() args in order
  txnInvoked: vi.fn(),
}))

vi.mock('../db/client', async () => {
  const { tickets, projects } = await import('../db/schema')
  const buildTxSelectChain = () => {
    const chain = {
      from: (table: unknown) => {
        if (table === tickets) {
          return { where: () => ({ orderBy: () => bag.loadColumn(), limit: () => bag.loadTicketFinal() }) }
        }
        return chain
      },
      where: () => chain,
      orderBy: () => bag.loadColumn(),
      limit: () => bag.loadTicketFinal(),
    }
    return chain
  }
  const db = {
    select: () => {
      const chain = {
        from: (table: unknown) => {
          if (table === tickets) return { where: () => ({ limit: () => bag.loadTicket() }) }
          if (table === projects) return { where: () => ({ limit: () => bag.loadProject() }) }
          return chain
        },
        where: () => chain,
        limit: () => bag.loadTicket(),
      }
      return chain
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      bag.txnInvoked()
      const tx = {
        select: () => buildTxSelectChain(),
        update: () => ({
          set: (setArg: Record<string, unknown>) => {
            bag.updateSets.push(setArg)
            return { where: () => undefined }
          },
        }),
      }
      return cb(tx)
    }),
  }
  return { db }
})

import { AppError } from '../utils/appError'
import { ErrorCode } from '../utils/envelope'
import { POSITION_GAP, POSITION_EPSILON, moveTicket } from './ticketService'
import { UNSORTED_BUCKET_ID } from './boardService'

function resetBag() {
  bag.loadTicket.mockReset()
  bag.loadProject.mockReset()
  bag.loadColumn.mockReset()
  bag.loadTicketFinal.mockReset()
  bag.updateSets.length = 0
  bag.txnInvoked.mockReset()
}

const TICKET_ID = 't1'
const PROJECT_ID = 'p1'

function makeTicket(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: TICKET_ID,
    projectId: PROJECT_ID,
    ticketNumber: 1,
    title: 'T1',
    description: null,
    statusColumn: 'c1',
    position: 10,
    assigneeId: null,
    creatorId: 'u1',
    priority: 'MEDIUM',
    labels: [] as string[],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
}

function makeColumns() {
  return [
    { id: 'c1', name: 'To Do' },
    { id: 'c2', name: 'Done' },
  ]
}

describe('ticketService moveTicket (F11)', () => {
  beforeEach(resetBag)

  it('404 NOT_FOUND when ticket absent', async () => {
    bag.loadTicket.mockResolvedValue([])

    const error = await moveTicket({ ticketId: 'missing', statusColumn: 'c1', position: 1 }).catch(
      (e) => e,
    )

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND)
    expect(bag.loadProject).not.toHaveBeenCalled()
    expect(bag.txnInvoked).not.toHaveBeenCalled()
  })

  it('404 NOT_FOUND when project row absent (defensive)', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([])

    const error = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 1 }).catch(
      (e) => e,
    )

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND)
    expect(bag.txnInvoked).not.toHaveBeenCalled()
  })

  it('400 VALIDATION_FAILED when statusColumn not in columns', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }])

    const error = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'ghost', position: 1 }).catch(
      (e) => e,
    )

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED)
    expect(((error as AppError).details as Record<string, unknown>).statusColumn).toBe(
      'Unknown column',
    )
    expect(bag.txnInvoked).not.toHaveBeenCalled()
  })

  it('400 VALIDATION_FAILED when statusColumn === UNSORTED_BUCKET_ID', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }])

    const error = await moveTicket({
      ticketId: TICKET_ID,
      statusColumn: UNSORTED_BUCKET_ID,
      position: 1,
    }).catch((e) => e)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED)
    expect(bag.txnInvoked).not.toHaveBeenCalled()
  })

  it('happy path writes statusColumn + position + updatedAt in ONE txn, no rebalance', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }])
    // healthy gap (65536) between t1 and t2
    bag.loadColumn.mockResolvedValue([
      { id: 't1', position: 0 },
      { id: 't2', position: 65536 },
    ])
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ statusColumn: 'c2', position: 50 })])

    const result = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c2', position: 50 })

    expect(bag.txnInvoked).toHaveBeenCalledTimes(1)
    expect(bag.updateSets.length).toBe(1)
    expect(bag.updateSets[0]!.statusColumn).toBe('c2')
    expect(bag.updateSets[0]!.position).toBe(50)
    expect(bag.updateSets[0]!.updatedAt).toBeInstanceOf(Date)
    expect(bag.loadColumn).toHaveBeenCalled()
    expect(result.statusColumn).toBe('c2')
    expect(result.position).toBe(50)
  })

  it('rebalance triggers when gap < EPSILON → whole column re-numbered index*GAP in same txn', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }])
    // gap = 1e-7 < 1e-6 EPSILON → rebalance
    bag.loadColumn.mockResolvedValue([
      { id: 't1', position: 0 },
      { id: 't2', position: POSITION_EPSILON / 10 },
    ])
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ position: 0 })])

    await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 0 })

    expect(bag.txnInvoked).toHaveBeenCalledTimes(1)
    expect(bag.updateSets.length).toBe(3) // 1 main + 2 rebalance
    expect(bag.updateSets[1]!.position).toBe(0) // index 0 * GAP
    expect(bag.updateSets[2]!.position).toBe(POSITION_GAP) // index 1 * GAP
  })

  it('no rebalance when gap healthy (asserted via updateSets.length === 1)', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }])
    bag.loadColumn.mockResolvedValue([
      { id: 't1', position: 0 },
      { id: 't2', position: 65536 },
    ])
    bag.loadTicketFinal.mockResolvedValue([makeTicket({ statusColumn: 'c1', position: 5 })])

    await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 5 })

    expect(bag.updateSets.length).toBe(1)
  })

  it('atomicity: mid-txn failure propagates', async () => {
    bag.loadTicket.mockResolvedValue([makeTicket()])
    bag.loadProject.mockResolvedValue([{ columns: makeColumns() }])
    bag.loadColumn.mockRejectedValue(new Error('boom'))

    const error = await moveTicket({ ticketId: TICKET_ID, statusColumn: 'c1', position: 0 }).catch(
      (e) => e,
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('boom')
    expect(bag.txnInvoked).toHaveBeenCalledTimes(1)
  })

  it('POSITION_GAP / POSITION_EPSILON exported as numbers', () => {
    expect(typeof POSITION_GAP).toBe('number')
    expect(POSITION_GAP).toBe(65536)
    expect(POSITION_EPSILON).toBe(1e-6)
  })
})
