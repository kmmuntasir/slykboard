import { describe, it, expect } from 'vitest';

import { formatRelativeTime } from './formatRelativeTime';

// F19 T2: table-driven relative-time tests. A fixed `now` makes Intl output
// deterministic. Boundaries exercised: seconds(now)/minutes/hours/days/weeks.

const NOW = new Date('2026-06-24T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function iso(offsetMs: number): string {
    return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe('formatRelativeTime', () => {
    const cases: Array<{ name: string; offsetMs: number; expected: string }> = [
        { name: 'under a minute ago → now', offsetMs: -30_000, expected: 'now' },
        { name: '5 minutes ago', offsetMs: -5 * MINUTE, expected: '5 minutes ago' },
        { name: '3 hours ago', offsetMs: -3 * HOUR, expected: '3 hours ago' },
        { name: '2 days ago', offsetMs: -2 * DAY, expected: '2 days ago' },
        { name: '1 week ago', offsetMs: -1 * WEEK, expected: '1 week ago' },
    ];

    cases.forEach(({ name, offsetMs, expected }) => {
        it(name, () => {
            expect(formatRelativeTime(iso(offsetMs), NOW)).toBe(expected);
        });
    });
});
