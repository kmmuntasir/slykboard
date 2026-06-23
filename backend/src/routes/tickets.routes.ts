import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { success, ErrorCode } from '../utils/envelope'
import { AppError } from '../utils/appError'
import * as ticketService from '../services/ticketService'
import { ticketIdParam, updateTicketBody, type TicketIdParam, type UpdateTicketBody } from './tickets.schema'

export const ticketsRouter = Router()

// TODO(F17): per-column / membership-based permissions + toast-on-deny.
// F13 wires authenticate only — any authenticated user may read/update (D3).

// F13 — ticket detail: returns description for edit form + F16 modal.
ticketsRouter.get(
    '/:ticketId',
    authenticate,
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const ticket = await ticketService.getTicket(ticketId)
        if (!ticket) {
            throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`)
        }
        res.json(success(ticket))
    },
)

// F11 move + F13 attributes — merged PATCH. Body is a non-empty subset of
// {statusColumn, position, title, description, priority, assigneeId}.
// If any attribute field is present, run updateTicket first; if move fields
// are ALSO present, run moveTicket on the updated row (move wins the response).
// Attribute-only path returns the updated row. Move-only path preserves F11.
ticketsRouter.patch(
    '/:ticketId',
    authenticate,
    validateRequest({ params: ticketIdParam, body: updateTicketBody }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const body = req.body as UpdateTicketBody

        const hasMoveFields = body.statusColumn !== undefined || body.position !== undefined
        const hasAttributeFields =
            body.title !== undefined ||
            body.description !== undefined ||
            body.priority !== undefined ||
            body.assigneeId !== undefined ||
            body.labelIds !== undefined

        if (hasAttributeFields) {
            const { new: updated } = await ticketService.updateTicket({
                ticketId,
                patch: {
                    title: body.title,
                    description: body.description,
                    priority: body.priority,
                    assigneeId: body.assigneeId,
                    labelIds: body.labelIds,
                },
                actingUserId: req.user!.id,
            })
            // If both move + attribute present, also apply move on the updated row.
            if (hasMoveFields) {
                const moved = await ticketService.moveTicket({
                    ticketId,
                    statusColumn: body.statusColumn!,
                    position: body.position!,
                })
                res.json(success(moved))
                return
            }
            res.json(success(updated))
            return
        }

        // Move-only path (F11 behavior preserved).
        const moved = await ticketService.moveTicket({
            ticketId,
            statusColumn: body.statusColumn!,
            position: body.position!,
        })
        res.json(success(moved))
    },
)
