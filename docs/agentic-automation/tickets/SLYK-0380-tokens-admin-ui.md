# SLYK-0380 — `/admin/tokens` page + `<AgentTokenGenerateDialog>`

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (frontend)
**Depends on:** SLYK-0370, SLYK-0230

## Description

Token management UI per `06-frontend-ui.md`.

1. **`<AgentTokenGenerateDialog>`** — form (name, optional project
   scoping select), submit → POST. On success shows the raw token ONCE
   with copy button + "I've copied it" gate before dismissal is enabled
   — modal cannot be closed past the reveal step without acknowledging.
   Warning copy: token cannot be retrieved again.
2. **`/admin/tokens` page** — table from GET: name, project, created by,
   created at, status (active/revoked), revoke button. Revoke =
   destructive action → confirmation modal per repo rule (lightweight
   confirm — revoke is reversible-by-regeneration but still confirm).
3. Register route on the agent-routes array; platform-admin gated; navbar
   link only when agentMode.

## Acceptance criteria

- [ ] Generate flow: token shown once, copy button works (clipboard mock
      test), dismiss gated on "I've copied it".
- [ ] After refresh/navigate back, token never re-displayed (list shows
      row, no token).
- [ ] Revoke: confirm modal → 204 → row shows revoked.
- [ ] Non-admin redirected; plain mode absent from bundle/routes.
- [ ] Component tests: show-once gate, revoke confirm, list render.

## References

- `docs/agentic-automation/06-frontend-ui.md` § AgentTokenGenerateDialog
- `docs/agentic-automation/09-implementation-phases.md` Phase 5 smoke tests
  (generate → refresh → not retrievable)

## Dependencies

- SLYK-0370 (routes)
- SLYK-0230 (admin page + route patterns)
