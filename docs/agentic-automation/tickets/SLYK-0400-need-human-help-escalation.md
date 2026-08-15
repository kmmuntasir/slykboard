# SLYK-0400 — "Need human help" escalation button

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (backend + frontend)
**Depends on:** SLYK-0180, SLYK-0310

## Description

Escalation for BLOCKED_HUMAN tickets. Renders from the SLYK-0310 badge
button (disabled stub there becomes real).

**Backend — `POST /api/v1/me/tickets/:id/escalate`:**

1. Ticket access check; job must exist and be `BLOCKED_HUMAN` (else 409).
2. After commit: POST dispatcher `/webhooks/pm-action/need-human-help`
   `{ticketId, projectId, reason: 'BLOCKED_HUMAN'}` per
   `07-dispatcher-contract.md` — this is the authoritative path
   (**reconciliation:** `06` says "POST to a Slack webhook"; `07`'s
   dispatcher path wins. `SLYKBOARD_SLACK_ESCALATION_WEBHOOK`, when set,
   is an optional SECONDARY direct Slack ping — belt-and-suspenders, not
   the primary).
3. 202 on dispatcher ack; 502 on dispatcher failure (button re-enables
   for retry). Debounce: one escalation per ticket per 60s (server-side
   timestamp guard) to prevent double-fire.

**Frontend:**

4. Wire the SLYK-0310 `<FailedPipelineBadge>` BLOCKED variant button →
   escalate endpoint. Loading state, error toast, success → button
   disabled ("escalated") — re-enabled if a new BLOCKED_HUMAN transition
   arrives via SSE. Hidden entirely when state ≠ BLOCKED_HUMAN. If
   neither dispatcher escalation nor Slack env is configured the button
   stays hidden per `06` (admin sees dashboard state instead).

## Acceptance criteria

- [ ] BLOCKED_HUMAN + member click → signed dispatcher webhook fires
      (mock 202) → UI shows escalated.
- [ ] Non-BLOCKED_HUMAN state → 409; double-click within 60s → single
      dispatch (second 429/409).
- [ ] Dispatcher down → 502, retry possible.
- [ ] Slack env set → secondary Slack ping sent (mock fetch assert);
      unset → no ping, button still works via dispatcher path.
- [ ] Plain mode: endpoint 501, button absent.

## References

- `docs/agentic-automation/06-frontend-ui.md` (FailedPipelineBadge BLOCKED
  variant)
- `docs/agentic-automation/07-dispatcher-contract.md` POST
  `/webhooks/pm-action/need-human-help`
- `docs/agentic-automation/09-implementation-phases.md` Phase 5

## Dependencies

- SLYK-0180 (dispatcherClient)
- SLYK-0310 (badge button host)
