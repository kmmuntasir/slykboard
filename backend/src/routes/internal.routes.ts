import { Router } from 'express';
import { AppError } from '../utils/appError';
import { validateRequest } from '../middleware/validateRequest';
import { ErrorCode, success } from '../utils/envelope';
import {
  slugParam,
  onboardingEventBody,
  stateUpdateBody,
  ticketIdParam,
  type OnboardingEventBody,
  type StateUpdateBody,
} from './internal.schema';
import * as onboardingEventService from '../services/onboardingEventService';
import * as pipelineJobService from '../services/pipelineJobService';

// SLYK-0150 — dispatcher callbacks, mounted at /api/v1/internal behind
// requireAgentMode + agentTokenAuth (HMAC). SLYK-0200 implements the two
// onboarding endpoints; SLYK-0260 implements the job-state write. The
// remaining stub returns 501 NOT_IMPLEMENTED naming the phase that fills
// it in:
//   jobs/:ticketId/messages            → Phase 2
// Path shapes per docs/agentic-automation/05-backend-routes.md § /api/v1/internal.
export const internalRouter = Router();

function notImplementedUntil(phase: string): AppError {
  return new AppError(ErrorCode.NOT_IMPLEMENTED, `Not implemented until ${phase}`);
}

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
internalRouter.post('/jobs/:ticketId/messages', (_req, _res, next) => {
  next(notImplementedUntil('Phase 2'));
});

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
