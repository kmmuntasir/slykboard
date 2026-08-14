import { createHmac, timingSafeEqual } from 'node:crypto';

// SLYK-0170 — HMAC helpers for the mock dispatcher, per
// docs/agentic-automation/10-mock-dispatcher.md § HMAC verification helper.
// Same scheme as slykboard's agentTokenAuth (SLYK-0150): hex HMAC-SHA256
// over the RAW request bytes, keyed by the shared dispatcher token.
// Outbound (mock → slykboard) requests sign with `sign()` so slykboard's
// agentTokenAuth accepts the mock's callbacks — the signature scheme is
// identical, only the header name differs (X-Dispatcher-Signature vs
// X-Slykboard-Signature).

export const SLYKBOARD_SIGNATURE_HEADER = 'x-slykboard-signature';
export const DISPATCHER_SIGNATURE_HEADER = 'x-dispatcher-signature';

/** Sign raw bytes (outbound callbacks) — hex HMAC-SHA256. */
export function sign(rawBody: Buffer | string, token: string): string {
  return createHmac('sha256', token).update(rawBody).digest('hex');
}

/** Sign a JSON-serializable body via JSON.stringify (test/driver convenience). */
export function signJson(body: unknown, token: string): string {
  return sign(JSON.stringify(body), token);
}

/** Constant-time hex-digest comparison; false on missing/length-mismatch. */
export function signaturesMatch(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Length check first — timingSafeEqual throws on mismatch, and the length
  // of a hex digest is not a secret.
  return a.length === b.length && timingSafeEqual(a, b);
}
