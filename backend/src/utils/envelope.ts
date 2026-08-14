import { HttpStatus } from './httpStatus';

// Closed error-code vocabulary (F03 spec edge case). Frontend branches on `code`.
// Add new codes here ONLY after owner sign-off — this is the contract surface.
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // SLYK-0260 — dispatcher state-write contract (05-backend-routes.md § error
  // envelope names this code verbatim; owner sign-off recorded on the ticket).
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  // SLYK-0190: the dispatcher rejected or could not be reached — slykboard
  // itself is healthy but onboarding cannot proceed (502 per
  // 05-backend-routes.md § POST /api/v1/admin/projects behavior 4).
  UPSTREAM_FAILED: 'UPSTREAM_FAILED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// Single source of truth: code → HTTP status. noUncheckedIndexedAccess makes
// lookup return `number | undefined`; callers MUST fall back to 500.
export const codeToStatus: Readonly<Record<ErrorCodeValue, number>> = Object.freeze({
  [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.INVALID_STATE_TRANSITION]: HttpStatus.BAD_REQUEST,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.NOT_IMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
  [ErrorCode.UPSTREAM_FAILED]: HttpStatus.BAD_GATEWAY,
});

// Success body: { data }. data may be a resource, array, null, or scalar.
export function success<T>(data: T): { data: T } {
  return { data };
}

// Error body: { error: { code, message, details? } }. message is human-readable
// and safe to expose; details is structured (e.g. Zod field errors).
export interface ErrorEnvelope {
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: unknown;
  };
}

export function error(code: ErrorCodeValue, message: string, details?: unknown): ErrorEnvelope {
  const body: ErrorEnvelope = { error: { code, message } };
  if (details !== undefined) {
    body.error.details = details;
  }
  return body;
}
