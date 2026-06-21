import { config as loadEnv } from 'dotenv';
// Override vitest's placeholder DATABASE_URL (see vitest.config.ts test.env) with the real
// backend/.env value so this integration test hits the docker-compose dev DB.
loadEnv({ override: true });

import { describe, it, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { users } from './schema';

function makeClient(): { db: ReturnType<typeof drizzle>; pool: Pool } {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  return { db, pool };
}

describe('F02 database integration', () => {
  it('connects and SELECTs 1', async () => {
    const { db, pool } = makeClient();
    const rows = await db.execute(sql`SELECT 1 AS one`);
    expect((rows.rows as Array<{ one: number }>)[0]?.one).toBe(1);
    await pool.end();
    expect(pool.ended).toBe(true);
  });

  const columnCases = [
    { name: 'id', type: 'uuid' },
    { name: 'google_id', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'full_name', type: 'text' },
    { name: 'avatar_url', type: 'text' },
    { name: 'role', type: 'USER-DEFINED' },
    { name: 'created_at', type: 'timestamp with time zone' },
    { name: 'updated_at', type: 'timestamp with time zone' },
  ];

  columnCases.forEach(({ name, type }) => {
    it(`Users column ${name} is ${type}`, async () => {
      const { db, pool } = makeClient();
      const res = await db.execute(sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${'Users'}
          AND column_name = ${name}
      `);
      expect((res.rows as Array<{ data_type: string }>)[0]?.data_type).toBe(type);
      await pool.end();
    });
  });

  it('round-trips a User row with UTC timestamps', async () => {
    const { db, pool } = makeClient();
    const [created] = await db
      .insert(users)
      .values({
        googleId: `test-${Date.now()}`,
        email: `test-${Date.now()}@slykboard.local`,
        fullName: 'Test User',
        role: 'MEMBER',
      })
      .returning();

    expect(created).toBeDefined();
    expect(created?.createdAt).toBeInstanceOf(Date);
    expect(created?.updatedAt).toBeInstanceOf(Date);
    expect(created?.role).toBe('MEMBER');

    await db.delete(users).where(sql`id = ${created!.id}`);
    await pool.end();
  });
});
