import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// HMAC signature verification for dispatcher→slykboard requests.
// Phase 0 fills in real verification per docs/agentic-automation/03-security.md.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function agentTokenAuth(_req: Request, _res: Response, next: NextFunction): void {
  // TODO(Phase 0): real HMAC verification.
  throw new AppError(ErrorCode.UNAUTHENTICATED, 'Agent token auth not implemented');
}
