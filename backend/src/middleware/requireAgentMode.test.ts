import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { requireAgentMode } from './requireAgentMode';
import { agentTokenAuth } from './agentTokenAuth';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0110/0150 — agent middleware. requireAgentMode gates /api/v1/* mounts
// on SLYKBOARD_AGENT_MODE; agentTokenAuth verifies the dispatcher's
// X-Dispatcher-Signature HMAC over req.rawBody (end-to-end supertest coverage
// lives in routes/internal.routes.test.ts).

describe('requireAgentMode gate', () => {
  const tests = [
    { name: 'calls next when SLYKBOARD_AGENT_MODE=true', env: 'true', expectThrow: false },
    {
      name: 'throws NOT_IMPLEMENTED when SLYKBOARD_AGENT_MODE=false',
      env: 'false',
      expectThrow: true,
    },
    {
      name: 'throws NOT_IMPLEMENTED when SLYKBOARD_AGENT_MODE unset',
      env: undefined,
      expectThrow: true,
    },
    {
      name: 'throws NOT_IMPLEMENTED when SLYKBOARD_AGENT_MODE is any other value',
      env: '1',
      expectThrow: true,
    },
  ];

  tests.forEach(({ name, env, expectThrow }) => {
    it(name, () => {
      if (env === undefined) {
        delete process.env.SLYKBOARD_AGENT_MODE;
      } else {
        process.env.SLYKBOARD_AGENT_MODE = env;
      }

      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn() as unknown as NextFunction;

      if (expectThrow) {
        try {
          requireAgentMode(req, res, next);
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          const e = err as AppError;
          expect(e.code).toBe(ErrorCode.NOT_IMPLEMENTED);
          expect(e.status).toBe(501);
          expect(e.message).toBe('Agent mode is not enabled on this server');
        }
        expect(next).not.toHaveBeenCalled();
      } else {
        requireAgentMode(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
      }
    });
  });

  afterEach(() => {
    delete process.env.SLYKBOARD_AGENT_MODE;
  });
});

describe('agentTokenAuth HMAC verification (SLYK-0150)', () => {
  const TOKEN = 'a'.repeat(64);
  const validSig = createHmac('sha256', TOKEN)
    .update(Buffer.from('{"state":"QUEUED"}'))
    .digest('hex');

  // Minimal Request stand-in: express's header() does case-insensitive lookup
  // on the raw headers object — same behavior the middleware relies on.
  function signedRequest(headers: Record<string, string>, rawBody?: Buffer): Request {
    const req = {
      headers,
      rawBody,
      header(name: string): string | undefined {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key === undefined ? undefined : headers[key];
      },
    };
    return req as unknown as Request;
  }

  afterEach(() => {
    delete process.env.SLYKBOARD_AGENT_MODE;
    delete process.env.SLYKBOARD_DISPATCHER_TOKEN;
  });

  it('throws INTERNAL_ERROR (500) when agent mode is on but token env is unset', () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    delete process.env.SLYKBOARD_DISPATCHER_TOKEN;

    try {
      agentTokenAuth(signedRequest({}), {} as Response, vi.fn() as unknown as NextFunction);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(e.status).toBe(500);
    }
  });

  it('throws UNAUTHENTICATED when X-Dispatcher-Signature is missing', () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    try {
      agentTokenAuth(signedRequest({}), {} as Response, vi.fn() as unknown as NextFunction);
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(e.message).toBe('Missing dispatcher signature');
    }
  });

  it('calls next() for a valid hex HMAC-SHA256 over the raw bytes', () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    const next = vi.fn() as unknown as NextFunction;
    agentTokenAuth(
      signedRequest({ 'x-dispatcher-signature': validSig }, Buffer.from('{"state":"QUEUED"}')),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('throws UNAUTHENTICATED for a signature over different bytes', () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    try {
      agentTokenAuth(
        signedRequest({ 'x-dispatcher-signature': validSig }, Buffer.from('{"state":"DONE"}')),
        {} as Response,
        vi.fn() as unknown as NextFunction,
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(e.message).toBe('Invalid dispatcher signature');
    }
  });

  it('throws UNAUTHENTICATED for a length-mismatched (truncated) signature', () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    try {
      agentTokenAuth(
        signedRequest(
          { 'x-dispatcher-signature': validSig.slice(0, 62) },
          Buffer.from('{"state":"QUEUED"}'),
        ),
        {} as Response,
        vi.fn() as unknown as NextFunction,
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });
});
