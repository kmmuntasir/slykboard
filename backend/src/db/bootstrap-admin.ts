import 'dotenv/config';
import { ensureBootstrapAdmin } from '../services/bootstrapService';
import { pool } from './client';
import { logger } from '../config/logger';

// SLYK-01 Task E: standalone runner for ensureBootstrapAdmin().
// Invoked by `make bootstrap` (after migrations), so the PA exists before the
// first server boot. Idempotent — safe to re-run. The server boot path no longer
// calls ensureBootstrapAdmin; this script owns seeding.
ensureBootstrapAdmin()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'Bootstrap admin seed failed');
    await pool.end();
    process.exit(1);
  });
