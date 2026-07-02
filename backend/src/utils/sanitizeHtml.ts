import DOMPurify from 'isomorphic-dompurify';

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
  // DEL-01 T2: widened rich-text allow-list (strike, headings, image).
  'b',
  'i',
  's',
  'del',
  'strike',
  'u',
  'h1',
  'h2',
  'img',
];

const ALLOWED_ATTR = [
  'href',
  // DEL-01 T2: image + safe-link attributes.
  'src',
  'alt',
  'target',
  'rel',
];

// DEL-01 T2: defense-in-depth URI filter. The DOMPurify default IS_ALLOWED_URI
// (which permits `[^a-z]` and bare words so non-URI values like target="_blank"
// or rel="noopener" still pass) extended with a leading negative lookahead that
// rejects any value beginning with `javascript:` or `data:`. Anything not
// matching is stripped before serialization. Allows http:, https:, mailto:,
// tel:, protocol-relative (//host) and root-relative (/path) references.
const ALLOWED_URI_REGEXP =
  /^(?!javascript:|data:)(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// DEL-01 T2: DOMPurify hard-codes `data:` URIs as safe on <img>/<video>/...
// (DATA_URI_TAGS) regardless of ALLOWED_URI_REGEXP, so the regexp alone cannot
// strip a `data:` img src. This `uponSanitizeAttribute` hook is the sanctioned
// DOMPurify mechanism that closes that gap: it removes the attribute when a
// `href`/`src` carries a `javascript:` or `data:` URI. Registered once at module
// load (this module is the sole DOMPurify consumer) — idempotent and global by
// DOMPurify design.
const DANGEROUS_URI = /^(?:javascript|data):/i;
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (
    (data.attrName === 'href' || data.attrName === 'src') &&
    DANGEROUS_URI.test(data.attrValue)
  ) {
    data.keepAttr = false;
  }
});

export function sanitizeDescription(input: string | null | undefined): string {
  if (!input) return '';
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    ALLOWED_URI_REGEXP,
  });
}
