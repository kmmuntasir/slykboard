import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { users } from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main(): Promise<void> {
  await db
    .insert(users)
    .values([
      {
        googleId: 'admin-dev-fixture',
        email: 'admin@slykboard.local',
        fullName: 'Dev Admin',
        role: 'ADMIN',
      },
      {
        googleId: 'member-dev-fixture',
        email: 'member@slykboard.local',
        fullName: 'Dev Member',
        role: 'MEMBER',
      },
    ])
    .onConflictDoNothing({ target: users.email });

  console.info('Seeded 2 users');
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
