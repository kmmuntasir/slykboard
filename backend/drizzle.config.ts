import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Core (plain-mode) schema + migrations. Agent half lives in
// drizzle.config.agent.ts — see docs/agentic-automation/00-refactor-plan.md Task 1.
export default defineConfig({
  schema: './src/db/schema/core.ts',
  out: './src/db/migrations/core',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
