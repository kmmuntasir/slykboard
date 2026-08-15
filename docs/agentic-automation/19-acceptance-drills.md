# 19 — Acceptance Drills (all milestones)

> Every milestone's definition of done includes a drill executed against
> **real services** — real slykboard, real dispatcher, real Cyrus, real
> GitHub, real LXCs. Mocks are for CI; drills are for truth. Doc `09`'s
> per-phase smoke tests were mock-scoped; this doc is the real-stack
> successor. A milestone is not done until its drill passes and is recorded
> (date, operator, outcome) at the bottom of this file.

Conventions:

- Drills run against the homelab (`*.kmlab.dev`), using throwaway projects
  where destructive steps occur.
- Every drill starts from a clean slate for its project: onboard fresh, or
  decommission leftovers first.
- Anything that surprises you is a finding — file a ticket, fix, re-run the
  drill from the top. No partial credits.

## §1 M0 — clean slate

| # | Step | Expected |
|---|---|---|
| 1 | `npm run lint && npm run typecheck && npm test` at repo root | all exit 0 (incl. backend suite now that `probe2.test.ts` is gone) |
| 2 | Push branch → GitHub CI runs | workflow green on the PR |
| 3 | `docker build` frontend with `SLYKBOARD_AGENT_MODE=true` build arg | image builds; served bundle contains agent routes |
| 4 | Same without the arg | bundle contains **no** agent components (grep `OnboardingForm` etc. in built assets → 0 hits) |
| 5 | Grep docs for "not in this repo" | zero stale claims; doc index lists 12–19 |

## §2 M1 — dispatcher core replaces the mock

| # | Step | Expected |
|---|---|---|
| 1 | Dispatcher boots against real slykboard | `/healthz` 200; boot log shows schemaVersion match |
| 2 | Boot with mismatched `SLYKBOARD_SCHEMA_VERSION_REQUIRED=99` | refuses to start (fail-fast verified) |
| 3 | Replay every `backend/tools/mock-dispatcher/scenarios/*.json` against the **real** dispatcher (mock's client role) | all scenarios pass — HMAC round-trips, 202s, idempotent replays, state callbacks hit slykboard and SSE reaches a browser tab |
| 4 | Create a ticket in the slykboard UI (agent mode) | PipelineJobs row BACKLOG → dispatcher receives `ticket_created`, logs mapping |
| 5 | Click "Queue for agent" | state QUEUED on slykboard; dispatcher lease loop picks it (agent dispatch stubbed — M1 has no Cyrus) → AGENT_RUNNING state callback → timeline updates live via SSE |
| 6 | Kill dispatcher mid-queue; restart 5 min later | leased job re-leased after expiry; no duplicate dispatch; slykboard timeline shows no orphan transitions |
| 7 | Two tickets queued in one project | strictly serial: second leases only after first leaves active states |
| 8 | slykboard reconciler drill: stop dispatcher, manually advance ticket state via psql (test only), restart both | 60s sweep converges to dispatcher truth without illegal-edge writes (log shows skip, not force) |

## §3 M2 — Cyrus adapter live

| # | Step | Expected |
|---|---|---|
| 1 | Spike (doc `14` §2) findings recorded back into doc 14 | checklist complete |
| 2 | Onboard a scratch repo with Cyrus (manual `self-add-repo` or via dispatcher) | `cyrus list-repos` shows it |
| 3 | Create a real ticket in slykboard for that project | Cyrus accepts the signed webhook, spawns worktree, opens a **real PR** on GitHub; slykboard timeline: QUEUED → AGENT_RUNNING → PR_OPEN (via GitHub webhook or status bridge per M-milestone) |
| 4 | **Linear coexistence**: simultaneously assign a real Linear ticket to Cyrus | real Linear flow unaffected; slykboard ticket unaffected; no cross-talk |
| 5 | Chat: agent asks a question (script via scratch ticket) | AGENT_WAITING badge + email; PM replies in slykboard chat; dispatcher forwards as Comment.create; agent session continues; AGENT_RUNNING resumes |
| 6 | PM replies while agent already finished | 409 surfaced politely in chat UI |
| 7 | Duplicate `ticket_created` delivery (curl replay, same idempotencyKey) | single dispatch — no second worktree (Cyrus dedupes on stable `data.id`) |
| 8 | 72h timeout drill (set clock threshold to minutes in test env) | AGENT_WAITING → FAILED_AGENT(reason=pm-reply-timeout) → BLOCKED_HUMAN + Slack alert |

## §4 M3 — onboarding + template

| # | Step | Expected |
|---|---|---|
| 1 | "Add project" in UI: greenfield, `node-express`, slug `drill-inventory` | timeline walks PENDING → … → LIVE; each step idempotent |
| 2 | Inspect artifacts | GitHub repo exists w/ template + workflows + `.deploy-target.json` + branch protection (linear history, required check, CODEOWNERS on infra/migrations); LXC exists w/ service up; Zoraxy route live; `https://drill-inventory.kmlab.dev/api/health` 200 |
| 3 | Retry drill: force a failure (e.g. bad Zoraxy key) mid-onboarding, then fix + "Retry from last step" | resumes at failed step, doesn't redo completed ones |
| 4 | Path B: onboard an existing repo | files arrive as a **PR**, not direct push; merge it; WIRING_AGENT proceeds only after merge |
| 5 | Decommission `drill-inventory` (type slug to confirm) | reverse-order teardown: Zoraxy proxy gone, `self-remove-repo` ran, LXC destroyed, **repo deleted** (created=true); project row archived not deleted |
| 6 | Decommission the Path B project | repo **survives** (created=false); webhook removed, onboarding PR closed if open |
| 7 | Template CI matrix on the repo | all five stack skeletons green in this repo's own CI |

## §5 M4 — mergebot + AI rebase

| # | Step | Expected |
|---|---|---|
| 1 | Ticket → Cyrus PR → CI green (template repo's own CI) | mergebot auto-merges `--rebase`, branch deleted, MERGING event carries full decision-log detail (inspect via psql / admin timeline) |
| 2 | Two conflicting tickets merged in sequence (both edit the same file) | second PR conflicts → CONFLICT_RETRY → AI rebase resolves → re-CI → merges. No human touched anything |
| 3 | Genuinely unresolvable conflict (two incompatible schema edits) | give-up path: 3 attempts → FAILED_CONFLICT → BLOCKED_HUMAN + Slack w/ PR link; Cyrus session stopped (`markBlocked`) |
| 4 | PR touching `migrations/` with a conflict | **no AI rebase attempt** — immediate escalation (upstream §5.4) |
| 5 | CI fails twice then passes | agent re-dispatched with CI log context each time; attempts counter visible; third failure would trip FAILED_CI |
| 6 | Merge racing: duplicate GitHub webhook deliveries | single-flight guard — exactly one merge attempt per ticket per sha |

## §6 M5 — deploy chain (dogfood)

| # | Step | Expected |
|---|---|---|
| 1 | Onboard the **slykboard repo itself** as a project (deploy target = slykboard LXC) | onboarding completes; future merges deploy slykboard via its own pipeline |
| 2 | Same for the dispatcher (deploy target = dispatcher LXC) | both services self-hosting |
| 3 | Happy path: trivial change (version bump) → PR → merge | deploy.yml: snapshot → build → rsync → restart → public smoke 200 → `/webhooks/deploy` success → ticket DONE + PM email + kanban auto-move |
| 4 | Rollback drill: commit a change that breaks `/api/health` | smoke fails → auto-rollback to pre-deploy snapshot → FAILED_DEPLOY → BLOCKED_HUMAN; LXC serving previous good build; ticket red with reason |
| 5 | Kill switch drill: revoke `DEPLOY_SSH_KEY` mid-deploy | deploy fails at SSH step, rollback path still functional (snapshot step already ran), alert fires — no wedged state |
| 6 | Snapshot retention | after 7 deploys: exactly 5 `pre-deploy-*` snapshots remain on the CTID |

## §7 M6 — observability

Per doc `18` §8: DispatcherDown fires ≤2 min; AiRebateGiveUp fires on a
forced give-up; Grafana ticket-series click → Loki trace lands; dashboards
provision on boot with zero manual import.

## §8 M7 — production-readiness gate (post-research, unchanged)

Not scheduled. Trigger conditions + full checklist live in doc `09` §6.5 +
`homelab-setup/RESEARCH-SCOPE-MEMO.md`. Nothing in M0–M6 depends on it.

## §9 Security gate (runs at every milestone boundary)

Doc `17` §7 checklist, executed and initialed. Plus:

- Port-scan the WAN face: only the two existing ports (2222 + Zoraxy 80/443)
  — the pipeline added **zero** new inbound holes.
- From a throwaway GitHub PR, attempt the deploy key's power: confirm it
  cannot shell the jump LXC (`restrict` honored) and cannot run anything
  outside the sudoers allowlists on target/proxmox.

## Drill log

| Date | Milestone | Drill | Operator | Result | Notes |
|---|---|---|---|---|---|
| _none yet_ | | | | | |
