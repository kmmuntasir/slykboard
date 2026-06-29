import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config';
import { AppError } from './appError';
import { ErrorCode } from './envelope';

const JWT_ISSUER = 'slykboard';
const JWT_AUDIENCE = 'slykboard-web';
const JWT_CLOCK_TOLERANCE = '30s';
// F07 D8: TTL is env-driven (env.jwtTtl, default '8h'). Read at sign time so
// config is the single source of truth. Removed the hardcoded JWT_TTL constant.

const secretKey = new TextEncoder().encode(env.jwtSecret);

export interface JwtUserClaims {
  sub: string; // user.id (uuid)
  email: string;
  // SLYK-01: platform-admin boolean replaces the global role enum. Project-scoped
  // roles are NOT in the JWT (per-project, resolved by middleware in Batch 3).
  pa: boolean;
  ver: number; // F07 D3: token version. Compared to Users.tokenVersion in authenticate.
}

export function signJwt(claims: JwtUserClaims): Promise<string> {
  return new SignJWT({ email: claims.email, pa: claims.pa, ver: claims.ver })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(env.jwtTtl)
    .sign(secretKey);
}

export async function verifyJwt(token: string): Promise<JwtUserClaims & JWTPayload> {
  const { payload } = await jwtVerify(token, secretKey, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: JWT_CLOCK_TOLERANCE,
  });

  // F07 M3: jose returns raw JSON values and its payload index signature
  // types every custom claim as `unknown`. Validate `ver` at runtime so a
  // pre-F07 or malformed token (ver absent, or a string like "0") fails
  // closed instead of relying on `undefined !== 0` happening to produce a 401.
  if (typeof payload.ver !== 'number' || !Number.isFinite(payload.ver)) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing numeric ver claim');
  }

  // SLYK-01: per-field narrowing. The JWT payload's open index signature types
  // custom claims as `unknown`; narrow each to its declared type before returning.
  // `pa` must be present and boolean — pre-SLYK-01 tokens (carrying `role` only)
  // fail closed here and are rejected as UNAUTHENTICATED.
  const sub = payload.sub;
  const email = payload.email;
  const pa = payload.pa;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing required claims');
  }
  if (typeof pa !== 'boolean') {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing required claims');
  }

  return { ...payload, sub, email, pa, ver: payload.ver };
}
