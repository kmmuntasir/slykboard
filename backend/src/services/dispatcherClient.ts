import { createHmac, randomUUID } from 'node:crypto';
import { env } from '../config';
import { logger } from '../config/logger';

// SLYK-0180 — slykboard's ONLY outbound path to the dispatcher
// (docs/agentic-automation/07-dispatcher-contract.md § Auth outbound +
// § Retry semantics; 03-security.md § Slykboard → dispatcher). Every call:
// serialize the payload ONCE, HMAC-SHA256-sign those exact raw bytes with
// SLYKBOARD_DISPATCHER_TOKEN, POST with X-Slykboard-Signature. Re-serializing
// per attempt would break the signature on key-ordering differences, so all
// retries send the identical byte string (and the identical idempotencyKey,
// letting the dispatcher dedupe).

/** Backoff before retry 1..3 — 07-dispatcher-contract.md § Retry semantics. */
const RETRY_BACKOFF_MS: readonly [number, number, number] = [1_000, 5_000, 30_000];

/** 1 initial attempt + 3 retries. */
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

// Test-only multiplier on RETRY_BACKOFF_MS (0.01 → 10ms/50ms/300ms) so CI
// never waits the real 1s/5s/30s. Read at call time — unlike the frozen env
// config, this knob must apply without re-booting the process (agentTokenAuth
// reads its env the same lazy way). Not set in production.
const BACKOFF_SCALE_ENV = 'SLYKBOARD_DISPATCHER_BACKOFF_SCALE';

// 03-security.md § Logging: PM-supplied text never enters logs at full
// length — cap at 200 chars. The token and request bodies are never logged
// at all.
const LOG_TEXT_CAP = 200;

export class DispatcherError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Dispatcher ${path} ${status}: ${detail}`);
    this.name = 'DispatcherError';
  }
}

export interface DispatcherCallOptions {
  /** Overrides env.dispatcherUrl — tests point this at a local listener. */
  baseUrl?: string;
  /** Overrides env.dispatcherToken. */
  token?: string;
  /** Multiplier on RETRY_BACKOFF_MS; defaults to SLYKBOARD_DISPATCHER_BACKOFF_SCALE or 1. */
  backoffScale?: number;
}

function resolveBackoffScale(scale: number | undefined): number {
  if (typeof scale === 'number' && Number.isFinite(scale) && scale >= 0) {
    return scale;
  }
  const fromEnv = Number(process.env[BACKOFF_SCALE_ENV]);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 1;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Best-effort ticketId/traceId for the observability log line
// (07 § Observability logs them "when known"). Contract payloads:
// ticket_created → body.ticket.id; pm_reply / queue_for_agent → body.ticketId.
function extractLogIds(body: unknown): { ticketId?: string; traceId?: string } {
  if (!isRecord(body)) return {};
  const ids: { ticketId?: string; traceId?: string } = {};
  const ticketId = body.ticketId ?? (isRecord(body.ticket) ? body.ticket.id : undefined);
  if (typeof ticketId === 'string') ids.ticketId = ticketId;
  if (typeof body.traceId === 'string') ids.traceId = body.traceId;
  return ids;
}

function truncateForLog(text: string): string {
  return text.length > LOG_TEXT_CAP ? `${text.slice(0, LOG_TEXT_CAP)}…[truncated]` : text;
}

async function readErrorDetail(res: Response): Promise<string> {
  const text = (await res.text().catch(() => '')).trim();
  return text || '(no body)';
}

/**
 * POST `body` to the dispatcher at `path`, HMAC-signed over the exact raw
 * bytes. Retries 5xx/network failures 3× (1s/5s/30s backoff); 4xx never
 * retries. 204 resolves undefined; other 2xx responses are parsed as JSON.
 * Throws DispatcherError on any non-2xx after retries (status 0 = unreachable).
 */
export async function postToDispatcher<T>(
  path: string,
  body: unknown,
  options: DispatcherCallOptions = {},
): Promise<T> {
  const baseUrl = options.baseUrl ?? env.dispatcherUrl;
  const token = options.token ?? env.dispatcherToken;

  // Config bug, not a dispatcher failure: SLYK-0130 refuses to boot agent mode
  // without the URL+token pair, so this is a plain-mode caller misusing the
  // client. Crash loudly rather than signing with nothing / posting nowhere.
  if (!baseUrl || !token) {
    throw new Error(
      'dispatcherClient: SLYKBOARD_DISPATCHER_URL and _TOKEN are required (agent mode only)',
    );
  }

  // Inject the idempotencyKey BEFORE the single serialization so retries carry
  // the same key and byte-identical body — the dispatcher dedupes on it
  // (07 § Retry semantics). A caller-supplied key is preserved.
  const payload =
    isRecord(body) && body.idempotencyKey === undefined
      ? { ...body, idempotencyKey: randomUUID() }
      : (body ?? {});
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', token).update(raw).digest('hex');
  const ids = extractLogIds(payload);
  const scale = resolveBackoffScale(options.backoffScale);

  let lastError: DispatcherError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let res: Response | undefined;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Slykboard-Signature': signature,
        },
        body: raw,
      });
    } catch (cause) {
      // Network-layer failure (ECONNREFUSED, DNS, TLS…). Retryable, same
      // bucket as 5xx per 07 § Retry semantics; status 0 marks "unreachable".
      lastError = new DispatcherError(
        path,
        0,
        cause instanceof Error ? cause.message : String(cause),
      );
    }

    const base = {
      direction: 'outbound',
      path,
      method: 'POST',
      attempt,
      durationMs: Date.now() - startedAt,
      ...ids,
    };

    if (res?.ok) {
      logger.info({ ...base, status: res.status }, 'dispatcher call');
      return (res.status === 204 ? undefined : ((await res.json()) as T)) as T;
    }

    if (!res) {
      logger.warn(
        { ...base, status: 0, detail: truncateForLog(lastError!.detail) },
        'dispatcher call failed (network error)',
      );
    } else if (res.status < 500) {
      // 4xx is a validation failure — retrying cannot help (07 § Retry
      // semantics). The full detail rides on the error for callers to surface
      // to admins; only the log line is truncated.
      const detail = await readErrorDetail(res);
      logger.error(
        { ...base, status: res.status, detail: truncateForLog(detail) },
        'dispatcher call rejected — not retrying (4xx)',
      );
      throw new DispatcherError(path, res.status, detail);
    } else {
      const detail = await readErrorDetail(res);
      lastError = new DispatcherError(path, res.status, detail);
      logger.warn(
        { ...base, status: res.status, detail: truncateForLog(detail) },
        'dispatcher call failed (5xx)',
      );
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS[attempt - 1]! * scale);
    }
  }

  logger.error(
    {
      direction: 'outbound',
      path,
      method: 'POST',
      status: lastError?.status,
      detail: lastError ? truncateForLog(lastError.detail) : undefined,
      ...ids,
    },
    'dispatcher call failed — gave up after 3 retries',
  );
  throw lastError!;
}
