import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { listUsers, setPlatformAdmin, setUserBlocked } from '../services/userService';

export const usersRouter = Router();

const blockedBody = z.object({ blocked: z.boolean() });
const platformAdminBody = z.object({ isPlatformAdmin: z.boolean() });
const userIdParams = z.object({ userId: z.string().min(1) });

// SLYK-01 Task K: workspace-wide user list is Platform-Admin only. The
// three-tier shape {id, email, fullName, displayName, isPlatformAdmin,
// avatarUrl, blocked} lets the admin user-management UI render the full roster.
usersRouter.get(
  '/',
  authenticate,
  requirePlatformAdmin(),
  async (_req, res) => {
    const users = await listUsers();
    res.json(success(users));
  },
);

// SLYK-01 Task K (resolved decision): Platform-Admin promotion/demotion UI.
// Platform-Admin only. Service applies the last-platform-admin guard (CONFLICT
// 409 on demoting the last PA) and bumpTokenVersion so the new `pa` claim takes
// effect on next issue.
usersRouter.patch(
  '/:userId/isPlatformAdmin',
  authenticate,
  requirePlatformAdmin(),
  validateRequest({ body: platformAdminBody, params: userIdParams }),
  async (req, res) => {
    const { userId } = req.params as { userId: string };
    const updated = await setPlatformAdmin(userId, req.body.isPlatformAdmin);
    res.json(success(updated));
  },
);

// F25 D6: activate/deactivate a user. Platform-Admin-only. bumpTokenVersion
// inside the service hard-expires outstanding JWTs; the auth-route login gate
// stops new sessions for blocked users.
usersRouter.patch(
  '/:userId/blocked',
  authenticate,
  requirePlatformAdmin(),
  validateRequest({ body: blockedBody, params: userIdParams }),
  async (req, res) => {
    const { userId } = req.params as { userId: string };
    const updated = await setUserBlocked({
      targetUserId: userId,
      blocked: req.body.blocked,
      actingUserId: req.user!.id,
    });
    res.json(success(updated));
  },
);
