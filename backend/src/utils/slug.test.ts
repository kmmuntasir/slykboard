import { describe, it, expect } from 'vitest';
import { normalizeSlug, isValidSlug, isReservedSlug } from './slug';

describe('normalizeSlug', () => {
  const tests = [
    { name: 'lowercase → uppercase', input: 'slyk', expected: 'SLYK' },
    { name: 'strips spaces', input: 'SLY K', expected: 'SLYK' },
    { name: 'strips hyphens', input: 'sly-k', expected: 'SLYK' },
    { name: 'strips underscores', input: 'sly_k', expected: 'SLYK' },
    { name: 'mixed case + symbols', input: ' My-Project_1 ', expected: 'MYPROJECT1' },
    { name: 'empty string', input: '', expected: '' },
    { name: 'only symbols', input: '---', expected: '' },
  ];
  tests.forEach(({ name, input, expected }) => {
    it(name, () => expect(normalizeSlug(input)).toBe(expected));
  });
});

describe('isValidSlug', () => {
  const valid = ['SL', 'SLYK', 'PROJECT1', 'AB', 'A1', 'ABCDEFG123456789']; // 2..16 chars
  const invalid = [
    '',
    'A', // too short (<2)
    'A'.repeat(16) + 'X', // too long (>16)
    'slyk',
    '1ABC',
    '_ABC',
    'A B C',
    'A-B', // lowercase, leading digit, symbols, spaces
  ];
  valid.forEach((s) => it(`accepts ${s}`, () => expect(isValidSlug(s)).toBe(true)));
  invalid.forEach((s) => it(`rejects '${s}'`, () => expect(isValidSlug(s)).toBe(false)));
});

describe('isReservedSlug', () => {
  it('blocks known reserved slugs', () => {
    ['API', 'AUTH', 'HEALTH', 'REPORTS', 'SETTINGS', 'LOGIN', 'NEW', 'ADMIN'].forEach((s) =>
      expect(isReservedSlug(s)).toBe(true),
    );
  });
  it('allows non-reserved slugs', () => {
    expect(isReservedSlug('SLYK')).toBe(false);
  });
  it('case-insensitive', () => {
    expect(isReservedSlug('api')).toBe(true);
  });
});
