import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ErrorCode } from '../utils/envelope';
import { TEST_DISPATCHER_TOKEN } from '../test/hmac';

// SLYK-0190 — end-to-end supertest coverage for POST /api/v1/admin/projects.
// The service's DB seams are mocked (unit SQL coverage lives in
// projectOnboardingService.test.ts); the dispatcher is a REAL local HTTP
// listener so the 202 wire path is exercised end-to-end through the real
// dispatcherClient. index.ts reads SLYKBOARD_AGENT_MODE at module scope →
// fresh module per mode (vi.resetModules + dynamic import). Config is NOT
// mocked — env vars are stubbed per boot (agentModeBoot.test.ts pattern),
// which also satisfies the SLYK-0130 agent-mode env validation.

// Force isProd=false so errorMiddleware keeps 5xx messages (assertion target).
vi.mock('../config/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/logger')>();
  return { ...actual, isProd: false };
});
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(async () => 0),
  bumpTokenVersion: vi.fn(),
}));

// The service's DB seams — everything below the route is stubbed here.
const serviceMock = vi.hoisted(() => ({
  createAgentProject: vi.fn(),
}));
vi.mock('../services/projectOnboardingService', () => serviceMock);

import { SignJWT } from 'jose';
import * as projectOnboardingService from '../services/projectOnboardingService';

const mockedCreate = vi.mocked(projectOnboardingService.createAgentProject);

// Must match backend/vitest.config.ts JWT_SECRET — the real config reads it.
const JWT_SECRET = 'test-secret-at-least-32-characters-long-aaaa';
const secretKey = new TextEncoder().encode(JWT_SECRET);

async function sessionToken(isPlatformAdmin: boolean): Promise<string> {
  return new SignJWT({ email: 'admin@example.com', pa: isPlatformAdmin, ver: 0 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .setIssuedAt()
    .setIssuer('slykboard')
    .setAudience('slykboard-web')
    .setExpirationTime('1h')
    .sign(secretKey);
}

async function bootAgentModeApp(dispatcherUrl = 'http://localhost:4001'): Promise<Express> {
  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'true');
  // SLYK-0130 cross-field rule: agent mode requires the dispatcher pair. The
  // real config reads these at load — a real listener URL makes the live-wire
  // describe block hit an actual server.
  vi.stubEnv('SLYKBOARD_DISPATCHER_URL', dispatcherUrl);
  vi.stubEnv('SLYKBOARD_DISPATCHER_TOKEN', TEST_DISPATCHER_TOKEN);
  const mod = await import('../index');
  return mod.app;
}

async function bootPlainModeApp(): Promise<Express> {
  vi.stubEnv('SLYKBOARD_AGENT_MODE', 'false');
  const mod = await import('../index');
  return mod.app;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ── Mock dispatcher ────────────────────────────────────────────────────────
// Local HTTP listener per 10-mock-dispatcher.md: records each request,
// verifies nothing (slykboard's job is to SIGN, dispatcher's to verify — but
// we DO assert the signature header is present + valid HMAC over raw bytes).

interface Recorded {
  rawBody: string;
  parsed: { idempotencyKey?: string; project?: Record<string, unknown> };
  signature: string | undefined;
}

function startDispatcher(
  status: number,
  body: unknown,
): Promise<{
  server: Server;
  requests: Recorded[];
  url: string;
}> {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      requests.push({
        rawBody,
        parsed: JSON.parse(rawBody),
        signature: req.headers['x-slykboard-signature'] as string | undefined,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, requests, url: `http://127.0.0.1:${port}` });
    });
  });
}

const VALID_BODY = {
  name: 'Inventory Tracker',
  slug: 'inventory-tracker',
  subdomain: 'inventory-tracker',
  sourceMode: 'new',
  githubRepo: null,
  stack: 'node-express',
  agentBackend: null,
  visibility: 'internal',
  initialAgentContext: null,
};

const PROJECT_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Inventory Tracker',
  slug: 'INVENTORYTRACKER',
  columns: [{ id: 'c1', name: 'To Do' }],
  creatorId: 'u1',
  isActive: true,
};

// appError identity across vi.resetModules — build fresh-module AppErrors
// (same pattern as internal.routes.test.ts; refreshed in beforeEach/afterEach
// because resetModules swaps the class identity the errorMiddleware checks).
const freshAppError = vi.hoisted(() => ({
  build: null as null | ((code: string, message: string, details?: unknown) => Error),
}));
async function refreshAppErrorFactory(): Promise<void> {
  const mod = await import('../utils/appError');
  freshAppError.build = (code, message, details) =>
    new mod.AppError(code as never, message, details !== undefined ? { details } : undefined);
}
beforeEach(refreshAppErrorFactory);
afterEach(refreshAppErrorFactory);

describe('POST /api/v1/admin/projects — validation table (400 VALIDATION_FAILED)', () => {
  const cases: Array<{ name: string; mutate: (b: Record<string, unknown>) => void }> = [
    {
      name: 'empty name',
      mutate: (b) => {
        b.name = '';
      },
    },
    {
      name: 'name > 200 chars',
      mutate: (b) => {
        b.name = 'x'.repeat(201);
      },
    },
    {
      name: 'uppercase slug',
      mutate: (b) => {
        b.slug = 'InventoryTracker';
      },
    },
    {
      name: 'underscore slug',
      mutate: (b) => {
        b.slug = 'inventory_tracker';
      },
    },
    {
      name: 'slug with slash',
      mutate: (b) => {
        b.slug = 'inventory/tracker';
      },
    },
    {
      name: 'reserved subdomain (api)',
      mutate: (b) => {
        b.subdomain = 'api';
      },
    },
    {
      name: 'reserved subdomain (www)',
      mutate: (b) => {
        b.subdomain = 'www';
      },
    },
    {
      name: 'reserved subdomain (admin)',
      mutate: (b) => {
        b.subdomain = 'admin';
      },
    },
    {
      name: 'reserved subdomain (dispatcher)',
      mutate: (b) => {
        b.subdomain = 'dispatcher';
      },
    },
    {
      name: 'reserved subdomain (cyrus)',
      mutate: (b) => {
        b.subdomain = 'cyrus';
      },
    },
    {
      name: 'githubRepo set when sourceMode=new',
      mutate: (b) => {
        b.githubRepo = 'git@github.com:kmlab/app.git';
      },
    },
    {
      name: 'githubRepo missing when sourceMode=existing',
      mutate: (b) => {
        b.sourceMode = 'existing';
        b.githubRepo = null;
      },
    },
    {
      name: 'githubRepo invalid (no .git) when sourceMode=existing',
      mutate: (b) => {
        b.sourceMode = 'existing';
        b.githubRepo = 'git@github.com:kmlab/app';
      },
    },
    {
      name: 'githubRepo invalid (https no .git) when sourceMode=existing',
      mutate: (b) => {
        b.sourceMode = 'existing';
        b.githubRepo = 'https://github.com/kmlab/app';
      },
    },
    {
      name: 'githubRepo wrong host when sourceMode=existing',
      mutate: (b) => {
        b.sourceMode = 'existing';
        b.githubRepo = 'git@gitlab.com:kmlab/app.git';
      },
    },
    {
      name: 'bad stack',
      mutate: (b) => {
        b.stack = 'rust-axum';
      },
    },
    {
      name: 'bad sourceMode',
      mutate: (b) => {
        b.sourceMode = 'fork';
      },
    },
    {
      name: 'bad visibility',
      mutate: (b) => {
        b.visibility = 'private';
      },
    },
    {
      name: 'initialAgentContext > 10,000 chars',
      mutate: (b) => {
        b.initialAgentContext = 'x'.repeat(10_001);
      },
    },
    {
      name: 'missing slug',
      mutate: (b) => {
        delete b.slug;
      },
    },
    {
      name: 'missing stack',
      mutate: (b) => {
        delete b.stack;
      },
    },
    {
      name: 'name not a string',
      mutate: (b) => {
        b.name = 42;
      },
    },
  ];

  beforeEach(() => {
    mockedCreate.mockReset();
    mockedCreate.mockResolvedValue({ project: PROJECT_ROW, meta: {} } as never);
  });

  cases.forEach(({ name, mutate }) => {
    it(`${name} → 400 VALIDATION_FAILED, service never called`, async () => {
      const app = await bootAgentModeApp();
      const body: Record<string, unknown> = { ...VALID_BODY };
      mutate(body);
      const res = await request(app)
        .post('/api/v1/admin/projects')
        .set('Authorization', `Bearer ${await sessionToken(true)}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(mockedCreate).not.toHaveBeenCalled();
    });
  });

  it('valid SSH githubRepo on existing passes validation (positive control)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({ ...VALID_BODY, sourceMode: 'existing', githubRepo: 'git@github.com:kmlab/app.git' });

    expect(res.status).toBe(201);
  });

  it('valid HTTPS githubRepo on existing passes validation', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({
        ...VALID_BODY,
        sourceMode: 'existing',
        githubRepo: 'https://github.com/kmlab/app.git',
      });

    expect(res.status).toBe(201);
  });

  it('agentBackend is nullable (null passes)', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send({ ...VALID_BODY, agentBackend: null });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/admin/projects — happy path + service mapping', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedCreate.mockResolvedValue({ project: PROJECT_ROW, meta: {} } as never);
  });

  it('admin JWT + valid body → 201 envelope with project row; creatorId from req.user', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: PROJECT_ROW });
    // Zod defaults applied (visibility) + githubRepo null-normalized.
    expect(mockedCreate).toHaveBeenCalledWith({
      body: { ...VALID_BODY, visibility: 'internal' },
      creatorId: 'u1',
    });
  });

  it('service CONFLICT (dup slug/subdomain) → 409 envelope', async () => {
    mockedCreate.mockRejectedValue(
      freshAppError.build!(ErrorCode.CONFLICT, "Slug 'inventory-tracker' already exists", {
        slug: 'inventory-tracker',
      }),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ slug: 'inventory-tracker' });
  });

  it('service UPSTREAM_FAILED (dispatcher rejected) → 502 envelope with details', async () => {
    mockedCreate.mockRejectedValue(
      freshAppError.build!(
        ErrorCode.UPSTREAM_FAILED,
        'Dispatcher onboarding failed: validation failed',
        { slug: 'inventory-tracker', dispatcherStatus: 400 },
      ),
    );
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_FAILED');
    expect(res.body.error.details).toEqual({ slug: 'inventory-tracker', dispatcherStatus: 400 });
  });
});

describe('POST /api/v1/admin/projects — auth + mode gates', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  it('no JWT → 401 UNAUTHENTICATED', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app).post('/api/v1/admin/projects').send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('non-admin JWT → 403 FORBIDDEN, service never called', async () => {
    const app = await bootAgentModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(false)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('plain mode → 501 NOT_IMPLEMENTED from requireAgentMode', async () => {
    const app = await bootPlainModeApp();
    const res = await request(app)
      .post('/api/v1/admin/projects')
      .set('Authorization', `Bearer ${await sessionToken(true)}`)
      .send(VALID_BODY);

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
    expect(res.body.error.message).toBe('Agent mode is not enabled on this server');
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/admin/projects — live dispatcher wire (real dispatcherClient)', () => {
  // Boots the app pointed at a REAL local listener: the service is mocked, so
  // this asserts the boot/config wiring only — the full signed POST (payload
  // shape, signature, idempotencyKey, retries) is covered by
  // dispatcherClient.test.ts + projectOnboardingService.test.ts.

  beforeEach(() => {
    mockedCreate.mockReset();
    mockedCreate.mockResolvedValue({ project: PROJECT_ROW, meta: {} } as never);
  });

  it('dispatcher 202 flows through the real client (smoke — service mocked)', async () => {
    const dispatcher = await startDispatcher(202, { orchestratorId: 'orch-1' });
    try {
      const app = await bootAgentModeApp(dispatcher.url);
      const res = await request(app)
        .post('/api/v1/admin/projects')
        .set('Authorization', `Bearer ${await sessionToken(true)}`)
        .send(VALID_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ data: PROJECT_ROW });
    } finally {
      await new Promise<void>((resolve) => dispatcher.server.close(() => resolve()));
    }
  });
});
