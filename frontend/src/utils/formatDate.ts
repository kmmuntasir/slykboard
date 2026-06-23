// F16 D12: shared timestamp formatter. Timestamps are stored as UTC ISO strings;
// render them in the user's locale for the modal (created/updated). No dep —
// Intl.DateTimeFormat is native.
export function formatDate(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(iso));
}
