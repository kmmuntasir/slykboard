// F21: parse a human duration string into integer minutes.
//   '2h 30m' -> 180   '90m' -> 90   '1.5h' -> 90   '30' -> 30   '' -> null
// The parser ONLY parses; it does NOT enforce the 1-1440 cap — the form does
// validation. So '0m' -> 0 and '25h' -> 1500 are returned as-is.
const MINUTES_PER_HOUR = 60;

// Hours (optional, fractional) + minutes (optional, fractional). At least one
// group must be present, otherwise the empty/whitespace match is rejected.
const HM_RE = /^\s*(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*$/;
// Bare number (no unit) — treated as minutes.
const BARE_RE = /^\d+(?:\.\d+)?$/;

export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '') return null;

  const hm = HM_RE.exec(trimmed);
  if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
    const hours = hm[1] !== undefined ? Number(hm[1]) : 0;
    const minutes = hm[2] !== undefined ? Number(hm[2]) : 0;
    return Math.round(hours * MINUTES_PER_HOUR + minutes);
  }

  if (BARE_RE.test(trimmed)) {
    return Math.round(Number(trimmed));
  }

  return null;
}
