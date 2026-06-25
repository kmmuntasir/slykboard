import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { toast } from '@/hooks/useToast';
import { ApiClientError } from '@/api/client';
import { queryClient, reportError } from './queryClient';

// SLYK-F28 T2: global error funnel + retry policy.
// reportError is unit-tested directly (reliable, internals-free); the retry
// fn is exercised via getDefaultOptions().queries.retry; and one wiring test
// drives a real mutation through the MutationCache to prove onError → reportError.

let errorSpy: MockInstance<typeof toast.error>;

beforeEach(() => {
  errorSpy = vi.spyOn(toast, 'error');
  errorSpy.mockImplementation(() => 'fake-id' as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportError funnel', () => {
  const cases: Array<{
    name: string;
    error: ApiClientError | Error;
    expectSubstring: string;
  }> = [
    {
      name: 'NETWORK_ERROR → offline message',
      error: new ApiClientError('Network request failed', 0, 'NETWORK_ERROR'),
      expectSubstring: 'offline',
    },
    {
      name: 'FORBIDDEN → permission message',
      error: new ApiClientError('No access', 403, 'FORBIDDEN'),
      expectSubstring: 'permission',
    },
    {
      name: 'INTERNAL_ERROR → passthrough message',
      error: new ApiClientError('Database exploded', 500, 'INTERNAL_ERROR'),
      expectSubstring: 'Database exploded',
    },
    {
      name: 'plain Error → generic action-failed message',
      error: new Error('boom'),
      expectSubstring: 'try again',
    },
    {
      name: 'empty-message ApiClientError → generic fallback',
      error: new ApiClientError('', 500, 'INTERNAL_ERROR'),
      expectSubstring: 'Something went wrong',
    },
  ];

  cases.forEach(({ name, error, expectSubstring }) => {
    it(name, () => {
      reportError(error);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(expectSubstring));
    });
  });

  it('always calls toast.error exactly once', () => {
    reportError(new ApiClientError('x', 404, 'NOT_FOUND'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('queryClient retry policy', () => {
  const retry = queryClient.getDefaultOptions().queries?.retry as unknown as (
    failureCount: number,
    error: unknown,
  ) => boolean;

  it('retry is a function', () => {
    expect(typeof retry).toBe('function');
  });

  const noRetryCases: Array<{ name: string; error: unknown }> = [
    {
      name: '401 UNAUTHENTICATED → no retry',
      error: new ApiClientError('Unauthorized', 401, 'UNAUTHENTICATED'),
    },
    { name: '403 FORBIDDEN → no retry', error: new ApiClientError('Forbidden', 403, 'FORBIDDEN') },
  ];

  noRetryCases.forEach(({ name, error }) => {
    it(name, () => {
      expect(retry(0, error)).toBe(false);
    });
  });

  it('plain Error at failureCount 0 → retries', () => {
    expect(retry(0, new Error('boom'))).toBe(true);
  });

  const boundaryCases: Array<{ name: string; failureCount: number; expected: boolean }> = [
    { name: '500 at failureCount 0 → retry', failureCount: 0, expected: true },
    { name: '500 at failureCount 2 → retry (last allowed)', failureCount: 2, expected: true },
    { name: '500 at failureCount 3 → stop (< 3 boundary)', failureCount: 3, expected: false },
  ];

  boundaryCases.forEach(({ name, failureCount, expected }) => {
    it(name, () => {
      const err = new ApiClientError('Server died', 500, 'INTERNAL_ERROR');
      expect(retry(failureCount, err)).toBe(expected);
    });
  });
});

describe('MutationCache wiring', () => {
  it('funnels a failing mutation to reportError → toast.error', async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw new ApiClientError('nope', 500, 'INTERNAL_ERROR');
      },
    });
    await expect(mutation.execute({})).rejects.toThrow('nope');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });
});
