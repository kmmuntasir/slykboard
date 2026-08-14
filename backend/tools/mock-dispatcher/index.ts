import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { sign, signaturesMatch, SLYKBOARD_SIGNATURE_HEADER } from './sign';

// SLYK-0170 — Mock dispatcher SKELETON per docs/agentic-automation/
// 10-mock-dispatcher.md "Implementation order" (Phase 0 scope): HMAC
// round-trip + 202 stubs. NOT part of the runtime backend bundle —
// backend/tsconfig.json rootDir/include keep tools/ out of dist/.
// Scenario replay, outbound callbacks, and failure injection arrive with
// SLYK-0220/0300/0360 (Phases 0.5/1/2/5).

const DEFAULT_PORT = 4001;
const MOCK_ORCHESTRATOR_ID = 'mock-orch-001';
const TOKEN_LENGTH_BYTES = 32; // crypto.randomBytes(32) → 64-char hex, matches SLYKBOARD_DISPATCHER_TOKEN

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(HERE, '.token');
const STATE_FILE = join(HERE, 'state.json');

// --- CLI args --------------------------------------------------------------
// --port=<n>        bind port (default 4001)
// --scenario=<name> Phase 0: parsed but unimplemented — errors "no scenarios
//                   registered yet" (files arrive with SLYK-0220+).
interface CliOptions {
  port: number;
  scenario: string | undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { port: DEFAULT_PORT, scenario: undefined };
  for (const arg of argv) {
    if (arg.startsWith('--port=')) {
      const port = Number.parseInt(arg.slice('--port='.length), 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${arg}`);
      }
      opts.port = port;
    } else if (arg.startsWith('--scenario=')) {
      opts.scenario = arg.slice('--scenario='.length);
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

function buildApp(token: string): Express {
  const app = express();
  app.use(express.json({ verify: captureRawBody, type: 'application/json' }));

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

  app.post('/onboard', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/onboard',
      signatureValid: true,
      body: req.body,
    });
    res.status(202).json({ orchestratorId: MOCK_ORCHESTRATOR_ID });
  });

  app.post('/decommission', (req, res) => {
    if (!requireValidSignature(req, res)) return;
    logCall({
      at: new Date().toISOString(),
      method: 'POST',
      path: '/decommission',
      signatureValid: true,
      body: req.body,
    });
    res.status(202).end();
  });

  app.post('/webhooks/ticket-events', (req, res) => {
    if (!requireValidSignature(req, res)) return;
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

// --- Scenario loading stub (SLYK-0220+) --------------------------------------
function loadScenario(name: string): never {
  throw new Error(
    `Scenario "${name}" not loaded: no scenarios registered yet ` +
      '(scenario files arrive with SLYK-0220/0300/0360)',
  );
}

// --- Boot ---------------------------------------------------------------------
function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.scenario) {
    loadScenario(opts.scenario);
  }

  const token = loadOrCreateToken();
  const app = buildApp(token);

  app.listen(opts.port, () => {
    // console, not pino — standalone tool, keeps the backend dependency tree out
    console.log(`[mock-dispatcher] skeleton listening on :${opts.port}`);
    console.log(`[mock-dispatcher] token: ${TOKEN_FILE} (state log: ${STATE_FILE})`);
  });
}

// Ensure the scenarios/ + fixtures/ dirs exist (files arrive with later
// SLYK tickets; .gitkeep files keep the layout in git from day one).
for (const dir of ['scenarios', 'fixtures']) {
  mkdirSync(join(HERE, dir), { recursive: true });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}

export { buildApp, parseArgs, loadOrCreateToken, verifySignature };
