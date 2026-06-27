import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { success } from '../utils/envelope';

export const timeRouter = Router();

// F20 D4 — server clock for client clock-skew correction.
timeRouter.get('/', authenticate, (_req, res) => {
  res.json(success({ now: new Date().toISOString() }));
});
