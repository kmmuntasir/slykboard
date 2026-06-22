import { env } from '../config';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// D6: extract domain from email, lowercase per RFC 5321 (domain is case-insensitive).
// lastIndexOf defends against malformed multi-@ (indexOf would mis-split).
// Returns '' for malformed input (no @, or trailing @) — caller compares against
// the normalized allowedDomain and rejects empty domains.
export function normalizeEmailDomain(email: string): string {
  const atIndex = email.trim().lastIndexOf('@');
  if (atIndex === -1 || atIndex === email.trim().length - 1) return '';
  return email
    .trim()
    .slice(atIndex + 1)
    .toLowerCase();
}

// D3 + D13: if env.allowedDomain is unset/empty, allow all (F06 "if configured").
// Otherwise the email's domain must EXACTLY match the normalized allowedDomain
// (case-insensitive, no subdomain wildcard). Throws AppError(FORBIDDEN) on mismatch
// or malformed email — first app-level use of ErrorCode.FORBIDDEN.
export function assertDomainAllowed(email: string): void {
  if (!env.allowedDomain) return; // D13 — empty/unset = allow all
  const userDomain = normalizeEmailDomain(email);
  const allowedDomain = normalizeEmailDomain(`x@${env.allowedDomain}`);
  if (!userDomain || userDomain !== allowedDomain) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Your Google account is not in the allowed workspace');
  }
}
