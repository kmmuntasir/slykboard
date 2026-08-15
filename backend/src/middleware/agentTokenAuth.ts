import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { hashToken, listActiveTokenHashes } from '../services/agentTokenService';

// SLYK-0150 — HMAC signature verification for dispatcher→slykboard requests
// (docs/agentic-automation/03-security.md § Dispatcher → slykboard).
// X-Dispatcher-Signature = hex HMAC-SHA256 of the request's RAW bytes. Must
// be mounted AFTER the verify-configured json parser that captures
// req.rawBody (see index.ts) — signing over the parsed/re-serialized body
// would break on key-ordering differences.
// All rejections are AppError so errorMiddleware emits the standard envelope
// (unlike the doc's paraphrased res.status().json() sketches).
//
// SLYK-0370 — dual token sources (11-existing-patterns.md § Dispatcher
// handshake: "DB tokens checked first, env token is fallback"). Env token
// stays the bootstrap path 1; AgentTokens rows are the rotation path 2.
// Only sha256(raw) is stored, so a stored row cannot serve as an HMAC key —
// the dispatcher presents its raw token in X-Dispatcher-Token, the
// middleware hash-compares it against non-revoked rows, and the SIGNATURE
// (still over the raw bytes with that token) proves possession. Revoked
// rows fall out of the candidate set, which is what makes revocation
// immediate. Async since SLYK-0370 (candidate query); Express 5 forwards
// the rejected promise to errorMiddleware.
export async function agentTokenAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const envToken = process.env.SLYKBOARD_DISPATCHER_TOKEN;

  // Unset token in agent mode is a config bug, not a client auth failure —
  // env validation (SLYK-0130) requires the dispatcher pair in agent mode
  // and should have refused to boot. 500, never 401.
  if (!envToken) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      'SLYKBOARD_DISPATCHER_TOKEN is not configured for agent mode',
    );
  }

  const signature = req.header('x-dispatcher-signature');
  if (!signature) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing dispatcher signature');
  }

  // Empty-body requests (GET deploy-target) sign the empty string; rawBody is
  // only set when the scoped parser actually buffered bytes.
  const rawBody = req.rawBody ?? Buffer.alloc(0);

  // ── Path 2: DB tokens, checked first ───────────────────────────────────
  // Candidate set = non-revoked rows; the presented raw token is hashed and
  // timing-safe compared against each (tokens are 64-hex, set is small).
  // Queried per request — volume is low; cache seam noted in the service.
  const presented = req.header('x-dispatcher-token');
  if (presented) {
    const presentedHash = Buffer.from(hashToken(presented), 'utf8');
    const activeHashes = await listActiveTokenHashes();
    const rowMatched = activeHashes.some(
      (rowHash) =>
        presentedHash.length === Buffer.byteLength(rowHash) &&
        timingSafeEqual(presentedHash, Buffer.from(rowHash, 'utf8')),
    );
    if (rowMatched && signatureMatches(signature, presented, rawBody)) {
      next();
      return;
    }
  }

  // ── Path 1: env token, fallback ────────────────────────────────────────
  if (signatureMatches(signature, envToken, rawBody)) {
    next();
    return;
  }

  // Generic rejection either way — never reveal which path failed.
  throw new AppError(ErrorCode.UNAUTHENTICATED, 'Invalid dispatcher signature');
}

function signatureMatches(signature: string, token: string, rawBody: Buffer): boolean {
  const expected = createHmac('sha256', token).update(rawBody).digest('hex');

  // Length check first — timingSafeEqual throws on length mismatch, and the
  // length itself is not a secret (both sides are fixed-size hex digests).
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
