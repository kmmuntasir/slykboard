import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config';

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
  return payload as JwtUserClaims & JWTPayload;
}
