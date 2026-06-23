import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { success } from '../utils/envelope';
import { listUsers } from '../services/userService';

export const usersRouter = Router();

// F13 T5: workspace-wide user list for the assignee picker. Minimal PII —
// {id, fullName, avatarUrl} only. Authenticated (any role).
usersRouter.get('/', authenticate, async (_req, res) => {
  const users = await listUsers();
  res.json(success(users));
});
