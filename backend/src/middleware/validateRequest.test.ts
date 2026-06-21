import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateRequest } from './validateRequest';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

describe('validateRequest', () => {
  it('passes and overwrites body with parsed value on success', () => {
    const next = vi.fn() as unknown as NextFunction;
    const mw = validateRequest(z.object({ name: z.string() }));
    const req = makeReq({ body: { name: 'ok', extra: 'stripped' } } as Partial<Request>);
    mw(req, {} as Response, next);
    expect(next).toHaveBeenCalled();
    expect((req.body as { name: string }).name).toBe('ok');
    expect((req.body as { extra?: string }).extra).toBeUndefined(); // stripped
  });

  it('throws VALIDATION_FAILED on bad body', () => {
    const next = vi.fn() as unknown as NextFunction;
    const mw = validateRequest(z.object({ name: z.string() }));
    const req = makeReq({ body: { name: 123 } } as Partial<Request>);
    expect(() => mw(req, {} as Response, next)).toThrow(AppError);
    try {
      mw(req, {} as Response, next);
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(e.status).toBe(400);
      expect(e.details).toMatchObject({
        source: 'body',
        issues: { formErrors: [], fieldErrors: { name: expect.any(Array) } },
      });
    }
  });

  it('validates query via { query } partial', () => {
    const next = vi.fn() as unknown as NextFunction;
    const mw = validateRequest({ query: z.object({ page: z.coerce.number().int().positive() }) });
    const req = makeReq({ query: { page: '5' } } as Partial<Request>);
    mw(req, {} as Response, next);
    expect(next).toHaveBeenCalled();
    expect((req.query as unknown as { page: number }).page).toBe(5); // coerced
  });

  it('validates params', () => {
    const next = vi.fn() as unknown as NextFunction;
    const mw = validateRequest({ params: z.object({ id: z.uuid() }) });
    const req = makeReq({ params: { id: 'not-a-uuid' } } as Partial<Request>);
    expect(() => mw(req, {} as Response, next)).toThrow(AppError);
  });

  it('skips sources not in the schema', () => {
    const next = vi.fn() as unknown as NextFunction;
    const mw = validateRequest({ query: z.object({ q: z.string() }) });
    const req = makeReq({ body: { anything: true }, query: { q: 'x' } } as Partial<Request>);
    mw(req, {} as Response, next);
    expect(next).toHaveBeenCalled();
    // body untouched (not in schema)
    expect((req.body as { anything: boolean }).anything).toBe(true);
  });
});
