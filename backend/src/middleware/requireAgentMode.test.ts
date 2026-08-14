import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAgentMode } from './requireAgentMode';
import { agentTokenAuth } from './agentTokenAuth';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0110 — agent middleware stubs. requireAgentMode gates /api/v1/* mounts
// on SLYKBOARD_AGENT_MODE; agentTokenAuth is a Phase 0 placeholder that always
// rejects (real HMAC verification lands in SLYK-0150).

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

describe('agentTokenAuth stub', () => {
  it('always throws UNAUTHENTICATED (Phase 0 fills HMAC verification)', () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    try {
      agentTokenAuth({} as Request, {} as Response, vi.fn() as unknown as NextFunction);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(e.status).toBe(401);
      expect(e.message).toBe('Agent token auth not implemented');
    }
    delete process.env.SLYKBOARD_AGENT_MODE;
  });
});
