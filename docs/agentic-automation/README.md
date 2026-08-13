# Agentic Development Automation — Slykboard Integration

> **Read this first.** This folder contains the full specification for
> adding an opt-in "agentic development" mode to slykboard. The work is
> executed by an AI agent with **no prior context** — every doc here is
> self-contained.

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
| `01-overview.md` | System architecture, component roles, data flow diagram. Read this before anything else. |
| `02-dual-mode.md` | How `SLYKBOARD_AGENT_MODE` gates schema, routes, UI. Plain-mode contract. |
| `03-security.md` | Threat model, secret boundaries, auth flows, decommission safety. |
| `04-schema.md` | Every new table, column, enum. Drizzle definitions, migration gating rules. |
| `05-backend-routes.md` | Every new Express route — request/response shapes, middleware, error codes. |
| `06-frontend-ui.md` | Pages, components, feature gating, forms, decommission dialog UX. |
| `07-dispatcher-contract.md` | The HTTP/HMAC contract between slykboard and dispatcher. Exact request shapes slykboard must emit / consume. |
| `08-cyrus-contract.md` | What Cyrus (the default agent) expects in the Linear-shape webhook. Slykboard never talks to Cyrus directly — included for context. |
| `09-implementation-phases.md` | Phase 0 → Phase 5 build order. What to ship first, smoke tests per phase. |

## Conventions reminder (from `AGENTS.md`)

- **npm only** — never pnpm/yarn/bun. npm-workspaces monorepo.
- **Layered backend** — Route → Controller → Service → Repository. No
  skipping layers. Transactions live in services.
- **Drizzle** for schema. snake_case column names, camelCase access keys.
- **Rebase and Merge only** — never squash, never merge commits.
- **Branch naming:** `feature/SLYK-<n>-hyphenated-desc`. Commit prefix:
  `SLYK-<n>: message`.
- **Tests:** Vitest, co-located as `*.test.ts`.
- **Single-line commit messages.**

## What is out of scope for slykboard

The following are owned by the **dispatcher** service (separate repo,
not this one). Do NOT implement them here:

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
