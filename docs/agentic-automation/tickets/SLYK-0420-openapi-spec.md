# SLYK-0420 — OpenAPI spec generation + serving

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (backend)
**Depends on:** SLYK-0330, SLYK-0370

## Description

Generate + serve an OpenAPI spec from the Zod schemas of every `/api/v1/*`
route, per `11-existing-patterns.md` § OpenAPI generation.

1. Add devDependency `@asteasolutions/zod-to-openapi`.
2. `backend/src/openapi.ts` — `OpenAPIRegistry` +
   `extendZodWithOpenApi(z)`; register every agent-mode route + schema:
   internal (4 endpoints), admin (projects, decommission, agent-tokens ×3),
   me (pipeline, messages GET/POST, events SSE, queue, escalate,
   notification-preferences GET/PUT, onboarding events GET). SSE route
   documented with `text/event-stream` response.
3. `GET /api/v1/openapi.json` behind `requireAgentMode, authenticate,
   requirePlatformAdmin()` returning the generated document (memoized per
   process).
4. Spec generation unit test: document parses, contains every registered
   path, no `$ref` to missing components (zod-to-openapi throws on
   orphans — assert it doesn't).

## Acceptance criteria

- [ ] `/api/v1/openapi.json` returns valid OpenAPI 3 document as admin.
- [ ] All `/api/v1/*` paths present (assert against a route-list constant
      — test fails when a new route forgets registration).
- [ ] Non-admin 403; plain mode 501.
- [ ] Document validates (structure assertions in test).

## References

- `docs/agentic-automation/11-existing-patterns.md` § OpenAPI generation
- `docs/agentic-automation/05-backend-routes.md` § OpenAPI
- `docs/agentic-automation/09-implementation-phases.md` Phase 5

## Dependencies

- SLYK-0330 (me-messages schemas exist — last core route family)
- SLYK-0370 (token routes exist)
- SLYK-0230 (onboarding events GET), SLYK-0290/0400 routes registered —
  all `/api/v1` routes shipped before this ticket in sequence
