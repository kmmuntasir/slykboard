// F16 D12 / F30 D1: unified display-ID formatter. REQ-3.1 ID format is
// [ProjectSlug]-[NUMBER]. Default (unpadded) form 'SLYK-4' is the URL/human-
// readable ref (D1). The padded form 'SLYK-004' is the display badge (F12 D2).
// Slug is upper-cased for display regardless of how it was cased in the URL.
// padStart is a minimum width, so SLYK-1000+ render unpadded beyond it.
const TICKET_NUMBER_DISPLAY_WIDTH = 3;

export interface FormatTicketIdOptions {
    padded?: boolean;
}

export function formatTicketId(
    slug: string,
    ticketNumber: number,
    options?: FormatTicketIdOptions,
): string {
    const upperSlug = slug.toUpperCase();
    if (options?.padded) {
        return `${upperSlug}-${String(ticketNumber).padStart(TICKET_NUMBER_DISPLAY_WIDTH, '0')}`;
    }
    return `${upperSlug}-${ticketNumber}`;
}
