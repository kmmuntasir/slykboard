import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { success } from '../utils/envelope';
import * as timerService from '../services/timerService';

export const timerRouter = Router();

// F20 — current user's global open timer (null if none).
timerRouter.get('/active', authenticate, async (req, res) => {
    const activeTimer = await timerService.getActiveTimer(req.user!.id);
    res.json(success({ activeTimer }));
});
