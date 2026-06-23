// F14 T5: WCAG relative-luminance contrast helper.
// Picks black or white text for a given #RRGGBB background so the chip is
// always readable. Threshold L > 0.179 → black text (WCAG 2.x simplified).

/**
 * Returns `#000000` or `#FFFFFF` — whichever contrasts more with `hex`.
 * Input is a 6-digit hex color (`#RRGGBB`); the leading `#` is optional.
 */
export function readableTextColor(hex: string): '#000000' | '#FFFFFF' {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const linear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const L = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  return L > 0.179 ? '#000000' : '#FFFFFF';
}
