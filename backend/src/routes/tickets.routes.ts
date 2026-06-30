import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireProjectAdmin } from '../middleware/requireProjectAdmin';
import { resolveTicketProject } from '../middleware/resolveProject';
import { validateRequest } from '../middleware/validateRequest';
import { success, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import * as ticketService from '../services/ticketService';
import * as activityService from '../services/activityService';
import * as timerService from '../services/timerService';
import {
  ticketIdParam,
  updateTicketBody,
  manualEntryBody,
  type TicketIdParam,
  type UpdateTicketBody,
  type ManualEntryBody,
} from './tickets.schema';
import { createCommentBody, type CreateCommentBody } from './comments.schema';
import * as commentService from '../services/commentService';

export const ticketsRouter = Router();

// F17 — admin-only soft delete. Returns 204 (no body).

// F13 — ticket detail: returns description for edit form + F16 modal.
// SLYK-01 Task K: resolveTicketProject resolves the ticket → its project →
// membership (non-revealing FORBIDDEN for non-member; NOT_FOUND only when the
// ticket row itself is absent).
ticketsRouter.get(
  '/:ticketId',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const ticket = await ticketService.getTicket(ticketId);
    if (!ticket) {
      throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`);
    }
    res.json(success(ticket));
  },
);

// F19 — activity feed: returns enriched reverse-chrono activity log entries.
ticketsRouter.get(
  '/:ticketId/activity',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const entries = await activityService.getTicketActivity(ticketId);
    res.json(success({ entries }));
  },
);

// F11 move + F13 attributes — merged PATCH. Body is a non-empty subset of
// {statusColumn, position, title, description, priority, assigneeId}.
// If any attribute field is present, run updateTicket first; if move fields
// are ALSO present, run moveTicket on the updated row (move wins the response).
// Attribute-only path returns the updated row. Move-only path preserves F11.
// SLYK-13: comment sub-resource (list + create). Member-scoped via the SAME
// resolveTicketProject middleware chain the other /:ticketId/* routes use — a
// non-member gets the byte-identical non-revealing FORBIDDEN, and a missing OR
// soft-deleted ticket surfaces as NOT_FOUND (getTicket ignores deletedAt, but
// createComment re-checks ticketIsLive so a soft-deleted ticket still 404s on
// POST). Mounted AFTER /:ticketId/activity; both are specific sub-paths so
// neither shadows the other (no catch-all precedes them).
ticketsRouter.get(
  '/:ticketId/comments',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const comments = await commentService.listComments(ticketId);
    res.json(success(comments));
  },
);

ticketsRouter.post(
  '/:ticketId/comments',
  authenticate,
  validateRequest({ params: ticketIdParam, body: createCommentBody }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const body = req.body as CreateCommentBody;
    const created = await commentService.createComment(ticketId, req.user!.id, body.body);
    res.status(201).json(success(created));
  },
);

// F11 move + F13 attributes — merged PATCH. Body is a non-empty subset of
// {statusColumn, position, title, description, priority, assigneeId}.
// If any attribute field is present, run updateTicket first; if move fields
// are ALSO present, run moveTicket on the updated row (move wins the response).
// Attribute-only path returns the updated row. Move-only path preserves F11.
ticketsRouter.patch(
  '/:ticketId',
  authenticate,
  validateRequest({ params: ticketIdParam, body: updateTicketBody }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const body = req.body as UpdateTicketBody;

    const hasMoveFields = body.statusColumn !== undefined || body.position !== undefined;
    const hasAttributeFields =
      body.title !== undefined ||
      body.description !== undefined ||
      body.priority !== undefined ||
      body.assigneeId !== undefined ||
      body.labelIds !== undefined ||
      body.checklist !== undefined;

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
      });
      // If both move + attribute present, also apply move on the updated row.
      if (hasMoveFields) {
        const moved = await ticketService.moveTicket({
          ticketId,
          statusColumn: body.statusColumn!,
          position: body.position!,
          actingUserId: req.user!.id,
        });
        res.json(success(moved));
        return;
      }
      res.json(success(updated));
      return;
    }

    // Move-only path (F11 behavior preserved).
    const moved = await ticketService.moveTicket({
      ticketId,
      statusColumn: body.statusColumn!,
      position: body.position!,
      actingUserId: req.user!.id,
    });
    res.json(success(moved));
  },
);

// F17 / SLYK-01 Task K (resolved decision): ticket soft-delete is Project Admin
// OR Platform Admin. resolveTicketProject resolves+authorizes the ticket's
// project (non-revealing FORBIDDEN for non-members); requireProjectAdmin then
// enforces the PROJECT_ADMIN/PA tier.
ticketsRouter.delete(
  '/:ticketId',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  requireProjectAdmin(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    await ticketService.deleteTicket(ticketId);
    res.status(204).end();
  },
);

// F20 — timer sub-resource (start/stop). Start auto-stops the user's prior
// open timer; stop allows admin to close any timer, members only their own.
ticketsRouter.post(
  '/:ticketId/timer/start',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    // SLYK-12: forward the full service result so autoStoppedEntry surfaces
    // (null when no prior timer was auto-stopped; the closed row otherwise).
    res.json(
      success(
        await timerService.startTimer({
          ticketId,
          userId: req.user!.id,
        }),
      ),
    );
  },
);

ticketsRouter.post(
  '/:ticketId/timer/stop',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const entry = await timerService.stopTimer({
      ticketId,
      userId: req.user!.id,
      isAdmin: req.user!.isPlatformAdmin,
    });
    res.json(success({ entry, serverNow: new Date().toISOString() }));
  },
);

// F20: time-tracking log — all TimeEntries for the ticket (reverse-chrono) with
// computed durations + a total of closed durations (running entry excluded).
ticketsRouter.get(
  '/:ticketId/timer/entries',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const result = await timerService.getTimeEntries(ticketId);
    res.json(success(result));
  },
);

// F21 §9.5: manual time entry. Creates a TimeEntries row with
// manualEntryMinutes set (no running timer). Validates minutes 1-1440 (24h cap).
ticketsRouter.post(
  '/:ticketId/timer/manual',
  authenticate,
  validateRequest({ params: ticketIdParam, body: manualEntryBody }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const body = req.body as ManualEntryBody;
    const entry = await timerService.addManualEntry({
      ticketId,
      userId: req.user!.id,
      minutes: body.minutes,
      description: body.description,
    });
    res.status(201).json(success(entry));
  },
);
