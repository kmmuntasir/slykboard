import { describe, it, expect } from 'vitest';
import { readableTextColor } from './color';

// F14 T5: table-driven WCAG luminance tests.
// White/yellow backgrounds are bright → black text; dark/saturated → white text.

describe('readableTextColor', () => {
  const cases: Array<{ name: string; input: string; expected: '#000000' | '#FFFFFF' }> = [
    { name: 'white → black text', input: '#FFFFFF', expected: '#000000' },
    { name: 'black → white text', input: '#000000', expected: '#FFFFFF' },
    // Pure red: L = 0.2126 > 0.179 → black text (WCAG simplified threshold).
    { name: 'red → black text', input: '#FF0000', expected: '#000000' },
    { name: 'yellow → black text', input: '#FFFF00', expected: '#000000' },
    { name: 'mid-gray (#6B7280) → white text', input: '#6B7280', expected: '#FFFFFF' },
  ];

  cases.forEach(({ name, input, expected }) => {
    it(name, () => {
      expect(readableTextColor(input)).toBe(expected);
    });
  });
});
