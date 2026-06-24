// F19 D6/D10: native Intl.RelativeTimeFormat (no dep). Relative primary ("2h ago");
// the absolute locale time is shown in a title tooltip via formatDate (ActivityItem).
//
// numeric: 'always' keeps singular boundaries readable ("1 week ago" rather than the
// "last week" auto-form); the sub-minute window is special-cased to "now".
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// F19: relative time for the activity feed. Returns "now"/"5 minutes ago"/
// "3 hours ago"/"2 days ago"/"1 week ago" for the given ISO timestamp vs `now`.
// `now` is injectable so tests are deterministic.
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
    const then = new Date(iso).getTime();
    const diffMs = then - now.getTime(); // negative = past
    const absMs = Math.abs(diffMs);

    if (absMs < MINUTE) return 'now';
    if (absMs < HOUR) return rtf.format(Math.round(diffMs / MINUTE), 'minute');
    if (absMs < DAY) return rtf.format(Math.round(diffMs / HOUR), 'hour');
    if (absMs < WEEK) return rtf.format(Math.round(diffMs / DAY), 'day');
    return rtf.format(Math.round(diffMs / WEEK), 'week');
}
