import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// Agent-mode gate. Mount as the first middleware on any /api/v1/*
// agent route. Rejects with 501 when SLYKBOARD_AGENT_MODE != 'true'.
export function requireAgentMode(_req: Request, _res: Response, next: NextFunction): void {
  if (process.env.SLYKBOARD_AGENT_MODE !== 'true') {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, 'Agent mode is not enabled on this server');
  }
  next();
}
