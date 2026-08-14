import { Router } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode, success } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';
import { validateRequest } from '../middleware/validateRequest';
import { createAgentProjectBody } from './admin-agent.schema';
import * as projectOnboardingService from '../services/projectOnboardingService';

// SLYK-0150 — admin UI action routes. Mounted at /api/v1/admin behind
// requireAgentMode + authenticate + requirePlatformAdmin() (user JWT auth,
// NOT HMAC — these are browser-driven). SLYK-0190 implements the
// create-project route; the remaining stubs return 501 NOT_IMPLEMENTED
// naming the phase that fills them in:
//   POST   /projects/:slug/decommission     → Phase 0.5 (SLYK-0330)
//   POST   /agent-tokens                    → Phase 5 (token rotation path)
// Path shapes per docs/agentic-automation/05-backend-routes.md § /api/v1/admin.
export const adminAgentRouter = Router();

function notImplementedUntil(phase: string): AppError {
  return new AppError(ErrorCode.NOT_IMPLEMENTED, `Not implemented until ${phase}`);
}

// Create a project + kick off dispatcher onboarding (SLYK-0190). Auth chain
// (requirePlatformAdmin) runs at the mount point; validateRequest strips and
// type-checks the body before the service sees it. Dispatcher 202 → 201 with
// the created project; dispatcher rejection/unreachable → UPSTREAM_FAILED 502
// after the service marks the meta FAILED.
adminAgentRouter.post(
  '/projects',
  validateRequest({ body: createAgentProjectBody }),
  async (req, res) => {
    const { project } = await projectOnboardingService.createAgentProject({
      body: req.body,
      creatorId: req.user!.id,
    });
    res.status(HttpStatus.CREATED).json(success(project));
  },
);

// Trigger dispatcher teardown for a project (destructive — confirmSlug gate).
adminAgentRouter.post('/projects/:slug/decommission', (_req, _res, next) => {
  next(notImplementedUntil('Phase 0.5'));
});

// Generate a dispatcher HMAC token (shown once).
adminAgentRouter.post('/agent-tokens', (_req, _res, next) => {
  next(notImplementedUntil('Phase 5'));
});
