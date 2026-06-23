import DOMPurify from 'dompurify';

// Re-init with explicit window so DOMPurify binds under both browser (Vite
// bundle) and jsdom (Vitest), where module-load order can race with the
// global window.
const purify = DOMPurify(globalThis.window);

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'blockquote',
  'a',
  'h3',
  'h4',
];
const ALLOWED_ATTR = ['href'];

// F13 T10: client-side sanitize for ticket description. Mirrors backend
// sanitize-on-write; called on read before rendering rich text.
export function sanitizeDescription(input: string | null | undefined): string {
  if (!input) return '';
  return purify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
}
