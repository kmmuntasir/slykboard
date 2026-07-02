import { describe, it, expect } from 'vitest';
import { sanitizeDescription } from './sanitizeHtml';

describe('sanitizeDescription', () => {
  const cases = [
    { name: 'plain text passthrough', input: 'hello', expected: 'hello' },
    { name: 'allowed tags kept', input: '<p>hi</p>', expected: '<p>hi</p>' },
    { name: 'script stripped', input: '<script>alert(1)</script>hi', expected: 'hi' },
    {
      name: 'script with body stripped',
      input: '<script>document.cookie</script>safe',
      expected: 'safe',
    },
    // DEL-01 T2: <img> is now allowed, so the onerror attribute is stripped
    // while a safe relative src survives.
    {
      name: 'onerror stripped (img now allowed)',
      input: '<img src=x onerror=alert(1)>',
      expected: '<img src="x">',
    },
    {
      name: 'onload stripped',
      input: '<img src="x" onload="alert(1)">',
      expected: '<img src="x">',
    },
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
    // DEL-01 T2: widened rich-text allow-list.
    { name: 'keeps <s>', input: '<s>strike</s>', expected: '<s>strike</s>' },
    { name: 'keeps <u>', input: '<u>under</u>', expected: '<u>under</u>' },
    { name: 'keeps <h1>', input: '<h1>H1</h1>', expected: '<h1>H1</h1>' },
    { name: 'keeps <h2>', input: '<h2>H2</h2>', expected: '<h2>H2</h2>' },
    {
      name: 'img https src survives',
      input: '<img src="https://example.com/i.png">',
      expected: '<img src="https://example.com/i.png">',
    },
    {
      name: 'img alt survives',
      input: '<img src="https://example.com/i.png" alt="pic">',
      expected: '<img src="https://example.com/i.png" alt="pic">',
    },
    {
      name: 'link target and rel survive',
      input: '<a href="https://x.com" target="_blank" rel="noopener">x</a>',
      expected: '<a href="https://x.com" target="_blank" rel="noopener">x</a>',
    },
    {
      name: 'javascript: img src stripped',
      input: '<img src="javascript:alert(1)">',
      expected: '<img>',
    },
    {
      name: 'data: img src stripped',
      input: '<img src="data:image/png;base64,abc">',
      expected: '<img>',
    },
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
