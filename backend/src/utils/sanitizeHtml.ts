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
  'figure',
  'figcaption',
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

/**
 * Keep only width / max-width declarations from an inline style string.
 * Returns "" when nothing survives, so callers can drop the attribute.
 */
function subsetWidthStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of (style ?? '').split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (prop === 'width' || prop === 'max-width') {
      const val = decl.slice(idx + 1).trim();
      if (val) kept.push(`${decl.slice(0, idx).trim()}:${val}`);
    }
  }
  return kept.join('; ');
}

// Minimal structural type for a node accepting setAttribute. Avoids pulling in
// the DOM lib (backend tsconfig targets ES2023 only, no "dom" in lib); the
// DOMPurify hook node is a real jsdom Element at runtime.
type SetAttributeNode = { setAttribute(name: string, value: string): void };

// DEL-01 T2: DOMPurify hard-codes `data:` URIs as safe on <img>/<video>/...
// (DATA_URI_TAGS) regardless of ALLOWED_URI_REGEXP, so the regexp alone cannot
// strip a `data:` img src. This `uponSanitizeAttribute` hook is the sanctioned
// DOMPurify mechanism that closes that gap: it removes the attribute when a
// `href`/`src` carries a `javascript:` or `data:` URI, and scopes width/style/
// class to the elements that may carry a resize width. Registered once at module
// load (this module is the sole DOMPurify consumer) — idempotent and global by
// DOMPurify design.
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName.toLowerCase();

  // javascript: / data: URI guard (unchanged behavior; defense-in-depth with
  // ALLOWED_URI_REGEXP).
  if (name === 'src' || name === 'href') {
    const value = (data.attrValue ?? '').trim().toLowerCase();
    if (value.startsWith('javascript:') || value.startsWith('data:')) {
      data.keepAttr = false;
    }
    return;
  }

  // Scope width/style/class to specific elements. These names are NOT in
  // ALLOWED_ATTR, so we force-keep them where allowed and drop elsewhere.
  if (name === 'width' || name === 'style' || name === 'class') {
    const tag = node.nodeName.toLowerCase();
    const isImg = tag === 'img';
    const isFigure = tag === 'figure';
    const isFigcaption = tag === 'figcaption';
    const keep =
      isImg ||
      (isFigure && (name === 'style' || name === 'width' || name === 'class')) ||
      (isFigcaption && name === 'class');

    if (!keep) {
      data.keepAttr = false;
      return;
    }

    if (name === 'style') {
      const subset = subsetWidthStyle(data.attrValue ?? '');
      if (subset === '') {
        data.keepAttr = false; // never emit style=""
        return;
      }
      // forceKeepAttr skips DOMPurify's attrValue write-back, so write the
      // subset directly to the node BEFORE setting forceKeepAttr (the
      // dompurify@3.4.11 forceKeepAttr path early-continues past
      // _setAttributeValue).
      const settable = node as unknown as SetAttributeNode;
      if (settable && typeof settable.setAttribute === 'function') {
        settable.setAttribute('style', subset);
      }
      data.forceKeepAttr = true;
      return;
    }

    data.forceKeepAttr = true;
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
