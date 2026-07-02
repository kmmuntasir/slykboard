import { describe, it, expect } from 'vitest';
import { sanitizeDescription } from './sanitizeHtml';

describe('sanitizeDescription', () => {
  const cases: Array<{
    name: string;
    input: string | null | undefined;
    check: (out: string) => boolean;
    expected?: string;
  }> = [
    { name: 'empty string -> empty', input: '', check: (o) => o === '', expected: '' },
    { name: 'null -> empty', input: null, check: (o) => o === '', expected: '' },
    { name: 'undefined -> empty', input: undefined, check: (o) => o === '', expected: '' },
    {
      name: 'strips <script>',
      input: '<script>alert(1)</script>hi',
      check: (o) => !o.includes('<script') && o.includes('hi'),
    },
    {
      name: 'strips onerror handler',
      input: '<img src="x" onerror="alert(1)">',
      check: (o) => !o.includes('onerror'),
    },
    {
      name: 'strips onload handler',
      input: '<img src="x" onload="alert(1)">',
      check: (o) => !o.includes('onload'),
    },
    {
      name: 'strips onclick handler',
      input: '<a onclick="alert(1)">x</a>',
      check: (o) => !o.includes('onclick'),
    },
    {
      name: 'strips onmouseover handler',
      input: '<a onmouseover="alert(1)">x</a>',
      check: (o) => !o.includes('onmouseover'),
    },
    {
      name: 'strips <iframe>',
      input: '<iframe src="x"></iframe>',
      check: (o) => !o.includes('<iframe'),
    },
    {
      name: 'strips <style>',
      input: '<style>body{}</style>text',
      check: (o) => !o.includes('<style') && o.includes('text'),
    },
    {
      name: 'strips <object>',
      input: '<object data="x"></object>',
      check: (o) => !o.includes('<object'),
    },
    {
      name: 'strips <embed>',
      input: '<embed src="x">text',
      check: (o) => !o.includes('<embed'),
    },
    {
      name: 'keeps <p>',
      input: '<p>hello</p>',
      check: (o) => o.includes('<p>') && o.includes('hello'),
    },
    {
      name: 'keeps <strong> + <em>',
      input: '<p>a <strong>b</strong> <em>c</em></p>',
      check: (o) => o.includes('<strong>b</strong>') && o.includes('<em>c</em>'),
    },
    {
      name: 'keeps <a href>',
      input: '<a href="https://example.com">link</a>',
      check: (o) => o.includes('href="https://example.com"') && o.includes('link'),
    },
    {
      name: 'keeps nested <ul><li>',
      input: '<ul><li>a</li><li>b</li></ul>',
      check: (o) => o.includes('<ul>') && o.includes('<li>a</li>'),
    },
    {
      name: 'strips disallowed class attr',
      input: '<p class="x">hi</p>',
      check: (o) => !o.includes('class=') && o.includes('hi'),
    },
    {
      name: 'strips disallowed id attr',
      input: '<p id="y">hi</p>',
      check: (o) => !o.includes('id=') && o.includes('hi'),
    },
    {
      name: 'keeps <s> and <u>',
      input: '<p><s>struck</s> <u>under</u></p>',
      check: (o) => o.includes('<s>struck</s>') && o.includes('<u>under</u>'),
    },
    {
      name: 'keeps <h1> and <h2>',
      input: '<h1>one</h1><h2>two</h2>',
      check: (o) => o.includes('<h1>one</h1>') && o.includes('<h2>two</h2>'),
    },
    {
      name: 'keeps <img src="https://..."> with src',
      input: '<img src="https://example.com/a.png">',
      check: (o) => o.includes('<img') && o.includes('src="https://example.com/a.png"'),
    },
    {
      name: 'img alt survives',
      input: '<img src="https://example.com/a.png" alt="alt text">',
      check: (o) => o.includes('alt="alt text"'),
    },
    {
      name: 'link target/rel survive',
      input: '<a href="https://example.com" target="_blank" rel="noopener">link</a>',
      check: (o) => o.includes('target="_blank"') && o.includes('rel="noopener"'),
    },
    {
      name: 'strips script / onerror / onload',
      input: '<script>x</script><img src="x" onerror="a(1)" onload="b(2)">',
      check: (o) => !o.includes('<script') && !o.includes('onerror') && !o.includes('onload'),
    },
    {
      name: 'strips javascript: href',
      input: '<a href="javascript:alert(1)">x</a>',
      check: (o) => !o.toLowerCase().includes('javascript:'),
    },
    {
      name: 'strips javascript: img src',
      input: '<img src="javascript:alert(1)">',
      check: (o) => !o.toLowerCase().includes('javascript:'),
    },
    {
      name: 'strips data: img src',
      input: '<img src="data:image/png;base64,abc">',
      check: (o) => !o.toLowerCase().includes('data:'),
    },
    {
      name: 'strips <iframe> with remote src',
      input: '<iframe src="https://evil.com"></iframe>',
      check: (o) => !o.includes('<iframe'),
    },
    {
      name: 'keeps nested allowed content unchanged',
      input: '<p>hello <strong>world</strong></p>',
      check: (o) => o === '<p>hello <strong>world</strong></p>',
      expected: '<p>hello <strong>world</strong></p>',
    },
  ];

  cases.forEach(({ name, input, check, expected }) => {
    it(name, () => {
      const out = sanitizeDescription(input);
      if (expected !== undefined) {
        expect(out).toBe(expected);
      } else {
        expect(check(out)).toBe(true);
      }
    });
  });
});
