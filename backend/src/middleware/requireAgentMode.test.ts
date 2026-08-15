import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { requireAgentMode } from './requireAgentMode';
import { agentTokenAuth } from './agentTokenAuth';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-0370 — agentTokenAuth's DB seam. Default: no active DB tokens, so the
// env path is the only candidate source unless a test seeds rows.
const activeHashes = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock('../services/agentTokenService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agentTokenService')>();
  return { ...actual, listActiveTokenHashes: activeHashes };
});

// SLYK-0110/0150 — agent middleware. requireAgentMode gates /api/v1/* mounts
// on SLYKBOARD_AGENT_MODE; agentTokenAuth verifies the dispatcher's
// X-Dispatcher-Signature HMAC over req.rawBody (end-to-end supertest coverage
// lives in routes/internal.routes.test.ts). SLYK-0370 made agentTokenAuth
// async (dual-source candidate query) and added the DB-token path tests
// below — listActiveTokenHashes is mocked so no DB is hit here.

describe('requireAgentMode gate', () => {
  const tests = [
    { name: 'calls next when SLYKBOARD_AGENT_MODE=true', env: 'true', expectThrow: false },
    {
      name: 'throws NOT_IMPLEMENTED when SLYKBOARD_AGENT_MODE=false',
      env: 'false',
      expectThrow: true,
    },
    {
      name: 'throws NOT_IMPLEMENTED when SLYKBOARD_AGENT_MODE unset',
      env: undefined,
      expectThrow: true,
    },
    {
      name: 'throws NOT_IMPLEMENTED when SLYKBOARD_AGENT_MODE is any other value',
      env: '1',
      expectThrow: true,
    },
  ];

  tests.forEach(({ name, env, expectThrow }) => {
    it(name, () => {
      if (env === undefined) {
        delete process.env.SLYKBOARD_AGENT_MODE;
      } else {
        process.env.SLYKBOARD_AGENT_MODE = env;
      }

      const req = {} as Request;
      const res = {} as Response;
      const next = vi.fn() as unknown as NextFunction;

      if (expectThrow) {
        try {
          requireAgentMode(req, res, next);
          expect.unreachable('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(AppError);
          const e = err as AppError;
          expect(e.code).toBe(ErrorCode.NOT_IMPLEMENTED);
          expect(e.status).toBe(501);
          expect(e.message).toBe('Agent mode is not enabled on this server');
        }
        expect(next).not.toHaveBeenCalled();
      } else {
        requireAgentMode(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
      }
    });
  });

  afterEach(() => {
    delete process.env.SLYKBOARD_AGENT_MODE;
  });
});

describe('agentTokenAuth HMAC verification (SLYK-0150, dual-source SLYK-0370)', () => {
  const TOKEN = 'a'.repeat(64);
  const DB_TOKEN = 'e'.repeat(64);
  const validSig = createHmac('sha256', TOKEN)
    .update(Buffer.from('{"state":"QUEUED"}'))
    .digest('hex');

  // Minimal Request stand-in: express's header() does case-insensitive lookup
  // on the raw headers object — same behavior the middleware relies on.
  function signedRequest(headers: Record<string, string>, rawBody?: Buffer): Request {
    const req = {
      headers,
      rawBody,
      header(name: string): string | undefined {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key === undefined ? undefined : headers[key];
      },
    };
    return req as unknown as Request;
  }

  function sha256Hex(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  beforeEach(() => {
    activeHashes.mockClear();
    activeHashes.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.SLYKBOARD_AGENT_MODE;
    delete process.env.SLYKBOARD_DISPATCHER_TOKEN;
  });

  it('throws INTERNAL_ERROR (500) when agent mode is on but token env is unset', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    delete process.env.SLYKBOARD_DISPATCHER_TOKEN;

    await expect(
      agentTokenAuth(signedRequest({}), {} as Response, vi.fn() as unknown as NextFunction),
    ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR, status: 500 });
  });

  it('throws UNAUTHENTICATED when X-Dispatcher-Signature is missing', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    await expect(
      agentTokenAuth(signedRequest({}), {} as Response, vi.fn() as unknown as NextFunction),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Missing dispatcher signature',
    });
  });

  it('calls next() for a valid hex HMAC-SHA256 over the raw bytes', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    const next = vi.fn() as unknown as NextFunction;
    await agentTokenAuth(
      signedRequest({ 'x-dispatcher-signature': validSig }, Buffer.from('{"state":"QUEUED"}')),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('throws UNAUTHENTICATED for a signature over different bytes', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    await expect(
      agentTokenAuth(
        signedRequest({ 'x-dispatcher-signature': validSig }, Buffer.from('{"state":"DONE"}')),
        {} as Response,
        vi.fn() as unknown as NextFunction,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Invalid dispatcher signature',
    });
  });

  it('throws UNAUTHENTICATED for a length-mismatched (truncated) signature', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    await expect(
      agentTokenAuth(
        signedRequest(
          { 'x-dispatcher-signature': validSig.slice(0, 62) },
          Buffer.from('{"state":"QUEUED"}'),
        ),
        {} as Response,
        vi.fn() as unknown as NextFunction,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  // ── SLYK-0370 dual-source (DB first, env fallback) ──────────────────────

  it('DB token (presented raw matches an active row hash + valid signature) → next()', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;
    activeHashes.mockResolvedValue([sha256Hex(DB_TOKEN)]);

    const sig = createHmac('sha256', DB_TOKEN)
      .update(Buffer.from('{"state":"QUEUED"}'))
      .digest('hex');
    const next = vi.fn() as unknown as NextFunction;
    await agentTokenAuth(
      signedRequest(
        { 'x-dispatcher-signature': sig, 'x-dispatcher-token': DB_TOKEN },
        Buffer.from('{"state":"QUEUED"}'),
      ),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(activeHashes).toHaveBeenCalledTimes(1);
  });

  it('presented token matching a row but WRONG signature → falls to env → 401 (generic)', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;
    activeHashes.mockResolvedValue([sha256Hex(DB_TOKEN)]);

    // Signed with the env token's bytes… no — signed with a THIRD key, over
    // the right bytes: possession of the row hash alone must not pass.
    const sig = createHmac('sha256', 'f'.repeat(64))
      .update(Buffer.from('{"state":"QUEUED"}'))
      .digest('hex');
    await expect(
      agentTokenAuth(
        signedRequest(
          { 'x-dispatcher-signature': sig, 'x-dispatcher-token': DB_TOKEN },
          Buffer.from('{"state":"QUEUED"}'),
        ),
        {} as Response,
        vi.fn() as unknown as NextFunction,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.UNAUTHENTICATED });
  });

  it('revoked DB token (hash absent from candidate set) → 401 even with its valid signature', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;
    activeHashes.mockResolvedValue([]); // revocation removed the row from the set

    const sig = createHmac('sha256', DB_TOKEN)
      .update(Buffer.from('{"state":"QUEUED"}'))
      .digest('hex');
    await expect(
      agentTokenAuth(
        signedRequest(
          { 'x-dispatcher-signature': sig, 'x-dispatcher-token': DB_TOKEN },
          Buffer.from('{"state":"QUEUED"}'),
        ),
        {} as Response,
        vi.fn() as unknown as NextFunction,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Invalid dispatcher signature',
    });
  });

  it('unknown presented token (no row) still reaches the env fallback', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;
    activeHashes.mockResolvedValue([sha256Hex(DB_TOKEN)]);

    // Presented token is unknown BUT the signature is a valid env signature —
    // path 2 misses, path 1 catches. Coexistence is the contract.
    const sig = createHmac('sha256', TOKEN).update(Buffer.from('{"state":"QUEUED"}')).digest('hex');
    const next = vi.fn() as unknown as NextFunction;
    await agentTokenAuth(
      signedRequest(
        { 'x-dispatcher-signature': sig, 'x-dispatcher-token': 'f'.repeat(64) },
        Buffer.from('{"state":"QUEUED"}'),
      ),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('no X-Dispatcher-Token header → DB candidate query never runs (env only)', async () => {
    process.env.SLYKBOARD_AGENT_MODE = 'true';
    process.env.SLYKBOARD_DISPATCHER_TOKEN = TOKEN;

    const next = vi.fn() as unknown as NextFunction;
    await agentTokenAuth(
      signedRequest({ 'x-dispatcher-signature': validSig }, Buffer.from('{"state":"QUEUED"}')),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(activeHashes).not.toHaveBeenCalled();
  });
});
