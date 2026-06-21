import { pinoHttp } from 'pino-http';
import type { Request, Response } from 'express';
import { logger, isProd } from '../config/logger';

// Serializers: lean in prod (no headers/body — D9), richer in dev for debugging.
const serializers = {
  req: (req: Request) =>
    isProd
      ? { id: req.id, method: req.method, url: req.url }
      : { id: req.id, method: req.method, url: req.url, headers: req.headers },
  res: (res: Response) => ({ statusCode: res.statusCode }),
  // responseTime is added by pino-http automatically.
};

export const requestLogger = pinoHttp({ logger, serializers });
