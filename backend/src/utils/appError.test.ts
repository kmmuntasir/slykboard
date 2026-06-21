import { describe, it, expect } from 'vitest';
import { AppError } from './appError';
import { ErrorCode } from './envelope';
import { HttpStatus } from './httpStatus';

describe('AppError', () => {
  const cases = [
    {
      name: 'VALIDATION_FAILED → 400',
      code: ErrorCode.VALIDATION_FAILED,
      expected: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'UNAUTHENTICATED → 401',
      code: ErrorCode.UNAUTHENTICATED,
      expected: HttpStatus.UNAUTHORIZED,
    },
    { name: 'FORBIDDEN → 403', code: ErrorCode.FORBIDDEN, expected: HttpStatus.FORBIDDEN },
    { name: 'NOT_FOUND → 404', code: ErrorCode.NOT_FOUND, expected: HttpStatus.NOT_FOUND },
    { name: 'CONFLICT → 409', code: ErrorCode.CONFLICT, expected: HttpStatus.CONFLICT },
    {
      name: 'INTERNAL_ERROR → 500',
      code: ErrorCode.INTERNAL_ERROR,
      expected: HttpStatus.INTERNAL_SERVER_ERROR,
    },
  ];

  cases.forEach(({ name, code, expected }) => {
    it(name, () => {
      const err = new AppError(code, 'msg');
      expect(err.code).toBe(code);
      expect(err.status).toBe(expected);
      expect(err.message).toBe('msg');
      expect(err.name).toBe('AppError');
      expect(err.details).toBeUndefined();
    });
  });

  it('carries details when provided', () => {
    const err = new AppError(ErrorCode.VALIDATION_FAILED, 'bad', { details: { x: 1 } });
    expect(err.details).toEqual({ x: 1 });
  });

  it('is an instance of Error', () => {
    expect(new AppError(ErrorCode.NOT_FOUND, 'x')).toBeInstanceOf(Error);
  });
});
