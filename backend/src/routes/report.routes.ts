import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { success } from '../utils/envelope';
import * as reportService from '../services/reportService';

export const reportRouter = Router();

// F23 — per-user aggregated time report over a weekly/monthly window.
reportRouter.get('/time', authenticate, async (req, res) => {
  const period = (req.query.period === 'monthly' ? 'monthly' : 'weekly') as 'weekly' | 'monthly';
  const offsetRaw = parseInt(req.query.offset as string, 10);
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;
  const report = await reportService.getTimeReport({ period, offset });
  res.json(success(report));
});
