# 11 — Existing Codebase Patterns

> Cheat-sheet of existing slykboard code to use as templates when
> implementing new agent-mode features. Saves the AI agent hours of
> code archaeology. **Read before writing any new file** — every new
> file should match an existing pattern documented here.

## Backend layering

Repo uses **three layers** (not four — no `controllers/` dir, despite
the empty `backend/src/controllers/.gitkeep`):

```
routes/         *.routes.ts       Express router + Zod-validated handlers
                *.schema.ts       Zod schemas (split from routes — convention)
services/       *.ts              business logic + transactions
repositories/   *.ts              DB access via Drizzle
middleware/     *.ts              request preprocessing (auth, validation)
utils/          *.ts              shared helpers (envelope, appError)
```

**Rule:** new agent code follows the same split. Create:
- `backend/src/routes/internal.routes.ts` + `internal.schema.ts`
- `backend/src/routes/admin-agent.routes.ts` + `admin-agent.schema.ts`
- `backend/src/routes/agent-chat.routes.ts` + `agent-chat.schema.ts`
- `backend/src/services/pipelineStateService.ts`
- `backend/src/services/dispatcherClient.ts`
- `backend/src/repositories/pipelineJobRepository.ts`
- `backend/src/repositories/agentMessageRepository.ts`

## File template — route

Use `backend/src/routes/comments.routes.ts` (~50 lines) as template.
Key elements:
- Import `Router` from `express`.
- Import Zod schemas from sibling `*.schema.ts` file.
- Import `validateRequest` middleware from `../middleware/validateRequest`.
- Import service functions from `../services/<name>Service`.
- Each handler: `validateRequest(schema)`, then call service, then
  respond via envelope (see `utils/envelope.ts`).

```ts
// Skeleton (paraphrased from comments.routes.ts):
import { Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { envelope, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { createCommentSchema } from './comments.schema';
import { commentService } from '../services/commentService';

export const commentsRouter = Router();

commentsRouter.post('/', validateRequest(createCommentSchema), async (req, res) => {
  const created = await commentService.create(req.context!, req.validated.body);
  res.status(201).json(envelope(created));
});
```

## File template — schema

`backend/src/routes/comments.schema.ts`:

```ts
import { z } from 'zod';

export const createCommentSchema = z.object({
  body: z.object({
    ticketId: z.string().uuid(),
    body: z.string().min(1).max(10000),
  }),
});
```

Wrap with `z.object({body: ...})` because `validateRequest` injects
the parsed shape as `req.validated.body`. Match this style for every
new route.

## File template — service

Use `backend/src/services/commentService.ts` (~200 lines) as
template. Key elements:
- Import `db` from `../db/client`.
- Import repository functions.
- Import `RepositoryContext` type (auth-aware transaction handle).
- Each public method takes `ctx: RepositoryContext` first, then args.
- Transactions wrap multi-step mutations.

```ts
// Skeleton:
import { db } from '../db/client';
import { agentMessageRepository } from '../repositories/agentMessageRepository';
import type { RepositoryContext } from '../types';

export const agentMessageService = {
  async postReply(ctx: RepositoryContext, ticketId: string, body: string) {
    return db.transaction(async (tx) => {
      // 1. Verify ticket state via pipelineJobRepository.get(tx, ticketId)
      // 2. Insert message
      // 3. Clear needsPmAttention flag
      // 4. POST to dispatcher
      // 5. Return inserted message
    });
  },
};
```

## Existing middleware — what to reuse

| Middleware | File | Purpose |
|---|---|---|
| `authenticate` | `middleware/auth.ts` | Populates `req.user` from JWT. **Mount first** on any user-facing route. |
| `requirePlatformAdmin()` | `middleware/requirePlatformAdmin.ts` | Factory — **invoke with `()`**. Checks `req.user.isPlatformAdmin`. Mount after `authenticate`. |
| `requireProjectMember` | `middleware/requireProjectMember.ts` | Verifies user belongs to project. Param: project ID source (`params.projectId` or `params.slug` via lookup). |
| `resolveProject` | `middleware/resolveProject.ts` | Loads project by slug/id, attaches `req.project`. |
| `validateRequest` | `middleware/validateRequest.ts` | Runs Zod schema against request, populates `req.validated`. |
| `errorHandler` | `middleware/errorMiddleware.ts` | Catches thrown `AppError`, returns envelope. Mount last. |

New agent middleware:
- `requireAgentMode` — gate on `SLYKBOARD_AGENT_MODE=true`.
- `agentTokenAuth` — HMAC verify inbound dispatcher calls.

Both live in `backend/src/middleware/` per Task 4 of
`00-refactor-plan.md`.

## Existing ticket creation flow

**Route:** `POST /api/tickets` in `backend/src/routes/tickets.routes.ts`.

**Service:** `ticketService.create(...)` in
`backend/src/services/ticketService.ts` (~line 50, the `create` method).

**Auto-queue hook (Phase 1 work):**

In `ticketService.create`, after the core ticket insert commits
successfully, add conditional logic:

```ts
// At the end of ticketService.create, before return:
if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
  const job = await pipelineJobRepository.insert(tx, {
    ticketId: ticket.id,
    projectId: ticket.projectId,
    state: 'BACKLOG',
    agentBackend: projectMeta?.agentBackend ?? null,
    traceId: crypto.randomUUID(),
  });

  // Fire-and-forget outbound webhook — dispatcherClient handles retry.
  // Don't await inside the transaction; emit after commit.
  afterCommit(() => dispatcherClient.postToDispatcher('/webhooks/ticket-events', {
    eventType: 'ticket_created',
    idempotencyKey: crypto.randomUUID(),
    ticket: { /* full ticket payload per 07-dispatcher-contract.md */ },
  }));
}
```

`afterCommit` pattern: Drizzle exposes `tx.onCommit` or you can use a
simple `Promise.resolve().then(...)` after the transaction returns.
Either way, **don't make HTTP calls inside the transaction** — they
hold the DB connection open.

## Existing ticket access check

`ticketService.getTicketForUser(ctx, ticketId)` returns the ticket
row or throws `AppError(ErrorCode.NOT_FOUND)`. Internally checks
project membership via `requireProjectMember` semantics.

Reuse this in every new `GET /api/v1/me/tickets/:id/*` route. Don't
write a new auth check.

## API client (frontend)

Existing client: `frontend/src/api/client.ts`. Uses native `fetch`
with credentials + JSON. Wrapped per-resource:

```
frontend/src/api/
  client.ts          fetch wrapper, 401/403 handling, JSON parse
  tickets.ts         ticket CRUD calls (uses client.ts)
  comments.ts        comments calls
  ...
  queryKeys.ts       TanStack Query key factory
```

Frontend uses **TanStack Query** (React Query) for server state. New
agent endpoints follow the same pattern:

```ts
// frontend/src/api/pipeline.ts (new file)
import { apiClient } from './client';
import { queryKeys } from './queryKeys';

export const pipelineApi = {
  getJob: (ticketId: string) => apiClient.get(`/api/v1/me/tickets/${ticketId}/pipeline`),
};

// frontend/src/hooks/usePipeline.ts (new file)
import { useQuery } from '@tanstack/react-query';
import { pipelineApi } from '../api/pipeline';
import { queryKeys } from '../api/queryKeys';

export function usePipeline(ticketId: string) {
  return useQuery({
    queryKey: queryKeys.pipeline(ticketId),
    queryFn: () => pipelineApi.getJob(ticketId),
    enabled: !!ticketId,
  });
}
```

Add `pipeline(ticketId)` factory to `queryKeys.ts`. SSE events
invalidate the cache via `queryClient.invalidateQueries({queryKey: queryKeys.pipeline(ticketId)})`.

## Existing form pattern

Use `AddMemberModal.tsx` (~18KB) or `ChecklistEditor.tsx` (~6KB) as
template for new agent forms. Key conventions:

- Plain `useState` for form state (no react-hook-form in repo today).
- Zod schema (shared with backend if possible via
  `frontend/src/types/`) for validation.
- `<TextInput>`, `<SelectInput>`, `<ToggleSwitch>`, `<MarkdownTextarea>`
  components under `frontend/src/components/ui/`.
- Submit handler: set loading state, call API client, on success
  invalidate query + close, on error show inline error.

For `<OnboardingForm>`, follow `AddMemberModal.tsx` structure with
more fields. For `<DecommissionDialog>`, follow any existing modal
with confirm-text pattern (search for `confirm` in components).

## SSE — library + HA story

**Library choice:** plain `express` SSE. No `express-sse`, no
`sse-stream`. Express 5 supports long-lived connections natively. Use
Node's `http.ServerResponse` directly:

```ts
// backend/src/routes/internal.routes.ts (paraphrased)
internalRouter.get('/me/tickets/:id/events', requireAgentMode, authenticate, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',  // disable Nginx buffering if behind proxy
  });
  res.write('retry: 5000\n\n');  // client reconnects after 5s if dropped

  // Heartbeat every 15s — flushes proxies, keeps connection alive
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

  const onEvent = (event: { type: string; data: unknown }) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  };

  sseEmitter.on(req.params.id, onEvent);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseEmitter.off(req.params.id, onEvent);
  });
});
```

**HA story (research-phase acceptance):** in-memory
`EventEmitter` means multi-pod deploys break (events emitted on pod A
don't reach clients on pod B). **v1 invariant: single-pod slykboard
deployment.** Documented in deploy config. Phase 6.5 revisit if/when
scale-out needed — migration path is Redis pub/sub with the same
emitter interface.

`03-security.md` risk table already documents the 15s heartbeat +
5min idle close + client auto-reconnect.

## OpenAPI generation (Phase 5)

**Library choice:** `@asteasolutions/zod-to-openapi`. Mature, supports
Zod 4, works with the existing `*.schema.ts` split. Add to
`backend/package.json` devDependencies.

Procedural generation:

```ts
// backend/src/openapi.ts (new file in Phase 5)
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
// Register each schema + route path...

export function generateOpenAPISpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: { title: 'Slykboard Agent API', version: '1.0.0' },
    servers: [{ url: 'https://slykboard.kmlab.dev' }],
  });
}
```

Mounted at `GET /api/v1/openapi.json` behind `requirePlatformAdmin()`
(Phase 5 task).

## `/healthz` schemaVersion

Existing `/api/health` in `backend/src/index.ts` returns:

```json
{"status":"ok","service":"slykboard-backend","uptime":...,"timestamp":...}
```

Phase 0 task: extend response to include agent-mode signal + version:

```json
{
  "status":"ok",
  "service":"slykboard-backend",
  "uptime":...,
  "timestamp":...,
  "agentMode": <bool>,
  "schemaVersion": 1
}
```

`schemaVersion` bumps when the dispatcher↔slykboard contract changes
(field rename, required field added, etc.). Dispatcher refuses to
start if mismatched — see `07-dispatcher-contract.md`. Current value
`1`. Maintain a `SCHEMA_VERSION` constant in `backend/src/config/version.ts`.

## Dispatcher handshake

Two paths to establish HMAC trust:

1. **Operator-manual (primary):** `openssl rand -hex 32` → copy to
   slykboard `.env` (`SLYKBOARD_DISPATCHER_TOKEN`) + dispatcher env.
   Restart both. For homelab + research phase.

2. **UI-managed (Phase 5):** `POST /api/v1/admin/agent-tokens`
   generates a token, returns raw value **once**. UI shows copy button
   + "I've copied it" gate. Admin pastes into dispatcher env manually.
   Stored `sha256`-hashed in `AgentTokens.tokenHash`. Rotation = revoke
   + generate new + restart both.

Path 1 is the bootstrap path (env-based). Path 2 is the ongoing
rotation path (DB-based). Both coexist — env token is fallback, DB
tokens checked first. Phase 0 ships with path 1 only; Phase 5 adds
path 2.

## Test patterns

Vitest config: `backend/vitest.config.ts`. Tests co-located
`*.test.ts`. DB tests use the real test database (env var
`DATABASE_URL` points at `slykboard_test`). **No DB mocking** —
spin up schema via `npm run db:migrate` against the test DB once per
test run.

HMAC test helper (add to `backend/src/test/hmac.ts`):

```ts
import { createHmac } from 'node:crypto';

export function signPayload(body: unknown, token: string): string {
  return createHmac('sha256', token).update(JSON.stringify(body)).digest('hex');
}

export function dispatcherHeaders(body: unknown, token: string) {
  return {
    'Content-Type': 'application/json',
    'X-Dispatcher-Signature': signPayload(body, token),
  };
}
```

Use in `*.routes.test.ts` via `supertest`:

```ts
const body = {state: 'AGENT_RUNNING'};
const res = await request(app)
  .post('/api/v1/internal/jobs/uuid/state')
  .set(dispatcherHeaders(body, testToken))
  .send(body);
```

Mock dispatcher (see `10-mock-dispatcher.md`) provides higher-level
end-to-end coverage.

## Cross-doc consistency

- All env vars prefixed `SLYKBOARD_*` for slykboard-owned,
  `AGENT_*` not used (avoid prefix collisions).
- Route paths under `/api/v1/*` for new agent code; existing routes
  untouched at `/api/*`.
- Zod schemas always `*.schema.ts` siblings to `*.routes.ts`.
- Stores always `use*Store.ts` (zustand) on frontend.
- Test files always `*.test.{ts,tsx}` co-located.

When in doubt about a pattern: grep the codebase, find an existing
file doing something similar, copy its structure.
