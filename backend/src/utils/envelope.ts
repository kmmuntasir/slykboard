import { HttpStatus } from './httpStatus';

// Closed error-code vocabulary (F03 spec edge case). Frontend branches on `code`.
// Add new codes here ONLY after owner sign-off — this is the contract surface.
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
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
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
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
