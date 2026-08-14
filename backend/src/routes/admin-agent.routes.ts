import { Router } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0150 — admin UI action stubs. Mounted at /api/v1/admin behind
// requireAgentMode + authenticate + requirePlatformAdmin() (user JWT auth,
// NOT HMAC — these are browser-driven). Every handler returns 501
// NOT_IMPLEMENTED naming the phase that fills it in:
//   POST   /projects                        → Phase 0.5 (SLYK-0320)
//   POST   /projects/:slug/decommission     → Phase 0.5 (SLYK-0320)
//   POST   /agent-tokens                    → Phase 5 (token rotation path)
// Path shapes per docs/agentic-automation/05-backend-routes.md § /api/v1/admin.
export const adminAgentRouter = Router();

function notImplementedUntil(phase: string): AppError {
  return new AppError(ErrorCode.NOT_IMPLEMENTED, `Not implemented until ${phase}`);
}

// Create a project + kick off dispatcher onboarding.
adminAgentRouter.post('/projects', (_req, _res, next) => {
  next(notImplementedUntil('Phase 0.5'));
});

// Trigger dispatcher teardown for a project (destructive — confirmSlug gate).
adminAgentRouter.post('/projects/:slug/decommission', (_req, _res, next) => {
  next(notImplementedUntil('Phase 0.5'));
});

// Generate a dispatcher HMAC token (shown once).
adminAgentRouter.post('/agent-tokens', (_req, _res, next) => {
  next(notImplementedUntil('Phase 5'));
});
