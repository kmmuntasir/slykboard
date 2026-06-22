// F08 D-Slug-Format: uppercase alphanumerics, start with letter, len 2–16.
export const SLUG_REGEX = /^[A-Z][A-Z0-9]{1,15}$/;

// F08 D-Reserved-Slugs: route-namespace collisions blocked.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'API',
  'AUTH',
  'HEALTH',
  'REPORTS',
  'SETTINGS',
  'LOGIN',
  'NEW',
  'ADMIN',
]);

// Normalize: uppercase + strip non-alphanumerics. Applied BEFORE uniqueness check
// so 'slyk' / 'Slyk ' / 'sly-k' inputs all converge to 'SLYK'.
export function normalizeSlug(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toUpperCase());
}
