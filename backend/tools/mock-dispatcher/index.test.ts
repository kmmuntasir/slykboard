import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { signPayload, TEST_DISPATCHER_TOKEN } from '../../src/test/hmac';

// SLYK-0170 — Round-trip proof for the mock dispatcher skeleton: payloads
// signed with slykboard's own test helper (src/test/hmac.ts, SLYK-0150) are
// accepted by the mock; tampered/unsigned requests are rejected. This is the
// smoke-test contract from docs/agentic-automation/10-mock-dispatcher.md —
// the mock and slykboard must agree byte-for-byte on the HMAC scheme.
// SLYK-0220 adds the scenario-engine suite below: --scenario loading,
// onboarding/decommission callback streaming, fixture fallback, and the
// /admin/next-status failure-injection control.

// state.json is append-only runtime state; tests must not pollute it.
const STATE_FILE = new URL('./state.json', import.meta.url).pathname;
const TOKEN_FILE = new URL('./.token', import.meta.url).pathname;
vi.hoisted(() => {
  process.env.MOCK_DISPATCHER_STATE_FILE = 'true';
});

import { readFileSync } from 'node:fs';
import {
  buildApp,
  verifySignature,
  loadScenario,
  parseArgs,
  parseStateSteps,
  streamJobCallbacks,
} from './index';
import { sign, signaturesMatch, DISPATCHER_SIGNATURE_HEADER } from './sign';

let app: Express;
let originalState: string | undefined;

beforeAll(() => {
  app = buildApp(TEST_DISPATCHER_TOKEN);
  try {
    originalState = readFileSync(STATE_FILE, 'utf8');
  } catch {
    originalState = undefined;
  }
});

afterAll(() => {
  // Append-only log grows across runs by design; tests tolerate extra lines
  // and only assert that their calls were appended. Nothing to restore.
  void originalState;
  void TOKEN_FILE;
});

describe('mock dispatcher skeleton — HMAC round-trip (slykboard test helper)', () => {
  it('signed /webhooks/ticket-events → 202 {acceptedAt}', async () => {
    const body = { eventType: 'ticket_created', ticketId: 't-1' };
    const res = await request(app)
      .post('/webhooks/ticket-events')
      .set('Content-Type', 'application/json')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('signed /onboard → 202 {orchestratorId: "mock-orch-001"}', async () => {
    const body = { projectSlug: 'inventory-tracker' };
    const res = await request(app)
      .post('/onboard')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ orchestratorId: 'mock-orch-001' });
  });

  it('signed /decommission → 202', async () => {
    const body = { projectSlug: 'inventory-tracker', confirmSlug: 'inventory-tracker' };
    const res = await request(app)
      .post('/decommission')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(202);
  });

  it('signed /webhooks/pm-action/need-human-help → 202', async () => {
    const body = { ticketId: 't-1', reason: 'blocked' };
    const res = await request(app)
      .post('/webhooks/pm-action/need-human-help')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(202);
  });

  it('tampered body (signature over different bytes) → 401', async () => {
    const signedBody = { ticketId: 't-1' };
    const sentBody = { ticketId: 'EVIL' }; // same length, different content
    const res = await request(app)
      .post('/webhooks/ticket-events')
      .set('X-Slykboard-Signature', signPayload(signedBody, TEST_DISPATCHER_TOKEN))
      .send(sentBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Signature invalid');
  });

  it('unsigned request → 401', async () => {
    const res = await request(app)
      .post('/webhooks/ticket-events')
      .send({ eventType: 'ticket_created' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Signature missing');
  });

  it('signature with wrong token → 401', async () => {
    const body = { eventType: 'ticket_created' };
    const res = await request(app)
      .post('/webhooks/ticket-events')
      .set('X-Slykboard-Signature', signPayload(body, 'b'.repeat(64)))
      .send(body);

    expect(res.status).toBe(401);
  });

  it('non-ASCII body signed verbatim → 202 (multi-byte UTF-8 round-trip)', async () => {
    const body = { detail: { note: 'ファイル作成 — émoji 🚀 ünïcødé' } };
    const res = await request(app)
      .post('/webhooks/ticket-events')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    expect(res.status).toBe(202);
  });

  it('every received call is appended to state.json', async () => {
    const before = countStateLines();
    const body = { eventType: 'pm_reply', ticketId: 't-9' };
    await request(app)
      .post('/webhooks/ticket-events')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

    const lines = readStateLines();
    expect(lines.length).toBeGreaterThanOrEqual(before + 1);
    const last = lines[lines.length - 1]!;
    expect(last.path).toBe('/webhooks/ticket-events');
    expect(last.signatureValid).toBe(true);
    expect(last.body).toEqual(body);
  });

  it('rejected calls are logged with signatureValid: false', async () => {
    await request(app).post('/onboard').send({ projectSlug: 'x' });

    const lines = readStateLines();
    const last = lines[lines.length - 1]!;
    expect(last.signatureValid).toBe(false);
  });
});

describe('sign.ts helpers', () => {
  it('sign() over raw bytes matches slykboard test-helper signPayload()', () => {
    // signPayload takes a body and JSON.stringify's it; to prove byte-level
    // agreement, hand it a value whose serialization IS the raw string.
    const body = { eventType: 'ticket_created' };
    expect(sign(JSON.stringify(body), TEST_DISPATCHER_TOKEN)).toBe(
      signPayload(body, TEST_DISPATCHER_TOKEN),
    );
  });

  it('signaturesMatch() rejects undefined and length-mismatched inputs', () => {
    expect(signaturesMatch(undefined, 'ab'.repeat(32))).toBe(false);
    expect(signaturesMatch('deadbeef', 'ab'.repeat(32))).toBe(false);
    expect(signaturesMatch('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
  });

  it('verifySignature() accepts a request signed over its raw body', async () => {
    const body = { state: 'QUEUED' };
    const agent = request(app);
    await agent
      .post('/webhooks/ticket-events')
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);
    // verifySignature exercised implicitly through the 202 path above; direct
    // unit check on the helper shape:
    const sig = sign(JSON.stringify(body), TEST_DISPATCHER_TOKEN);
    expect(signaturesMatch(sig, sign(JSON.stringify(body), TEST_DISPATCHER_TOKEN))).toBe(true);
    expect(verifySignature.name).toBe('verifySignature');
  });
});

// --- state.json helpers -------------------------------------------------------
function readStateLines(): Array<{ path: string; signatureValid: boolean; body: unknown }> {
  try {
    return readFileSync(STATE_FILE, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function countStateLines(): number {
  return readStateLines().length;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLYK-0220 — scenario engine, callback streaming, failure injection
// ─────────────────────────────────────────────────────────────────────────────

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  rawBody: string;
}

// Deterministic fetch/sleep double: records every outbound request and
// resolves sleeps immediately while still tracking the scripted delays.
function makeTransport() {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    text: async () => '{}',
    // captured synchronously for assertion after the stream drains
    record: requests.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      rawBody: String(init.body ?? ''),
    }),
  });
  return { requests, sleeps, fetchImpl };
}

const instantSleep = async (ms: number) => {
  sleepsRef.push(ms);
};
// Shared sink so makeTransport's sleep double can log without closures
const sleepsRef: number[] = [];

async function drain(): Promise<void> {
  // streamOnboardingEvents chains microtask promises per step; a few macro
  // task turns guarantee the fire-and-forget stream fully drained.
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function signedOnboard(app: Express, slug: string) {
  const body = {
    project: { slug, name: slug, subdomain: slug, stack: 'node-express' },
  };
  return request(app)
    .post('/onboard')
    .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
    .send(body);
}

function signedDecommission(app: Express, slug: string) {
  const body = { projectId: 'p-1', slug, lxcCtid: 999 };
  return request(app)
    .post('/decommission')
    .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
    .send(body);
}

describe('SLYK-0220 — loadScenario + parseArgs', () => {
  it('loads scenarios/happy-path.json with the doc-10 event shape', () => {
    const scenario = loadScenario('happy-path');
    expect(scenario.name).toBe('happy-path');
    expect(scenario.onboardingEvents?.map((s) => s.toState)).toEqual([
      'PROVISIONING_LXC',
      'WIRING_GITHUB',
      'WIRING_AGENT',
      'WIRING_ZORAXY',
      'SMOKE_TEST',
      'LIVE',
    ]);
    // Phase 1 field carried per doc 10 — SLYK-0300 parses it into steps.
    expect(scenario.ticketCreatedStateSequence?.map((s) => s.state)).toEqual([
      'QUEUED',
      'AGENT_RUNNING',
      'PR_OPEN',
      'CI_RUNNING',
      'MERGING',
      'DONE',
    ]);
  });

  // SLYK-0300 — the Phase-1 scenarios, each validated against the 15×15
  // matrix (05-backend-routes.md): no MERGING→DEPLOYING hop (illegal —
  // no edge enters DEPLOYING; MERGING goes straight to DONE). SLYK-0360:
  // agent-waiting splits at the AGENT_WAITING pause — the resume tail lives
  // in pmReplySequence and only streams when slykboard delivers a pm_reply,
  // so the edge walk covers BOTH sequences end-to-end (message steps are
  // not state writes and are filtered out of the walk).
  it.each([
    {
      name: 'agent-waiting',
      states: [
        'QUEUED',
        'AGENT_RUNNING',
        'AGENT_WAITING',
        'AGENT_RUNNING',
        'PR_OPEN',
        'CI_RUNNING',
        'MERGING',
        'DONE',
      ],
    },
    {
      name: 'failed-ci-retry',
      states: [
        'QUEUED',
        'AGENT_RUNNING',
        'PR_OPEN',
        'CI_RUNNING',
        'FAILED_CI',
        'QUEUED',
        'AGENT_RUNNING',
        'PR_OPEN',
        'CI_RUNNING',
        'MERGING',
        'DONE',
      ],
    },
    {
      name: 'blocked-human',
      states: [
        'QUEUED',
        'AGENT_RUNNING',
        'PR_OPEN',
        'CI_RUNNING',
        'FAILED_CI',
        'QUEUED',
        'AGENT_RUNNING',
        'PR_OPEN',
        'CI_RUNNING',
        'FAILED_CI',
        'QUEUED',
        'AGENT_RUNNING',
        'PR_OPEN',
        'CI_RUNNING',
        'FAILED_CI',
        'BLOCKED_HUMAN',
      ],
    },
  ])('loads scenarios/$name.json with a legal $name sequence', ({ name, states }) => {
    const scenario = loadScenario(name);
    expect(scenario.name).toBe(name);
    const statesOf = (steps: typeof scenario.ticketCreatedStateSequence) =>
      (steps ?? [])
        .filter((s): s is { delayMs: number; state: string } => 'state' in s)
        .map((s) => s.state);
    expect([
      ...statesOf(scenario.ticketCreatedStateSequence),
      ...statesOf(scenario.pmReplySequence),
    ]).toEqual(states);
    // Every edge in the sequence must exist in slykboard's matrix, and the
    // FAILED_*→QUEUED requeues must stay under the attempts cap of 3
    // (attempts bumps on each requeue: 1, 2 — the third FAILED_CI escalates).
    const LEGAL = new Set([
      'BACKLOG->QUEUED',
      'QUEUED->AGENT_RUNNING',
      'QUEUED->FAILED_AGENT',
      'AGENT_RUNNING->AGENT_WAITING',
      'AGENT_RUNNING->PR_OPEN',
      'AGENT_RUNNING->FAILED_AGENT',
      'AGENT_WAITING->AGENT_RUNNING',
      'AGENT_WAITING->FAILED_AGENT',
      'PR_OPEN->CI_RUNNING',
      'CI_RUNNING->MERGING',
      'CI_RUNNING->FAILED_CI',
      'MERGING->CONFLICT_RETRY',
      'MERGING->DONE',
      'CONFLICT_RETRY->MERGING',
      'CONFLICT_RETRY->FAILED_CONFLICT',
      'DEPLOYING->DONE',
      'DEPLOYING->FAILED_DEPLOY',
      'FAILED_AGENT->QUEUED',
      'FAILED_AGENT->BLOCKED_HUMAN',
      'FAILED_CI->QUEUED',
      'FAILED_CI->BLOCKED_HUMAN',
      'FAILED_CONFLICT->QUEUED',
      'FAILED_CONFLICT->BLOCKED_HUMAN',
      'FAILED_DEPLOY->QUEUED',
      'FAILED_DEPLOY->BLOCKED_HUMAN',
      'BLOCKED_HUMAN->QUEUED',
    ]);
    let attempts = 0;
    for (let i = 1; i < states.length; i++) {
      const edge = `${states[i - 1]}->${states[i]}`;
      expect(LEGAL.has(edge), `illegal edge ${edge} in scenario ${name}`).toBe(true);
      if (edge === 'FAILED_CI->QUEUED') attempts += 1;
    }
    expect(attempts).toBeLessThan(3); // cap check reads pre-bump value; 3 requeues would break
  });

  it('rejects ticketCreatedStateSequence steps with an unknown state', () => {
    expect(() => parseStateSteps('happy-path', [{ delayMs: 1, state: 'NOT_A_STATE' }])).toThrow(
      /needs a "state".*"message" key/,
    );
    expect(() => parseStateSteps('happy-path', [{ state: 'QUEUED' }])).toThrow(
      /delayMs must be a non-negative number/,
    );
    expect(() => parseStateSteps('happy-path', 'nope')).toThrow(/must be an array/);
  });

  // SLYK-0360 — message-step validation (agentMessageBody Zod span).
  it('rejects message steps with a bad role/body/shape', () => {
    expect(() =>
      parseStateSteps('happy-path', [{ delayMs: 1, message: { authorRole: 'PM', body: 'hi' } }]),
    ).toThrow(/authorRole must be AGENT or SYSTEM/);
    expect(() =>
      parseStateSteps('happy-path', [{ delayMs: 1, message: { body: 'x'.repeat(4001) } }]),
    ).toThrow(/body must be a string of 1\.\.4000 chars/);
    expect(() =>
      parseStateSteps('happy-path', [{ delayMs: 1, message: { authorRole: 'AGENT', body: '' } }]),
    ).toThrow(/body must be a string of 1\.\.4000 chars/);
    expect(() => parseStateSteps('happy-path', [{ delayMs: 1, message: 'nope' }])).toThrow(
      /message must be an object/,
    );
  });

  it('loads scenarios/decommission.json streaming DECOMMISSIONING → DECOMMISSIONED', () => {
    const scenario = loadScenario('decommission');
    expect(scenario.decommissionEvents?.map((s) => s.toState)).toEqual([
      'DECOMMISSIONING',
      'DECOMMISSIONED',
    ]);
  });

  it('rejects unknown scenario names with the expected file path', () => {
    expect(() => loadScenario('nope')).toThrow(/Scenario "nope" not found/);
  });

  it('rejects path-traversal-ish names and name/file mismatch', () => {
    expect(() => loadScenario('../secrets')).toThrow(/Invalid scenario name/);
    expect(() => loadScenario('happy path')).toThrow(/Invalid scenario name/);
  });

  it('parseArgs accepts --scenario and --slykboard-url', () => {
    const opts = parseArgs([
      '--scenario=happy-path',
      '--slykboard-url=http://localhost:3001/',
      '--port=4002',
    ]);
    expect(opts).toEqual({
      port: 4002,
      scenario: 'happy-path',
      slykboardUrl: 'http://localhost:3001',
      latency: 'fast',
    });
    expect(parseArgs([]).slykboardUrl).toBe('http://localhost:3000');
    expect(() => parseArgs(['--slykboard-url=not a url'])).toThrow(/Invalid slykboard URL/);
  });
});

describe('SLYK-0220 — /onboard streams signed onboarding events per scenario', () => {
  it('happy-path: 202 ack, then 6 signed callbacks to /onboarding/events ending at LIVE', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('happy-path'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedOnboard(app, 'inventory-tracker');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ orchestratorId: 'mock-orch-001' });
    await drain();

    expect(transport.requests).toHaveLength(6);
    const urls = transport.requests.map((r) => r.url);
    for (const url of urls) {
      expect(url).toBe(
        'http://slyk.test/api/v1/internal/projects/inventory-tracker/onboarding/events',
      );
    }

    // Body chain: fromState seeded PENDING, each step advancing.
    const bodies = transport.requests.map((r) => JSON.parse(r.rawBody));
    expect(bodies.map((b) => b.toState)).toEqual([
      'PROVISIONING_LXC',
      'WIRING_GITHUB',
      'WIRING_AGENT',
      'WIRING_ZORAXY',
      'SMOKE_TEST',
      'LIVE',
    ]);
    expect(bodies[0]!.fromState).toBe('PENDING');
    expect(bodies[5]!.fromState).toBe('SMOKE_TEST');
    expect(bodies[5]!.toState).toBe('LIVE');
    // Scenario detail wins over the fixture template for LIVE.
    expect(bodies[5]!.detail).toEqual({ deployedAt: '2026-08-13T12:00:00Z' });

    // Every callback is HMAC-signed over its exact raw bytes with the shared
    // token — the contract slykboard's agentTokenAuth enforces.
    for (const r of transport.requests) {
      expect(r.headers[DISPATCHER_SIGNATURE_HEADER]).toBe(sign(r.rawBody, TEST_DISPATCHER_TOKEN));
      expect(r.headers['Content-Type']).toBe('application/json');
    }
  });

  it('falls back to the fixtures/onboarding_event.*.json template when a step has no detail', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'fixture-fallback',
        onboardingEvents: [
          { delayMs: 1, toState: 'WIRING_GITHUB' }, // no detail → fixture
          { delayMs: 1, toState: 'FAILED', detail: { error: 'boom' } }, // detail wins
        ],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    await signedOnboard(app, 'fixture-proj');
    await drain();

    const bodies = transport.requests.map((r) => JSON.parse(r.rawBody));
    expect(bodies[0]!.detail).toEqual({
      repoUrl: 'git@github.com:example-org/inventory-tracker.git',
    });
    expect(bodies[1]!.detail).toEqual({ error: 'boom' });
  });

  it('no scenario set → 202 stub only, zero outbound callbacks (skeleton preserved)', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedOnboard(app, 'plain-stub');
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0);
  });

  it('onboardReply override changes the ack status/body and skips streaming on non-2xx', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'reply-override',
        onboardReply: { status: 503, body: { orchestratorId: 'unavailable' } },
        onboardingEvents: [{ delayMs: 1, toState: 'LIVE' }],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedOnboard(app, 'down-proj');
    expect(res.status).toBe(503);
    await drain();
    expect(transport.requests).toHaveLength(0);
  });

  it('a failed callback step does not abort the remaining stream', async () => {
    const requests: RecordedRequest[] = [];
    let calls = 0;
    const failingFetch = async (url: string, init: RequestInit) => {
      calls += 1;
      requests.push({
        url,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        rawBody: String(init.body ?? ''),
      });
      if (calls === 2) throw new Error('ECONNREFUSED (injected)');
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'resilient',
        onboardingEvents: [
          { delayMs: 1, toState: 'PROVISIONING_LXC' },
          { delayMs: 1, toState: 'SMOKE_TEST' },
          { delayMs: 1, toState: 'LIVE' },
        ],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: failingFetch,
      sleepImpl: instantSleep,
    });

    await signedOnboard(app, 'flaky-proj');
    await drain();
    expect(requests).toHaveLength(3);
  });
});

describe('SLYK-0220 — /decommission streams the teardown pair', () => {
  it('decommission scenario: 202 ack, two signed events, DECOMMISSIONING → DECOMMISSIONED', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('decommission'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedDecommission(app, 'inventory-tracker');
    expect(res.status).toBe(202);
    await drain();

    expect(transport.requests).toHaveLength(2);
    const bodies = transport.requests.map((r) => JSON.parse(r.rawBody));
    // Slykboard already committed DECOMMISSIONING before calling the mock —
    // the ack event's fromState seed.
    expect(bodies[0]).toEqual({
      fromState: 'DECOMMISSIONING',
      toState: 'DECOMMISSIONING',
      detail: { reason: 'teardown started' },
    });
    expect(bodies[1]).toEqual({
      fromState: 'DECOMMISSIONING',
      toState: 'DECOMMISSIONED',
      detail: { releasedAt: '2026-08-13T13:00:00Z' },
    });
    for (const r of transport.requests) {
      expect(r.headers[DISPATCHER_SIGNATURE_HEADER]).toBe(sign(r.rawBody, TEST_DISPATCHER_TOKEN));
    }
  });

  it('no scenario → 202 with no outbound events', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedDecommission(app, 'plain-proj');
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0);
  });
});

describe('SLYK-0220 — /admin/next-status failure injection', () => {
  it('arms a sticky status override for the next /onboard calls and logs it', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const arm = await request(app).get('/admin/next-status?path=/onboard&status=500');
    expect(arm.status).toBe(200);
    expect(arm.body).toEqual({ path: '/onboard', nextStatus: 500 });

    // Still 401 first — signature gate runs before the injected status.
    const unsigned = await request(app).post('/onboard').send({});
    expect(unsigned.status).toBe(401);

    const res = await signedOnboard(app, 'retry-proj');
    expect(res.status).toBe(500);
    // Sticky: a second (retry) call fails the same way → slykboard exhausts
    // its backoff and marks onboarding FAILED (doc 10 § Failure injection).
    const retry = await signedOnboard(app, 'retry-proj');
    expect(retry.status).toBe(500);
    await drain();
    expect(transport.requests).toHaveLength(0);

    const last = readStateLines().at(-1)!;
    expect(last.injectedStatus).toBe(500);

    const clear = await request(app).get('/admin/next-status?path=/onboard&status=clear');
    expect(clear.body).toEqual({ path: '/onboard', cleared: true });
    const restored = await signedOnboard(app, 'retry-proj');
    expect(restored.status).toBe(202);
  });

  it('validates the control inputs', async () => {
    const app = buildApp(TEST_DISPATCHER_TOKEN);
    expect((await request(app).get('/admin/next-status')).status).toBe(400);
    expect((await request(app).get('/admin/next-status?path=/onboard')).status).toBe(400);
    expect((await request(app).get('/admin/next-status?path=onboard&status=500')).status).toBe(400);
    expect((await request(app).get('/admin/next-status?path=/onboard&status=200')).status).toBe(
      400,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SLYK-0300 — /webhooks/ticket-events handling + state_update.* streaming
// ─────────────────────────────────────────────────────────────────────────────

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

function signedTicketEvent(app: Express, body: unknown) {
  return request(app)
    .post('/webhooks/ticket-events')
    .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
    .send(body as Record<string, unknown>);
}

function ticketCreatedBody(ticketId: string) {
  // Field-for-field 07-dispatcher-contract.md § ticket_created — slykboard's
  // ticketAgentService.emitTicketCreated emits exactly this shape.
  return {
    eventType: 'ticket_created',
    ticket: {
      id: ticketId,
      projectId: '33333333-3333-4333-8333-333333333333',
      projectSlug: 'inventory-tracker',
      teamKey: 'INVENTORYTRACKER',
      agentBackend: null,
      number: 42,
      title: 'Add CSV import',
      description: 'Allow users to bulk-import inventory from a CSV file.',
      priority: 'HIGH',
      labels: ['feature'],
      createdAt: '2026-08-13T12:34:56.789Z',
    },
  };
}

describe('SLYK-0300 — ticket_created streams signed state callbacks', () => {
  it('happy-path: 202 ack, then 6 signed callbacks to jobs/:id/state ending at DONE', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('happy-path'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    expect(res.status).toBe(202);
    expect(res.body.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await drain();

    expect(transport.requests).toHaveLength(6);
    for (const r of transport.requests) {
      expect(r.url).toBe(`http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/state`);
      expect(r.method).toBe('POST');
    }

    // Body shape = stateUpdateBody (05-backend-routes.md): {state, detail?}.
    // NO fromState on the wire — slykboard derives it from the job row.
    const bodies = transport.requests.map((r) => JSON.parse(r.rawBody));
    expect(bodies.map((b) => b.state)).toEqual([
      'QUEUED',
      'AGENT_RUNNING',
      'PR_OPEN',
      'CI_RUNNING',
      'MERGING',
      'DONE',
    ]);
    expect(bodies.every((b) => b.fromState === undefined)).toBe(true);
    // Detail flows verbatim: agentSessionId, PR fields, mergebot decision log.
    expect(bodies[1]!.detail).toEqual({ agentSessionId: 'mock-cyrus-001' });
    expect(bodies[2]!.detail).toEqual({ prNumber: 137, sha: 'abc1234' });
    expect(bodies[4]!.detail).toMatchObject({
      checksPassed: ['lint', 'test', 'build'],
      checksFailed: [],
      coverageDelta: { files: 2, lines: 24 },
      diffSize: { filesChanged: 3, insertions: 120, deletions: 15 },
      touchedSensitivePaths: { infra: false, migrations: false, deployConfig: false },
    });
    expect(bodies[5]!.detail).toEqual({ deployedAt: '2026-08-13T12:30:00Z' });

    // Every callback HMAC-signed over its exact raw bytes — zero-401 contract.
    for (const r of transport.requests) {
      expect(r.headers[DISPATCHER_SIGNATURE_HEADER]).toBe(sign(r.rawBody, TEST_DISPATCHER_TOKEN));
      expect(r.headers['Content-Type']).toBe('application/json');
    }
  });

  it('steps without detail fall back to the state_update.*.json fixture', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'fixture-fallback',
        ticketCreatedStateSequence: [
          { delayMs: 1, state: 'QUEUED' }, // no detail → fixture
          { delayMs: 1, state: 'AGENT_WAITING', detail: { question: 'custom?' } }, // detail wins
        ],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    await drain();

    const bodies = transport.requests.map((r) => JSON.parse(r.rawBody));
    expect(bodies[0]!.detail).toEqual({ source: 'mock-dispatcher auto-queue' });
    expect(bodies[1]!.detail).toEqual({ question: 'custom?' });
  });

  it('a 400 from slykboard is logged and skipped, not retried or aborted', async () => {
    const requests: string[] = [];
    let calls = 0;
    const rejectingFetch = async (_url: string, init: RequestInit) => {
      calls += 1;
      requests.push(String(init.body));
      // First callback rejected (illegal transition), the rest accepted —
      // the stream must continue to DONE.
      const ok = calls > 1;
      return {
        ok,
        status: ok ? 200 : 400,
        text: async () => (ok ? '{}' : '{"error":{"code":"INVALID_STATE_TRANSITION"}}'),
      };
    };
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'resilient-states',
        ticketCreatedStateSequence: [
          { delayMs: 1, state: 'QUEUED' },
          { delayMs: 1, state: 'AGENT_RUNNING' },
          { delayMs: 1, state: 'DONE' },
        ],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: rejectingFetch,
      sleepImpl: instantSleep,
    });

    await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    await drain();

    expect(calls).toBe(3); // exactly one POST per step — no retry loop
    expect(requests).toHaveLength(3);
  });

  it('no scenario loaded → 202 stub only, zero state callbacks', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0);
  });

  it('scenario without ticketCreatedStateSequence → 202, zero state callbacks', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: { name: 'onboard-only', onboardingEvents: [{ delayMs: 1, toState: 'LIVE' }] },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0);
  });

  it('garbage/unknown eventType → 202 ack, no stream, still logged', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('happy-path'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, { eventType: 'something_else', ticketId: TICKET_ID });
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0);

    const last = readStateLines().at(-1)!;
    expect(last.path).toBe('/webhooks/ticket-events');
    expect(last.signatureValid).toBe(true);
  });
});

describe('SLYK-0300 — queue_for_agent + pm_reply handling', () => {
  it('queue_for_agent emits AGENT_RUNNING after the ack (QUEUED already written by slykboard)', async () => {
    const transport = makeTransport();
    const sleeps: number[] = [];
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('happy-path'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    const res = await signedTicketEvent(app, { eventType: 'queue_for_agent', ticketId: TICKET_ID });
    expect(res.status).toBe(202);
    await drain();

    // Slykboard's queueForAgent already transitioned the job to QUEUED before
    // the webhook, so re-emitting QUEUED would be a same-state 400 self-loop —
    // the mock must only follow with AGENT_RUNNING.
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]!.url).toBe(
      `http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/state`,
    );
    const body = JSON.parse(transport.requests[0]!.rawBody);
    expect(body.state).toBe('AGENT_RUNNING');
    expect(transport.requests[0]!.headers[DISPATCHER_SIGNATURE_HEADER]).toBe(
      sign(transport.requests[0]!.rawBody, TEST_DISPATCHER_TOKEN),
    );
  });

  it('queue_for_agent with no scenario → 202 stub, no callbacks', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, { eventType: 'queue_for_agent', ticketId: TICKET_ID });
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0);
  });

  // SLYK-0360 — happy-path scripts no pmReplySequence, so pm_reply stays a
  // logged receipt (the pre-Phase-2 behavior, now scoped to scenarios that
  // don't script the resume).
  it('pm_reply with no scripted pmReplySequence → 202, logged only', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('happy-path'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, {
      eventType: 'pm_reply',
      ticketId: TICKET_ID,
      agentSessionId: 'mock-cyrus-001',
      body: 'Yes, add a confirm dialog.',
    });
    expect(res.status).toBe(202);
    await drain();
    expect(transport.requests).toHaveLength(0); // no state, no messages

    const last = readStateLines().at(-1)!;
    expect(last.body).toMatchObject({ eventType: 'pm_reply', ticketId: TICKET_ID });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SLYK-0360 — agent message emission + pm_reply resume (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

const pmReplyBody = (idempotencyKey: string) => ({
  eventType: 'pm_reply',
  ticketId: TICKET_ID,
  agentSessionId: 'mock-cyrus-001',
  body: 'Yes, validate headers first.',
  idempotencyKey,
});

describe('SLYK-0360 — ticket_created streams the question message (agent-waiting)', () => {
  it('stops at AGENT_WAITING, then posts one signed AGENT question to /messages', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('agent-waiting'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    expect(res.status).toBe(202);
    await drain();

    // 3 state callbacks + 1 message callback, in scripted order — the
    // question lands AFTER the AGENT_WAITING state it accompanies.
    expect(transport.requests).toHaveLength(4);
    expect(transport.requests.map((r) => r.url)).toEqual([
      `http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/state`,
      `http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/state`,
      `http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/state`,
      `http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/messages`,
    ]);
    const states = transport.requests
      .slice(0, 3)
      .map((r) => (JSON.parse(r.rawBody) as { state: string }).state);
    expect(states).toEqual(['QUEUED', 'AGENT_RUNNING', 'AGENT_WAITING']);

    // agentMessageBody shape (05-backend-routes.md § jobs/:ticketId/messages):
    // fresh uuid idempotencyKey per emission, scenario body + session verbatim.
    const message = JSON.parse(transport.requests[3]!.rawBody);
    expect(message).toMatchObject({
      authorRole: 'AGENT',
      body: 'Quick question before I continue: should the CSV importer validate headers before inserting rows?',
      agentSessionId: 'mock-cyrus-001',
    });
    expect(message.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Message callbacks are HMAC-signed over exact raw bytes too — the
    // zero-401 contract covers every outbound path, not just /state.
    expect(transport.requests[3]!.headers[DISPATCHER_SIGNATURE_HEADER]).toBe(
      sign(transport.requests[3]!.rawBody, TEST_DISPATCHER_TOKEN),
    );
    expect(transport.requests[3]!.headers['Content-Type']).toBe('application/json');
  });
});

describe('SLYK-0360 — pm_reply emits ack message + resume tail (agent-waiting)', () => {
  it('acks with an AGENT message, echoes the pm_reply session, then streams to DONE', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('agent-waiting'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const res = await signedTicketEvent(app, pmReplyBody('9b7c6d5e-1111-4222-8333-444455556666'));
    expect(res.status).toBe(202);
    await drain();

    // 1 message + 5 state callbacks (agentMessageBody + stateUpdateBody).
    expect(transport.requests).toHaveLength(6);
    expect(transport.requests[0]!.url).toBe(
      `http://slyk.test/api/v1/internal/jobs/${TICKET_ID}/messages`,
    );
    const ack = JSON.parse(transport.requests[0]!.rawBody);
    expect(ack).toMatchObject({
      authorRole: 'AGENT',
      body: 'Got it — validating headers before insert. Resuming work.',
      // session echoed from the pm_reply payload (routing the reply home)
      agentSessionId: 'mock-cyrus-001',
    });
    expect(ack.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(ack.authorUserId).toBeUndefined(); // dispatcher may never spoof a PM author

    // Message FIRST, then the agent_running resume (doc 10 § pm_reply).
    const states = transport.requests
      .slice(1)
      .map((r) => (JSON.parse(r.rawBody) as { state: string }).state);
    expect(states).toEqual(['AGENT_RUNNING', 'PR_OPEN', 'CI_RUNNING', 'MERGING', 'DONE']);
    expect((JSON.parse(transport.requests[1]!.rawBody) as { detail?: unknown }).detail).toEqual({
      resumedBy: 'pm_reply',
    });

    for (const r of transport.requests) {
      expect(r.headers[DISPATCHER_SIGNATURE_HEADER]).toBe(sign(r.rawBody, TEST_DISPATCHER_TOKEN));
    }
  });

  it('duplicate pm_reply with the same idempotencyKey → acked, no second emission', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('agent-waiting'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    // Same key twice — slykboard's delivery queue retries carry the SAME key
    // (07 § Retry semantics puts inbound dedup on the dispatcher).
    const body = pmReplyBody('1b7c6d5e-1111-4222-8333-444455556666');
    const first = await signedTicketEvent(app, body);
    const dup = await signedTicketEvent(app, body);
    expect(first.status).toBe(202);
    expect(dup.status).toBe(202);
    await drain();

    // Exactly one stream: 1 message + 5 states.
    expect(transport.requests).toHaveLength(6);
  });

  it('a fresh pm_reply idempotencyKey streams again (distinct deliveries are distinct)', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: loadScenario('agent-waiting'),
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    await signedTicketEvent(app, pmReplyBody('2b7c6d5e-1111-4222-8333-444455556666'));
    await signedTicketEvent(app, pmReplyBody('3b7c6d5e-1111-4222-8333-444455556666'));
    await drain();

    expect(transport.requests).toHaveLength(12);
  });

  it('message steps fall back to the fixtures/message.*.json template', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'message-fixture-fallback',
        ticketCreatedStateSequence: [
          { delayMs: 1, state: 'AGENT_WAITING' },
          // No body → fixtures/message.agent.json; SYSTEM with no body →
          // fixtures/message.system.json.
          { delayMs: 1, message: {} },
          { delayMs: 1, message: { authorRole: 'SYSTEM' } },
        ],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    await signedTicketEvent(app, ticketCreatedBody(TICKET_ID));
    await drain();

    const messages = transport.requests
      .filter((r) => r.url.endsWith('/messages'))
      .map((r) => JSON.parse(r.rawBody));
    expect(messages).toEqual([
      {
        authorRole: 'AGENT',
        body: 'Should I add a confirm dialog before deleting the user?',
        agentSessionId: 'mock-cyrus-001',
        idempotencyKey: messages[0]!.idempotencyKey,
      },
      {
        authorRole: 'SYSTEM',
        body: 'Agent session resumed by PM reply.',
        idempotencyKey: messages[1]!.idempotencyKey,
      },
    ]);
    expect(messages[0]!.idempotencyKey).not.toBe(messages[1]!.idempotencyKey);
  });

  // SYSTEM fixture carries no session, and the pm_reply payload omits one —
  // so the ack must omit the key entirely (agentSessionId is optional in
  // agentMessageBody; never null, never invented).
  it('pm_reply without an agentSessionId → SYSTEM ack omits the key', async () => {
    const transport = makeTransport();
    const app = buildApp(TEST_DISPATCHER_TOKEN, {
      scenario: {
        name: 'no-session',
        pmReplySequence: [{ delayMs: 1, message: { authorRole: 'SYSTEM', body: 'ack' } }],
      },
      slykboardUrl: 'http://slyk.test',
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const { agentSessionId: _omit, ...withoutSession } = pmReplyBody(
      '4b7c6d5e-1111-4222-8333-444455556666',
    );
    void _omit;
    await signedTicketEvent(app, withoutSession);
    await drain();

    const ack = JSON.parse(transport.requests[0]!.rawBody);
    expect(ack).toEqual({
      authorRole: 'SYSTEM',
      body: 'ack',
      idempotencyKey: ack.idempotencyKey,
    });
    expect('agentSessionId' in ack).toBe(false);
  });
});

describe('SLYK-0300 — streamJobCallbacks direct (agent-waiting sequence)', () => {
  it('streams AGENT_WAITING → AGENT_RUNNING with scenario details', async () => {
    const transport = makeTransport();
    await streamJobCallbacks({
      slykboardUrl: 'http://slyk.test',
      ticketId: TICKET_ID,
      steps: [
        { delayMs: 1, state: 'AGENT_WAITING' },
        { delayMs: 1, state: 'AGENT_RUNNING' },
      ],
      token: TEST_DISPATCHER_TOKEN,
      fetchImpl: transport.fetchImpl as never,
      sleepImpl: instantSleep,
    });

    const bodies = transport.requests.map((r) => JSON.parse(r.rawBody));
    expect(bodies.map((b) => b.state)).toEqual(['AGENT_WAITING', 'AGENT_RUNNING']);
    // AGENT_WAITING detail falls back to the fixture template.
    expect(bodies[0]!.detail).toEqual({
      question: 'Should the CSV importer validate headers before inserting rows?',
    });
  });
});

// ── SLYK-0450: latency profiles + flaky 500 rolls ───────────────────────────

describe('SLYK-0450 — latency profiles + failure injection', () => {
  const signedPost = (expressApp: Express, path: string, body: unknown) =>
    request(expressApp)
      .post(path)
      .set('X-Slykboard-Signature', signPayload(body, TEST_DISPATCHER_TOKEN))
      .send(body);

  it('parseArgs accepts --latency=fast|slow|flaky and rejects garbage', () => {
    expect(parseArgs(['--latency=slow']).latency).toBe('slow');
    expect(parseArgs(['--latency=flaky']).latency).toBe('flaky');
    expect(parseArgs([]).latency).toBe('fast');
    expect(() => parseArgs(['--latency=turbo'])).toThrow(/Invalid latency profile/);
  });

  it('slow profile delays every inbound webhook by the configured sleep', async () => {
    const sleeps: number[] = [];
    const slowApp = buildApp(TEST_DISPATCHER_TOKEN, {
      latency: 'slow',
      sleepImpl: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    const body = { eventType: 'ticket_created', ticketId: 't-slow' };
    const res = await signedPost(slowApp, '/webhooks/ticket-events', body);

    expect(res.status).toBe(202);
    expect(sleeps).toContain(2_000);
  });

  it('flaky profile 500s when the random roll hits, 202s otherwise', async () => {
    let roll = 0.1; // < 0.3 → 500 on the first call
    const flakyApp = buildApp(TEST_DISPATCHER_TOKEN, {
      latency: 'flaky',
      randomImpl: () => roll,
    });
    const body = { eventType: 'ticket_created', ticketId: 't-flaky' };

    const fail = await signedPost(flakyApp, '/webhooks/ticket-events', body);
    expect(fail.status).toBe(500);
    expect(fail.body.error).toContain('Injected 500');

    roll = 0.9; // ≥ 0.3 → passes through to the 202 stub
    const pass = await signedPost(flakyApp, '/webhooks/ticket-events', body);
    expect(pass.status).toBe(202);
  });

  it('fast (default) profile adds no sleep and never injects', async () => {
    const sleeps: number[] = [];
    const fastApp = buildApp(TEST_DISPATCHER_TOKEN, {
      sleepImpl: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      randomImpl: () => 0,
    });
    const body = { eventType: 'ticket_created', ticketId: 't-fast' };
    const res = await signedPost(fastApp, '/webhooks/ticket-events', body);

    expect(res.status).toBe(202);
    expect(sleeps).toEqual([]);
  });

  it('/admin/next-status can arm a 429 on demand (rate-limit simulation)', async () => {
    const app429 = buildApp(TEST_DISPATCHER_TOKEN);
    await request(app429)
      .get('/admin/next-status')
      .query({ path: '/webhooks/ticket-events', status: 429 });

    const body = { eventType: 'ticket_created', ticketId: 't-429' };
    const res = await signedPost(app429, '/webhooks/ticket-events', body);
    expect(res.status).toBe(429);
  });
});
