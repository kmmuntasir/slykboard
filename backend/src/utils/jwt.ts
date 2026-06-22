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
  role: 'ADMIN' | 'MEMBER';
  ver: number; // F07 D3: token version. Compared to Users.tokenVersion in authenticate.
}

export function signJwt(claims: JwtUserClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role, ver: claims.ver })
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

  // Per-field narrowing: JWT payload's open index signature types sub/email/role
  // as `unknown`. Narrow each to its declared type before returning, so the
  // JwtUserClaims half of the return type is honest without a whole-object cast.
  const sub = payload.sub;
  const email = payload.email;
  const role = payload.role;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing required claims');
  }
  if (role !== 'ADMIN' && role !== 'MEMBER') {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token missing required claims');
  }

  return { ...payload, sub, email, role, ver: payload.ver };
}
