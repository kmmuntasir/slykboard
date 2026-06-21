import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config';
import * as schema from './schema';

// Lazy singleton on globalThis — survives tsx watch HMR / hot restarts.
// Import-safe: constructing Pool does NOT connect; it connects on first query.
// Boot-time connectivity is validated by connect.ts.
const globalForDb = globalThis as unknown as {
  __slykPool?: Pool;
};

const pool: Pool =
  globalForDb.__slykPool ??
  new Pool({
    connectionString: env.databaseUrl,
    max: 5, // D3 — single Render service, low concurrency
  });

if (!globalForDb.__slykPool) {
  globalForDb.__slykPool = pool;
}

export const db = drizzle(pool, { schema });
export { pool };
