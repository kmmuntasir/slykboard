// F30 D-Display-Id-Format: human-readable ticket URL ref = '<SLUG>-<NUMBER>'
// (e.g. 'SLYK-4'). The slug half reuses the SLUG shape from slug.ts
// ([A-Z][A-Z0-9]{1,15}); the number half is one-or-more digits, tolerant of
// leading zeros (SLYK-04 === SLYK-4). The route layer treats a malformed ref
// as NOT_FOUND (D5), NOT a 400 — this helper just parses; it returns null on
// any mismatch and the caller decides the response code.
export const TICKET_DISPLAY_ID_REGEX = /^([A-Z][A-Z0-9]{1,15})-(\d+)$/;

// F12: ticket numbers are positive integers (sequence starts at 1). Zero is
// not a valid ticket number, so a ref like 'SLYK-0' parses structurally but
// is rejected here.
export const MIN_TICKET_NUMBER = 1;

export interface ParsedTicketDisplayId {
  slug: string;
  ticketNumber: number;
}

/**
 * Parse a human-readable ticket ref like 'SLYK-4' into {slug, ticketNumber}.
 *
 * - Returns null on any structural mismatch (bad slug shape, non-digit
 *   number, trailing whitespace, etc.).
 * - Returns null when the parsed number is below MIN_TICKET_NUMBER.
 * - When `expectedSlug` is provided, returns null on a case-insensitive
 *   prefix mismatch (D3: the URL path's slug must agree with the displayId's
 *   slug, e.g. /projects/SLYK/tickets/PX-4 is a 404, never a hit on PX).
 *
 * The parsed slug is always uppercase because the regex enforces it; the
 * case-insensitivity only affects the expectedSlug comparison.
 */
export function parseTicketDisplayId(
  ref: string,
  expectedSlug?: string,
): ParsedTicketDisplayId | null {
  const match = TICKET_DISPLAY_ID_REGEX.exec(ref);
  if (!match) return null;

  // exec with a non-global/non-sticky regex always yields groups 1 and 2 on a
  // match, but noUncheckedIndexedAccess widens them to `string | undefined`.
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
