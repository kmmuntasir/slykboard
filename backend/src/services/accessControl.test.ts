import { describe, it, expect, beforeEach, vi } from 'vitest';

const { envStub } = vi.hoisted(() => ({
  envStub: { allowedDomain: undefined as string | undefined },
}));

vi.mock('../config', () => ({
  env: envStub,
}));

import { normalizeEmailDomain, assertDomainAllowed } from './accessControl';
import { AppError } from '../utils/appError';

describe('normalizeEmailDomain', () => {
  const tests = [
    { name: 'lowercases domain', input: 'Alice@Example.COM', expected: 'example.com' },
    { name: 'trims whitespace', input: '  alice@example.com  ', expected: 'example.com' },
    {
      name: 'uses lastIndexOf for malformed multi-@',
      input: 'a@b@example.com',
      expected: 'example.com',
    },
    { name: 'returns empty string for missing @', input: 'not-an-email', expected: '' },
    { name: 'returns empty string for trailing @', input: 'alice@', expected: '' },
  ];

  tests.forEach(({ name, input, expected }) => {
    it(name, () => {
      expect(normalizeEmailDomain(input)).toBe(expected);
    });
  });
});

describe('assertDomainAllowed', () => {
  beforeEach(() => {
    envStub.allowedDomain = undefined;
  });

  const cases: Array<{
    name: string;
    allowedDomain: string | undefined;
    email: string;
    throws: boolean;
  }> = [
    {
      name: 'allows all when env.allowedDomain unset',
      allowedDomain: undefined,
      email: 'anyone@anywhere.com',
      throws: false,
    },
    {
      name: 'allows matching domain (case-insensitive)',
      allowedDomain: 'Example.com',
      email: 'alice@example.com',
      throws: false,
    },
    {
      name: 'throws FORBIDDEN on mismatch',
      allowedDomain: 'allowed.com',
      email: 'alice@blocked.com',
      throws: true,
    },
    {
      name: 'throws FORBIDDEN on malformed email',
      allowedDomain: 'allowed.com',
      email: 'no-at-sign',
      throws: true,
    },
    {
      name: 'throws FORBIDDEN on bare-domain env mismatch (subdomain NOT auto-allowed)',
      allowedDomain: 'allowed.com',
      email: 'alice@sub.allowed.com',
      throws: true,
    },
  ];

  cases.forEach(({ name, allowedDomain, email, throws }) => {
    it(name, () => {
      envStub.allowedDomain = allowedDomain;
      if (!throws) {
        expect(() => assertDomainAllowed(email)).not.toThrow();
        return;
      }
      let caught: unknown;
      try {
        assertDomainAllowed(email);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect(caught).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Your Google account is not in the allowed workspace',
      });
    });
  });
});
