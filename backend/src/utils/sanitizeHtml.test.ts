import { describe, it, expect } from 'vitest';
import { sanitizeDescription } from './sanitizeHtml';

describe('sanitizeDescription', () => {
  const cases = [
    { name: 'plain text passthrough', input: 'hello', expected: 'hello' },
    { name: 'allowed tags kept', input: '<p>hi</p>', expected: '<p>hi</p>' },
    { name: 'script stripped', input: '<script>alert(1)</script>hi', expected: 'hi' },
    { name: 'onerror stripped', input: '<img src=x onerror=alert(1)>', expected: '' },
    {
      name: 'href kept on a',
      input: '<a href="https://x.com">x</a>',
      expected: '<a href="https://x.com">x</a>',
    },
    {
      name: 'javascript: href stripped',
      input: '<a href="javascript:alert(1)">x</a>',
      expected: '<a>x</a>',
    },
    { name: 'style tag stripped', input: '<style>*{}</style>hi', expected: 'hi' },
    { name: 'iframe stripped', input: '<iframe src=x></iframe>', expected: '' },
    { name: 'empty input', input: '', expected: '' },
    { name: 'null input', input: null, expected: '' },
    { name: 'undefined input', input: undefined, expected: '' },
  ];

  cases.forEach(({ name, input, expected }) => {
    it(name, () => {
      expect(sanitizeDescription(input)).toBe(expected);
    });
  });
});
