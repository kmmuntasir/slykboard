# SLYK-0390 — Notification preferences: endpoints, UI, DONE/BLOCKED emails

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (backend + frontend)
**Depends on:** SLYK-0350, SLYK-0140

## Description

Full per-user per-project email opt-ins (SLYK-0350 shipped only the
AGENT_WAITING half reading the table directly).

**Backend** *(doc gap: `05` defines no preference endpoints but `06`/`09`
require the `<NotificationPreferences>` UI — add them)*:

1. **`GET /api/v1/me/projects/:projectId/notification-preferences`** —
   return row or defaults `{notifyOnDone: true, notifyOnBlockedHuman:
   true, notifyOnAgentWaiting: true}` without creating it (lazy default).
2. **`PUT` same path** — upsert (composite PK user×project), Zod three
   booleans. Auth: authenticate + project member.
3. **Email triggers extended** in the SLYK-0260 transition service, all
   preference-gated, fire-and-forget after commit, ticket-creator
   audience (same pattern as SLYK-0350):
   - entering `DONE` (subject: ticket deployed) when `notifyOnDone`;
   - entering `BLOCKED_HUMAN` when `notifyOnBlockedHuman`.

**Frontend:**

4. **`<NotificationPreferences>`** — three toggles on the project
   settings/members area (agent mode only), loads via GET, saves via PUT,
   toast on save. Follows existing toggle component conventions.

## Acceptance criteria

- [ ] GET returns defaults when no row; PUT upserts + returns saved
      values; second PUT updates in place (single row — composite PK
      enforced).
- [ ] DONE email fires only with notifyOnDone=true; BLOCKED_HUMAN same
      for its flag.
- [ ] Preference off → no email (test-transport capture empty).
- [ ] Non-member → 403/404 on both endpoints.
- [ ] UI toggles persist round-trip; plain-mode absent.
- [ ] Emails include ticket + project context + deep link.

## References

- `docs/agentic-automation/06-frontend-ui.md` § Notifications
- `docs/agentic-automation/04-schema.md` (NotificationPreferences — lazy
  default row semantics)
- `docs/agentic-automation/09-implementation-phases.md` Phase 5

## Dependencies

- SLYK-0350 (email service + trigger pattern)
- SLYK-0140 (table)
