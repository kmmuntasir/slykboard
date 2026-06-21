// Mirror of backend envelope contract.
// Source of truth: backend/src/utils/envelope.ts:5-12 (ErrorCode vocabulary)
// and backend/src/utils/envelope.ts:28-48 (success/error body shapes).
// Add new codes here ONLY after owner sign-off on the backend side.

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface Envelope<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: unknown;
  };
}
