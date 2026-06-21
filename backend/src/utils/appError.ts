import { codeToStatus, type ErrorCodeValue } from './envelope';
import { HttpStatus } from './httpStatus';

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

/**
 * Application error carrying a machine-readable `code` (from the closed
 * ErrorCode vocabulary), a safe-to-expose `message`, and optional structured
 * `details` (e.g. Zod field errors). `status` is derived from codeToStatus;
 * unknown codes fall back to 500 (defense in depth).
 *
 * Throw this from routes/middleware/services; the global errorMiddleware
 * catches it and serializes it via the error envelope.
 */
export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeValue, message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    // noUncheckedIndexedAccess: lookup is `number | undefined` → fallback 500.
    this.status = codeToStatus[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}
