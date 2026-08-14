import { Router } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode, success } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';
import { validateRequest } from '../middleware/validateRequest';
import { createAgentProjectBody, decommissionProjectBody, slugParam } from './admin-agent.schema';
import * as projectOnboardingService from '../services/projectOnboardingService';

// SLYK-0150 — admin UI action routes. Mounted at /api/v1/admin behind
// requireAgentMode + authenticate + requirePlatformAdmin() (user JWT auth,
// NOT HMAC — these are browser-driven). SLYK-0190 implemented create-project
// and SLYK-0210 decommission; the remaining stub returns 501 NOT_IMPLEMENTED
// naming the phase that fills it in:
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

// Trigger dispatcher teardown for a project (SLYK-0210, destructive —
// confirmSlug gate enforced in the service after the 404 lookup). Dispatcher
// 202 → 202 with the meta row (state DECOMMISSIONING); the terminal
// DECOMMISSIONED arrives later via the onboarding-events callback
// (SLYK-0200). Dispatcher failure → UPSTREAM_FAILED 502, state stays
// DECOMMISSIONING for a manual retry (03-security.md layer 4).
adminAgentRouter.post(
  '/projects/:slug/decommission',
  validateRequest({ params: slugParam, body: decommissionProjectBody }),
  async (req, res) => {
    const { slug } = req.params as { slug: string };
    const meta = await projectOnboardingService.decommissionAgentProject({
      slug,
      body: req.body,
      initiatedBy: req.user!.id,
    });
    res.status(HttpStatus.ACCEPTED).json(success(meta));
  },
);

// Generate a dispatcher HMAC token (shown once).
adminAgentRouter.post('/agent-tokens', (_req, _res, next) => {
  next(notImplementedUntil('Phase 5'));
});
