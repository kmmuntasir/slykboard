import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0150 — HMAC signature verification for dispatcher→slykboard requests
// (docs/agentic-automation/03-security.md § Dispatcher → slykboard).
// X-Dispatcher-Signature = hex HMAC-SHA256 of the request's RAW bytes, key
// SLYKBOARD_DISPATCHER_TOKEN. Must be mounted AFTER the verify-configured
// json parser that captures req.rawBody (see index.ts) — signing over the
// parsed/re-serialized body would break on key-ordering differences.
// All rejections are AppError so errorMiddleware emits the standard envelope
// (unlike the doc's paraphrased res.status().json() sketches).
export function agentTokenAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = process.env.SLYKBOARD_DISPATCHER_TOKEN;

  // Unset token in agent mode is a config bug, not a client auth failure —
  // env validation (SLYK-0130) should have refused to boot. 500, never 401.
  if (!token) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      'SLYKBOARD_DISPATCHER_TOKEN is not configured for agent mode',
    );
  }

  const signature = req.header('x-dispatcher-signature');
  if (!signature) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing dispatcher signature');
  }

  // Empty-body requests (GET deploy-target) sign the empty string; rawBody is
  // only set when the scoped parser actually buffered bytes.
  const rawBody = req.rawBody ?? Buffer.alloc(0);
  const expected = createHmac('sha256', token).update(rawBody).digest('hex');

  // Length check first — timingSafeEqual throws on length mismatch, and the
  // length itself is not a secret (both sides are fixed-size hex digests).
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid dispatcher signature');
  }

  next();
}
