import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole } from './requireRole';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

describe('requireRole middleware', () => {
  const tests = [
    {
      name: 'calls next when role allowed',
      user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' as const },
      roles: ['ADMIN' as const],
      expectThrow: false,
    },
    {
      name: 'throws FORBIDDEN when not allowed',
      user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' as const },
      roles: ['ADMIN' as const],
      expectThrow: true,
      expectedCode: ErrorCode.FORBIDDEN,
      messageIncludes: 'ADMIN',
    },
    {
      name: 'throws UNAUTHENTICATED when req.user absent',
      user: undefined,
      roles: ['ADMIN' as const],
      expectThrow: true,
      expectedCode: ErrorCode.UNAUTHENTICATED,
    },
    {
      name: 'allows multiple roles',
      user: { id: 'u1', email: 'a@b.com', role: 'MEMBER' as const },
      roles: ['ADMIN' as const, 'MEMBER' as const],
      expectThrow: false,
    },
  ];

  tests.forEach(({ name, user, roles, expectThrow, expectedCode, messageIncludes }) => {
    it(name, () => {
      const req = { user } as unknown as Request;
      const res = {} as Response;
      const next = vi.fn() as unknown as NextFunction;
      const middleware = requireRole(...roles);

      if (expectThrow) {
        try {
          middleware(req, res, next);
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          const e = err as AppError;
          expect(e.code).toBe(expectedCode);
          if (messageIncludes !== undefined) {
            expect(e.message).toContain(messageIncludes);
          }
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
