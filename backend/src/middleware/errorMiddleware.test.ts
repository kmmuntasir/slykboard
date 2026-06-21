import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './errorMiddleware';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { HttpStatus } from '../utils/httpStatus';

type RequestWithLog = Request & { log?: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } };

function makeReqRes() {
  const req = { log: { error: vi.fn(), warn: vi.fn() } } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('errorMiddleware', () => {
  const cases = [
    { name: 'VALIDATION_FAILED → 400', code: ErrorCode.VALIDATION_FAILED, status: HttpStatus.BAD_REQUEST },
    { name: 'UNAUTHENTICATED → 401', code: ErrorCode.UNAUTHENTICATED, status: HttpStatus.UNAUTHORIZED },
    { name: 'FORBIDDEN → 403', code: ErrorCode.FORBIDDEN, status: HttpStatus.FORBIDDEN },
    { name: 'NOT_FOUND → 404', code: ErrorCode.NOT_FOUND, status: HttpStatus.NOT_FOUND },
    { name: 'CONFLICT → 409', code: ErrorCode.CONFLICT, status: HttpStatus.CONFLICT },
    { name: 'INTERNAL_ERROR → 500', code: ErrorCode.INTERNAL_ERROR, status: HttpStatus.INTERNAL_SERVER_ERROR },
  ];

  cases.forEach(({ name, code, status }) => {
    it(name, () => {
      const { req, res, next } = makeReqRes();
      const err = new AppError(code, 'msg', { details: { x: 1 } });
      errorHandler(err, req, res, next);
      expect(res.status).toHaveBeenCalledWith(status);
      // isProd=true in test env → 5xx messages are forced to the generic string.
      const expectedMessage = status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal server error' : 'msg';
      expect(res.json).toHaveBeenCalledWith({
        error: { code, message: expectedMessage, details: { x: 1 } },
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('normalizes unknown Error to INTERNAL_ERROR 500', () => {
    const { req, res, next } = makeReqRes();
    // isProd is true in test env → message should be 'Internal server error'
    errorHandler(new Error('boom'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  it('includes details only when provided', () => {
    const { req, res, next } = makeReqRes();
    errorHandler(new AppError(ErrorCode.NOT_FOUND, 'x'), req, res, next);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'x' },
    });
  });

  it('logs 5xx at error level', () => {
    const { req, res, next } = makeReqRes();
    errorHandler(new AppError(ErrorCode.INTERNAL_ERROR, 'x'), req, res, next);
    expect((req as RequestWithLog).log!.error).toHaveBeenCalled();
  });

  it('logs 4xx at warn level', () => {
    const { req, res, next } = makeReqRes();
    errorHandler(new AppError(ErrorCode.NOT_FOUND, 'x'), req, res, next);
    expect((req as RequestWithLog).log!.warn).toHaveBeenCalled();
    expect((req as RequestWithLog).log!.error).not.toHaveBeenCalled();
  });
});
