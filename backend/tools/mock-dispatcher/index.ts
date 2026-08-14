import { randomBytes } from 'node:crypto';
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
// NOT part of the runtime backend bundle — backend/tsconfig.json
// rootDir/include keep tools/ out of dist/. Ticket-event state_update
// emission arrives with SLYK-0300 (Phase 1), messages with SLYK-0360
// (Phase 2), latency/rate-limit profiles with Phase 5.

const DEFAULT_PORT = 4001;
const DEFAULT_SLYKBOARD_URL = 'http://localhost:3000';
const MOCK_ORCHESTRATOR_ID = 'mock-orch-001';
const TOKEN_LENGTH_BYTES = 32; // crypto.randomBytes(32) → 64-char hex, matches SLYKBOARD_DISPATCHER_TOKEN
const ONBOARDING_EVENTS_PATH = '/api/v1/internal/projects';

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
interface CliOptions {
  port: number;
  scenario: string | undefined;
  slykboardUrl: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    port: DEFAULT_PORT,
    scenario: undefined,
    slykboardUrl: DEFAULT_SLYKBOARD_URL,
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

// --- Scenario engine (SLYK-0220, Phase 0.5) ---------------------------------
// Shape per docs/agentic-automation/10-mock-dispatcher.md § Scenario file
// shape. One process replays at most one scenario.
interface ScenarioStep {
  delayMs: number;
  toState: string;
  detail?: Record<string, unknown>;
  fromState?: string; // optional explicit override; default = previous toState
}

interface Scenario {
  name: string;
  description?: string;
  onboardReply?: { status?: number; body?: { orchestratorId?: string } };
  onboardingEvents?: ScenarioStep[];
  decommissionEvents?: ScenarioStep[];
  // Phase 1 (SLYK-0300) field per doc 10 § Scenario file shape — carried in
  // the JSON now, ignored by the mock until ticket-event emission lands.
  ticketCreatedStateSequence?: unknown[];
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
    if (typeof step.delayMs !== 'number' || step.delayMs < 0) {
      throw new Error(`Scenario "${name}": ${field}[${i}].delayMs must be a non-negative number`);
    }
    return {
      delayMs: step.delayMs,
      toState: step.toState,
      ...(step.detail !== undefined ? { detail: step.detail as Record<string, unknown> } : {}),
      ...(step.fromState !== undefined ? { fromState: step.fromState as string } : {}),
    };
  });
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
    ...(raw.ticketCreatedStateSequence !== undefined
      ? { ticketCreatedStateSequence: raw.ticketCreatedStateSequence }
      : {}),
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

// --- App ---------------------------------------------------------------------
interface BuildAppOptions {
  scenario?: Scenario;
  slykboardUrl?: string;
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
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

  // Returns true when the response was written with the injected status.
  const applyInjectedStatus = (req: Request, res: Response): boolean => {
    const status = injectedStatuses.get(req.path);
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

  app.post('/webhooks/ticket-events', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    if (applyInjectedStatus(req, res)) return;
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/webhooks/ticket-events',
      signatureValid: true,
      body: req.body,
    });
    res.status(202).json({ acceptedAt: new Date().toISOString() });
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
    !scenario?.decommissionEvents?.length
  ) {
    console.warn(
      `[mock-dispatcher] scenario "${opts.scenario}" streams no onboarding/decommission events`,
    );
  }

  const token = loadOrCreateToken();
  const app = buildApp(token, { scenario, slykboardUrl: opts.slykboardUrl });

  app.listen(opts.port, () => {
    // console, not pino — standalone tool, keeps the backend dependency tree out
    console.log(`[mock-dispatcher] listening on :${opts.port}`);
    console.log(
      `[mock-dispatcher] scenario: ${scenario ? scenario.name : 'none (202 stubs only)'}`,
    );
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
  streamOnboardingEvents,
};
