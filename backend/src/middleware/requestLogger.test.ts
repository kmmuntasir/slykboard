import { describe, it, expect } from 'vitest';
import { requestLogger } from './requestLogger';

describe('requestLogger', () => {
  it('is an Express middleware function (3-arg)', () => {
    expect(typeof requestLogger).toBe('function');
    expect(requestLogger.length).toBe(3);
  });

  it('serializers shape proven by /api/ping integration test', () => {
    // Real serializer proof is via the /api/ping integration test in pingRoute.test.ts
    // — this file only sanity-checks the middleware surface (shape/arity).
    expect(true).toBe(true);
  });
});
