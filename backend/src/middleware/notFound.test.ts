import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { notFound } from './notFound';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

describe('notFound', () => {
  it('throws AppError NOT_FOUND', () => {
    const req = { method: 'GET', path: '/api/nope' } as unknown as Request;
    expect(() => notFound(req, {} as never, {} as never)).toThrow(AppError);
  });

  it('includes method and path in the message', () => {
    const req = { method: 'POST', path: '/api/missing' } as unknown as Request;
    try {
      notFound(req, {} as never, {} as never);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ErrorCode.NOT_FOUND);
      expect((err as AppError).message).toBe('Resource not found: POST /api/missing');
    }
  });
});
