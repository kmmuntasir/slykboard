import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { error, ErrorCode } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';
import { isProd, logger } from '../config/logger';

// Express 5 error middleware: MUST be 4-arg and registered LAST via app.use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const appErr =
    err instanceof AppError
      ? err
      : new AppError(
          ErrorCode.INTERNAL_ERROR,
          isProd
            ? 'Internal server error'
            : err instanceof Error
              ? err.message
              : 'Unknown error',
          { cause: err },
        );

  const safeMessage =
    isProd && appErr.status >= HttpStatus.INTERNAL_SERVER_ERROR
      ? 'Internal server error'
      : appErr.message;

  // pino-http attaches req.log at runtime; its ambient type isn't always loaded.
  type RequestWithLog = Request & { log?: typeof logger };
  const log = (req as RequestWithLog).log ?? logger;
  if (appErr.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    log.error({ err }, 'request failed');
  } else {
    log.warn({ err }, 'request error');
  }

  const body = error(appErr.code, safeMessage, appErr.details);
  if (!isProd && err instanceof Error && err.stack) {
    (body.error as Record<string, unknown>).stack = err.stack;
  }

  res.status(appErr.status).json(body);
}
