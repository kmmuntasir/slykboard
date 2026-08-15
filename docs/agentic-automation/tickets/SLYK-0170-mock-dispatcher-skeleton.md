# SLYK-0170 — Mock dispatcher skeleton

**Phase:** 0 — Foundations
**Type:** Tooling
**Depends on:** SLYK-0150

## Description

Standalone mock dispatcher at `backend/tools/mock-dispatcher/` — skeleton
level per `10-mock-dispatcher.md` "Implementation order" (Phase 0 scope):
HMAC round-trip + `202` stubs. Not part of the runtime backend bundle.

1. **`backend/tools/mock-dispatcher/index.ts`** — Express server, default
   port 4001 (`--port` override). Raw-body capture via
   `express.json({verify})`. Token: `tools/mock-dispatcher/.token` generated
   on first run (`crypto.randomBytes(32).toString('hex')`), reused
   thereafter; `.token` gitignored.

2. **Skeleton endpoints** (all verify `X-Slykboard-Signature`, log the call
   to `state.json` (append-only log of received calls), return `202`):
   - `POST /onboard` → `202 {orchestratorId: "mock-orch-001"}`
   - `POST /decommission` → `202`
   - `POST /webhooks/ticket-events` → `202 {acceptedAt: <ISO>}`
   - `POST /webhooks/pm-action/need-human-help` → `202`
   - Invalid/missing signature → `401`.

3. **Directory layout** — create `scenarios/` + `fixtures/` dirs with
   `.gitkeep`s (files arrive with SLYK-0220/0300/0360). `README.md` with run
   instructions from `10-mock-dispatcher.md`.

4. **npm scripts** in `backend/package.json`:
   `"mock:dispatcher": "tsx tools/mock-dispatcher/index.ts"` and
   `"mock:dispatcher:scenario": "tsx tools/mock-dispatcher/index.ts
   --scenario"` (`--scenario=<name>` arg parsing; scenario loading logic
   itself is a stub that errors "no scenarios registered yet").

5. **Smoke proof** — with slykboard in agent mode pointing at the mock, a
   manually signed curl to any mock endpoint verifies; a tampered one 401s.
   And the reverse: mock's future outbound callbacks will use the same HMAC
   scheme (helper `sign()` exported from a shared `tools/mock-dispatcher/
   sign.ts`).

## Acceptance criteria

- [ ] `npm run mock:dispatcher` starts, binds 4001, generates `.token` on
      first run.
- [ ] Signed request to `/webhooks/ticket-events` → 202; tampered → 401;
      unsigned → 401.
- [ ] Every received call appended to `state.json` log.
- [ ] `backend` production build does not include `tools/` (check tsconfig
      exclude / build output).
- [ ] Round-trip test: sign with slykboard's test helper
      (`backend/src/test/hmac.ts`), mock accepts.

## References

- `docs/agentic-automation/10-mock-dispatcher.md` (layout, run, HMAC helper)
- `docs/agentic-automation/09-implementation-phases.md` Phase 0 last task

## Dependencies

- SLYK-0150 (HMAC scheme + test helper exist to round-trip against)
