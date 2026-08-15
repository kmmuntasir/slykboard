// SLYK-0420 — OpenAPI spec for every /api/v1/* agent route
// (11-existing-patterns.md § OpenAPI generation). Procedural registration of
// all 18 paths (4 internal + 5 admin + 9 me) via @asteasolutions/zod-to-openapi;
// generateDocument() is memoized per process — the route table is static.
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

// ── Shared pieces ───────────────────────────────────────────────────────────

// Responses are envelope-wrapped DB rows; documenting them as free-form
// objects keeps the spec honest without duplicating row schemas.
// Literal-typed schema objects — `type: 'object'` must stay the literal, not
// string, to satisfy zod-to-openapi's SchemaObject union.
const objectSchema = { type: 'object' } as const;
const stringSchema = { type: 'string' } as const;

const okResponse = {
  description: 'Success envelope { data }',
  content: { 'application/json': { schema: objectSchema } },
};
const sseResponse = {
  description: 'Server-Sent Events stream (text/event-stream)',
  content: { 'text/event-stream': { schema: stringSchema } },
};
const errResponse = (description: string) => ({ description });

// Security schemes: dispatcher HMAC vs browser JWT (03-security.md).
const hmacAuth: Array<{ dispatcherHmac: string[] }> = [{ dispatcherHmac: [] }];
const jwtAuth: Array<{ bearerAuth: string[] }> = [{ bearerAuth: [] }];

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'dispatcherHmac', {
  type: 'apiKey',
  description:
    'X-Dispatcher-Signature — hex HMAC-SHA256 of the raw body, key SLYKBOARD_DISPATCHER_TOKEN',
  in: 'header',
  name: 'X-Dispatcher-Signature',
});
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Session JWT (authenticate middleware)',
});

// ── /api/v1/internal — dispatcher callbacks (HMAC) ──────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/v1/internal/jobs/{ticketId}/state',
  description: 'Dispatcher updates pipeline state (SLYK-0260). Validates the transition matrix; DONE auto-moves the kanban ticket.',
  security: hmacAuth,
  request: {
    params: z.object({ ticketId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['state'],
            properties: {
              state: {
                type: 'string',
                enum: ['BACKLOG', 'QUEUED', 'AGENT_RUNNING', 'AGENT_WAITING', 'PR_OPEN', 'CI_RUNNING', 'MERGING', 'CONFLICT_RETRY', 'DEPLOYING', 'DONE', 'FAILED_AGENT', 'FAILED_CI', 'FAILED_CONFLICT', 'FAILED_DEPLOY', 'BLOCKED_HUMAN'],
              },
              detail: { type: 'object', additionalProperties: true },
              traceId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
  },
  responses: {
    200: okResponse,
    400: errResponse('Invalid state / illegal transition (INVALID_STATE_TRANSITION)'),
    401: errResponse('Missing/invalid HMAC signature'),
    404: errResponse('Ticket not in pipeline'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/internal/jobs/{ticketId}/messages',
  description: 'Dispatcher forwards an agent utterance into the PM↔agent chat (SLYK-0320). Idempotent on idempotencyKey.',
  security: hmacAuth,
  request: {
    params: z.object({ ticketId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['authorRole', 'body'],
            properties: {
              authorRole: { type: 'string', enum: ['AGENT', 'SYSTEM'] },
              body: { type: 'string', maxLength: 4000 },
              agentSessionId: { type: 'string' },
              idempotencyKey: { type: 'string', format: 'uuid' },
              traceId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
  },
  responses: {
    201: okResponse,
    400: errResponse('authorRole=PM rejected; body length cap'),
    401: errResponse('Missing/invalid HMAC signature'),
    404: errResponse('Ticket not in pipeline'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/internal/projects/{slug}/deploy-target',
  description: 'Dispatcher reads deploy config (SLYK-0200). 409 when the project is not LIVE.',
  security: hmacAuth,
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: okResponse,
    401: errResponse('Missing/invalid HMAC signature'),
    404: errResponse('Unknown slug'),
    409: errResponse('Project not LIVE'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/internal/projects/{slug}/onboarding/events',
  description: 'Dispatcher appends an onboarding lifecycle event (SLYK-0200). LIVE sets onboardedAt; FAILED stores onboardingError.',
  security: hmacAuth,
  request: {
    params: z.object({ slug: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['toState'],
            properties: {
              fromState: { type: 'string', nullable: true },
              toState: { type: 'string' },
              detail: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
  },
  responses: {
    200: okResponse,
    400: errResponse('Invalid toState'),
    401: errResponse('Missing/invalid HMAC signature'),
    404: errResponse('Unknown slug'),
  },
});

// ── /api/v1/admin — admin UI actions (JWT + platform admin) ─────────────────

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/projects',
  description: 'Create a project + start onboarding (SLYK-0190). Rate-limited 1/10s/admin (SLYK-0410).',
  security: jwtAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'slug', 'subdomain', 'sourceMode', 'stack'],
            properties: {
              name: { type: 'string', maxLength: 200 },
              slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
              subdomain: { type: 'string', pattern: '^[a-z0-9-]+$' },
              sourceMode: { type: 'string', enum: ['new', 'existing'] },
              githubRepo: { type: 'string', nullable: true },
              stack: { type: 'string', enum: ['node-express', 'next', 'python-fastapi', 'go', 'static'] },
              agentBackend: { type: 'string', nullable: true },
              visibility: { type: 'string', enum: ['internal', 'public'] },
              initialAgentContext: { type: 'string', nullable: true, maxLength: 10000 },
            },
          },
        },
      },
    },
  },
  responses: {
    201: okResponse,
    400: errResponse('VALIDATION_FAILED'),
    401: errResponse('Unauthenticated'),
    403: errResponse('Non-admin'),
    429: errResponse('Rate limited (1/10s)'),
    502: errResponse('Dispatcher rejected/unreachable (UPSTREAM_FAILED)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/projects/{slug}/decommission',
  description: 'Trigger dispatcher teardown (SLYK-0210). confirmSlug must match exactly.',
  security: jwtAuth,
  request: {
    params: z.object({ slug: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['confirmSlug'],
            properties: { confirmSlug: { type: 'string' } },
          },
        },
      },
    },
  },
  responses: {
    202: okResponse,
    400: errResponse('confirmSlug mismatch'),
    404: errResponse('Unknown slug'),
    502: errResponse('Dispatcher failure (state stays DECOMMISSIONING)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/agent-tokens',
  description: 'Generate a dispatcher HMAC token (SLYK-0370). Raw token returned exactly once.',
  security: jwtAuth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 200 },
              projectId: { type: 'string', format: 'uuid', nullable: true },
            },
          },
        },
      },
    },
  },
  responses: {
    201: okResponse,
    400: errResponse('VALIDATION_FAILED'),
    403: errResponse('Non-admin'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/agent-tokens/{id}',
  description: 'Revoke a token (SLYK-0370). 404 unknown id; 409 already revoked.',
  security: jwtAuth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: 'Revoked' },
    404: errResponse('Unknown token id'),
    409: errResponse('Already revoked'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/agent-tokens',
  description: 'List tokens without hashes (SLYK-0370).',
  security: jwtAuth,
  responses: {
    200: okResponse,
    403: errResponse('Non-admin'),
  },
});

// ── /api/v1/me — user-facing agent routes (JWT) ─────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/tickets/{ticketId}/pipeline',
  description: 'Pipeline tab payload — job row + last 50 events (SLYK-0280).',
  security: jwtAuth,
  request: { params: z.object({ ticketId: z.string().uuid() }) },
  responses: {
    200: okResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown ticket / not in pipeline'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/tickets/{ticketId}/events',
  description: 'SSE stream of pipeline state + chat message events (SLYK-0270). Heartbeat every 15s; idle close at 5 min.',
  security: jwtAuth,
  request: { params: z.object({ ticketId: z.string().uuid() }) },
  responses: {
    200: sseResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown ticket / non-member (non-revealing)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/me/tickets/{ticketId}/queue',
  description: 'PM "Start work" — BACKLOG/FAILED_*/BLOCKED_HUMAN → QUEUED (SLYK-0290).',
  security: jwtAuth,
  request: { params: z.object({ ticketId: z.string().uuid() }) },
  responses: {
    200: okResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown ticket / no job row'),
    409: errResponse('Illegal source state'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/me/tickets/{ticketId}/escalate',
  description: '"Need human help" on BLOCKED_HUMAN (SLYK-0400). 60s debounce per ticket.',
  security: jwtAuth,
  request: { params: z.object({ ticketId: z.string().uuid() }) },
  responses: {
    202: okResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown ticket / no job row'),
    409: errResponse('Not BLOCKED_HUMAN / debounced'),
    502: errResponse('Dispatcher escalation failed'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/tickets/{ticketId}/messages',
  description: 'PM↔agent chat thread read (SLYK-0330). Marks AGENT messages read.',
  security: jwtAuth,
  request: { params: z.object({ ticketId: z.string().uuid() }) },
  responses: {
    200: okResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown ticket'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/me/tickets/{ticketId}/messages',
  description: 'PM chat reply (SLYK-0330). 409 unless AGENT_RUNNING/AGENT_WAITING. Rate-limited 30/min/user (SLYK-0410).',
  security: jwtAuth,
  request: {
    params: z.object({ ticketId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['body'],
            properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } },
          },
        },
      },
    },
  },
  responses: {
    201: okResponse,
    400: errResponse('Body length cap'),
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown ticket'),
    409: errResponse('Agent not listening'),
    429: errResponse('Rate limited (30/min)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/projects/{slug}/onboarding/events',
  description: 'Onboarding timeline read (SLYK-0230). Polled by the admin timeline page.',
  security: jwtAuth,
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: okResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown slug'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/me/projects/{slug}/notification-preferences',
  description: 'Per-user notification opt-ins; defaults without a row (SLYK-0390).',
  security: jwtAuth,
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: okResponse,
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown slug'),
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/me/projects/{slug}/notification-preferences',
  description: 'Upsert the three opt-in booleans (SLYK-0390).',
  security: jwtAuth,
  request: {
    params: z.object({ slug: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['notifyOnDone', 'notifyOnBlockedHuman', 'notifyOnAgentWaiting'],
            properties: {
              notifyOnDone: { type: 'boolean' },
              notifyOnBlockedHuman: { type: 'boolean' },
              notifyOnAgentWaiting: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
  responses: {
    200: okResponse,
    400: errResponse('VALIDATION_FAILED'),
    401: errResponse('Unauthenticated'),
    404: errResponse('Unknown slug'),
  },
});

// ── Generation ──────────────────────────────────────────────────────────────

/** Every registered path — the completeness test asserts against this list. */
export const AGENT_API_PATHS = [
  'POST /api/v1/internal/jobs/{ticketId}/state',
  'POST /api/v1/internal/jobs/{ticketId}/messages',
  'GET /api/v1/internal/projects/{slug}/deploy-target',
  'POST /api/v1/internal/projects/{slug}/onboarding/events',
  'POST /api/v1/admin/projects',
  'POST /api/v1/admin/projects/{slug}/decommission',
  'POST /api/v1/admin/agent-tokens',
  'DELETE /api/v1/admin/agent-tokens/{id}',
  'GET /api/v1/admin/agent-tokens',
  'GET /api/v1/me/tickets/{ticketId}/pipeline',
  'GET /api/v1/me/tickets/{ticketId}/events',
  'POST /api/v1/me/tickets/{ticketId}/queue',
  'POST /api/v1/me/tickets/{ticketId}/escalate',
  'GET /api/v1/me/tickets/{ticketId}/messages',
  'POST /api/v1/me/tickets/{ticketId}/messages',
  'GET /api/v1/me/projects/{slug}/onboarding/events',
  'GET /api/v1/me/projects/{slug}/notification-preferences',
  'PUT /api/v1/me/projects/{slug}/notification-preferences',
] as const;

let cached: Record<string, unknown> | null = null;

/** Memoized OpenAPI 3 document — the route table is static per process. */
export function generateOpenApiDocument(): Record<string, unknown> {
  if (cached) return cached;
  const generator = new OpenApiGeneratorV3(registry.definitions);
  cached = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Slykboard Agent API',
      version: '1.0.0',
      description:
        'Agent-mode /api/v1 surface (docs/agentic-automation/05-backend-routes.md). Plain mode answers every path with 501.',
    },
    servers: [{ url: 'https://slykboard.kmlab.dev' }],
    tags: [
      { name: 'internal', description: 'Dispatcher callbacks (HMAC)' },
      { name: 'admin', description: 'Admin UI actions (JWT + platform admin)' },
      { name: 'me', description: 'User-facing agent routes (JWT)' },
    ],
  }) as unknown as Record<string, unknown>;
  return cached;
}
