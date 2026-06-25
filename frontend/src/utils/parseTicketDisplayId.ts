// F30 D-Display-Id-Format: human-readable ticket URL ref = '<SLUG>-<NUMBER>'
// (e.g. 'SLYK-4'). Slug half: [A-Z][A-Z0-9]{1,15}; number half: one-or-more
// digits, tolerant of leading zeros (SLYK-04 === SLYK-4). Returns null on any
// structural mismatch; caller decides the response. Frontend mirror of the
// backend parseTicketDisplayId util — keep the two APIs identical.
export const TICKET_DISPLAY_ID_REGEX = /^([A-Z][A-Z0-9]{1,15})-(\d+)$/;

// F12: ticket numbers are positive integers (sequence starts at 1). 'SLYK-0'
// parses structurally but is rejected here.
export const MIN_TICKET_NUMBER = 1;

export interface ParsedTicketDisplayId {
  slug: string;
  ticketNumber: number;
}

/**
 * Parse a human-readable ticket ref like 'SLYK-4' into { slug, ticketNumber }.
 *
 * - Returns null on structural mismatch (bad slug shape, non-digit number, etc.).
 * - Returns null when parsed number < MIN_TICKET_NUMBER.
 * - When expectedSlug is provided, returns null on a case-insensitive prefix
 *   mismatch (the URL path's slug must agree with the ref's slug).
 *
 * Parsed slug is always uppercase (regex enforces it); case-insensitivity only
 * affects the expectedSlug comparison.
 */
export function parseTicketDisplayId(
  ref: string,
  expectedSlug?: string,
): ParsedTicketDisplayId | null {
  const match = TICKET_DISPLAY_ID_REGEX.exec(ref);
  if (!match) return null;

  const slug = match[1];
  const digits = match[2];
  if (slug === undefined || digits === undefined) return null;

  const ticketNumber = Number.parseInt(digits, 10);
  if (ticketNumber < MIN_TICKET_NUMBER) return null;

  if (expectedSlug !== undefined && slug.toLowerCase() !== expectedSlug.toLowerCase()) {
    return null;
  }

  return { slug, ticketNumber };
}
