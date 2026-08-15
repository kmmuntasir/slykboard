import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import {
  sign,
  signaturesMatch,
  SLYKBOARD_SIGNATURE_HEADER,
  DISPATCHER_SIGNATURE_HEADER,
} from './sign';

// SLYK-0170 — Mock dispatcher skeleton per docs/agentic-automation/
// 10-mock-dispatcher.md. SLYK-0220 (Phase 0.5) adds the scenario engine:
// --scenario=<name> loads scenarios/<name>.json and replays scripted
// onboarding/decommission callbacks to slykboard's /api/v1/internal routes.
// SLYK-0300 (Phase 1) adds /webhooks/ticket-events handling + the
// state_update.* callback stream to /api/v1/internal/jobs/:ticketId/state.
// SLYK-0360 (Phase 2) adds agent message emission (message steps stream to
// /api/v1/internal/jobs/:ticketId/messages) + pm_reply handling: the
// agent-waiting scenario pauses at AGENT_WAITING + a question message and
// resumes (ack message + state tail) when slykboard delivers a pm_reply.
// NOT part of the runtime backend bundle — backend/tsconfig.json
// rootDir/include keep tools/ out of dist/. Latency/rate-limit profiles
// arrive with Phase 5.

const DEFAULT_PORT = 4001;
const DEFAULT_SLYKBOARD_URL = 'http://localhost:3000';
const MOCK_ORCHESTRATOR_ID = 'mock-orch-001';
const TOKEN_LENGTH_BYTES = 32; // crypto.randomBytes(32) → 64-char hex, matches SLYKBOARD_DISPATCHER_TOKEN
const ONBOARDING_EVENTS_PATH = '/api/v1/internal/projects';
const JOB_STATE_PATH = '/api/v1/internal/jobs';
// queue_for_agent follow-up per doc 10 § Endpoints mock must implement
// ("emit state_update.queued then agent_running"): slykboard already wrote
// QUEUED before the webhook, so the mock's single callback is AGENT_RUNNING.
const QUEUE_AGENT_DELAY_MS = 1000;

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(HERE, '.token');
const STATE_FILE = join(HERE, 'state.json');
const SCENARIOS_DIR = join(HERE, 'scenarios');
const FIXTURES_DIR = join(HERE, 'fixtures');

// --- CLI args --------------------------------------------------------------
// --port=<n>             bind port (default 4001)
// --scenario=<name>      load scenarios/<name>.json and replay its scripted
//                        onboarding/decommission callback streams (Phase 0.5)
// --slykboard-url=<url>  base URL slykboard listens on for outbound
//                        /api/v1/internal/* callbacks (default localhost:3000)
// --latency=<profile>    SLYK-0450 response-shaping profile:
//                        fast (0ms, default) | slow (2s/call) | flaky (30% 500s)
interface CliOptions {
  port: number;
  scenario: string | undefined;
  slykboardUrl: string;
  latency: LatencyProfile;
}

/** SLYK-0450 — latency/failure profile applied to every inbound webhook. */
export type LatencyProfile = 'fast' | 'slow' | 'flaky';

const LATENCY_DELAYS: Record<LatencyProfile, number> = {
  fast: 0,
  slow: 2_000,
  flaky: 0,
};

/** flaky: share of inbound webhook calls answered with an injected 500. */
const FLAKY_500_RATE = 0.3;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    port: DEFAULT_PORT,
    scenario: undefined,
    slykboardUrl: DEFAULT_SLYKBOARD_URL,
    latency: 'fast',
  };
  for (const arg of argv) {
    if (arg.startsWith('--port=')) {
      const port = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${arg}`);
      }
      opts.port = port;
    } else if (arg.startsWith('--scenario=')) {
      opts.scenario = arg.slice('--scenario='.length);
    } else if (arg.startsWith('--slykboard-url=')) {
      const url = arg.slice('--slykboard-url='.length).replace(/\/+$/, '');
      try {
        new URL(url);
      } catch {
        throw new Error(`Invalid slykboard URL: ${arg}`);
      }
      opts.slykboardUrl = url;
    } else if (arg.startsWith('--latency=')) {
      const profile = arg.slice('--latency='.length);
      if (profile !== 'fast' && profile !== 'slow' && profile !== 'flaky') {
        throw new Error(`Invalid latency profile: ${arg} (fast|slow|flaky)`);
      }
      opts.latency = profile;
    }
  }
  return opts;
}

// --- Token: generate on first run, reuse thereafter -------------------------
function loadOrCreateToken(): string {
  if (existsSync(TOKEN_FILE)) {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  const token = randomBytes(TOKEN_LENGTH_BYTES).toString('hex');
  writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  return token;
}

// --- state.json: append-only log of received calls --------------------------
interface LoggedCall {
  at: string;
  method: string;
  path: string;
  signatureValid: boolean;
  body: unknown;
  injectedStatus?: number;
}

function logCall(entry: LoggedCall): void {
  appendFileSync(STATE_FILE, JSON.stringify(entry) + '\n');
}

// --- Middleware: HMAC verify over raw bytes ---------------------------------
// Verify callback mirrors slykboard's index.ts raw-body capture (SLYK-0150):
// signing over parsed/re-serialized JSON breaks on key-ordering differences.
function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}

interface VerifyResult {
  valid: boolean;
  reason: 'missing' | 'invalid';
}

function verifySignature(req: Request, token: string): VerifyResult {
  const received = req.header(SLYKBOARD_SIGNATURE_HEADER);
  if (!received) return { valid: false, reason: 'missing' };
  const expected = sign(req.rawBody ?? Buffer.alloc(0), token);
  return signaturesMatch(received, expected)
    ? { valid: true, reason: 'invalid' }
    : { valid: false, reason: 'invalid' };
}

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

// ticket_created carries the id under body.ticket.id; queue_for_agent and
// pm_reply carry it flat (07-dispatcher-contract.md § /webhooks/ticket-events).
// Returns '' when absent — callers treat that as "nothing to stream".
function ticketIdOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const record = body as { ticketId?: unknown; ticket?: { id?: unknown } };
  const id = record.ticketId ?? record.ticket?.id;
  return typeof id === 'string' ? id : '';
}

// --- Scenario engine (SLYK-0220, Phase 0.5) ---------------------------------
// Shape per docs/agentic-automation/10-mock-dispatcher.md § Scenario file
// shape. One process replays at most one scenario.
interface ScenarioStep {
  delayMs: number;
  toState: string;
  detail?: Record<string, unknown>;
  fromState?: string; // optional explicit override; default = previous toState
}

// Phase 1 (SLYK-0300) per doc 10 § Scenario file shape: ticket_created steps
// key the target as "state" (not "toState") and POST {state, detail} — the
// jobs/:ticketId/state body shape from 05-backend-routes.md. fromState is
// NOT sent: slykboard derives it from the job row inside its transaction.
interface StateStep {
  delayMs: number;
  state: string;
  detail?: Record<string, unknown>;
}

// SLYK-0360 (Phase 2) — a chat-message callback step. Streams to
// /api/v1/internal/jobs/:ticketId/messages; step fields win over the
// fixtures/message.<role>.json template, idempotencyKey is minted per
// emission at runtime.
type MessageAuthorRole = 'AGENT' | 'SYSTEM';

interface MessageStep {
  delayMs: number;
  message: {
    authorRole?: MessageAuthorRole;
    body?: string;
    agentSessionId?: string;
  };
}

// A scripted ticket stream is a mix of state and message callbacks, played
// sequentially — the agent-waiting flow interleaves them (AGENT_WAITING
// state → question message; pm_reply → ack message → AGENT_RUNNING).
type TicketEventStep = StateStep | MessageStep;

interface Scenario {
  name: string;
  description?: string;
  onboardReply?: { status?: number; body?: { orchestratorId?: string } };
  onboardingEvents?: ScenarioStep[];
  decommissionEvents?: ScenarioStep[];
  ticketCreatedStateSequence?: TicketEventStep[];
  // SLYK-0360 — streamed when /webhooks/ticket-events delivers a pm_reply
  // (deduped on the webhook's idempotencyKey). Absent → receipt logged only.
  pmReplySequence?: TicketEventStep[];
}

// Kebab-name allowlist doubles as path-traversal protection for the join.
const SCENARIO_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function parseSteps(name: string, field: string, value: unknown): ScenarioStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Scenario "${name}": ${field} must be an array`);
  }
  return value.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Scenario "${name}": ${field}[${i}] must be an object`);
    }
    const step = raw as Record<string, unknown>;
    if (typeof step.toState !== 'string' || step.toState.length === 0) {
      throw new Error(`Scenario "${name}": ${field}[${i}].toState must be a string`);
    }
    if (!isLegalDelay(step.delayMs)) {
      throw new Error(`Scenario "${name}": ${field}[${i}].delayMs must be a non-negative number`);
    }
    return {
      delayMs: step.delayMs as number,
      toState: step.toState,
      ...(step.detail !== undefined ? { detail: step.detail as Record<string, unknown> } : {}),
      ...(step.fromState !== undefined ? { fromState: step.fromState as string } : {}),
    };
  });
}

// ticketCreatedStateSequence / pmReplySequence parser — each element is a
// state step (target key "state", must be a real PipelineState, else the
// stream would 400 on the first callback — 05-backend-routes.md Zod enum) or
// a message step (target key "message", authorRole AGENT|SYSTEM, body
// 1..4000 — the agentMessageBody Zod span).
function parseStateSteps(name: string, value: unknown, field: string): TicketEventStep[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Scenario "${name}": ${field} must be an array`);
  }
  return value.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Scenario "${name}": ${field}[${i}] must be an object`);
    }
    const step = raw as Record<string, unknown>;
    if (!isLegalDelay(step.delayMs)) {
      throw new Error(`Scenario "${name}": ${field}[${i}].delayMs must be a non-negative number`);
    }
    if (step.message !== undefined) {
      const msg = step.message;
      if (typeof msg !== 'object' || msg === null) {
        throw new Error(`Scenario "${name}": ${field}[${i}].message must be an object`);
      }
      const { authorRole, body, agentSessionId } = msg as Record<string, unknown>;
      if (authorRole !== undefined && authorRole !== 'AGENT' && authorRole !== 'SYSTEM') {
        throw new Error(
          `Scenario "${name}": ${field}[${i}].message.authorRole must be AGENT or SYSTEM`,
        );
      }
      if (
        body !== undefined &&
        (typeof body !== 'string' || body.length === 0 || body.length > 4000)
      ) {
        throw new Error(
          `Scenario "${name}": ${field}[${i}].message.body must be a string of 1..4000 chars`,
        );
      }
      if (agentSessionId !== undefined && typeof agentSessionId !== 'string') {
        throw new Error(
          `Scenario "${name}": ${field}[${i}].message.agentSessionId must be a string`,
        );
      }
      return {
        delayMs: step.delayMs as number,
        message: {
          ...(authorRole !== undefined ? { authorRole: authorRole as MessageAuthorRole } : {}),
          ...(body !== undefined ? { body: body as string } : {}),
          ...(agentSessionId !== undefined ? { agentSessionId: agentSessionId as string } : {}),
        },
      };
    }
    if (typeof step.state !== 'string' || !PIPELINE_STATES.includes(step.state)) {
      throw new Error(
        `Scenario "${name}": ${field}[${i}] needs a "state" (${PIPELINE_STATES.join('|')}) or "message" key`,
      );
    }
    return {
      delayMs: step.delayMs as number,
      state: step.state,
      ...(step.detail !== undefined ? { detail: step.detail as Record<string, unknown> } : {}),
    };
  });
}

function isLegalDelay(value: unknown): value is number {
  return typeof value === 'number' && value >= 0;
}

function loadScenario(name: string): Scenario {
  if (!SCENARIO_NAME_RE.test(name)) {
    throw new Error(`Invalid scenario name: "${name}"`);
  }
  const file = join(SCENARIOS_DIR, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(`Scenario "${name}" not found: expected ${file}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Scenario "${name}": top level must be an object`);
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.name !== name) {
    throw new Error(
      `Scenario "${name}": file name and "name" field ("${String(raw.name)}") disagree`,
    );
  }
  return {
    name,
    ...(raw.description !== undefined ? { description: raw.description as string } : {}),
    ...(raw.onboardReply !== undefined
      ? { onboardReply: raw.onboardReply as Scenario['onboardReply'] }
      : {}),
    onboardingEvents: parseSteps(name, 'onboardingEvents', raw.onboardingEvents),
    decommissionEvents: parseSteps(name, 'decommissionEvents', raw.decommissionEvents),
    ticketCreatedStateSequence: parseStateSteps(
      name,
      raw.ticketCreatedStateSequence,
      'ticketCreatedStateSequence',
    ),
    pmReplySequence: parseStateSteps(name, raw.pmReplySequence, 'pmReplySequence'),
  };
}

// Fixture payload templates per doc 10 § Layout — HMAC-signed at runtime, so
// files carry only {toState, detail}; fromState is injected by the engine
// (it depends on the live state chain, not the template).
function loadEventFixture(toState: string): { detail?: Record<string, unknown> } | null {
  const file = join(FIXTURES_DIR, `onboarding_event.${toState.toLowerCase()}.json`);
  if (!existsSync(file)) return null;
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return null;
  return parsed as { detail?: Record<string, unknown> };
}

// The 15-value PipelineState enum (04-schema.md) — validation target for
// scenario state steps, mirrored from slykboard's db enum. A local literal
// (not an import of src/db/schema) keeps the tool out of the backend's
// module graph; drift is caught by the e2e suite asserting real transitions.
const PIPELINE_STATES: readonly string[] = [
  'BACKLOG',
  'QUEUED',
  'AGENT_RUNNING',
  'AGENT_WAITING',
  'PR_OPEN',
  'CI_RUNNING',
  'MERGING',
  'CONFLICT_RETRY',
  'DEPLOYING',
  'DONE',
  'FAILED_AGENT',
  'FAILED_CI',
  'FAILED_CONFLICT',
  'FAILED_DEPLOY',
  'BLOCKED_HUMAN',
];

// state_update.* template twin of loadEventFixture (SLYK-0300): files carry
// {state, detail}; the engine strips "state" and sends detail only — the
// target state always comes from the scenario step, never the fixture.
function loadStateFixture(state: string): { detail?: Record<string, unknown> } | null {
  const file = join(FIXTURES_DIR, `state_update.${state.toLowerCase()}.json`);
  if (!existsSync(file)) return null;
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return null;
  return parsed as { detail?: Record<string, unknown> };
}

// SLYK-0360 — fixtures/message.<role>.json template: {authorRole, body,
// agentSessionId?}. Step fields win per-key; a missing fixture just means
// every message step must carry its own body.
interface MessageTemplate {
  authorRole?: MessageAuthorRole;
  body?: string;
  agentSessionId?: string;
}

function loadMessageFixture(role: string): MessageTemplate {
  const file = join(FIXTURES_DIR, `message.${role.toLowerCase()}.json`);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return {};
  return parsed as MessageTemplate;
}

// --- Outbound callback stream (mock → slykboard) ----------------------------
interface FetchLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchImpl = (url: string, init: RequestInit) => Promise<FetchLike>;
type SleepImpl = (ms: number) => Promise<void>;

const defaultFetchImpl: FetchImpl = (url, init) =>
  fetch(url, init).then(async (res) => ({
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
  }));

const defaultSleepImpl: SleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface StreamOptions {
  slykboardUrl: string;
  slug: string;
  steps: ScenarioStep[];
  seedFromState: string;
  token: string;
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
}

// Replay one scripted event stream sequentially: sleep delayMs, POST one
// signed onboarding event, advance fromState. Fire-and-forget from the route
// handler (the 202 already went out); per-step failures are logged and never
// abort the remaining stream — each event is an independent append.
async function streamOnboardingEvents(opts: StreamOptions): Promise<void> {
  const { slykboardUrl, slug, steps, seedFromState, token } = opts;
  const doFetch = opts.fetchImpl ?? defaultFetchImpl;
  const sleep = opts.sleepImpl ?? defaultSleepImpl;
  const url = `${slykboardUrl}${ONBOARDING_EVENTS_PATH}/${slug}/onboarding/events`;
  let fromState = seedFromState;

  for (const step of steps) {
    try {
      await sleep(step.delayMs);
      // Scenario step detail wins; otherwise fall back to the fixture template.
      const detail = step.detail ?? loadEventFixture(step.toState)?.detail;
      const body: Record<string, unknown> = {
        fromState: step.fromState ?? fromState,
        toState: step.toState,
      };
      if (detail !== undefined) body.detail = detail;
      const raw = JSON.stringify(body);
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [DISPATCHER_SIGNATURE_HEADER]: sign(raw, token),
        },
        body: raw,
      });
      if (!res.ok) {
        console.error(
          `[mock-dispatcher] outbound ${step.toState} → ${res.status}: ${await res.text()}`,
        );
      } else {
        console.log(`[mock-dispatcher] outbound ${step.toState} → ${res.status}`);
      }
    } catch (err) {
      console.error(`[mock-dispatcher] outbound ${step.toState} failed:`, err);
    }
    fromState = step.toState;
  }
}

// SLYK-0300 — state_update.* + SLYK-0360 message callback stream (mock →
// slykboard's /api/v1/internal/jobs/:ticketId/{state,messages}). Same
// sequential sleep-then-POST shape as streamOnboardingEvents. State bodies
// are the stateUpdateBody Zod shape ({state, detail?}) — fromState is
// derived server-side from the job row. Message bodies are the
// agentMessageBody shape ({authorRole, body, agentSessionId?,
// idempotencyKey}) with a per-emission idempotencyKey. A non-2xx (e.g. 400
// on an illegal transition) is logged and skipped, not retried: the mock is
// a script player, and re-sending the same state would just 400 again
// (07 § Retry semantics puts inbound dedup on the dispatcher).
async function streamJobCallbacks(opts: {
  slykboardUrl: string;
  ticketId: string;
  steps: TicketEventStep[];
  token: string;
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
  /** Routes message steps lacking an explicit agentSessionId (pm_reply echo). */
  replyAgentSessionId?: string;
}): Promise<void> {
  const { slykboardUrl, ticketId, steps, token } = opts;
  const doFetch = opts.fetchImpl ?? defaultFetchImpl;
  const sleep = opts.sleepImpl ?? defaultSleepImpl;
  const baseUrl = `${slykboardUrl}${JOB_STATE_PATH}/${ticketId}`;

  for (const step of steps) {
    try {
      await sleep(step.delayMs);
      if ('message' in step) {
        // Step fields win; the rest comes from the fixtures/message.*.json
        // template (authorRole defaults AGENT).
        const role = step.message.authorRole ?? 'AGENT';
        const template = loadMessageFixture(role);
        const agentSessionId =
          step.message.agentSessionId ?? template.agentSessionId ?? opts.replyAgentSessionId;
        const text = step.message.body ?? template.body;
        if (text === undefined) {
          console.error(
            `[mock-dispatcher] message ${role} skipped — no body (step or fixtures/message.${role.toLowerCase()}.json)`,
          );
          continue;
        }
        const body: Record<string, unknown> = {
          authorRole: role,
          body: text,
          // Fresh key per emission — inbound dedup is slykboard's job.
          idempotencyKey: randomUUID(),
        };
        if (agentSessionId !== undefined) body.agentSessionId = agentSessionId;
        const raw = JSON.stringify(body);
        const res = await doFetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [DISPATCHER_SIGNATURE_HEADER]: sign(raw, token),
          },
          body: raw,
        });
        if (!res.ok) {
          console.error(`[mock-dispatcher] message ${role} → ${res.status}: ${await res.text()}`);
        } else {
          console.log(`[mock-dispatcher] message ${role} → ${res.status}`);
        }
      } else {
        // Scenario step detail wins; otherwise the state_update.* fixture.
        const detail = step.detail ?? loadStateFixture(step.state)?.detail;
        const body: Record<string, unknown> = { state: step.state };
        if (detail !== undefined) body.detail = detail;
        const raw = JSON.stringify(body);
        const res = await doFetch(`${baseUrl}/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [DISPATCHER_SIGNATURE_HEADER]: sign(raw, token),
          },
          body: raw,
        });
        if (!res.ok) {
          console.error(
            `[mock-dispatcher] state_update ${step.state} → ${res.status}: ${await res.text()}`,
          );
        } else {
          console.log(`[mock-dispatcher] state_update ${step.state} → ${res.status}`);
        }
      }
    } catch (err) {
      const label =
        'message' in step
          ? `message ${step.message.authorRole ?? 'AGENT'}`
          : `state_update ${step.state}`;
      console.error(`[mock-dispatcher] ${label} failed:`, err);
    }
  }
}

// --- App ---------------------------------------------------------------------
interface BuildAppOptions {
  scenario?: Scenario;
  slykboardUrl?: string;
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
  /** SLYK-0450 latency profile (default fast). */
  latency?: LatencyProfile;
  /** SLYK-0450 determinism seam — flaky 500 rolls. Defaults to Math.random. */
  randomImpl?: () => number;
}

function buildApp(token: string, options: BuildAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ verify: captureRawBody, type: 'application/json' }));

  const scenario = options.scenario;
  const slykboardUrl = options.slykboardUrl ?? DEFAULT_SLYKBOARD_URL;
  // slug → orchestratorId for in-flight onboardings (memory only — doc 10:
  // no state persists across restarts).
  const onboardings = new Map<string, string>();
  // Failure injection (doc 10 § Failure injection): path → status. Sticky
  // until cleared — slykboard retries an armed /onboard with backoff, and a
  // one-shot override would let retry #1 succeed, so the doc's "retry 3x
  // then FAILED" outcome needs every attempt to fail. Full use lands with
  // SLYK-0410/0450; the endpoint exists per SLYK-0220.
  const injectedStatuses = new Map<string, number>();
  // pm_reply inbound dedup (SLYK-0360) — webhook idempotencyKeys already
  // streamed, per 07 § Retry semantics ("dispatcher dedups upstream").
  const seenPmReplyKeys = new Set<string>();

  // SLYK-0450 — latency/flaky profile state.
  const latency = options.latency ?? 'fast';
  const latencyDelayMs = LATENCY_DELAYS[latency];
  const randomImpl = options.randomImpl ?? Math.random;

  const requireValidSignature = (req: Request, res: Response): boolean => {
    const result = verifySignature(req, token);
    if (result.valid) return true;
    logCall({
      at: new Date().toISOString(),
      method: req.method,
      path: req.path,
      signatureValid: false,
      body: req.body,
    });
    res.status(401).json({ error: `Signature ${result.reason}` });
    return false;
  };

  // Returns true when the response was written with an injected status —
  // either an armed /admin/next-status code or (SLYK-0450) a flaky-profile
  // roll. Checked on every signed inbound webhook.
  const applyInjectedStatus = (req: Request, res: Response): boolean => {
    let status = injectedStatuses.get(req.path);
    if (status === undefined && latency === 'flaky' && randomImpl() < FLAKY_500_RATE) {
      status = 500;
    }
    if (status === undefined) return false;
    logCall({
      at: new Date().toISOString(),
      method: req.method,
      path: req.path,
      signatureValid: true,
      body: req.body,
      injectedStatus: status,
    });
    res.status(status).json({ error: `Injected ${status} via /admin/next-status` });
    return true;
  };

  // SLYK-0450 — latency middleware: slow adds 2s to every inbound webhook
  // (429-on-demand already rides next-status; fast is a no-op).
  if (latencyDelayMs > 0) {
    const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    app.use(async (_req, _res, next) => {
      await sleep(latencyDelayMs);
      next();
    });
  }

  const streamFromScenario = (steps: ScenarioStep[] | undefined, slug: string, seed: string) => {
    if (!steps || steps.length === 0 || !slug) return;
    void streamOnboardingEvents({
      slykboardUrl,
      slug,
      steps,
      seedFromState: seed,
      token,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
  };

  const streamStatesFromScenario = (steps: TicketEventStep[] | undefined, ticketId: string) => {
    if (!steps || steps.length === 0 || !ticketId) return;
    void streamJobCallbacks({
      slykboardUrl,
      ticketId,
      steps,
      token,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
  };

  // Local test control (doc 10 § Failure injection) — deliberately unsigned:
  // it configures the mock, never carries dispatcher traffic.
  //   /admin/next-status?path=/onboard&status=500   arm
  //   /admin/next-status?path=/onboard&status=clear disarm
  app.get('/admin/next-status', (req, res) => {
    const path = String(req.query.path ?? '');
    const statusParam = String(req.query.status ?? '');
    if (!path.startsWith('/')) {
      res.status(400).json({ error: 'path query param required (e.g. path=/onboard)' });
      return;
    }
    if (statusParam === 'clear') {
      injectedStatuses.delete(path);
      res.json({ path, cleared: true });
      return;
    }
    const status = Number.parseInt(statusParam, 10);
    if (Number.isNaN(status) || status < 400 || status > 599) {
      res.status(400).json({ error: 'status must be 400-599 or "clear"' });
      return;
    }
    injectedStatuses.set(path, status);
    res.json({ path, nextStatus: status });
  });

  app.post('/onboard', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    if (applyInjectedStatus(req, res)) return;
    const body = (req.body ?? {}) as { project?: { slug?: string } };
    const slug = body.project?.slug;
    const replyStatus = scenario?.onboardReply?.status ?? 202;
    const replyBody = scenario?.onboardReply?.body ?? { orchestratorId: MOCK_ORCHESTRATOR_ID };
    if (slug && replyBody.orchestratorId) {
      onboardings.set(slug, replyBody.orchestratorId);
    }
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/onboard',
      signatureValid: true,
      body: req.body,
    });
    res.status(replyStatus).json(replyBody);
    // Phase 0.5 (SLYK-0220): with a scenario loaded, immediately stream
    // onboarding_event.* callbacks at the scripted delayMs intervals.
    // Meta is PENDING at this point (createAgentProject's initial state) —
    // the first event's fromState seed.
    if (replyStatus >= 200 && replyStatus < 300) {
      streamFromScenario(scenario?.onboardingEvents, slug ?? '', 'PENDING');
    }
  });

  app.post('/decommission', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    if (applyInjectedStatus(req, res)) return;
    const body = (req.body ?? {}) as { slug?: string };
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/decommission',
      signatureValid: true,
      body: req.body,
    });
    res.status(202).end();
    // Slykboard already moved meta to DECOMMISSIONING before calling us
    // (markDecommissioningInTx commits pre-dispatch) — the ack event's
    // fromState seed.
    streamFromScenario(scenario?.decommissionEvents, body.slug ?? '', 'DECOMMISSIONING');
  });

  // Phase 1 (SLYK-0300) per doc 10 § Endpoints mock must implement:
  //   ticket_created   → stream the scenario's ticketCreatedStateSequence
  //   queue_for_agent  → emit state_update.queued then agent_running
  //   pm_reply         → log only (message emission = SLYK-0360, Phase 2)
  app.post('/webhooks/ticket-events', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    if (applyInjectedStatus(req, res)) return;
    const body = (req.body ?? {}) as { eventType?: string };
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/webhooks/ticket-events',
      signatureValid: true,
      body: req.body,
    });
    res.status(202).json({ acceptedAt: new Date().toISOString() });

    const ticketId = ticketIdOf(req.body);
    if (body.eventType === 'ticket_created') {
      // Payload shape 07-dispatcher-contract.md § ticket_created — the ticket
      // object rides under body.ticket. Stream the scripted lifecycle; a
      // missing sequence (no scenario) leaves the stub ack as-is.
      streamStatesFromScenario(scenario?.ticketCreatedStateSequence, ticketId);
    } else if (body.eventType === 'queue_for_agent') {
      // PM pressed "Start work" — slykboard already wrote QUEUED through its
      // own service path, so the ack pair re-emits QUEUED is NOT sent (a
      // same-state write is a 400 self-loop); only AGENT_RUNNING follows.
      if (ticketId && scenario?.ticketCreatedStateSequence?.length) {
        void streamJobCallbacks({
          slykboardUrl,
          ticketId,
          steps: [{ delayMs: QUEUE_AGENT_DELAY_MS, state: 'AGENT_RUNNING' }],
          token,
          fetchImpl: options.fetchImpl,
          sleepImpl: options.sleepImpl,
        });
      }
    } else if (body.eventType === 'pm_reply') {
      // Phase 2 (SLYK-0360) per doc 10 § Endpoints mock must implement:
      // log the reply, then stream the scenario's pmReplySequence — the
      // agent-waiting script acks with an AGENT message and resumes
      // (state_update.agent_running) on through DONE. Inbound dedup is the
      // dispatcher's job (07 § Retry semantics): slykboard's delivery queue
      // retries carry the SAME idempotencyKey, and re-streaming the tail
      // would 400 the state writes (post-DONE transitions are illegal) and
      // double the ack message — so a seen key is acked and dropped.
      const payload = (req.body ?? {}) as { idempotencyKey?: unknown; agentSessionId?: unknown };
      const key = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : '';
      const agentSessionId =
        typeof payload.agentSessionId === 'string' ? payload.agentSessionId : undefined;
      const steps = scenario?.pmReplySequence;
      if (!ticketId || !steps || steps.length === 0) {
        console.log(
          `[mock-dispatcher] pm_reply for ticket ${ticketId ?? '(unknown)'} — logged only`,
        );
      } else if (key && seenPmReplyKeys.has(key)) {
        console.log(
          `[mock-dispatcher] pm_reply for ticket ${ticketId} — duplicate ${key}, dropped`,
        );
      } else {
        if (key) seenPmReplyKeys.add(key);
        console.log(`[mock-dispatcher] pm_reply for ticket ${ticketId} — resuming agent`);
        void streamJobCallbacks({
          slykboardUrl,
          ticketId,
          steps,
          token,
          fetchImpl: options.fetchImpl,
          sleepImpl: options.sleepImpl,
          // Echo the session that asked the question (slykboard routes the
          // reply to it) onto ack messages without an explicit session.
          replyAgentSessionId: agentSessionId,
        });
      }
    }
  });

  app.post('/webhooks/pm-action/need-human-help', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    if (applyInjectedStatus(req, res)) return;
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/webhooks/pm-action/need-human-help',
      signatureValid: true,
      body: req.body,
    });
    res.status(202).end();
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

// --- Boot ---------------------------------------------------------------------
function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  // Fail fast on a bad scenario name/file before anything listens.
  const scenario = opts.scenario ? loadScenario(opts.scenario) : undefined;
  if (
    opts.scenario &&
    !scenario?.onboardingEvents?.length &&
    !scenario?.decommissionEvents?.length &&
    !scenario?.ticketCreatedStateSequence?.length &&
    !scenario?.pmReplySequence?.length
  ) {
    console.warn(
      `[mock-dispatcher] scenario "${opts.scenario}" streams no onboarding/decommission/state events`,
    );
  }

  const token = loadOrCreateToken();
  const app = buildApp(token, {
    scenario,
    slykboardUrl: opts.slykboardUrl,
    latency: opts.latency,
  });

  app.listen(opts.port, () => {
    // console, not pino — standalone tool, keeps the backend dependency tree out
    console.log(`[mock-dispatcher] listening on :${opts.port}`);
    console.log(
      `[mock-dispatcher] scenario: ${scenario ? scenario.name : 'none (202 stubs only)'}`,
    );
    console.log(`[mock-dispatcher] latency: ${opts.latency}`);
    console.log(`[mock-dispatcher] slykboard: ${opts.slykboardUrl}`);
    console.log(`[mock-dispatcher] token: ${TOKEN_FILE} (state log: ${STATE_FILE})`);
  });
}

// Ensure the scenarios/ + fixtures/ dirs exist (payload files arrive with
// later SLYK tickets; .gitkeep files keep the layout in git from day one).
for (const dir of [SCENARIOS_DIR, FIXTURES_DIR]) {
  mkdirSync(dir, { recursive: true });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

export {
  buildApp,
  parseArgs,
  loadOrCreateToken,
  verifySignature,
  loadScenario,
  parseStateSteps,
  streamOnboardingEvents,
  streamJobCallbacks,
};
export type { Scenario, ScenarioStep, StateStep, MessageStep, MessageAuthorRole, TicketEventStep };
