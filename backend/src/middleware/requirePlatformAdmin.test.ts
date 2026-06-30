import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requirePlatformAdmin } from './requirePlatformAdmin';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-01 Task K: the requireRole compat alias/shim is deleted; every route now
// composes requirePlatformAdmin() directly. This gate is Platform-Admin only.

describe('requirePlatformAdmin gate', () => {
  const tests = [
    {
      name: 'calls next when req.user.isPlatformAdmin is true',
      user: { id: 'u1', email: 'a@b.com', isPlatformAdmin: true },
      expectThrow: false,
    },
    {
      name: 'throws FORBIDDEN when isPlatformAdmin is false',
      user: { id: 'u1', email: 'a@b.com', isPlatformAdmin: false },
      expectThrow: true,
      expectedCode: ErrorCode.FORBIDDEN,
    },
    {
      name: 'throws UNAUTHENTICATED when req.user absent',
      user: undefined,
      expectThrow: true,
      expectedCode: ErrorCode.UNAUTHENTICATED,
    },
  ];

  tests.forEach(({ name, user, expectThrow, expectedCode }) => {
    it(name, () => {
      const req = { user } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requirePlatformAdmin();

      if (expectThrow) {
        try {
          middleware(req, res, next);
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          const e = err as AppError;
          expect(e.code).toBe(expectedCode);
        }
        expect(next).not.toHaveBeenCalled();
      } else {
        middleware(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
      }
    });
  });
});
