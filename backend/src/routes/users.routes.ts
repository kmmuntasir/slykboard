import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { listUsers, setUserBlocked } from '../services/userService';

export const usersRouter = Router();

const blockedBody = z.object({ blocked: z.boolean() });
const userIdParams = z.object({ userId: z.string().min(1) });

// F13 T5: workspace-wide user list. Authenticated (any role). SLYK-01 returns
// the three-tier shape {id, email, fullName, displayName, isPlatformAdmin,
// avatarUrl, blocked} so the admin user-management UI renders the full roster.
usersRouter.get('/', authenticate, async (_req, res) => {
  const users = await listUsers();
  res.json(success(users));
});

// SLYK-01 Task D: PATCH /:userId/role removed (global role enum gone). Task K
// adds PATCH /:userId/isPlatformAdmin backed by a new setPlatformAdmin service
// method.

// F25 D6: activate/deactivate a user. Platform-Admin-only. bumpTokenVersion
// inside the service hard-expires outstanding JWTs; the auth-route login gate
// stops new sessions for blocked users.
usersRouter.patch(
  '/:userId/blocked',
  authenticate,
  requireRole(),
  validateRequest({ body: blockedBody, params: userIdParams }),
  async (req, res) => {
    const { userId } = req.params as { userId: string };
    const updated = await setUserBlocked({
      targetUserId: userId,
      blocked: req.body.blocked,
    });
    res.json(success(updated));
  },
);
