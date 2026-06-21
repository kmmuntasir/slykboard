import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config';

const JWT_ISSUER = 'slykboard';
const JWT_AUDIENCE = 'slykboard-web';
const JWT_TTL = '8h';
const JWT_CLOCK_TOLERANCE = '30s';

const secretKey = new TextEncoder().encode(env.jwtSecret);

export interface JwtUserClaims {
  sub: string; // user.id (uuid)
  email: string;
  role: 'ADMIN' | 'MEMBER';
}

export function signJwt(claims: JwtUserClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_TTL)
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
