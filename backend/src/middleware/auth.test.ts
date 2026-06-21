import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { SignJWT } from 'jose';
import { authenticate } from './auth';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { env } from '../config';

const secretKey = new TextEncoder().encode(env.jwtSecret);

function makeReq(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as Request;
}

function signExpiredToken(claims: {
  sub: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
}): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('-31s')
    .setIssuer('slykboard')
    .setAudience('slykboard-web')
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

describe('authenticate middleware', () => {
  it('attaches req.user on valid token', async () => {
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER' });
    const req = makeReq(`Bearer ${token}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'user-123', email: 'a@b.com', role: 'MEMBER' });
  });

  it('throws UNAUTHENTICATED on missing header', async () => {
    const req = makeReq();
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Missing or invalid token',
    });
  });

  [
    { name: 'Basic scheme', header: 'Basic abc' },
    { name: 'Bearer without token', header: 'Bearer' },
  ].forEach(({ name, header }) => {
    it(`throws UNAUTHENTICATED on malformed scheme (${name})`, async () => {
      const req = makeReq(header);
      const res = {} as Response;
      const next = vi.fn() as unknown as NextFunction;

      await expect(authenticate(req, res, next)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHENTICATED,
      });
    });
  });

  it('throws UNAUTHENTICATED on expired token', async () => {
    const expired = await signExpiredToken({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER' });
    const req = makeReq(`Bearer ${expired}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it('throws UNAUTHENTICATED on tampered token', async () => {
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER' });
    const tampered = tamperSignature(token);
    const req = makeReq(`Bearer ${tampered}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it('accepts lowercase scheme', async () => {
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER' });
    const req = makeReq(`bearer ${token}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'user-123', email: 'a@b.com', role: 'MEMBER' });
  });

  it('does not leak verifyJwt error in message', async () => {
    const expired = await signExpiredToken({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER' });
    const req = makeReq(`Bearer ${expired}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    try {
      await authenticate(req, res, next);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.code).toBe(ErrorCode.UNAUTHENTICATED);
      expect(e.message).toBe('Missing or invalid token');
    }
  });
});
