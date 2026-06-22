import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { success } from '../utils/envelope'
import * as ticketService from '../services/ticketService'
import { ticketIdParam, moveTicketBody, type TicketIdParam, type MoveTicketBody } from './tickets.schema'

export const ticketsRouter = Router()

// TODO(F17): add requireRole / per-column permission middleware + toast-on-deny.
// F11 wires authenticate only — any authenticated user may move (D3).
ticketsRouter.patch(
    '/:ticketId',
    authenticate,
    validateRequest({ params: ticketIdParam, body: moveTicketBody }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const { statusColumn, position } = req.body as MoveTicketBody
        const ticket = await ticketService.moveTicket({ ticketId, statusColumn, position })
        res.json(success(ticket))
    },
)
