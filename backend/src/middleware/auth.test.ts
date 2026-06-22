import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { SignJWT } from 'jose';
import { authenticate } from './auth';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { env } from '../config';

// Hoisted mock for tokenVersion service. Tests set return values per-case.
const tokenVersionMock = vi.hoisted(() => ({ findUserTokenVersion: vi.fn() }));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: tokenVersionMock.findUserTokenVersion,
}));

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
  // Flip the FIRST signature char (not the last). base64url's trailing char
  // holds only 4 meaningful bits (2 high bits ignored by decoders), so flipping
  // it can be a byte-wise no-op and leave the HMAC intact — a time-dependent
  // flake (signature shifts with each iat). The first char always encodes 6
  // meaningful bits of byte 0, so flipping it deterministically breaks the sig.
  const first = sig.charAt(0);
  const flipped = first === 'a' ? 'b' : 'a';
  parts[2] = flipped + sig.slice(1);
  return parts.join('.');
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    tokenVersionMock.findUserTokenVersion.mockReset();
  });

  it('attaches req.user when ver matches', async () => {
    tokenVersionMock.findUserTokenVersion.mockResolvedValueOnce(0);
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER', ver: 0 });
    const req = makeReq(`Bearer ${token}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await authenticate(req, res, next);

    expect(tokenVersionMock.findUserTokenVersion).toHaveBeenCalledWith('user-123');
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'user-123', email: 'a@b.com', role: 'MEMBER' });
  });

  it('throws UNAUTHENTICATED "Token version mismatch" when ver mismatches', async () => {
    tokenVersionMock.findUserTokenVersion.mockResolvedValueOnce(1);
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER', ver: 0 });
    const req = makeReq(`Bearer ${token}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Token version mismatch',
    });
  });

  it('throws UNAUTHENTICATED when user not found', async () => {
    tokenVersionMock.findUserTokenVersion.mockResolvedValueOnce(undefined);
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER', ver: 0 });
    const req = makeReq(`Bearer ${token}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
  });

  it('throws UNAUTHENTICATED on missing header', async () => {
    const req = makeReq();
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Missing or invalid token',
    });
    expect(tokenVersionMock.findUserTokenVersion).not.toHaveBeenCalled();
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
      expect(tokenVersionMock.findUserTokenVersion).not.toHaveBeenCalled();
    });
  });

  it('throws UNAUTHENTICATED on expired token', async () => {
    const expired = await signExpiredToken({
      sub: 'user-123',
      email: 'a@b.com',
      role: 'MEMBER',
    });
    const req = makeReq(`Bearer ${expired}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
    // F07 D3: verifyJwt throws before the DB compare is reached.
    expect(tokenVersionMock.findUserTokenVersion).not.toHaveBeenCalled();
  });

  it('throws UNAUTHENTICATED on tampered token', async () => {
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER', ver: 0 });
    const tampered = tamperSignature(token);
    const req = makeReq(`Bearer ${tampered}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await expect(authenticate(req, res, next)).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
    });
    // F07 D3: verifyJwt throws before the DB compare is reached.
    expect(tokenVersionMock.findUserTokenVersion).not.toHaveBeenCalled();
  });

  it('accepts lowercase scheme', async () => {
    tokenVersionMock.findUserTokenVersion.mockResolvedValueOnce(0);
    const token = await signJwt({ sub: 'user-123', email: 'a@b.com', role: 'MEMBER', ver: 0 });
    const req = makeReq(`bearer ${token}`);
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({ id: 'user-123', email: 'a@b.com', role: 'MEMBER' });
  });

  it('does not leak verifyJwt error in message', async () => {
    const expired = await signExpiredToken({
      sub: 'user-123',
      email: 'a@b.com',
      role: 'MEMBER',
    });
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
