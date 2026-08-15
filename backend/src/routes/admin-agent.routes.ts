import { Router } from 'express';
import { success } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';
import { validateRequest } from '../middleware/validateRequest';
import {
  agentTokenBody,
  agentTokenParam,
  createAgentProjectBody,
  decommissionProjectBody,
  slugParam,
} from './admin-agent.schema';
import * as projectOnboardingService from '../services/projectOnboardingService';
import * as agentTokenService from '../services/agentTokenService';

// SLYK-0150 — admin UI action routes. Mounted at /api/v1/admin behind
// requireAgentMode + authenticate + requirePlatformAdmin() (user JWT auth,
// NOT HMAC — these are browser-driven). SLYK-0190 implemented create-project,
// SLYK-0210 decommission, SLYK-0370 the agent-token trio (generate shown
// once / revoke / list — no hashes ever leave the DB).
// Path shapes per docs/agentic-automation/05-backend-routes.md § /api/v1/admin.
export const adminAgentRouter = Router();

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

// Generate a dispatcher HMAC token (SLYK-0370). 201 with the RAW token
// exactly once — only sha256(raw) is stored, so this response is the last
// time the value exists server-side. Never log the response body.
adminAgentRouter.post(
  '/agent-tokens',
  validateRequest({ body: agentTokenBody }),
  async (req, res) => {
    const generated = await agentTokenService.createAgentToken({
      body: req.body,
      createdBy: req.user!.id,
    });
    res.status(HttpStatus.CREATED).json(success(generated));
  },
);

// Revoke a token (SLYK-0370) — revokedAt flip only; the row + its hash stay
// for audit. 204 No Content per doc; 404 unknown id, 409 already revoked
// come from the service. Revocation takes effect on the next inbound
// candidate query (agentTokenAuth excludes revoked rows).
adminAgentRouter.delete(
  '/agent-tokens/:id',
  validateRequest({ params: agentTokenParam }),
  async (req, res) => {
    const { id } = req.params as { id: string };
    await agentTokenService.revokeAgentToken(id);
    res.status(HttpStatus.NO_CONTENT).send();
  },
);

// List tokens (SLYK-0370 — doc gap: 05 omits the list endpoint but the
// /admin/tokens page in 06/09 requires it). Revoked rows included (the UI
// renders revoke state); the service projection has no hash field at all.
adminAgentRouter.get('/agent-tokens', async (_req, res) => {
  const tokens = await agentTokenService.listAgentTokens();
  res.json(success(tokens));
});
