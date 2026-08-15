// SLYK-0410 — rateLimit middleware unit tests. The limiter is exercised as a
// plain middleware triple (req/res/next fakes) — the mount integration is
// covered by the admin + chat route suites; fake timers drive the window
// boundary without real sleeps.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

import { rateLimit, _resetRateLimitsForTests } from './rateLimit';
import { AppError } from '../utils/appError';

function fakeReq(userId: string): Request {
  return { user: { id: userId } } as unknown as Request;
}

function fakeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetRateLimitsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit middleware', () => {
  it('passes until max, then 429 AppError with Retry-After', () => {
    const limiter = rateLimit({ windowMs: 10_000, max: 2 });

    const n1 = vi.fn();
    limiter(fakeReq('u1'), fakeRes(), n1);
    const n2 = vi.fn();
    limiter(fakeReq('u1'), fakeRes(), n2);
    expect(n1).toHaveBeenCalledWith();
    expect(n2).toHaveBeenCalledWith();

    // Over the cap: next fires with the AppError (Express error-chain style).
    const n3 = vi.fn();
    const res3 = fakeRes();
    limiter(fakeReq('u1'), res3, n3);
    expect(n3).toHaveBeenCalledTimes(1);
    const err = n3.mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('TOO_MANY_REQUESTS');
    expect(res3.headers['retry-after']).toBe(String(10));
  });

  it('window reset re-allows', () => {
    const limiter = rateLimit({ windowMs: 10_000, max: 1 });

    limiter(fakeReq('u1'), fakeRes(), vi.fn());
    const rejected = vi.fn();
    limiter(fakeReq('u1'), fakeRes(), rejected);
    expect(rejected.mock.calls[0]?.[0]).toBeInstanceOf(AppError);

    vi.advanceTimersByTime(10_001);
    const after = vi.fn();
    limiter(fakeReq('u1'), fakeRes(), after);
    expect(after).toHaveBeenCalledWith();
  });

  it('keys are per-user — separate budgets', () => {
    const limiter = rateLimit({ windowMs: 10_000, max: 1 });

    limiter(fakeReq('u1'), fakeRes(), vi.fn());
    const u2 = vi.fn();
    limiter(fakeReq('u2'), fakeRes(), u2);
    expect(u2).toHaveBeenCalledWith();
  });

  it('custom keyFn overrides the default user-id key', () => {
    const limiter = rateLimit({ windowMs: 10_000, max: 1, keyFn: () => 'global' });

    limiter(fakeReq('u1'), fakeRes(), vi.fn());
    const second = vi.fn();
    limiter(fakeReq('u2'), fakeRes(), second);
    expect(second.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
  });
});
