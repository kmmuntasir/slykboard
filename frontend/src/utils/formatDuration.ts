// F20 T7: format a millisecond duration into a compact h/m/s string.
//   0 or negative        -> "0s"
//   < 60s (seconds only) -> "30s"
//   < 3600s (minutes)    -> "45m"  (seconds dropped; 0m -> "0s")
//   >= 3600s (hours)     -> "1h 30m" (seconds dropped)
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m`;
  }
  return `${s}s`;
}
