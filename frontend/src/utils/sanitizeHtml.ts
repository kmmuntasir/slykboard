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
const ALLOWED_ATTR = ['href', 'src', 'alt', 'target', 'rel'];

// Defense-in-depth URI filter that mirrors the backend canonical list
// byte-for-byte (DEL-01 T3). Negative lookahead rejects any value beginning
// with `javascript:` or `data:`; the remainder matches the DOMPurify default
// IS_ALLOWED_URI shape, which permits http:/https:/mailto:/tel:/callto:/sms:/
// cid:/xmpp:, protocol-relative (//host), root-relative (/path), and bare
// words so non-URI values still pass.
const ALLOWED_URI_REGEXP =
  /^(?!javascript:|data:)(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// DOMPurify 3.x keeps a built-in data-URI allowance for media tags
// (DATA_URI_TAGS includes `img`) that runs in a branch AFTER the
// ALLOWED_URI_REGEXP check, which would otherwise let `img src="data:..."`
// slip through despite the regex rejecting `data:`. This hook closes that
// gap so the URI policy matches the backend canonical list byte-for-byte.
purify.addHook('uponSanitizeAttribute', (_node, data) => {
  const name = data.attrName.toLowerCase();
  if (name === 'src' || name === 'href') {
    const value = (data.attrValue ?? '').trim().toLowerCase();
    if (value.startsWith('javascript:') || value.startsWith('data:')) {
      data.keepAttr = false;
    }
  }
});

// F13 T10: client-side sanitize for ticket description. Mirrors backend
// sanitize-on-write; called on read before rendering rich text.
export function sanitizeDescription(input: string | null | undefined): string {
  if (!input) return '';
  return purify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
}
