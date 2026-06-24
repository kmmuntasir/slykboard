import { describe, it, expect } from 'vitest';

import { parseDuration } from './parseDuration';

// F21: table-driven parseDuration tests. Covers h+m, fractional hours, bare
// minutes, empty/whitespace, and non-numeric rejection. The parser does NOT
// enforce the 1-1440 cap, so 0m and over-cap values are returned as-is.

describe('parseDuration', () => {
    const cases: Array<{ name: string; input: string; expected: number | null }> = [
        { name: 'hours + minutes', input: '2h 30m', expected: 150 },
        { name: 'three hours', input: '3h', expected: 180 },
        { name: 'minutes only', input: '90m', expected: 90 },
        { name: 'fractional hours', input: '1.5h', expected: 90 },
        { name: 'bare minutes', input: '30', expected: 30 },
        { name: 'hours only', input: '2h', expected: 120 },
        { name: 'fractional minutes round up', input: '0.4m', expected: 0 },
        { name: 'fractional minutes round to 1', input: '0.6m', expected: 1 },
        { name: 'uppercase H/M accepted', input: '2H 30M', expected: 150 },
        { name: 'leading/trailing whitespace', input: '  2h 30m  ', expected: 150 },
        { name: 'zero minutes parses to 0', input: '0m', expected: 0 },
        { name: 'over-cap parses anyway (no enforcement)', input: '25h', expected: 1500 },
        { name: 'empty string', input: '', expected: null },
        { name: 'non-numeric', input: 'abc', expected: null },
        { name: 'whitespace', input: '   ', expected: null },
        { name: 'mixed garbage', input: '2h abc', expected: null },
        { name: 'negative rejected', input: '-5', expected: null },
    ];

    cases.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(parseDuration(input)).toBe(expected);
        });
    });
});
