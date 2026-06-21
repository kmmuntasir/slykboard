import { pathToFileURL } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import { env } from './config';
import { pool } from './db/client';
import { connectWithRetry } from './db/connect';

const app: Express = express();

app.use(cors({ origin: env.frontendUrl }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'slykboard-backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

async function start(): Promise<void> {
  try {
    await connectWithRetry(pool);
  } catch (err) {
    console.error('[slykboard-backend] database connection failed on boot:', err);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`[slykboard-backend] listening on :${env.port}`);
  });

  server.on('error', (err) => {
    console.error('[slykboard-backend] server error:', err);
    process.exit(1);
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`[slykboard-backend] ${signal} received, shutting down`);
    // Hard deadline: if server.close or pool.end stall, force-exit.
    const forceExit = setTimeout(() => {
      console.error('[slykboard-backend] shutdown timed out, forcing exit');
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
