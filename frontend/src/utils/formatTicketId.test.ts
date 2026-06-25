import { describe, it, expect } from 'vitest';
import { formatTicketId } from './formatTicketId';

describe('formatTicketId', () => {
    describe('default (unpadded) — URL form', () => {
        const cases: Array<{ name: string; slug: string; ticketNumber: number; expected: string }> = [
            { name: 'single digit SLYK-4', slug: 'SLYK', ticketNumber: 4, expected: 'SLYK-4' },
            { name: 'three digit SLYK-101', slug: 'SLYK', ticketNumber: 101, expected: 'SLYK-101' },
            { name: 'large number SLYK-1000', slug: 'SLYK', ticketNumber: 1000, expected: 'SLYK-1000' },
            { name: 'min ticket number SLYK-1', slug: 'SLYK', ticketNumber: 1, expected: 'SLYK-1' },
        ];
        cases.forEach(({ name, slug, ticketNumber, expected }) => {
            it(name, () => {
                expect(formatTicketId(slug, ticketNumber)).toBe(expected);
            });
        });
    });

    describe('padded — badge form', () => {
        const cases: Array<{ name: string; slug: string; ticketNumber: number; expected: string }> = [
            { name: 'pads to 3 digits SLYK-004', slug: 'SLYK', ticketNumber: 4, expected: 'SLYK-004' },
            { name: 'min padded SLYK-001', slug: 'SLYK', ticketNumber: 1, expected: 'SLYK-001' },
            { name: 'three digit unchanged SLYK-101', slug: 'SLYK', ticketNumber: 101, expected: 'SLYK-101' },
            { name: 'beyond width stays unpadded SLYK-1000', slug: 'SLYK', ticketNumber: 1000, expected: 'SLYK-1000' },
        ];
        cases.forEach(({ name, slug, ticketNumber, expected }) => {
            it(name, () => {
                expect(formatTicketId(slug, ticketNumber, { padded: true })).toBe(expected);
            });
        });
    });

    describe('slug casing', () => {
        it('uppercases a lowercase slug (default)', () => {
            expect(formatTicketId('slyk', 4)).toBe('SLYK-4');
        });
        it('uppercases a lowercase slug (padded)', () => {
            expect(formatTicketId('slyk', 4, { padded: true })).toBe('SLYK-004');
        });
    });
});
