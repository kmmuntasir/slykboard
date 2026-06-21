import type { Pool } from 'pg';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 200;
const FACTOR = 2;
const JITTER = 0.25; // ±25%

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Validates DB connectivity at boot. pg/Drizzle have no built-in boot retry —
 * this wraps pool.query('SELECT 1') in exponential backoff + jitter so the
 * app doesn't crash if the DB is briefly unreachable on cold start (F02 edge
 * case). Throws if all attempts fail; caller should let the process exit non-zero.
 */
export async function connectWithRetry(pool: Pool, attempts = MAX_ATTEMPTS): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt === attempts) {
        throw err;
      }
      const delay = BASE_DELAY_MS * FACTOR ** (attempt - 1);
      const jitter = delay * JITTER * (Math.random() * 2 - 1);
      await sleep(Math.round(delay + jitter));
    }
  }
}
