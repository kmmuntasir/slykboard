import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { ticketIdParam, type TicketIdParam } from './agent-chat.schema';
import * as ticketService from '../services/ticketService';
import * as pipelineViewService from '../services/pipelineViewService';

// SLYK-0280 — user-facing agent routes mounted at /api/v1/me behind
// requireAgentMode + authenticate (index.ts). Sibling /tickets/:id/messages
// and /tickets/:id/events routes land in later phases; unknown /api/v1/me/*
// sub-paths 404 through the auth chain like the internal mount.

export const agentChatRouter = Router();

// Pipeline tab payload: the ticket's job row + the last 50 events in
// timeline (asc) order. Access check via getTicketForUser (11-existing-
// patterns.md § "Existing ticket access check") — NOT_FOUND for an unknown
// ticket, non-revealing FORBIDDEN for a non-member — then 404 when the
// ticket has no pipeline row (plain-mode ticket / not queued).
agentChatRouter.get(
  '/tickets/:ticketId/pipeline',
  validateRequest({ params: ticketIdParam }),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    await ticketService.getTicketForUser(req.user!, ticketId);
    const view = await pipelineViewService.getPipelineView(ticketId);
    res.json(success(view));
  },
);
