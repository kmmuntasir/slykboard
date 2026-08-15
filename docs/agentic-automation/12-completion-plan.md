# 12 — Completion Plan (Master)

> **Status: PLAN — 2026-08-15.** This is the master document for finishing the
> automated task → PR → merge → deploy pipeline. Phases 0–5 of the *slykboard
> service* are done (docs `00`–`11`, SLYK-0100…0450, verified by
> `homelab-setup/SLYKBOARD-IMPLEMENTATION-AUDIT.md`). Everything that remains —
> dispatcher, agent backend, project template, deploy chain, infra wrappers,
> observability, end-to-end drills — is specified here and in docs `13`–`19`.
>
> **Repo decision (supersedes earlier "dispatcher is not in this repo"
> statements):** the dispatcher lives in this repo as a **third npm workspace**
> (`dispatcher/`), beside `backend/` and `frontend/`. It is **built and deployed
> as a separate service** — own Dockerfile, own compose file, own LXC, own
> secrets. This repo is now a small research monorepo of cooperating
> microservices. Recorded as a deviation in `homelab-setup/AUTOMATION-PLAN.md`
> §12 (Decided).

## 1. Where we are

Verified state (audit, 2026-08-15):

| Piece | State |
|---|---|
| Slykboard dual-mode (schema/routes/UI/bundle gating) | ✅ done, tested |
| Internal API + HMAC both directions + token rotation | ✅ done, tested |
| Pipeline state machine (15 states, 26 edges, retry cap) | ✅ done, tested |
| Chat (PM reply + retry queue), SSE, notifications, reconciler | ✅ done, tested |
| Onboarding UI + decommission UI | ✅ done, tested (against mock) |
| Mock dispatcher (`backend/tools/mock-dispatcher/`) | ✅ done, scenario engine |
| **Dispatcher service (real)** | ❌ does not exist |
| **Cyrus agent backend** | ❌ does not exist |
| **Project template repo** | ❌ does not exist |
| **GitHub Actions CI/deploy** | ❌ not even for this repo |
| **Infra wrappers** (`gh-deploy-snap`, `gh-deploy-lxc`, `bootstrap-stack.sh`) | ❌ do not exist |
| **Operator pre-flight** (GitHub App, SSH keys, sudoers, secrets) | ❌ not done |
| **Monitoring stack** | ❌ does not exist |
| Known defects F1–F4 (broken test gate, hooks bug, lint gate, Docker agent-mode arg) | ❌ open |

## 2. Target architecture (after completion)

```
PM ──▶ slykboard.kmlab.dev            (this repo: backend + frontend)
         │  signed webhooks (X-Slykboard-Signature)
         ▼
       dispatcher.kmlab.dev           (this repo: dispatcher/ — SEPARATE service,
         │                             own LXC, own Dockerfile, holds ALL infra secrets)
         │  Linear-shape signed webhook            ┌──────────┐
         ├───────────────────────────────────────▶ │ Cyrus LXC │ (stock, unmodified)
         │        SSH: cyrus self-add-repo etc.    └──────────┘
         │  GitHub App API (repo create, merge)         │ opens PR
         │  SSH: Proxmox gh-deploy-lxc / gh-deploy-snap ▼
         │  Zoraxy API (proxy host CRUD)            GitHub
         │  polls Cyrus /status                       │ PR + push to main
         │                                            ▼
         │                          GitHub Actions (cloud) ──SSH via jump:2222──▶ LXC deploy
         │                                            │ deploy status webhook
         └──◀─────────────────────────────────────────┘
         │  signed state/message callbacks (X-Dispatcher-Signature)
         ▼
       slykboard internal API ──▶ SSE / emails / kanban move ──▶ PM watches ticket go green
```

Services and where each lives:

| Service | Code location | Deployed as | Secrets held |
|---|---|---|---|
| Slykboard API + web | `backend/`, `frontend/` | existing LXC, `docker-compose.prod.yml` | Google OAuth, session secret, **one** HMAC dispatcher token |
| **Dispatcher** | `dispatcher/` (new workspace) | **separate LXC**, `dispatcher/docker-compose.dispatcher.prod.yml` | HMAC token, LINEAR_WEBHOOK_SECRET, Cyrus SSH key, GitHub App key, Zoraxy API key, Proxmox SSH key |
| Cyrus | external (stock) | existing LXC | Anthropic key, Linear OAuth (untouched) |
| Monitoring | `monitoring/` configs in this repo | `monitor` + `logs` LXCs | none (internal) |

The dual-mode OSS contract is unchanged for plain-mode users: they run
`docker compose up` on backend+frontend and never build `dispatcher/`.

## 3. Milestones

Effort assumes one focused person, matching the estimates style of doc `09`.
Milestones are strictly ordered except where noted. Each has a drill in doc `19`.

| # | Name | Delivers | Estimate | Doc |
|---|---|---|---|---|
| **M0** | Clean slate | Fix F1–F8, CI for this repo, workspace scaffolding for `dispatcher/`, docs consistency rewrite | 1–2 days | this doc §5 |
| **M1** | Dispatcher core | Service boot, env validation, HMAC verify (slykboard direction), inbound endpoints (`/webhooks/ticket-events`, `/onboard`, `/decommission`, `/webhooks/pm-action/need-human-help`), idempotency, `GET /jobs/:id/state`, queue lease loop, state writer to slykboard. **Real dispatcher replaces mock in every scenario.** | 1 weekend | `13` |
| **M2** | Cyrus backend | `AgentBackend` interface + Cyrus implementation: Linear-shape emitter, SSH repo register, `/status` poller, chat bridge, `markBlocked`. Ticket → PR opened, end to end. | 1 weekend | `14` |
| **M3** | Onboarding + template | `project-template/` repo (5 stacks), onboarding orchestrator (LXC → GitHub → agent → Zoraxy → smoke), decommission teardown. PM onboards a greenfield project from the UI. | 1 weekend | `15` + `13` §7 |
| **M4** | Mergebot + AI rebase + 72h timeout | GitHub PR webhooks, `gh pr merge --rebase`, AI rebase via Cyrus sub-session, retry budget, decision-log population, AGENT_WAITING 72h escalation. Two conflicting PRs auto-resolve. | 1 weekend | `13` §8 + `14` §6 |
| **M5** | Deploy chain | `gh-deploy-snap`/`gh-deploy-lxc`/`bootstrap-stack.sh`, jumphost `gh-deploy` user, `ci.yml` + `deploy.yml` generation, snapshot/rollback, dogfood: **slykboard deploys itself through the pipeline.** | 1 weekend | `16` |
| **M6** | Observability | `monitor` + `logs` LXCs, dispatcher `/metrics`, Grafana dashboards, Loki fleet, Alertmanager + Slack. | 3–4 days | `18` |
| **M7** | Production-readiness gate | Conditional (research-triggered): AI reviewer, VAPT gate, cost circuit-breaker, decision-log UI, re-key, migration-bearing rollback drill. | post-research | `09` §6.5 + `19` §8 |

**"Complete" = M0–M5.** After M5 the full loop works: PM types a ticket in
slykboard → Cyrus opens a PR → CI green → mergebot merges → GitHub Actions
deploys to the project LXC → ticket moves to Done, PM gets an email. M6 is
operational hardening (strongly recommended before relying on it daily). M7 is
out of scope until research findings justify it.

## 4. Repo layout after M0

```
slykboard/
  backend/                    # existing (plain + agent mode)
  frontend/                   # existing
  dispatcher/                 # NEW workspace — separate deployed service
    src/                      #   see doc 13 §3
    test/                     #   co-located vitest, same conventions
    Dockerfile                #   own image, never built by plain-mode users
    docker-compose.dispatcher.prod.yml
    README.md                 #   DEPLOYMENT GUIDE: separate-service contract (doc 17 §1)
    .env.example
  project-template/           # NEW — greenfield seed repo contents (doc 15)
    node-express/ next/ python-fastapi/ go/ static/
    _shared/.github/workflows/{ci,deploy}.yml.tmpl
    _shared/.github/actions/setup-jump-ssh/action.yml
    _shared/.deploy-target.json.example
    AGENTS.md
  infra/                      # NEW — files installed on proxmox/jump/target LXCs (doc 16)
    gh-deploy-snap            #   sudoers wrapper (proxmox host)
    gh-deploy-lxc             #   sudoers wrapper (proxmox host)
    bootstrap-stack.sh        #   runs inside new LXC
    sudoers/                  #   sudoers.d fragments
    systemd/dispatcher.service
  monitoring/                 # NEW (doc 18)
    prometheus/ grafana/dashboards/ loki/ alertmanager/
  docs/agentic-automation/    # this series, extended with 12–19
  package.json                # workspaces: [frontend, backend, dispatcher]
```

Root scripts gain `-w dispatcher` legs in `typecheck` / `test` / `lint`.
`build` stays per-service (dispatcher builds its own image; frontend needs
`SLYKBOARD_AGENT_MODE` build arg — F4 fix lands in M0).

## 5. Milestone M0 — clean slate (detail)

Pre-req for everything. Everything here is mechanical.

### 5.1 Defect fixes (from the audit)

| ID | Fix | Ticket |
|---|---|---|
| F1 | `git rm backend/src/probe2.test.ts` — restores `npm test` exit 0 | SLYK-0460 |
| F2 | `FailedPipelineBadge.tsx` — hoist `useState` above the early return; gate the *render*, not the hook | SLYK-0461 |
| F3 | Lint cleanup pass: 23 errors across 22 files (`eslint --fix` for the 8 auto-fixables, manual for the rest). Gate is `--max-warnings=0` — must be zero | SLYK-0462 |
| F4 | `frontend/Dockerfile`: add `ARG SLYKBOARD_AGENT_MODE=false` + use it in the build stage; `docker-compose.prod.yml`: pass `SLYKBOARD_AGENT_MODE: ${SLYKBOARD_AGENT_MODE:-false}` as build arg | SLYK-0463 |
| F6 | Re-run `FailedPipelineBadge.test.tsx` after F2; fix residual flake | rides F2 |
| F8a | Rate-limit `POST /admin/projects/:slug/decommission` (1/10s/admin, same limiter shape as onboarding) | SLYK-0464 |
| F8b | Add `SLYKBOARD_DISPATCHER_TOKEN`-length + URL assertions to dispatcher env schema once `dispatcher/` exists (M1) | rides M1 |

### 5.2 CI for this repo (currently none)

`.github/workflows/ci.yml` at repo root — the exact workflow from
`homelab-setup/AUTOMATION-PLAN.md` §6.4, adapted:

```yaml
name: ci
on: [pull_request, push]
jobs:
  test:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: slyk, POSTGRES_PASSWORD: slyk, POSTGRES_DB: slykboard_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test            # backend + frontend (+ dispatcher from M1)
```

Branch protection on `main` (this repo is its own first customer): required
check `test`, linear history, rebase-and-merge only (matches `AGENTS.md`).

### 5.3 Workspace scaffolding

- Add `dispatcher` to root `workspaces`; empty `src/index.ts` + `package.json`
  (express 5, zod, pino — mirror backend deps), vitest config mirroring backend's.
- `dispatcher/.env.example` (full table lands with M1, doc 13 §4).
- `dispatcher/README.md` stub stating the separate-service contract.
- Root `Makefile`: `test-dispatcher`, `dev-dispatcher` targets.

### 5.4 Docs consistency rewrite

The existing docs say "dispatcher — separate repo, not this one" in ~10 places.
That was true; it no longer is. Update (wording, not substance):

- `README.md` (this folder): § "What is out of scope for slykboard" → becomes
  "Owned by the dispatcher *service*" (in-repo, separately deployed). Doc index
  gains 12–19.
- `01-overview.md`: component diagram gains dispatcher-in-repo annotation.
- `03-security.md`: secret-boundary table gains the dispatcher row (all infra
  secrets live in the dispatcher *service env*, which happens to be this repo —
  the boundary is the deployed process, not the git repo).
- `09-implementation-phases.md`: header note pointing at doc 12 for the
  dispatcher-side phases.
- `10-mock-dispatcher.md`: note that from M1 the mock remains as a dev tool but
  the real dispatcher is the integration target.
- `homelab-setup/AUTOMATION-PLAN.md` §12 "Decided": add the in-repo deviation
  line (done alongside this doc — see that file).

**Acceptance M0:** `npm run lint && npm run typecheck && npm test` all green at
repo root; CI workflow runs green on GitHub; `docker build` can produce an
agent-mode frontend; docs contain no stale "not in this repo" claims.

## 6. Ticket allocation

Continues the SLYK-NNN series (last used: 0450). Reserve blocks per milestone:

| Block | Milestone |
|---|---|
| SLYK-0460…0469 | M0 clean slate |
| SLYK-0470…0499 | M1 dispatcher core |
| SLYK-0500…0529 | M2 Cyrus backend |
| SLYK-0530…0559 | M3 onboarding + template |
| SLYK-0560…0589 | M4 mergebot + rebase |
| SLYK-0590…0619 | M5 deploy chain |
| SLYK-0620…0639 | M6 observability |
| unnumbered | M7 (post-research) |

One ticket = one PR, rebase-merge only, single-line `SLYK-NNN: message`
commits — same conventions as everything so far.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Monorepo blurs the secret boundary ("it's all one repo") | The boundary is enforced by *deployment*: dispatcher env is the only place infra secrets exist; slykboard containers never mount them. Doc 17 §2 matrix is the checklist; audit it per milestone. |
| Two writers to `PipelineJobs` (dispatcher lease SQL + slykboard state API) | Contract fixed in doc 13 §5: dispatcher only ever `SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE` lease columns; **all state changes go through slykboard's internal API**, which remains the single writer for `state`/events/SSE/emails. |
| Cyrus `/status` or CLI shape differs from assumptions | M2 starts with a half-day spike against the real Cyrus LXC (doc 14 §2) before writing the adapter; fallback is the §3.3.1 config-file path from the upstream plan. |
| GitHub free-tier Actions minutes | Homelab scale (~5 projects, few deploys/day) is far under the free cap; CI jobs are the only cloud runners. |
| Real Linear + synthetic workspaces collide | Namespacing rules are already fixed (upstream §3.3): per-project teamKey = UPPER(slug), `slykboard-<slug>` workspace ids. Drill 19 §3 verifies coexistence. |
| Scope creep into M7 | M7 items are explicitly gated on research triggers (doc 09 §6.5). Do not pull them forward. |

## 8. Reading order for implementers

- M1 → doc `13` (dispatcher service) + `07` (wire contract, already implemented on the slykboard side)
- M2 → doc `14` (agent backend) + `08` (Linear-shape reference)
- M3 → docs `15` (template) + `13` §7 (orchestrator)
- M4 → docs `13` §8 + `14` §6
- M5 → doc `16` (deploy chain) + `17` (operator runbook — the pre-flight lives here)
- M6 → doc `18`
- Drills for every milestone → doc `19`
