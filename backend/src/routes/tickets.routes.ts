import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { validateRequest } from '../middleware/validateRequest'
import { success, ErrorCode } from '../utils/envelope'
import { AppError } from '../utils/appError'
import * as ticketService from '../services/ticketService'
import * as activityService from '../services/activityService'
import * as timerService from '../services/timerService'
import { ticketIdParam, updateTicketBody, type TicketIdParam, type UpdateTicketBody } from './tickets.schema'

export const ticketsRouter = Router()

// F17 — admin-only soft delete. Returns 204 (no body).

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

// F19 — activity feed: returns enriched reverse-chrono activity log entries.
ticketsRouter.get(
    '/:ticketId/activity',
    authenticate,
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const entries = await activityService.getTicketActivity(ticketId)
        res.json(success({ entries }))
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
            body.labelIds !== undefined ||
            body.checklist !== undefined

        if (hasAttributeFields) {
            const { new: updated } = await ticketService.updateTicket({
                ticketId,
                patch: {
                    title: body.title,
                    description: body.description,
                    priority: body.priority,
                    assigneeId: body.assigneeId,
                    labelIds: body.labelIds,
                    checklist: body.checklist,
                },
                actingUserId: req.user!.id,
            })
            // If both move + attribute present, also apply move on the updated row.
            if (hasMoveFields) {
                const moved = await ticketService.moveTicket({
                    ticketId,
                    statusColumn: body.statusColumn!,
                    position: body.position!,
                    actingUserId: req.user!.id,
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
            actingUserId: req.user!.id,
        })
        res.json(success(moved))
    },
)

// F17 — admin-only soft delete: sets deletedAt, hides ticket from reads.
ticketsRouter.delete(
    '/:ticketId',
    authenticate,
    requireRole('ADMIN'),
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        await ticketService.deleteTicket(ticketId)
        res.status(204).end()
    },
)

// F20 — timer sub-resource (start/stop). Start auto-stops the user's prior
// open timer; stop allows admin to close any timer, members only their own.
ticketsRouter.post(
    '/:ticketId/timer/start',
    authenticate,
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const { entry, serverNow } = await timerService.startTimer({
            ticketId,
            userId: req.user!.id,
        })
        res.json(success({ entry, serverNow }))
    },
)

ticketsRouter.post(
    '/:ticketId/timer/stop',
    authenticate,
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const entry = await timerService.stopTimer({
            ticketId,
            userId: req.user!.id,
            isAdmin: req.user!.role === 'ADMIN',
        })
        res.json(success({ entry, serverNow: new Date().toISOString() }))
    },
)

// F20: time-tracking log — all TimeEntries for the ticket (reverse-chrono) with
// computed durations + a total of closed durations (running entry excluded).
ticketsRouter.get(
    '/:ticketId/timer/entries',
    authenticate,
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam
        const result = await timerService.getTimeEntries(ticketId)
        res.json(success(result))
    },
)
