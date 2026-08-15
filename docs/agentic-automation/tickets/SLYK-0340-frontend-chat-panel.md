# SLYK-0340 — `<AgentChatPanel>` + chat tab (sanitized markdown)

**Phase:** 2 — PM ↔ Agent Chat
**Type:** Feature (frontend)
**Depends on:** SLYK-0330, SLYK-0270, SLYK-0310

## Description

Chat tab on the ticket detail page per `06-frontend-ui.md`.

1. **`<AgentChatPanel>`**:
   - Thread from `GET /api/v1/me/tickets/:id/messages`; PM messages
     right-aligned, AGENT left-aligned with agent label, SYSTEM centered
     with subtle background per `06` sketches.
   - Input box: enabled only while `ticketState ∈ {AGENT_RUNNING,
     AGENT_WAITING}`; disabled otherwise with reason text. Enter sends,
     Shift+Enter newline, char counter to 4000.
   - Send → POST; optimistic append; on `delivered: false` show "not
     delivered" indicator next to the message (clears when retry
     succeeds — SSE or refetch).
   - Live updates: SSE `message` event appends + refetch fallback.
   - "Waiting" styling on the last AGENT message while AGENT_WAITING.
2. **Markdown rendering** — `react-markdown` + `rehype-sanitize` (add
   deps). Applies to AGENT + PM bodies. Security requirement from
   `03-security.md`: markdown only, sanitize strips dangerous tags — test
     with `<script>` + `[link](javascript:alert(1))` adversarial input.
3. **Chat tab** on ticket detail (agent mode only), visible when ticket
   is AGENT_RUNNING/AGENT_WAITING or any messages exist.
4. `frontend/src/api/agentChat.ts` + queryKeys additions; SSE hook from
   SLYK-0310 extended for `message` events.

## Acceptance criteria

- [ ] Script-tag body renders inert (escaped/stripped) — adversarial test
      passes.
- [ ] `javascript:` link neutralized.
- [ ] Input gating follows ticketState (enabled RUNNING/WAITING;
      disabled DONE + others) — test all relevant states.
- [ ] SYSTEM message renders centered variant.
- [ ] SSE message event appends without refetch flicker.
- [ ] delivered:false indicator shows and clears.
- [ ] Plain-mode build: no AgentChatPanel in bundle.

## References

- `docs/agentic-automation/06-frontend-ui.md` § AgentChatPanel
- `docs/agentic-automation/03-security.md` § Input validation (markdown
  rendering rule)
- `docs/agentic-automation/09-implementation-phases.md` Phase 2 smoke tests

## Dependencies

- SLYK-0330 (GET/POST endpoints)
- SLYK-0270 (SSE `message` frames)
- SLYK-0310 (tab infra + SSE hook to extend)
