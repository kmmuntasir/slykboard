import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Request } from 'express';
import cors from 'cors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { Pool } from 'pg';
import { env, runtimeConfig, SCHEMA_VERSION } from './config';
import { logger } from './config/logger';
import { pool } from './db/client';
import { connectWithRetry } from './db/connect';
import { requestLogger } from './middleware/requestLogger';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorMiddleware';
import { pingRouter } from './middleware/pingRoute';
import { authenticate } from './middleware/auth';
import { requireAgentMode } from './middleware/requireAgentMode';
import { agentTokenAuth } from './middleware/agentTokenAuth';
import { requirePlatformAdmin } from './middleware/requirePlatformAdmin';
import { authRouter } from './routes/auth.routes';
import { projectsRouter } from './routes/projects.routes';
import { ticketsRouter } from './routes/tickets.routes';
import { timerRouter } from './routes/timer.routes';
import { timeRouter } from './routes/time.routes';
import { usersRouter } from './routes/users.routes';
import { labelsRouter } from './routes/labels.routes';
import { commentsRouter } from './routes/comments.routes';

const app: Express = express();

// --- Global middleware (order matters — see F03 §4 lifecycle) ---
// 1. Security headers (first so every response incl. errors gets them).
app.use(helmet());
// 2. CORS — locked to FRONTEND_URL (D8). credentials:true enables future HttpOnly cookies.
app.use(
  cors({
    origin: env.frontendUrls,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);
// 3. Request logging (pino-http) — hangs req.log before routes use it.
app.use(requestLogger);
// 4a. Raw-body capture for dispatcher HMAC verification (SLYK-0150).
// Mounted BEFORE the global json parser and scoped to /api/v1/internal —
// the ONLY path whose auth signs over raw bytes. body-parser's
// `req.complete` guard makes the later global parse a no-op for these
// requests, so bodies are buffered exactly once.
app.use(
  '/api/v1/internal',
  express.json({
    // body-parser's verify types req as IncomingMessage; narrow to the
    // augmented Express Request that declares rawBody (types/express.d.ts).
    verify: (req: Request, _res, buf) => {
      req.rawBody = buf;
    },
    type: 'application/json',
  }),
);
// 4b. Body parsing (everything else).
app.use(express.json());

// --- Routes ---
// Health is the documented non-enveloped exception (F03 D10) — consumed by ops probes.
// SLYK-0160: agentMode + schemaVersion extend the probe per
// 07-dispatcher-contract.md § Versioning (dispatcher checks schemaVersion on boot).
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'slykboard-backend',
    agentMode: runtimeConfig.agentMode,
    schemaVersion: SCHEMA_VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe (F29 D7) — deep DB check via the app pool. Non-enveloped
// like /api/health (documented ops-probe exception).
app.get('/api/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ready',
      db: 'ok',
      service: 'slykboard-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, '[slykboard-backend] readiness probe failed');
    res.status(503).json({ status: 'unavailable', db: 'error' });
  }
});

// Smoke route proving the F03 contract end-to-end (D16).
app.use('/api', pingRouter);
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/timer', timerRouter);
app.use('/api/time', timeRouter);
app.use('/api/users', usersRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/comments', commentsRouter);

// --- Agent-mode routes (SLYK-0150) ---
// Mounted unconditionally per docs/agentic-automation/02-dual-mode.md Layer 2:
// plain mode must answer every /api/v1/* call with 501 from requireAgentMode
// (not 404), so the OSS contract "reject with 501" holds. The dynamic imports
// at boot still keep agent modules out of the plain-mode request path; the
// requireAgentMode gate short-circuits before any agent code runs.
const { internalRouter } = await import('./routes/internal.routes');
const { adminAgentRouter } = await import('./routes/admin-agent.routes');
app.use('/api/v1/internal', requireAgentMode, agentTokenAuth, internalRouter);
app.use('/api/v1/admin', requireAgentMode, authenticate, requirePlatformAdmin(), adminAgentRouter);

// --- Error sink (MUST be last) ---
app.use(notFound);
app.use(errorHandler);

// --- Boot / shutdown (untouched by F03) ---
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Runs pending drizzle migrations against the direct (non-pooled) DB url.
// Uses its own short-lived Pool — migrations may require the direct url and
// must not ride the app Pool (which may set prepare:false for pgBouncer).
// Runs pending drizzle migrations against the direct (non-pooled) DB url.
// Uses its own short-lived Pool — migrations may require the direct url and
// must not ride the app Pool (which may set prepare:false for pgBouncer).
// Core migrations always run; agent migrations only when agent mode is on
// (docs/agentic-automation/02-dual-mode.md Layer 1).
async function runMigrations(): Promise<void> {
  const coreFolder =
    process.env.CORE_MIGRATIONS_FOLDER?.trim() ||
    fileURLToPath(new URL('./db/migrations/core', import.meta.url));

  const migrationPool = new Pool({ connectionString: env.directDatabaseUrl });
  const migrationDb = drizzle(migrationPool);

  logger.info({ coreFolder }, '[slykboard-backend] running core migrations');
  try {
    await migrate(migrationDb, { migrationsFolder: coreFolder });

    if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
      const agentFolder =
        process.env.AGENT_MIGRATIONS_FOLDER?.trim() ||
        fileURLToPath(new URL('./db/migrations/agent', import.meta.url));
      logger.info({ agentFolder }, '[slykboard-backend] running agent migrations');
      await migrate(migrationDb, { migrationsFolder: agentFolder });
    }

    logger.info('[slykboard-backend] migrations applied');
  } finally {
    await migrationPool.end();
  }
}

async function start(): Promise<void> {
  try {
    await connectWithRetry(pool);
  } catch (err) {
    logger.error({ err }, '[slykboard-backend] database connection failed on boot');
    process.exit(1);
  }

  if (env.runMigrationsOnStart) {
    try {
      await runMigrations();
    } catch (err) {
      logger.error({ err }, '[slykboard-backend] migrations failed on boot');
      process.exit(1);
    }
  }

  const server = app.listen(env.port, () => {
    logger.info(`[slykboard-backend] listening on :${env.port}`);
  });

  server.on('error', (err) => {
    logger.error({ err }, '[slykboard-backend] server error');
    process.exit(1);
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info(`[slykboard-backend] ${signal} received, shutting down`);
    // Hard deadline: if server.close or pool.end stall, force-exit.
    const forceExit = setTimeout(() => {
      logger.error('[slykboard-backend] shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (isMain) {
  start();
}

export { app };
