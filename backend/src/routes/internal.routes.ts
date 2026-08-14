import { Router } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0150 — dispatcher callback stubs. Mounted at /api/v1/internal behind
// requireAgentMode + agentTokenAuth (HMAC). Every handler returns 501
// NOT_IMPLEMENTED naming the phase that fills it in:
//   jobs/:ticketId/state               → Phase 1 (SLYK-0200)
//   jobs/:ticketId/messages            → Phase 2 (SLYK-0260)
//   projects/:slug/deploy-target       → Phase 0.5 (SLYK-0320)
//   projects/:slug/onboarding/events   → Phase 0.5 (SLYK-0320)
// Path shapes per docs/agentic-automation/05-backend-routes.md § /api/v1/internal.
export const internalRouter = Router();

function notImplementedUntil(phase: string): AppError {
  return new AppError(ErrorCode.NOT_IMPLEMENTED, `Not implemented until ${phase}`);
}

// Dispatcher updates pipeline state for a ticket.
internalRouter.post('/jobs/:ticketId/state', (_req, _res, next) => {
  next(notImplementedUntil('Phase 1'));
});

// Dispatcher forwards an agent utterance into the PM↔agent chat thread.
internalRouter.post('/jobs/:ticketId/messages', (_req, _res, next) => {
  next(notImplementedUntil('Phase 2'));
});

// Dispatcher reads deploy target config for a project.
internalRouter.get('/projects/:slug/deploy-target', (_req, _res, next) => {
  next(notImplementedUntil('Phase 0.5'));
});

// Dispatcher appends an onboarding lifecycle event.
internalRouter.post('/projects/:slug/onboarding/events', (_req, _res, next) => {
  next(notImplementedUntil('Phase 0.5'));
});
