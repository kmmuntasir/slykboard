import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';
import {
  onboardingSlugParam,
  pmReplyBody,
  ticketIdParam,
  type OnboardingSlugParam,
  type PmReplyBody,
  type TicketIdParam,
} from './agent-chat.schema';
import * as ticketService from '../services/ticketService';
import * as pipelineViewService from '../services/pipelineViewService';
import * as sseEmitter from '../services/sseEmitter';
import * as ticketAgentService from '../services/ticketAgentService';
import * as onboardingEventService from '../services/onboardingEventService';
import * as agentMessageService from '../services/agentMessageService';

// SLYK-0270/0280 — user-facing agent routes mounted at /api/v1/me behind
// requireAgentMode + authenticate (index.ts). PM browser JWTs — NOT the
// HMAC-gated internalRouter. Phase 2 appends:
//   GET  /tickets/:id/messages          → SLYK-0330
//   POST /tickets/:id/messages          → SLYK-0330

export const agentChatRouter = Router();

// Heartbeat cadence — 03-security.md risk table ("flushes proxies, keeps
// connection alive") and 09-implementation-phases.md § risk table (leak
// mitigation). Exported for the route tests' fake-timer assertions.
export const SSE_HEARTBEAT_MS = 15_000;

// Idle-connection ceiling — 09-implementation-phases.md § risk table: "server
// closes idle connections after 5 min; client auto-reconnects" via the retry
// hint, so this bounds how long an abandoned tab can pin a socket + listener.
export const SSE_IDLE_TIMEOUT_MS = 5 * 60_000;

// Path params for this router. 05-backend-routes.md spells the path param
// `:id`, but the pipeline route (SLYK-0280) uses `:ticketId` per
// agent-chat.schema.ts; validate whichever key the route declares.
const idPathParam = z.object({ id: z.uuid() });
const ticketIdPathParam = z.object({ ticketId: z.uuid() });

// GET /api/v1/me/tickets/:id/events — Server-Sent Events stream of pipeline
// activity for one ticket. Access check runs BEFORE the stream opens so
// outsiders get a plain 404 envelope, never a live channel.
agentChatRouter.get(
  '/tickets/:id/events',
  validateRequest({ params: idPathParam }),
  async (req, res) => {
    const { id } = req.params as { id: string };

    // Non-revealing 404 before headers are written: unknown ticket and
    // non-member are indistinguishable (getTicketForUser semantics).
    await ticketService.getTicketForUser({
      ticketId: id,
      userId: req.user!.id,
      isPlatformAdmin: req.user!.isPlatformAdmin,
    });

    // 11-existing-patterns.md § SSE — headers verbatim from the sketch.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable Nginx buffering if behind proxy
    });
    // Client reconnects after 5s if dropped.
    res.write('retry: 5000\n\n');

    // Heartbeat every 15s — flushes proxies, keeps connection alive.
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_HEARTBEAT_MS);

    const onEvent = (event: sseEmitter.SseEvent) => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    };
    sseEmitter.on(id, onEvent);

    // Idle close: 5 min without a client message or event ends the response;
    // EventSource reconnects via the retry hint (risk-table mitigation).
    const idleTimeout = setTimeout(() => {
      res.end();
    }, SSE_IDLE_TIMEOUT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(idleTimeout);
      sseEmitter.off(id, onEvent);
    });
  },
);

// GET /api/v1/me/tickets/:ticketId/pipeline (SLYK-0280) — Pipeline tab
// payload: the ticket's job row + the last 50 events in timeline (asc)
// order. Access check via getTicketForUser (11-existing-patterns.md §
// "Existing ticket access check") — NOT_FOUND for an unknown ticket,
// non-revealing FORBIDDEN for a non-member — then 404 when the ticket has
// no pipeline row (plain-mode ticket / not queued).
agentChatRouter.get(
  '/tickets/:ticketId/pipeline',
  validateRequest({ params: ticketIdPathParam }),
  async (req, res) => {
    const { ticketId } = req.params as { ticketId: string };
    await ticketService.getTicketForUser({
      ticketId,
      userId: req.user!.id,
      isPlatformAdmin: req.user!.isPlatformAdmin,
    });
    const view = await pipelineViewService.getPipelineView(ticketId);
    res.json(success(view));
  },
);

// SLYK-0290 — PM "Start work" (06-frontend-ui.md PipelinePanel empty state
// 'Queue for agent' button; 07-dispatcher-contract.md § queue_for_agent).
// Same access check as the pipeline read, then the SLYK-0260 transition path
// validates BACKLOG/FAILED_*/BLOCKED_HUMAN → QUEUED against the matrix
// (illegal source state → 409 CONFLICT, no job → 404) and emits the signed
// queue_for_agent webhook after the commit.
agentChatRouter.post(
  '/tickets/:ticketId/queue',
  validateRequest({ params: ticketIdParam }),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    await ticketService.getTicketForUser({
      ticketId,
      userId: req.user!.id,
      isPlatformAdmin: req.user!.isPlatformAdmin,
    });
    const job = await ticketAgentService.queueForAgent(ticketId);
    res.status(HttpStatus.OK).json(success(job));
  },
);

// SLYK-0230 — onboarding timeline for the admin project page
// (06-frontend-ui.md § Onboarding Timeline — the read endpoint the doc polls
// but 05-backend-routes.md never defined). Mounted on the /api/v1/me router
// per the ticket's layering note; in practice admin-only (the UI gates to
// platform admins, and requireAgentMode + authenticate run at the mount).
// Unknown slug → non-revealing 404 from the service.
agentChatRouter.get(
  '/projects/:slug/onboarding/events',
  validateRequest({ params: onboardingSlugParam }),
  async (req, res) => {
    const { slug } = req.params as OnboardingSlugParam;
    const view = await onboardingEventService.getOnboardingTimeline(slug);
    res.json(success(view));
  },
);

// SLYK-0330 — PM chat thread read (05-backend-routes.md § me messages routes).
// Access check first: unknown ticket and non-member get the same
// non-revealing 404 (getTicketForUser semantics — the route's license for the
// readAt write: only a project member's GET marks AGENT messages read).
// Response: { messages: [asc], ticketState } — ticketState lets the UI gate
// the input box when the agent has finished.
agentChatRouter.get(
  '/tickets/:ticketId/messages',
  validateRequest({ params: ticketIdParam }),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    await ticketService.getTicketForUser({
      ticketId,
      userId: req.user!.id,
      isPlatformAdmin: req.user!.isPlatformAdmin,
    });
    const view = await agentMessageService.getChatThread(ticketId);
    res.json(success(view));
  },
);

// SLYK-0330 — PM reply. Same access check, then the service transaction:
// listening-state check (AGENT_RUNNING|AGENT_WAITING else 409 "agent not
// listening") → PM row insert → needsPmAttention cleared → signed pm_reply
// webhook after commit. Dispatcher-down is NOT an error: 201 with
// { ...row, delivered: false } and a background retry every 30s up to 10 min
// (07-dispatcher-contract.md § failure table).
agentChatRouter.post(
  '/tickets/:ticketId/messages',
  validateRequest({ params: ticketIdParam, body: pmReplyBody }),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const { body } = req.body as PmReplyBody;
    await ticketService.getTicketForUser({
      ticketId,
      userId: req.user!.id,
      isPlatformAdmin: req.user!.isPlatformAdmin,
    });
    const { row, delivered } = await agentMessageService.postPmReply({
      ticketId,
      userId: req.user!.id,
      body,
    });
    res.status(HttpStatus.CREATED).json(success({ ...row, delivered }));
  },
);
