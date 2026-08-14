import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Agent-mode schema + migrations. Applied only when
// SLYKBOARD_AGENT_MODE=true (custom runner in src/db/migrate.ts).
// Populated in Phase 0 per docs/agentic-automation/04-schema.md.
export default defineConfig({
  schema: './src/db/schema/agent.ts',
  out: './src/db/migrations/agent',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
