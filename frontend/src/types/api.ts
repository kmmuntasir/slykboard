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
  // Agent-era backend codes (backend/src/utils/envelope.ts has shipped these
  // since the pipeline state machine landed). The decommission flow surfaces
  // UPSTREAM_FAILED as 502 (SLYK-0240).
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  UPSTREAM_FAILED: 'UPSTREAM_FAILED',
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
