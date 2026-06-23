// F16 D12: shared display-ID formatter. REQ-3.1 ID format is [ProjectSlug]-[NNN].
// Used by the TicketDetailModal header (and the board card can adopt it later).
// Slug is upper-cased for display regardless of how it was cased in the URL.
export function formatTicketId(slug: string, ticketNumber: number): string {
    return `${slug.toUpperCase()}-${ticketNumber}`;
}
