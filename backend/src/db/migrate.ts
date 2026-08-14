import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_MODE = process.env.SLYKBOARD_AGENT_MODE === 'true';
const here = path.dirname(fileURLToPath(import.meta.url));

async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    // Core always runs.
    await migrate(db, {
      migrationsFolder: path.join(here, 'migrations', 'core'),
    });
    console.info('[migrate] core migrations applied');

    // Agent only in agent mode.
    if (AGENT_MODE) {
      await migrate(db, {
        migrationsFolder: path.join(here, 'migrations', 'agent'),
      });
      console.info('[migrate] agent migrations applied');
    } else {
      console.info('[migrate] agent mode off — skipping agent migrations');
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
