# 18 — Observability (M6)

> Metrics, logs, dashboards, alerts. Upstream reference:
> `AUTOMATION-PLAN.md` §7. Two new LXCs (`monitor`, `logs`), config-as-code in
> this repo's `monitoring/` directory. Additive — the pipeline is complete
> without this (doc `12` §3), this milestone makes it operable day-to-day.

## 1. Stacks

| LXC | Runs | Specs (set-up-container.sh) |
|---|---|---|
| `monitor` | Prometheus, Grafana, Alertmanager | `-n monitor -c 2 -r 2048 -s 20` |
| `logs` | Loki, Grafana agent (promtail successor) | `-n logs -c 2 -r 4096 -s 50` |

Loki over ELK per upstream §7.1 (label-index only, ~10× less RAM at this
scale). No K8s, no mesh — same ceiling as the rest of the plan.

## 2. Layout

```
monitoring/
  prometheus/prometheus.yml        # scrape configs
  prometheus/alerts.yml            # alert rules (§5)
  grafana/dashboards/*.json        # committed dashboards (§4)
  grafana/provisioning/            # datasource + dashboard providers
  loki/loki-config.yml
  grafana-agent/agent.yml          # per-LXC shipping config (journal + files)
  alertmanager/alertmanager.yml    # routes (§5)
  MONITORING.md                    # install + upgrade runbook
```

## 3. Metrics

### 3.1 Dispatcher `/metrics` (Prometheus text format)

The dispatcher is the only pipeline service that exports metrics (slykboard
is OSS-clean — no homelab-specific metrics in its process; if ever needed,
they go behind agent mode).

```
pipeline_jobs_total{project,state,terminal}        counter
pipeline_duration_seconds{project,state}           histogram
ai_rebase_attempts_total{outcome}                  counter
deploy_rollback_total                              counter
dispatcher_lease_acquired_total                    counter
dispatcher_state_write_failures_total{reason}      counter   # slykboard API 4xx/5xx
agent_dispatch_duration_seconds{backend}           histogram
agent_status_poll_errors_total                     counter
onboarding_step_duration_seconds{step}             histogram
onboarding_failures_total{step}                    counter
escalations_total{kind}                            counter
```

Plus node_exporter on every LXC (CPU/RAM/disk/net) — installed by
`infra/bootstrap-stack.sh` + the runbook for pre-existing LXCs.

### 3.2 Label discipline

`project` label = slykboard slug. `trace_id` is **not** a label (cardinality)
— it rides in logs and PipelineEvents only; dashboards link out to Loki by
trace via a Grafana data-link.

## 4. Dashboards (JSON committed)

| Dashboard | Panels (source) |
|---|---|
| **Pipeline overview** | tickets by state (timeseries from `pipeline_jobs_total`), throughput/day, p50/p90 cycle time BACKLOG→DONE (`pipeline_duration_seconds`), failure breakdown by state |
| **Agent health** | dispatch duration by backend, `/status` poll error rate, active sessions (gauge from lease count), rebase attempts by outcome |
| **Onboarding health** | step funnel + duration p50/p90, failures by step, currently-in-flight onboardings |
| **Deploy health** | success rate (24h/7d), rollback count, smoke-test latency, deploys/day |
| **Fleet** | node_exporter overview across LXCs |

Grafana provisioned from `grafana/provisioning/` — dashboards load at boot,
no manual import. One Grafana instance on `monitor`, Zoraxy-routed at
`grafana.kmlab.dev` behind Cloudflare Access.

## 5. Alerts

| Alert | Expression (sketch) | Route | Docs anchor |
|---|---|---|---|
| `CyrusAgentStuck` | no state transition on an AGENT_RUNNING ticket for 30 min | Slack #pipeline | upstream §7.4 |
| `AiRebaseGiveUp` | `FAILED_CONFLICT` transition observed | Slack + email | §5.3 budget |
| `DeployFailed` | `FAILED_DEPLOY` transition | Slack + email | doc 16 §5 |
| `CICascadingFail` | >3 `FAILED_CI` transitions per project in 1h | Slack | doc 13 §8.3 |
| `ProxmoxSnapshotsFull` | >5 `pre-deploy-*` on any CTID | Slack #ops | doc 16 §6 |
| `DispatcherDown` | `up{job="dispatcher"} == 0` for 2m | Slack + email | — |
| `SlykboardDown` | `up{job="slykboard"} == 0` for 2m | Slack + email | — |
| `AgentWaitingTimeout` | AGENT_WAITING age > 70h (fires *before* the 72h escalation) | Slack | doc 14 §6 |
| `AgentApiQuotaBurning` | Anthropic spend proxy (dispatch count × est. tokens) > threshold/day | Slack #ops | memo'd cost guard, crude v1 |

Notification channels: one Slack incoming-webhook per channel (the same
mechanism as the existing escalation webhook, `SLACK_ALERT_WEBHOOK` on the
dispatcher); email via Alertmanager's SMTP (Cloudflare Email Routing
outbound is acceptable at this volume). PagerDuty/SMS deliberately out of
scope (upstream table marked it optional).

## 6. Logs

Grafana agent on every pipeline LXC ships:
- systemd journal (`journald` integration — dispatcher, slykboard, target
  services)
- `/var/log/<slug>/*.log` where a stack logs to files

Both dispatcher and slykboard already emit pino structured JSON with
`ticketId` / `traceId` / `direction` / `path` / `status` fields (dispatcher
inherits backend's logger conventions — doc `13` §3). Query pattern from
upstream §7.3: `{job="dispatcher"} |= "SLYK-42" | json`. Retention 14d
(filesystem compactor) — homelab disk budget.

## 7. Trace IDs

Already load-bearing end to end: slykboard generates on ticket create
(`PipelineJobs.traceId`), the dispatcher propagates into Linear-shape
`webhookId` + its dispatch log, state callbacks carry it back, PipelineEvents
store it per transition (04-schema). M6 closes the loop with a Grafana
data-link on the Pipeline-overview dashboard: click a ticket's series →
Loki query by trace_id. No new tracing infra (no OTel collector — overkill
at this scale; revisit only if cross-service latency debugging demands it).

## 8. Milestone scope + drill

M6 delivers: both LXCs, `monitoring/` fully populated, dispatcher
`/metrics` + node_exporter fleet, provisioned dashboards, Alertmanager wired
to Slack, agent fleet shipping to Loki, MONITORING.md runbook.

Drill (doc `19` §7): kill the dispatcher process → Slack fires DispatcherDown
within 2 min; force a CONFLICT_RETRY give-up → AiRebaseGiveUp fires; open
Grafana, click a deployed ticket's series → lands on its Loki trace.
