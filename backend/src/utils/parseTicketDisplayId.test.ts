import { describe, it, expect } from 'vitest';
import {
  parseTicketDisplayId,
  TICKET_DISPLAY_ID_REGEX,
  MIN_TICKET_NUMBER,
} from './parseTicketDisplayId';

describe('parseTicketDisplayId', () => {
  describe('TICKET_DISPLAY_ID_REGEX constant', () => {
    it('is anchored (no partial / no trailing)', () => {
      expect(TICKET_DISPLAY_ID_REGEX.test('SLYK-4')).toBe(true);
      expect(TICKET_DISPLAY_ID_REGEX.test('SLYK-4 extra')).toBe(false);
    });
  });

  describe('MIN_TICKET_NUMBER constant', () => {
    it('is 1', () => {
      expect(MIN_TICKET_NUMBER).toBe(1);
    });
  });

  describe('valid refs', () => {
    const validCases: Array<{
      name: string;
      input: string;
      expectedSlug: string;
      expectedNumber: number;
    }> = [
      { name: 'basic SLYK-4', input: 'SLYK-4', expectedSlug: 'SLYK', expectedNumber: 4 },
      { name: 'leading zero SLYK-04', input: 'SLYK-04', expectedSlug: 'SLYK', expectedNumber: 4 },
      {
        name: 'two leading zeros SLYK-004',
        input: 'SLYK-004',
        expectedSlug: 'SLYK',
        expectedNumber: 4,
      },
      { name: 'shortest slug AB-1', input: 'AB-1', expectedSlug: 'AB', expectedNumber: 1 },
      {
        name: 'longest slug (16 chars) A123456789012345-99',
        input: 'A123456789012345-99',
        expectedSlug: 'A123456789012345',
        expectedNumber: 99,
      },
      { name: 'large number SLYK-123456', input: 'SLYK-123456', expectedSlug: 'SLYK', expectedNumber: 123456 },
    ];

    validCases.forEach(({ name, input, expectedSlug, expectedNumber }) => {
      it(`parses ${name}`, () => {
        const result = parseTicketDisplayId(input);
        expect(result).toEqual({ slug: expectedSlug, ticketNumber: expectedNumber });
      });
    });

    it('leading-zero stripping yields numeric ticketNumber === 4 for SLYK-004', () => {
      const result = parseTicketDisplayId('SLYK-004');
      expect(result?.ticketNumber).toBe(4);
      expect(result?.slug).toBe('SLYK');
    });
  });

  describe('malformed refs return null', () => {
    const malformedCases: Array<{ name: string; input: string }> = [
      { name: 'non-numeric suffix SLYK-abc', input: 'SLYK-abc' },
      { name: 'missing number SLYK-', input: 'SLYK-' },
      { name: 'missing slug -4', input: '-4' },
      { name: 'slug only SLYK', input: 'SLYK' },
      { name: 'number only 4', input: '4' },
      { name: 'empty string', input: '' },
      { name: 'lowercase slug slyk-4 (regex enforces uppercase)', input: 'slyk-4' },
      { name: 'zero number SLYK-0 (< MIN)', input: 'SLYK-0' },
      { name: 'double dash SLYK--4', input: 'SLYK--4' },
      { name: 'leading whitespace " SLYK-4"', input: ' SLYK-4' },
      { name: 'trailing whitespace "SLYK-4 "', input: 'SLYK-4 ' },
      { name: 'single-letter slug A-4 (too short)', input: 'A-4' },
      { name: '17-char slug A1234567890123456-4 (too long)', input: 'A1234567890123456-4' },
      { name: 'lowercase digit mixed sLyK-4', input: 'sLyK-4' },
    ];

    malformedCases.forEach(({ name, input }) => {
      it(`returns null for ${name}`, () => {
        expect(parseTicketDisplayId(input)).toBeNull();
      });
    });
  });

  describe('expectedSlug (prefix mismatch)', () => {
    it('returns null when parsed slug differs from expected (PX-4 vs SLYK)', () => {
      expect(parseTicketDisplayId('PX-4', 'SLYK')).toBeNull();
    });

    it('returns null when expected differs from parsed (SLYK-4 vs PX)', () => {
      expect(parseTicketDisplayId('SLYK-4', 'PX')).toBeNull();
    });
  });

  describe('expectedSlug (case-insensitive match)', () => {
    it('matches when expectedSlug is lowercase (slyk) but parsed slug is uppercase (SLYK)', () => {
      expect(parseTicketDisplayId('SLYK-4', 'slyk')).toEqual({
        slug: 'SLYK',
        ticketNumber: 4,
      });
    });

    it('matches when expectedSlug is mixed case (Slyk)', () => {
      expect(parseTicketDisplayId('SLYK-4', 'Slyk')).toEqual({
        slug: 'SLYK',
        ticketNumber: 4,
      });
    });

    it('matches when both are uppercase', () => {
      expect(parseTicketDisplayId('SLYK-4', 'SLYK')).toEqual({
        slug: 'SLYK',
        ticketNumber: 4,
      });
    });

    it('returns the parsed (uppercase) slug even when expectedSlug is lowercase', () => {
      // Parsed slug always retains its regex form (uppercase); expectedSlug
      // only affects the comparison, not the returned slug.
      const result = parseTicketDisplayId('AB-7', 'ab');
      expect(result?.slug).toBe('AB');
    });
  });
});
