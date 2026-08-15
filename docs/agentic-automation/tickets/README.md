# Agentic Automation — JIRA Ticket Set

Tickets generated from `docs/agentic-automation/00`–`11`. One file per ticket.
Execute in ascending ticket-number order — numbering is dependency-aware:
**every ticket depends only on lower-numbered tickets**, so strict sequential
implementation causes no conflicts and no unmet dependencies.

## Numbering

- Format `SLYK-XXXX`, gaps of 10 between tickets — room to insert follow-ups
  (e.g. `SLYK-0105`) without renumbering.
- Phase blocks:
  - `SLYK-0100`–`0130` — Pre-Phase-0 refactor (`00-refactor-plan.md`)
  - `SLYK-0140`–`0170` — Phase 0: Foundations
  - `SLYK-0180`–`0240` — Phase 0.5: Onboarding MVP
  - `SLYK-0250`–`0310` — Phase 1: Pipeline state + SSE
  - `SLYK-0320`–`0360` — Phase 2: PM ↔ agent chat
  - `SLYK-0370`–`0450` — Phase 5: Polish, notifications, admin tools

## Index

| Ticket | Title | Phase | Depends on |
|---|---|---|---|
| [SLYK-0100](SLYK-0100-split-schema-migrations-conditional-runner.md) | Split schema + migrations, conditional migration runner | Refactor | — |
| [SLYK-0110](SLYK-0110-api-v1-mount-stub-middleware.md) | `/api/v1` mount points + stub agent middleware | Refactor | — |
| [SLYK-0120](SLYK-0120-frontend-runtime-config-store-agent-mode-switch.md) | Frontend runtime config store + `__AGENT_MODE__` build switch | Refactor | — |
| [SLYK-0130](SLYK-0130-env-var-validation-agent-mode.md) | Env var validation for agent mode | Refactor | — |
| [SLYK-0140](SLYK-0140-agent-schema-tables-first-migration.md) | Agent schema (7 tables, 3 enums) + first agent migration | 0 | 0100 |
| [SLYK-0150](SLYK-0150-hmac-agent-token-auth-internal-mount.md) | Real HMAC `agentTokenAuth` + raw-body capture + stub routers | 0 | 0110, 0130 |
| [SLYK-0160](SLYK-0160-health-me-runtime-config-schema-version.md) | Health/`me` runtime config + `SCHEMA_VERSION` + store population | 0 | 0110, 0120 |
| [SLYK-0170](SLYK-0170-mock-dispatcher-skeleton.md) | Mock dispatcher skeleton | 0 | 0150 |
| [SLYK-0180](SLYK-0180-dispatcher-client-service.md) | `dispatcherClient` service (HMAC sign + retry + logging) | 0.5 | 0130, 0170 |
| [SLYK-0190](SLYK-0190-admin-create-project-onboard-route.md) | `POST /api/v1/admin/projects` (create + start onboarding) | 0.5 | 0140, 0150, 0180 |
| [SLYK-0200](SLYK-0200-internal-onboarding-events-deploy-target.md) | Internal onboarding events + deploy-target endpoints | 0.5 | 0140, 0150 |
| [SLYK-0210](SLYK-0210-decommission-route.md) | `POST /api/v1/admin/projects/:slug/decommission` | 0.5 | 0190, 0180 |
| [SLYK-0220](SLYK-0220-mock-dispatcher-onboarding-extension.md) | Mock dispatcher: onboarding + decommission scenarios | 0.5 | 0170, 0190, 0200, 0210 |
| [SLYK-0230](SLYK-0230-frontend-onboarding-pages.md) | Onboarding form, timeline, admin pages (+ events GET endpoint) | 0.5 | 0160, 0190, 0200 |
| [SLYK-0240](SLYK-0240-decommission-dialog.md) | `<DecommissionDialog>` — slug-match destructive confirm | 0.5 | 0210, 0230 |
| [SLYK-0250](SLYK-0250-pipeline-state-machine.md) | Pipeline state machine + transition matrix | 1 | 0140 |
| [SLYK-0260](SLYK-0260-internal-job-state-route.md) | `POST /api/v1/internal/jobs/:ticketId/state` + job repository | 1 | 0150, 0250 |
| [SLYK-0270](SLYK-0270-sse-emitter-events-route.md) | SSE emitter + `GET /api/v1/me/tickets/:id/events` | 1 | 0260 |
| [SLYK-0280](SLYK-0280-me-pipeline-endpoint.md) | `GET /api/v1/me/tickets/:id/pipeline` | 1 | 0260 |
| [SLYK-0290](SLYK-0290-auto-queue-ticket-creation.md) | Auto-queue on ticket creation + `queue_for_agent` endpoint | 1 | 0260, 0180 |
| [SLYK-0300](SLYK-0300-mock-dispatcher-pipeline-extension.md) | Mock dispatcher: ticket-events + state stream | 1 | 0170, 0260, 0290 |
| [SLYK-0310](SLYK-0310-frontend-pipeline-ui.md) | Pipeline tab, `<PipelinePanel>`, `<FailedPipelineBadge>` | 1 | 0270, 0280, 0290, 0160 |
| [SLYK-0320](SLYK-0320-internal-agent-messages-route.md) | `POST /api/v1/internal/jobs/:ticketId/messages` (idempotent) | 2 | 0140, 0270 |
| [SLYK-0330](SLYK-0330-me-messages-routes.md) | `GET`/`POST /api/v1/me/tickets/:id/messages` (PM reply) | 2 | 0320, 0260, 0180 |
| [SLYK-0340](SLYK-0340-frontend-chat-panel.md) | `<AgentChatPanel>` + chat tab (sanitized markdown) | 2 | 0330, 0270, 0310 |
| [SLYK-0350](SLYK-0350-agent-waiting-email.md) | `AGENT_WAITING` email notification | 2 | 0260, 0140 |
| [SLYK-0360](SLYK-0360-mock-dispatcher-chat-extension.md) | Mock dispatcher: pm_reply + agent messages | 2 | 0300, 0320, 0330 |
| [SLYK-0370](SLYK-0370-agent-tokens-routes.md) | Agent token generate/revoke/list routes | 5 | 0140, 0150 |
| [SLYK-0380](SLYK-0380-tokens-admin-ui.md) | `/admin/tokens` page + `<AgentTokenGenerateDialog>` | 5 | 0370, 0230 |
| [SLYK-0390](SLYK-0390-notification-preferences.md) | Notification preferences endpoints + UI + DONE/BLOCKED emails | 5 | 0350, 0140 |
| [SLYK-0400](SLYK-0400-need-human-help-escalation.md) | "Need human help" escalation button | 5 | 0180, 0310 |
| [SLYK-0410](SLYK-0410-rate-limiting.md) | Rate limiting (onboarding + chat) | 5 | 0190, 0330 |
| [SLYK-0420](SLYK-0420-openapi-spec.md) | OpenAPI spec generation + serving | 5 | 0330, 0370 |
| [SLYK-0430](SLYK-0430-admin-dashboard-filters.md) | Admin project dashboard filters + search | 5 | 0230 |
| [SLYK-0440](SLYK-0440-polling-reconciliation.md) | 60s polling reconciliation fallback | 5 | 0290, 0180 |
| [SLYK-0450](SLYK-0450-mock-dispatcher-phase5-extension.md) | Mock dispatcher: latency profiles + failure injection polish | 5 | 0360, 0410 |

## Dependency graph

```
Refactor:  0100 ─┐
           0110 ─┼─> everything under /api/v1
           0120 ─┤    (frontend gating)
           0130 ─┘    (env contract)

Phase 0:   0100 ─> 0140 (schema) ─┐
           0110+0130 ─> 0150 (HMAC) ─┬─> 0170 (mock skeleton)
                                     └─> all internal/admin routes
           0110+0120 ─> 0160 (runtime config)

Phase 0.5: 0130+0170 ─> 0180 (dispatcherClient)
           0140+0150+0180 ─> 0190 ─> 0210
           0140+0150 ─> 0200
           0170+0190+0200+0210 ─> 0220 (mock scenarios)
           0160+0190+0200 ─> 0230 ─> 0240

Phase 1:   0140 ─> 0250 ─> 0260 ─┬─> 0270 ─┐
                                 ├─> 0280  ├─> 0310
                                 └─> 0290 ─┘
           0170+0260+0290 ─> 0300

Phase 2:   0270+0140 ─> 0320 ─> 0330 ─> 0340
           0260+0140 ─> 0350
           0300+0320+0330 ─> 0360

Phase 5:   0140+0150 ─> 0370 ─> 0380
           0350 ─> 0390
           0180+0310 ─> 0400
           0190+0330 ─> 0410
           0330+0370 ─> 0420
           0230 ─> 0430
           0290+0180 ─> 0440
           0360+0410 ─> 0450
```

## Doc gaps resolved inside tickets

`05-backend-routes.md` references endpoints that are never specified. These
tickets add them explicitly:

1. **`GET /api/v1/me/projects/:slug/onboarding/events`** — required by
   `06-frontend-ui.md` (timeline polls it), not defined anywhere → added in
   SLYK-0230.
2. **`POST /api/v1/me/tickets/:id/queue`** — "Start work"/"Queue for agent"
   button (`06` PipelinePanel empty state + `07` `queue_for_agent` event) has
   no consuming endpoint → added in SLYK-0290.
3. **`GET /api/v1/admin/agent-tokens`** — `/admin/tokens` page must list
   tokens (`09` Phase 5), no list endpoint defined → added in SLYK-0370.
4. **Notification preferences read/update endpoints** —
   `<NotificationPreferences>` UI (`06`/`09` Phase 5) needs GET/PUT → added
   in SLYK-0390.

Also reconciled: `06` says "Need human help" POSTs directly to a Slack
webhook; `07` says slykboard POSTs the dispatcher escalation webhook. `07` is
the authoritative contract — SLYK-0400 implements the dispatcher path, with
direct-Slack as an optional secondary when the env var is set.

## Explicitly out of scope (do not ticket)

- Everything owned by the dispatcher service: queue loop, Linear-shape
  emitter, mergebot, AI rebase, onboarding orchestrator, LXC/Zoraxy/GitHub
  App/Proxmox credential handling (`README.md` "out of scope").
- Any Cyrus-specific code (`08-cyrus-contract.md` is reference-only).
- Deploy workflow files for target projects.
- Phase 6 stretch items and Phase 6.5 production-readiness gate — conditional
  on research findings; ticket separately when triggered.

## Conventions (apply to every ticket)

- npm only; Vitest tests co-located; single-line commit messages
  `SLYK-XXXX: message`; branch `feature/SLYK-XXXX-short-desc`.
- Routes → services → repositories; Zod schemas in sibling `*.schema.ts`;
  errors via `AppError` + error middleware, never hand-written status codes.
- Destructive/role-changing actions require confirmation modals (repo rule).
- Drizzle-kit caveat: generated enum **partial** indexes can emit unapplyable
  `$1` placeholders — reconcile to literal values before applying a
  migration.
- Plain-mode contract must hold after every ticket: plain boots, core tables
  only, `/api/v1/*` agent routes → 501, no agent code in plain frontend
  bundle.
