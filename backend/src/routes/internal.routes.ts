import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';
import {
  slugParam,
  onboardingEventBody,
  stateUpdateBody,
  agentMessageBody,
  ticketIdParam,
  type OnboardingEventBody,
  type StateUpdateBody,
  type AgentMessageBody,
} from './internal.schema';
import * as onboardingEventService from '../services/onboardingEventService';
import * as pipelineJobService from '../services/pipelineJobService';
import * as agentMessageService from '../services/agentMessageService';

// SLYK-0150 — dispatcher callbacks, mounted at /api/v1/internal behind
// requireAgentMode + agentTokenAuth (HMAC). SLYK-0200 implements the two
// onboarding endpoints; SLYK-0260 the job-state write; SLYK-0320 the
// agent-message forward. Path shapes per docs/agentic-automation/
// 05-backend-routes.md § /api/v1/internal.
export const internalRouter = Router();

// Dispatcher updates pipeline state for a ticket (SLYK-0260). Same-state
// re-writes are illegal self-loops per the transition matrix → 400; inbound
// dedup is the dispatcher's job (07-dispatcher-contract.md § Retry semantics).
internalRouter.post(
  '/jobs/:ticketId/state',
  validateRequest({ params: ticketIdParam, body: stateUpdateBody }),
  async (req, res) => {
    const { ticketId } = req.params as { ticketId: string };
    const job = await pipelineJobService.updateJobState({
      ticketId,
      body: req.body as StateUpdateBody,
    });
    res.json(success(job));
  },
);

// Dispatcher forwards an agent utterance into the PM↔agent chat thread.
// Idempotent on idempotencyKey (07-dispatcher-contract.md § Retry semantics):
// a replay returns 201 with the ORIGINAL row — the service decides, never
// the route. SSE `message` frame rides the SLYK-0270 per-ticket channel.
internalRouter.post(
  '/jobs/:ticketId/messages',
  validateRequest({ params: ticketIdParam, body: agentMessageBody }),
  async (req, res) => {
    const { ticketId } = req.params as { ticketId: string };
    const message = await agentMessageService.recordAgentMessage({
      ticketId,
      body: req.body as AgentMessageBody,
    });
    res.status(HttpStatus.CREATED).json(success(message));
  },
);

// Dispatcher reads deploy target config for a project.
internalRouter.get(
  '/projects/:slug/deploy-target',
  validateRequest({ params: slugParam }),
  async (req, res) => {
    const { slug } = req.params as { slug: string };
    const deployTarget = await onboardingEventService.getDeployTarget(slug);
    res.json(success(deployTarget));
  },
);

// Dispatcher appends an onboarding lifecycle event.
internalRouter.post(
  '/projects/:slug/onboarding/events',
  validateRequest({ params: slugParam, body: onboardingEventBody }),
  async (req, res) => {
    const { slug } = req.params as { slug: string };
    const event = await onboardingEventService.recordOnboardingEvent({
      slug,
      body: req.body as OnboardingEventBody,
    });
    res.json(success(event));
  },
);
