// SLYK-0410 — in-memory fixed-window rate limiter (03-security.md § Rate
// limiting). Two mounts:
//   POST /api/v1/admin/projects          → 1 request / 10s / admin user
//   POST /api/v1/me/tickets/:id/messages → 30 requests / min / user
// `/api/v1/internal/*` stays unlimited (trusted dispatcher, single source,
// low volume — 03 explicitly exempts it).
//
// In-memory is correct under the v1 single-pod invariant (same seam note as
// the SSE emitter + escalation debounce); the multi-pod path swaps the Map
// for Redis with the same key shape.
import type { RequestHandler } from 'express';

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

export interface RateLimitOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests per window per key. */
  max: number;
  /**
   * Key extractor — defaults to the authenticated user id (both mounts are
   * behind `authenticate`). Returns a string for the counter map.
   */
  keyFn?: (req: { user?: { id?: string } }) => string;
}

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

/** Test seam: clear all counters between cases. */
export function _resetRateLimitsForTests(): void {
  windows.clear();
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, keyFn } = options;

  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.user?.id ?? 'anonymous');
    const now = Date.now();

    let state = windows.get(key);
    if (!state || now >= state.resetAt) {
      state = { count: 0, resetAt: now + windowMs };
      windows.set(key, state);
    }

    if (state.count >= max) {
      const retryAfterSec = Math.max(Math.ceil((state.resetAt - now) / 1000), 1);
      res.setHeader('Retry-After', String(retryAfterSec));
      next(
        new AppError(ErrorCode.TOO_MANY_REQUESTS, 'Too many requests — slow down', {
          details: { retryAfterSeconds: retryAfterSec },
        }),
      );
      return;
    }

    state.count += 1;
    next();
  };
}
