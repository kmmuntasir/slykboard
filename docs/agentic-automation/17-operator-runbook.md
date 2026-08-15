# 17 — Operator Runbook: Pre-flight, Deployment, Secrets (M0–M5)

> The manual steps. Everything here is done **once** by the operator (you);
> after that the system is PM-driven. This doc is the "separate service"
> deployment guide for the dispatcher and the install guide for every host
> touched by the pipeline. Upstream reference: `AUTOMATION-PLAN.md` §3.6.7,
> §6.2, §9.

## 1. The separate-service contract (read first)

This repo contains **three deployables**. Plain-mode OSS users build two:

| Deployable | Built from | Deployed to | Who installs |
|---|---|---|---|
| Slykboard API + web | `backend/` + `frontend/` (one image pair via `docker-compose.prod.yml`) | slykboard LXC | OSS user (docker compose up) or homelab |
| **Dispatcher** | `dispatcher/` (own image via `dispatcher/Dockerfile`) | **dispatcher LXC — its own container, own host, own secrets** | homelab only |
| Cyrus | *not in this repo* | existing Cyrus LXC | already installed, untouched |

Invariants that make "same repo, separate services" safe:

1. `docker-compose.prod.yml` (backend+frontend) **never** references
   `dispatcher/`, never mounts dispatcher secrets. Plain-mode `docker compose
   up` remains exactly what doc `02` promises.
2. `dispatcher/docker-compose.dispatcher.prod.yml` builds only from
   `dispatcher/` + `project-template/` + `infra/` contexts.
3. The secret boundary is the **process/host boundary**, not the git boundary
   (doc `12` §7 risk #1). The repo carrying dispatcher code leaks nothing —
   dispatcher *env/secret files* are the crown jewels and live only on the
   dispatcher LXC.

## 2. Secret inventory (who holds what, exactly)

| Secret | Lives on | Never on |
|---|---|---|
| `SLYKBOARD_DISPATCHER_TOKEN` (64-hex HMAC) | slykboard env **and** dispatcher env (same value) | anywhere else |
| `LINEAR_WEBHOOK_SECRET` | Cyrus `~/.cyrus/.env` (existing) + **copy** in dispatcher env | slykboard, git |
| `GITHUB_APP_PRIVATE_KEY` | dispatcher LXC secret file | slykboard, git, Actions |
| `GITHUB_WEBHOOK_SECRET` | dispatcher env + GitHub webhook config | slykboard |
| Cyrus SSH keypair (dispatcher→cyrus) | dispatcher secret file / Cyrus authorized_keys | slykboard |
| Proxmox SSH keypair (dispatcher→proxmox) | dispatcher secret file / proxmox authorized_keys | slykboard |
| Zoraxy API key | dispatcher env | slykboard |
| Anthropic key | Cyrus env only (unchanged) | dispatcher, slykboard |
| `DEPLOY_SSH_KEY` (ED25519) | GitHub Actions secrets per repo | dispatcher, slykboard |
| `DISPATCHER_TOKEN` (Actions→dispatcher header) | GitHub Actions secrets + dispatcher env | slykboard |
| Google OAuth client secret | slykboard env (existing) | dispatcher |

Rule of thumb: **slykboard's env and dispatcher's env are disjoint except the
one HMAC token.** Audit this table against both `.env` files at every
milestone gate (doc `19`).

## 3. One-time pre-flight (order matters)

### 3.1 Tokens + keys (local, ~15 min)

```bash
# shared HMAC token
openssl rand -hex 32                          # → SLYKBOARD_DISPATCHER_TOKEN (both services)

# deploy keypair for GitHub Actions
ssh-keygen -t ed25519 -f gh-actions-deploy -N '' -C 'gh-actions-deploy'

# dispatcher→cyrus + dispatcher→proxmox keypairs
ssh-keygen -t ed25519 -f dispatcher-cyrus -N '' -C 'dispatcher-cyrus'
ssh-keygen -t ed25519 -f dispatcher-proxmox -N '' -C 'dispatcher-proxmox'

# github webhook secret
openssl rand -hex 32                          # → GITHUB_WEBHOOK_SECRET
```

### 3.2 GitHub App `kmlab-dispatcher`

1. Create App (org-level): permissions — `repository:administration`,
   `contents: write`, `metadata: read`, `pull_requests: write`,
   `workflows: write`. **No** webhook on the App itself (per-repo webhooks
   are configured by onboarding).
2. Install on the org (all repos — Cyrus's GitHub user already has org write,
   unchanged).
3. Download private key → dispatcher secret file.
4. Generate + install the deploy keypair per §3.1 into org-level Actions
   secrets defaults (per-repo copying happens at onboarding; doc `15` §4).

### 3.3 Zoraxy API key — Zoraxy admin UI → API key, scope proxy-host CRUD.

### 3.4 Host installs

```bash
# jump LXC — authorized_keys entry only:
# restrict,permitopen=192.168.31.0/24:22 ssh-ed25519 AAAA… gh-actions-deploy

# proxmox host:
scp infra/gh-deploy-snap infra/gh-deploy-lxc root@proxmox:/usr/local/bin/
scp infra/sudoers/proxmox-gh-deploy root@proxmox:/etc/sudoers.d/
ssh root@proxmox 'chmod 0755 /usr/local/bin/gh-deploy-* && visudo -c'

# dispatcher SSH pubkey → Cyrus LXC (existing cyrus-runner user):
ssh-copy-id -i dispatcher-cyrus.pub cyrus-runner@cyrus-lxc
# + proxmox (gh-deploy user, created by install.sh):
./infra/install.sh --role proxmox --key dispatcher-proxmox.pub
./infra/install.sh --role jump     --key gh-actions-deploy.pub
```

Verify each: `ssh -i dispatcher-cyrus cyrus-runner@cyrus-lxc 'cyrus --version'`,
`ssh gh-deploy@proxmox 'sudo gh-deploy-snap'` (expect "refused" — that's
success), `ssh -J gh-deploy@jump:2222 gh-deploy@<any-lxc> 'true'`.

### 3.5 `LINEAR_WEBHOOK_SECRET` copy

`grep LINEAR_WEBHOOK_SECRET ~/.cyrus/.env` on the Cyrus LXC → paste into
dispatcher env. **Do not edit `~/.cyrus/.env`** — read-only copy (upstream
§3.3).

## 4. Dispatcher LXC provisioning (once)

```bash
# from homelab-setup (existing tooling):
./set-up-container.sh -n dispatcher -c 2 -r 1024 -s 10
# no -d/-p — API-only, no Zoraxy web route exposed; Cloudflare Access in front
# of dispatcher.kmlab.dev for defense-in-depth (upstream §4.1).

# on the LXC:
git clone <this-repo> /opt/slykboard && cd /opt/slykboard
install -m 600 dispatcher.env /etc/slykboard-dispatcher/env   # from §2 inventory
docker compose -f dispatcher/docker-compose.dispatcher.prod.yml up -d
```

Compose mounts (files, not env values, for keys):
`/run/secrets/cyrus_ssh_key`, `/run/secrets/proxmox_ssh_key`,
`/run/secrets/gh_app_key` + env file for the rest. Healthcheck hits
`/healthz`; the service self-checks slykboard's `schemaVersion` at boot and
refuses to start on mismatch (doc `13` §4).

Also ship `infra/systemd/dispatcher.service` as the non-docker alternative
(same env-file + LoadCredential pattern) — pick one; the compose path is the
default.

## 5. Bring-up order (first full install)

1. M0 fixes + this repo's CI green (doc `12` §5).
2. §3 pre-flight complete, verified per its check commands.
3. Dispatcher LXC up (§4), `/healthz` green, boot self-checks pass.
4. Flip slykboard's env to `SLYKBOARD_AGENT_MODE=true` + dispatcher URL/token
   → restart → `/api/health` shows `agentMode: true`.
5. Run doc `19` drills in order (§2 → §3 → …). Each milestone's drill is its
   acceptance gate.

## 6. Routine operations (post-M5)

| Task | Procedure |
|---|---|
| Rotate deploy SSH key | new keypair → org Actions secrets + jump/target/proxmox authorized_keys (add new, test, remove old). No downtime. |
| Rotate HMAC token | generate → dispatcher env + slykboard env → restart both. In-flight retries fail once; idempotency keys make replays safe. Do between tickets. |
| Rotate GitHub App key | App settings → new key → dispatcher secret file → restart. |
| Re-key `LINEAR_WEBHOOK_SECRET` | Cyrus env + Linear webhook settings + dispatcher env, same maintenance window. **Deferred to Phase 6.5** for the real Linear workspace (memo). |
| Dispatcher upgrade | it deploys itself through the pipeline (M5 dogfood); manual `docker compose pull && up -d` is the fallback. |
| Snapshot housekeeping | automatic (doc `16` §6); manual check: `pct listsnapshot <ctid>` shows ≤5 `pre-deploy-*`. |
| Break-glass | every step is idempotent + reversible: decommission a project to tear it down; `git revert` + normal deploy for bad code; snapshots for LXC-level restore. |

## 7. Security checklist (audit at each milestone gate, doc 19)

- [ ] slykboard env ∩ dispatcher env == {HMAC token} (§2 table verified).
- [ ] No secret values in git (`git log -p | grep -iE 'secret|key|token'`
      sanity sweep; `.secrets` pattern stays gitignored).
- [ ] `restrict,permitopen` present on the jump LXC authorized_keys entry.
- [ ] Sudoers files pass `visudo -c`; wrappers are 0755 root:root.
- [ ] Dispatcher LXC reachable only via Cloudflare Access (no direct WAN).
- [ ] Cyrus LXC untouched: no `~/.cyrus/.env` edits, no source modifications
      (`cyrus --version` + one real Linear ticket still processing).
- [ ] GitHub App has no webhook secret configured (per-repo webhooks only).
- [ ] Actions secrets list matches §2 inventory exactly — nothing extra.
