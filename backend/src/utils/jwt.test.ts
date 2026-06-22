import { describe, it, expect, vi } from 'vitest';

vi.mock('../config', async (importActual) => {
  const actual = await importActual<typeof import('../config')>();
  // Shallow-copy the frozen env into a mutable object so tests can flip jwtTtl.
  return { env: { ...actual.env } };
});

import { SignJWT } from 'jose';
import { signJwt, verifyJwt, type JwtUserClaims } from './jwt';
import { env } from '../config';
import type { Config } from '../config';
import { AppError } from './appError';
import { ErrorCode } from './envelope';

const secretKey = new TextEncoder().encode(env.jwtSecret);

const validClaims: JwtUserClaims = {
  sub: 'user-uuid-123',
  email: 'test@slykboard.test',
  role: 'MEMBER',
  ver: 1,
};

function signBadToken(
  overrides: {
    issuer?: string;
    audience?: string;
    expiresIn?: string;
  } = {},
): Promise<string> {
  return new SignJWT({ email: 'x@slykboard.test', role: 'MEMBER' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? 'slykboard')
    .setAudience(overrides.audience ?? 'slykboard-web')
    .setExpirationTime(overrides.expiresIn ?? '8h')
    .sign(secretKey);
}

function tamperSignature(token: string): string {
  const parts = token.split('.');
  const sig = parts[2] ?? '';
  const last = sig.charAt(sig.length - 1);
  const flipped = last === 'a' ? 'b' : 'a';
  parts[2] = sig.slice(0, -1) + flipped;
  return parts.join('.');
}

describe('jwt', () => {
  it('signs and verifies a valid token', async () => {
    const token = await signJwt(validClaims);
    const payload = await verifyJwt(token);

    expect(payload.sub).toBe(validClaims.sub);
    expect(payload.email).toBe(validClaims.email);
    expect(payload.role).toBe(validClaims.role);
    expect(payload.iss).toBe('slykboard');
    expect(payload.aud).toBe('slykboard-web');
    expect(payload.iat).toBeTruthy();
    expect(payload.exp! - payload.iat!).toBe(8 * 60 * 60);
  });

  it('rejects a tampered token', async () => {
    const token = await signJwt(validClaims);
    const tampered = tamperSignature(token);
    await expect(verifyJwt(tampered)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const expired = await signBadToken({ expiresIn: '-31s' });
    await expect(verifyJwt(expired)).rejects.toThrow();
  });

  it('rejects wrong issuer', async () => {
    const badIssuer = await signBadToken({ issuer: 'evil' });
    await expect(verifyJwt(badIssuer)).rejects.toThrow();
  });

  it('rejects wrong audience', async () => {
    const badAudience = await signBadToken({ audience: 'evil' });
    await expect(verifyJwt(badAudience)).rejects.toThrow();
  });

  it('throws on malformed (non-JWT) string', async () => {
    await expect(verifyJwt('not-a-jwt')).rejects.toThrow();
  });

  it('embeds the ver claim and round-trips it through verify', async () => {
    const token = await signJwt({ ...validClaims, ver: 5 });
    const payload = await verifyJwt(token);
    expect(payload.ver).toBe(5);
  });

  it('throws UNAUTHENTICATED when ver claim is missing', async () => {
    // Mirror signBadToken style: raw SignJWT, correct issuer/audience/exp,
    // but omit `ver` from the payload object entirely.
    const token = await new SignJWT({ email: 'test@slykboard.test', role: 'MEMBER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(validClaims.sub)
      .setIssuedAt()
      .setIssuer('slykboard')
      .setAudience('slykboard-web')
      .setExpirationTime('8h')
      .sign(secretKey);

    await expect(verifyJwt(token)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Token missing numeric ver claim',
    });
    await expect(verifyJwt(token)).rejects.toBeInstanceOf(AppError);
  });

  it('throws UNAUTHENTICATED when ver claim is a string', async () => {
    // ver: "0" must fail closed — typeof string !== number.
    const token = await new SignJWT({ email: 'test@slykboard.test', role: 'MEMBER', ver: '0' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(validClaims.sub)
      .setIssuedAt()
      .setIssuer('slykboard')
      .setAudience('slykboard-web')
      .setExpirationTime('8h')
      .sign(secretKey);

    await expect(verifyJwt(token)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Token missing numeric ver claim',
    });
  });

  it('honors env.jwtTtl for the expiration window', async () => {
    // env is typed Readonly<Config>; the mock backs it with a mutable object,
    // so cast to the mutable shape for this scenario only.
    const mutableEnv = env as Config;
    const original = mutableEnv.jwtTtl;
    mutableEnv.jwtTtl = '1m';
    try {
      const token = await signJwt(validClaims);
      const payload = await verifyJwt(token);
      expect(payload.exp! - payload.iat!).toBe(60);
    } finally {
      mutableEnv.jwtTtl = original;
    }
  });
});
