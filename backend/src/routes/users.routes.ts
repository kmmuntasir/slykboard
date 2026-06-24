import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { listUsers, setUserBlocked, updateUserRole } from '../services/userService';

export const usersRouter = Router();

const roleBody = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });
const blockedBody = z.object({ blocked: z.boolean() });
const userIdParams = z.object({ userId: z.string().min(1) });

// F13 T5: workspace-wide user list. Authenticated (any role). F25 expands the
// returned shape to {id, email, fullName, role, avatarUrl, blocked} so the
// admin user-management UI can render the full roster.
usersRouter.get('/', authenticate, async (_req, res) => {
  const users = await listUsers();
  res.json(success(users));
});

// F25 D6: set a user's role. ADMIN-only. Service guards the last-admin demote
// (CONFLICT) and bumps tokenVersion so outstanding JWTs reflect the new role.
usersRouter.patch(
  '/:userId/role',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ body: roleBody, params: userIdParams }),
  async (req, res) => {
    const { userId } = req.params as { userId: string };
    const updated = await updateUserRole({
      targetUserId: userId,
      newRole: req.body.role,
      actingUserId: req.user!.id,
    });
    res.json(success(updated));
  },
);

// F25 D6: activate/deactivate a user. ADMIN-only. bumpTokenVersion inside the
// service hard-expires outstanding JWTs; the auth-route login gate stops new
// sessions for blocked users.
usersRouter.patch(
  '/:userId/blocked',
  authenticate,
  requireRole('ADMIN'),
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
