import { describe, it, expect } from 'vitest';
import {
  parseTicketDisplayId,
  MIN_TICKET_NUMBER,
  TICKET_DISPLAY_ID_REGEX,
} from './parseTicketDisplayId';

describe('parseTicketDisplayId', () => {
  describe('valid refs', () => {
    const cases: Array<{
      name: string;
      input: string;
      expected: { slug: string; ticketNumber: number };
    }> = [
      { name: 'unpadded SLYK-4', input: 'SLYK-4', expected: { slug: 'SLYK', ticketNumber: 4 } },
      {
        name: 'padded leading zeros SLYK-004 normalizes to 4',
        input: 'SLYK-004',
        expected: { slug: 'SLYK', ticketNumber: 4 },
      },
      {
        name: 'large number SLYK-1000',
        input: 'SLYK-1000',
        expected: { slug: 'SLYK', ticketNumber: 1000 },
      },
      { name: 'two-char slug AB-12', input: 'AB-12', expected: { slug: 'AB', ticketNumber: 12 } },
    ];
    cases.forEach(({ name, input, expected }) => {
      it(name, () => {
        expect(parseTicketDisplayId(input)).toEqual(expected);
      });
    });
  });

  describe('malformed refs return null', () => {
    const cases: Array<{ name: string; input: string }> = [
      { name: 'non-digit number SLYK-abc', input: 'SLYK-abc' },
      { name: 'missing number SLYK-', input: 'SLYK-' },
      { name: 'missing slug -4', input: '-4' },
      { name: 'empty string', input: '' },
      { name: 'trailing chars SLYK-4-extra', input: 'SLYK-4-extra' },
      { name: 'lowercase slug slyk-4', input: 'slyk-4' },
      { name: 'single-char slug S-4', input: 'S-4' },
      { name: 'slug starting with digit 4SLYK-4', input: '4SLYK-4' },
      { name: 'number below MIN SLYK-0', input: 'SLYK-0' },
    ];
    cases.forEach(({ name, input }) => {
      it(name, () => {
        expect(parseTicketDisplayId(input)).toBeNull();
      });
    });
  });

  describe('expectedSlug prefix check', () => {
    it('returns null on prefix mismatch', () => {
      expect(parseTicketDisplayId('SLYK-4', 'PX')).toBeNull();
    });
    it('matches case-insensitively, returns uppercase slug', () => {
      expect(parseTicketDisplayId('SLYK-4', 'slyk')).toEqual({ slug: 'SLYK', ticketNumber: 4 });
    });
    it('matches exact slug', () => {
      expect(parseTicketDisplayId('SLYK-4', 'SLYK')).toEqual({ slug: 'SLYK', ticketNumber: 4 });
    });
    it('skips check when expectedSlug omitted', () => {
      expect(parseTicketDisplayId('SLYK-4')).toEqual({ slug: 'SLYK', ticketNumber: 4 });
    });
  });

  it('exports MIN_TICKET_NUMBER = 1', () => {
    expect(MIN_TICKET_NUMBER).toBe(1);
  });
  it('exports the display-id regex', () => {
    expect(TICKET_DISPLAY_ID_REGEX).toBeInstanceOf(RegExp);
    expect(TICKET_DISPLAY_ID_REGEX.test('SLYK-4')).toBe(true);
  });
});
