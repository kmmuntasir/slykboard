# Agentic Development Automation — Slykboard Integration

> **Read this first.** This folder contains the full specification for
> adding an opt-in "agentic development" mode to slykboard. The work is
> executed by an AI agent with **no prior context** — docs are designed
> to be readable individually, with cross-references for detail. Read
> `00-refactor-plan.md` first (mandatory refactor), then `01-overview.md`
> for the architecture, then `09-implementation-phases.md` for build
> order.

## ⚠️ Prerequisite: refactor BEFORE Phase 0

The docs in this folder assume a repo layout (split schema, split
migrations, build-time agent-mode switch) that does **not match the
current slykboard codebase**. Before starting Phase 0, the repo must be
refactored to match. **See [`00-refactor-plan.md`](./00-refactor-plan.md)
for the complete, comprehensive refactor instructions.**

Skipping the refactor and proceeding to Phase 0 will produce non-
compiling code. The refactor is ~1 day of focused work and lands as a
single atomic commit. After it merges, all other docs (01–09) become
implementable as written.

The refactor does NOT change plain-mode behavior. Existing kanban
flows keep working identically.

## What we are building

Slykboard today is a plain kanban PM tool (Google OAuth + boards +
tickets + comments). We are adding an **opt-in agentic layer** that
turns slykboard into the intake for an automated development pipeline:

1. PM creates a ticket in slykboard (existing kanban flow).
2. Dispatcher (separate service, not in this repo) picks up the ticket,
   forwards it to an AI coding agent (default: Cyrus), which opens a PR.
3. Mergebot auto-merges the PR after green CI.
4. GitHub Actions deploys the merged change into the project's LXC.
5. Pipeline status flows back to slykboard — PM sees the ticket move
   across columns automatically.

Slykboard's job in this pipeline: **intake, status display, PM↔agent
chat, project onboarding form, decommission flow.** All heavy lifting
(queue, webhooks, agent SSH, AI rebase, deploy) happens in the
**dispatcher** — a separate service not in this repo.

## Slykboard dual-mode contract

Slykboard ships as a generic OSS kanban by default. Agentic features
are gated behind `SLYKBOARD_AGENT_MODE=true` env var.

| Mode | `SLYKBOARD_AGENT_MODE` | What works |
|---|---|---|
| **Plain** | `false` (default) | Boards, tickets, comments, time tracking, Google OAuth. Zero agent code paths execute. |
| **Agent** | `true` | Everything in plain + Pipeline panel, onboarding form, decommission, PM↔agent chat, internal webhook endpoints. |

Self-host community uses plain mode. Homelab uses agent mode. Same
Docker image, same release pipeline, mode is runtime config.

**Critical invariant:** in **both** modes, slykboard holds **zero
infrastructure secrets**. No Anthropic API keys, no Cyrus SSH keys, no
GitHub App keys, no Zoraxy/Proxmox/Cloudflare credentials. The only
credential toward the agentic layer is one HMAC token used to talk to
the dispatcher. See `03-security.md`.

## Doc index — read in order

| Doc | Purpose |
|---|---|
| `00-refactor-plan.md` | **Pre-Phase-0 repo refactor.** Must be completed before any other doc is implementable. |
| `01-overview.md` | System architecture, component roles, data flow diagram. Read this before anything else. |
| `02-dual-mode.md` | How `SLYKBOARD_AGENT_MODE` gates schema, routes, UI. Plain-mode contract. |
| `03-security.md` | Threat model, secret boundaries, auth flows, decommission safety. |
| `04-schema.md` | Every new table, column, enum. Drizzle definitions, migration gating rules. |
| `05-backend-routes.md` | Every new Express route — request/response shapes, middleware, error codes. |
| `06-frontend-ui.md` | Pages, components, feature gating, forms, decommission dialog UX. |
| `07-dispatcher-contract.md` | The HTTP/HMAC contract between slykboard and dispatcher. Exact request shapes slykboard must emit / consume. |
| `08-cyrus-contract.md` | What Cyrus (the default agent) expects in the Linear-shape webhook. Slykboard never talks to Cyrus directly — included for context. |
| `09-implementation-phases.md` | Phase 0 → Phase 5 build order. What to ship first, smoke tests per phase. Slykboard-side phases — all done. |
| `10-mock-dispatcher.md` | Mock dispatcher contract — required for every phase's smoke tests. Scenarios, fixtures, npm scripts. Remains the dev tool + golden-scenario set after the real dispatcher lands. |
| `11-existing-patterns.md` | Existing slykboard code to use as templates (routes, services, middleware, API client, SSE, tests). |
| `12-completion-plan.md` | **Master completion plan.** Where the build stands (audited), milestones M0–M7, repo layout, ticket blocks, risks. Start here for remaining work. |
| `13-dispatcher-service.md` | The dispatcher service build book (M1 core + M4 mergebot): layout, env, queue lease loop, onboarding orchestrator, HTTP surface, tests. |
| `14-agent-backend.md` | `AgentBackend` interface + Cyrus implementation (M2): Linear-shape emitter, SSH repo lifecycle, status bridge, chat, AI rebase, 72h timeout. |
| `15-project-template.md` | Greenfield project template (M3): five stack skeletons, rendered CI/deploy workflows, branch protection recipe. |
| `16-deploy-chain.md` | Deploy chain (M5): jumphost trust model, `gh-deploy-snap`/`gh-deploy-lxc`/`bootstrap-stack.sh`, deploy flow, rollback semantics. |
| `17-operator-runbook.md` | Operator runbook: separate-service contract, secret inventory, one-time pre-flight, dispatcher LXC provisioning, routine ops, security checklist. |
| `18-observability.md` | Monitoring stack (M6): Prometheus/Grafana/Loki/Alertmanager, dispatcher metrics, dashboards, alerts, trace links. |
| `19-acceptance-drills.md` | Real-stack acceptance drills for every milestone + per-milestone security gate + drill log. A milestone isn't done until its drill passes. |

## Conventions reminder (from `AGENTS.md`)

- **npm only** — never pnpm/yarn/bun. npm-workspaces monorepo.
- **Layered backend** — Route handler → Service → Repository. No
  controllers dir in this repo (routes own handler logic directly, see
  `projects.routes.ts`). Transactions live in services.
- **Drizzle** for schema. snake_case column names, camelCase access keys.
- **Rebase and Merge only** — never squash, never merge commits.
- **Branch naming:** `feature/SLYK-<n>-hyphenated-desc`. Commit prefix:
  `SLYK-<n>: message`.
- **Tests:** Vitest, co-located as `*.test.ts`.
- **Single-line commit messages.**
- **Middleware factories:** `requirePlatformAdmin()` is a factory —
  invoke with `()` when mounting, not as a bare reference.

## What is out of scope for the slykboard *service*

> **Repo note (2026-08-15, doc 12 §2):** the dispatcher now lives **in this
> repo** as a third workspace (`dispatcher/`) — but it is built and deployed
> as a **separate service** (own Dockerfile, own LXC, own secrets; see
> `17-operator-runbook.md` §1). Earlier drafts of this folder said "separate
> repo, not this one" — the separation that matters is the deployed-process
> boundary, not the git boundary. The bullets below still hold verbatim for
> the slykboard *backend/frontend service*:

The following are owned by the **dispatcher service** (in-repo workspace,
separately deployed). Do NOT implement them in `backend/` or `frontend/`:

- The task queue / lease loop / state machine driver.
- The Linear-shape webhook emitter to Cyrus.
- The mergebot + AI rebase logic.
- The onboarding orchestrator that creates LXC containers, calls
  GitHub App API, invokes `cyrus self-add-repo` over SSH, calls Zoraxy
  API.
- Proxmox / Zoraxy / Cloudflare / GitHub App credential management.
- AI rebase sub-session execution.

Slykboard only stores the state these operations produce and renders
them in the UI. The dispatcher writes state back to slykboard via the
internal endpoints in `05-backend-routes.md`.

## Source plan

This folder distills the upstream plan at
`homelab-setup/AUTOMATION-PLAN.md` (Draft 10, 2026-08-13) into
slykboard-scoped build instructions. When in doubt, the upstream plan
is authoritative for anything cross-service; this folder is
authoritative for slykboard-local decisions (schema names, route
paths, component names).
