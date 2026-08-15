# SLYK-0350 — `AGENT_WAITING` email notification

**Phase:** 2 — PM ↔ Agent Chat
**Type:** Feature (backend)
**Depends on:** SLYK-0260, SLYK-0140

## Description

Email the ticket's PM when the agent asks a question.

1. **Email service** — `06-frontend-ui.md` says "use whatever slykboard
   already uses". Audit the repo first (grep for Resend/SendGrid/SMTP/
   nodemailer). If nothing exists, add a minimal `emailService` behind an
   interface (dev/no-op transport by default; SMTP env-configurable) —
   do not hard-couple a vendor.
2. **Trigger** — in the SLYK-0260 state-transition service, on entering
   `AGENT_WAITING`: send email to the ticket creator (users.email)
   containing ticket title, display id, project name, the latest AGENT
   message body (from AgentMessages), and a deep link
   `/projects/:slug/tickets/:displayId`. Fire-and-forget after commit;
   email failure logs, never fails the request.
3. **Opt-in gate** — respect `NotificationPreferences.notifyOnAgentWaiting`
   when a row exists; when no row exists (lazy default) treat as opted-IN
   (schema default true) for the ticket creator only. Full preference
   endpoints/UI are SLYK-0390 — this ticket reads the table directly.
4. Plain-text + minimal HTML; no PM body text >200 chars into logs.

## Acceptance criteria

- [ ] Transition to AGENT_WAITING sends one email to the ticket creator
      (test transport captures it).
- [ ] Preference row with `notifyOnAgentWaiting=false` suppresses it.
- [ ] No row → sent (default true).
- [ ] Email failure does not fail the state-transition request.
- [ ] Plain mode: trigger unreachable (state route 501s) — no code path
      executes.
- [ ] One email per transition (WAITING→RUNNING→WAITING sends twice —
      correct; retry-duplicate WAITING→WAITING is illegal per matrix, so
      impossible).

## References

- `docs/agentic-automation/06-frontend-ui.md` § Notifications
- `docs/agentic-automation/04-schema.md` (NotificationPreferences defaults)
- `docs/agentic-automation/09-implementation-phases.md` Phase 2 (email
  on AGENT_WAITING task)

## Dependencies

- SLYK-0260 (transition hook point)
- SLYK-0140 (NotificationPreferences table)
