import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from './validateRequest';
import { success } from '../utils/envelope';

export const pingRouter = Router();

const pingQuery = z.object({
  name: z.string().min(1).default('world'),
});

// GET /api/ping?name=<string> → { data: { message: 'pong, <name>' } }
// Proves: envelope + validateRequest + async handler (Express 5 native errors).
pingRouter.get('/ping', validateRequest({ query: pingQuery }), async (req, res): Promise<void> => {
  const { name } = req.query as z.infer<typeof pingQuery>;
  req.log?.info({ name }, 'ping');
  res.json(success({ message: `pong, ${name}` }));
});
