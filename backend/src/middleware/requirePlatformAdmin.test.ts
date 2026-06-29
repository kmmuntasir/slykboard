import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole, requirePlatformAdmin } from './requirePlatformAdmin';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-01 Task D: the gate is now a Platform-Admin-only gate. The `requireRole`
// alias accepts and ignores legacy role args; every call site is a platform-admin
// gate until Task I (Batch 3) swaps in project-scoped gates.

describe('requirePlatformAdmin gate (Task D placeholder)', () => {
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

  it('requireRole alias ignores legacy role args and behaves as the platform-admin gate', () => {
    const req = { user: { id: 'u1', email: 'a@b.com', isPlatformAdmin: true } } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;
    // Legacy call form — args accepted and ignored.
    const middleware = requireRole('ADMIN');
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('requireRole alias throws FORBIDDEN for a non-platform-admin', () => {
    const req = {
      user: { id: 'u1', email: 'a@b.com', isPlatformAdmin: false },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;
    const middleware = requireRole('ADMIN');
    try {
      middleware(req, res, next);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe(ErrorCode.FORBIDDEN);
    }
    expect(next).not.toHaveBeenCalled();
  });
});
