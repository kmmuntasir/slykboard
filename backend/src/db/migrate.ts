import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const here = path.dirname(fileURLToPath(import.meta.url));

migrate(db, { migrationsFolder: path.join(here, 'migrations') })
  .then(async () => {
    console.info('Migrations applied');
    await pool.end();
  })
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await pool.end();
    process.exit(1);
  });
