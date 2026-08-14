import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { postToDispatcher, DispatcherError } from './dispatcherClient';
import { TEST_DISPATCHER_TOKEN } from '../test/hmac';

// SLYK-0180 — dispatcherClient against a REAL HTTP listener (ticket: local
// server on a random port; same raw-body HMAC scheme as the mock skeleton).
// The listener records every request and replays a scripted status sequence,
// so retry/backoff/idempotency behavior is asserted from the wire's point of
// view. Backoff is env-scaled (SLYKBOARD_DISPATCHER_BACKOFF_SCALE=0.01 →
// 10ms/50ms/300ms) — no real 1s/5s/30s waits in CI.

const TOKEN = TEST_DISPATCHER_TOKEN;
const BACKOFF_SCALE = 0.01;

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  rawBody: string;
  signature: string | string[] | undefined;
  contentType: string | string[] | undefined;
  parsed: unknown;
}

/** Node headers can be string[] — normalize for assertions. */
function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Scripted listener: pops one status per request; 204/202-empty have no body. */
function makeListener(script: number[], options: { emptyBody?: boolean } = {}) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = undefined;
      }
      requests.push({
        method: req.method,
        url: req.url,
        rawBody,
        signature: req.headers['x-slykboard-signature'],
        contentType: req.headers['content-type'],
        parsed,
      });
      const status = script[Math.min(requests.length - 1, script.length - 1)]!;
      if (status === 204 || options.emptyBody) {
        res.writeHead(status).end();
      } else {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `scripted ${status}` }));
      }
    });
  });
  return { server, requests };
}

interface ListenerHandle {
  server: Server;
  requests: RecordedRequest[];
  baseUrl: string;
}

async function startListener(
  script: number[],
  options: { emptyBody?: boolean } = {},
): Promise<ListenerHandle> {
  const { server, requests } = makeListener(script, options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, requests, baseUrl: `http://127.0.0.1:${port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

let listeners: Server[] = [];

afterEach(async () => {
  await Promise.all(listeners.map(closeServer));
  listeners = [];
});

// Silence the expected warn/error lines (retry paths log by design); captured
// below asserts the documented fields instead.
vi.mock('../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from '../config/logger';

function expectSigned(req: RecordedRequest): void {
  const expected = createHmac('sha256', TOKEN).update(req.rawBody).digest('hex');
  expect(headerValue(req.signature)).toBe(expected);
  expect(headerValue(req.contentType)).toBe('application/json');
  expect(req.method).toBe('POST');
}

beforeAll(() => {
  vi.stubEnv('SLYKBOARD_DISPATCHER_BACKOFF_SCALE', String(BACKOFF_SCALE));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('postToDispatcher', () => {
  it('signs the exact raw bytes and parses the 2xx JSON response', async () => {
    const l = await startListener([202]);
    listeners.push(l.server);
    vi.mocked(logger.info).mockClear();

    const result = await postToDispatcher<{ acceptedAt: string }>(
      '/webhooks/ticket-events',
      { eventType: 'ticket_created', ticketId: 't-1' },
      { baseUrl: l.baseUrl, token: TOKEN },
    );

    expect(l.requests.length).toBe(1);
    expectSigned(l.requests[0]!);
    expect(l.requests[0]!.url).toBe('/webhooks/ticket-events');
    expect(result).toEqual({ error: 'scripted 202' });

    // Observability §: documented fields on the success log line.
    const line = vi.mocked(logger.info).mock.calls.at(-1)!;
    const fields = line[0] as Record<string, unknown>;
    expect(fields).toMatchObject({
      direction: 'outbound',
      path: '/webhooks/ticket-events',
      method: 'POST',
      status: 202,
    });
    expect(typeof fields.durationMs).toBe('number');
    expect(fields.ticketId).toBe('t-1');
  });

  it('signs nested /ticket-created payloads byte-identically (key order preserved)', async () => {
    const l = await startListener([202]);
    listeners.push(l.server);

    await postToDispatcher(
      '/webhooks/ticket-events',
      { eventType: 'ticket_created', ticket: { id: 't-2', title: 'Add CSV import' } },
      { baseUrl: l.baseUrl, token: TOKEN },
    );

    expectSigned(l.requests[0]!);
    expect((l.requests[0]!.parsed as { ticket: { id: string } }).ticket.id).toBe('t-2');
  });

  it('retries on 500 then succeeds — same idempotencyKey + identical bytes every attempt', async () => {
    const l = await startListener([500, 500, 202]);
    listeners.push(l.server);
    vi.mocked(logger.warn).mockClear();

    const result = await postToDispatcher(
      '/webhooks/ticket-events',
      { eventType: 'pm_reply', ticketId: 't-3' },
      { baseUrl: l.baseUrl, token: TOKEN },
    );

    expect(l.requests.length).toBe(3);
    for (const req of l.requests) expectSigned(req);
    // Retry-safety contract: byte-identical bodies (so one signature holds for
    // all attempts) and one stable idempotencyKey for dispatcher-side dedupe.
    expect(new Set(l.requests.map((r) => r.rawBody)).size).toBe(1);
    const key = (l.requests[0]!.parsed as { idempotencyKey: string }).idempotencyKey;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    for (const req of l.requests) {
      expect((req.parsed as { idempotencyKey: string }).idempotencyKey).toBe(key);
    }
    expect(result).toEqual({ error: 'scripted 202' });
    expect(vi.mocked(logger.warn).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('gives up after 3 retries on persistent 5xx and throws DispatcherError', async () => {
    const l = await startListener([500, 500, 500, 500]);
    listeners.push(l.server);
    vi.mocked(logger.error).mockClear();

    const err = await postToDispatcher(
      '/onboard',
      { project: { slug: 'x' } },
      {
        baseUrl: l.baseUrl,
        token: TOKEN,
      },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );

    // 1 initial attempt + 3 retries.
    expect(l.requests.length).toBe(4);
    expect(err).toBeInstanceOf(DispatcherError);
    const d = err as DispatcherError;
    expect(d.path).toBe('/onboard');
    expect(d.status).toBe(500);
    expect(d.detail).toContain('scripted 500');
    expect(d.message).toBe('Dispatcher /onboard 500: {"error":"scripted 500"}');

    const giveUp = vi.mocked(logger.error).mock.calls.find((c) => String(c[1]).includes('gave up'));
    expect(giveUp).toBeDefined();
    expect((giveUp![0] as Record<string, unknown>).path).toBe('/onboard');
  });

  it('does NOT retry on 400 — single request, DispatcherError with dispatcher detail', async () => {
    const l = await startListener([400]);
    listeners.push(l.server);
    vi.mocked(logger.error).mockClear();

    const err = await postToDispatcher(
      '/onboard',
      { project: { slug: 'bad' } },
      {
        baseUrl: l.baseUrl,
        token: TOKEN,
      },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(l.requests.length).toBe(1);
    expect(err).toBeInstanceOf(DispatcherError);
    expect((err as DispatcherError).status).toBe(400);
    expect((err as DispatcherError).detail).toContain('scripted 400');
  });

  it('treats 409 as non-retryable like any 4xx', async () => {
    const l = await startListener([409, 202]);
    listeners.push(l.server);

    await postToDispatcher(
      '/onboard',
      { project: { slug: 'collision' } },
      {
        baseUrl: l.baseUrl,
        token: TOKEN,
      },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );

    // The scripted 202 must never be reached.
    expect(l.requests.length).toBe(1);
  });

  it('resolves undefined on 204 without attempting to parse a body', async () => {
    const l = await startListener([204]);
    listeners.push(l.server);

    const result = await postToDispatcher<void>(
      '/decommission',
      { projectId: 'p-1' },
      {
        baseUrl: l.baseUrl,
        token: TOKEN,
      },
    );

    expect(l.requests.length).toBe(1);
    expectSigned(l.requests[0]!);
    expect(result).toBeUndefined();
  });

  // SLYK-0210 — /decommission's documented reply is 202 with NO body
  // (07-dispatcher-contract.md; mock dispatcher: res.status(202).end()). A
  // successful response must resolve undefined, not throw on JSON.parse('').
  it('resolves undefined on a bodyless 202 (the /decommission reply)', async () => {
    const l = await startListener([202], { emptyBody: true });
    listeners.push(l.server);

    const result = await postToDispatcher<void>(
      '/decommission',
      { projectId: 'p-1' },
      { baseUrl: l.baseUrl, token: TOKEN },
    );

    expect(l.requests.length).toBe(1);
    expectSigned(l.requests[0]!);
    expect(result).toBeUndefined();
  });

  it('includes a fresh uuid-v4 idempotencyKey in every payload', async () => {
    const l = await startListener([202]);
    listeners.push(l.server);
    const l2 = await startListener([202]);
    listeners.push(l2.server);

    await postToDispatcher(
      '/webhooks/ticket-events',
      { eventType: 'queue_for_agent', ticketId: 't-4' },
      {
        baseUrl: l.baseUrl,
        token: TOKEN,
      },
    );
    await postToDispatcher(
      '/webhooks/ticket-events',
      { eventType: 'queue_for_agent', ticketId: 't-5' },
      {
        baseUrl: l2.baseUrl,
        token: TOKEN,
      },
    );

    const key1 = (l.requests[0]!.parsed as { idempotencyKey: string }).idempotencyKey;
    const key2 = (l2.requests[0]!.parsed as { idempotencyKey: string }).idempotencyKey;
    expect(key1).toMatch(/^[0-9a-f-]{36}$/);
    expect(key2).toMatch(/^[0-9a-f-]{36}$/);
    expect(key1).not.toBe(key2);
  });

  it('retries on network error (connection refused) and throws DispatcherError status 0', async () => {
    vi.mocked(logger.warn).mockClear();
    // Reserve then close a port — connections to it refuse instantly.
    const dead = await startListener([202]);
    const url = (dead.server.address() as AddressInfo).port;
    await closeServer(dead.server);

    const err = await postToDispatcher(
      '/webhooks/ticket-events',
      { ticketId: 't-6' },
      {
        baseUrl: `http://127.0.0.1:${url}`,
        token: TOKEN,
      },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(DispatcherError);
    expect((err as DispatcherError).status).toBe(0);
    // 1 initial + 3 retries, each failing at the network layer.
    expect(vi.mocked(logger.warn).mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses to send without agent-mode config (no URL/token → config error, no request)', async () => {
    const l = await startListener([202]);
    listeners.push(l.server);

    // env (SLYK-0130 vitest config) has no dispatcher URL/token, and none is
    // passed — the client must fail fast instead of signing with nothing.
    await expect(postToDispatcher('/onboard', { project: { slug: 'x' } })).rejects.toThrow(
      /SLYKBOARD_DISPATCHER_URL and _TOKEN are required/,
    );
    expect(l.requests.length).toBe(0);
  });
});
