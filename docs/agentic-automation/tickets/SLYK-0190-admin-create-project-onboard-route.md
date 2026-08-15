# SLYK-0190 — `POST /api/v1/admin/projects`: create project + start onboarding

**Phase:** 0.5 — Onboarding MVP
**Type:** Feature (backend)
**Depends on:** SLYK-0140, SLYK-0150, SLYK-0180

## Description

Admin route creating a project + agent meta and kicking off the dispatcher
orchestrator. Replaces the stub in `admin-agent.routes.ts`.

**Files:** `backend/src/routes/admin-agent.routes.ts` +
`admin-agent.schema.ts` (Zod), `backend/src/services/projectOnboardingService.ts`,
`backend/src/repositories/projectAgentMetaRepository.ts`.

**Validation** (Zod, per `05-backend-routes.md`):

- `name` — non-empty, ≤200 chars.
- `slug` — `/^[a-z0-9-]+$/`, unique across `ProjectAgentMeta`.
- `subdomain` — same pattern, unique, NOT in reserved list (`api`, `www`,
  `admin`, `dispatcher`, `cyrus`, + document the list as a constant).
- `sourceMode` — `'new' | 'existing'`.
- `githubRepo` — required iff `sourceMode === 'existing'`; must match SSH
  `^git@github\.com:[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+\.git$` or HTTPS
  `^https://github\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+\.git$`; must be null
  when `sourceMode === 'new'`.
- `stack` — enum `node-express | next | python-fastapi | go | static`.
- `agentBackend` — nullable.
- `visibility` — `'internal' | 'public'` (default internal).
- `initialAgentContext` — nullable, ≤10,000 chars.

**Behavior:**

1. Transaction: insert core `projects` row (reuse existing name/description
   fields; check how `projects` creation currently seeds membership +
   sequences — reuse that service logic so the board actually works) +
   insert `ProjectAgentMeta` (teamKey = UPPER(slug), onboardingState =
   'PENDING', defaults per schema).
2. After commit: POST dispatcher `/onboard` with the `project` payload per
   `07-dispatcher-contract.md` (signed; includes idempotencyKey).
3. Dispatcher `202` → respond `201` envelope with the project row.
4. Dispatcher `400/409` → mark meta `onboardingState = 'FAILED'`,
   `onboardingError = <dispatcher message>`, return `502` with details.
5. Dispatcher unreachable after retries → also FAILED + `502`.

Errors use existing envelope codes (`VALIDATION_FAILED`, `CONFLICT` for
slug/subdomain collisions, `INTERNAL_ERROR`, `502` for dispatcher failure —
add a `BAD_GATEWAY`/`UPSTREAM_FAILED` code if none fits).

## Acceptance criteria

- [ ] Happy path (mock dispatcher 202): project + meta rows created, meta
      state PENDING, response 201.
- [ ] Every validation rule rejects with 400 + `VALIDATION_FAILED`
      (table-driven tests: bad slug, reserved subdomain, dup slug, dup
      subdomain, githubRepo set on 'new', githubRepo missing/invalid on
      'existing', bad stack, long initialAgentContext).
- [ ] Dispatcher 400/409 → meta FAILED + 502 to client.
- [ ] Dispatcher unreachable (mock down) → FAILED + 502 after retries.
- [ ] Non-admin → 403; unauthenticated → 401; plain mode → 501.
- [ ] Created project usable by existing board flows (membership seeded).

## References

- `docs/agentic-automation/05-backend-routes.md` § admin routes
- `docs/agentic-automation/07-dispatcher-contract.md` POST `/onboard`
- `docs/agentic-automation/11-existing-patterns.md` (route/schema/service templates)

## Dependencies

- SLYK-0140 (ProjectAgentMeta table)
- SLYK-0150 (admin router mounted, auth chain)
- SLYK-0180 (dispatcherClient)
