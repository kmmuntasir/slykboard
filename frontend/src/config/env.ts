interface EnvConfig {
  readonly apiBaseUrl: string;
  readonly googleClientId: string;
  readonly pollIntervalSeconds: number;
}

function loadEnv(): EnvConfig {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('Missing VITE_API_BASE_URL — set it in frontend/.env (see .env.example)');
  }
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    throw new Error('Missing VITE_GOOGLE_CLIENT_ID — set it in frontend/.env (see .env.example)');
  }

  // F10 D9 / PRD REQ-2.4: board auto-poll interval. Vite inlines VITE_* vars as
  // STRINGS, so coerce explicitly. OPTIONAL — defaults to 30 when unset/empty.
  // Fail-fast on a present-but-non-integer or non-positive value: a bad poll
  // cadence is a misconfiguration that should surface at build, not silently at
  // runtime (mirrors this file's throw-on-bad-env philosophy).
  const rawPollIntervalSeconds = import.meta.env.VITE_POLL_INTERVAL_SECONDS;
  const pollIntervalSeconds = rawPollIntervalSeconds ? Number(rawPollIntervalSeconds) : 30;
  if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
    throw new Error(
      `Invalid VITE_POLL_INTERVAL_SECONDS="${rawPollIntervalSeconds}" — must be a positive integer (default 30)`,
    );
  }

  return { apiBaseUrl, googleClientId, pollIntervalSeconds };
}

export const env: EnvConfig = Object.freeze(loadEnv());

// F10 D9: refetchInterval takes ms. Single source of truth consumed by useBoard.
export const POLL_INTERVAL_MS = env.pollIntervalSeconds * 1000;
