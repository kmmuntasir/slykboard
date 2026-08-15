# 16 — Deploy Chain: Jumphost, Wrappers, GitHub Actions (M5)

> How a merged PR becomes a running service on an LXC, with rollback. Upstream
> reference: `homelab-setup/AUTOMATION-PLAN.md` §6 (auth model, workflows),
> §6.8 (rollback), `gateway-architecture-guide.md` §14 (jumphost). The
> operator steps that install everything here live in doc `17`.

## 1. Trust chain (recap)

GitHub Actions (cloud) holds **one** ED25519 private key. That key's power is
exactly:

1. ProxyJump through `jump` LXC as user `gh-deploy` — restricted
   (`restrict,permitopen=192.168.31.0/24:22`), no shell, no other forwarding.
2. Shell on target LXCs as `gh-deploy` — sudoers allowlist:
   `systemctl restart <slug service>` + rsync into `/opt/<slug>/`.
3. Shell on Proxmox host as `gh-deploy` — sudoers allowlist: only
   `/usr/local/bin/gh-deploy-snap` and `/usr/local/bin/gh-deploy-lxc`.

No root anywhere. No raw `pct`. Key rotation = one secret update + one
authorized_keys swap (runbook doc `17` §6).

## 2. Files this repo ships (`infra/`)

```
infra/
  gh-deploy-snap              # proxmox host: /usr/local/bin/gh-deploy-snap
  gh-deploy-lxc               # proxmox host: /usr/local/bin/gh-deploy-lxc
  bootstrap-stack.sh          # target LXC: /opt/bootstrap-stack.sh
  sudoers/
    jump-gh-deploy            # (none needed — restrict is in authorized_keys)
    target-gh-deploy          # target LXCs: systemctl restart + rsync allowlist
    proxmox-gh-deploy         # proxmox: the two wrappers only
  systemd/
    dispatcher.service        # dispatcher LXC unit (doc 17)
    <slug>.service.example    # template bootstrap-stack.sh instantiates
  install.sh                  # idempotent installer run per-host via SSH
```

### `gh-deploy-snap` (upstream §6.2 step 4, verbatim basis)

```bash
#!/bin/bash
# /usr/local/bin/gh-deploy-snap — allowlisted pct snapshot/rollback.
set -euo pipefail
case "$1 $2 $3" in
  "snapshot "*"") pct snapshot "$2" "$3" ;;
  "rollback "*"") pct rollback "$2" "$3" ;;
  *) echo "refused" >&2; exit 1 ;;
esac
```

Note the pattern-match limits arity by construction — `snapshot a b c` fails
the glob (three args after the verb) and hits `*` → refused.

### `gh-deploy-lxc` (onboarding-time LXC lifecycle)

```bash
#!/bin/bash
set -euo pipefail
cmd="$1"; slug="$2"
case "$cmd" in
  create)   # $3 cores $4 ram_mb $5 disk_gb → prints "<ctid> <ip>"
            pct create … ; pct set "$slug-ct" … ; echo "$ctid $ip" ;;
  bootstrap) # $3 stack → ssh <ct-ip> '/opt/bootstrap-stack.sh <stack> <slug>'
            ;;
  destroy)  pct destroy "$ctid" --purge ;;
  *) echo "refused" >&2; exit 1 ;;
esac
```

Implementation detail: the wrapper resolves slug→ctid via `pct list` name
match (containers created with hostname = slug). Cores/ram/disk clamped
(1–4 cores, 512–4096 MB, 4–40 GB) — the wrapper enforces bounds, dispatcher
sends only sane values (defense in depth).

### `bootstrap-stack.sh` (runs inside the new LXC)

1. Installs the stack runtime (doc `15` §2 table).
2. Creates `gh-deploy` user + sudoers fragment (allowlist: this slug's
   `systemctl restart`, `rsync`).
3. Writes `/opt/<slug>/` skeleton + instantiates `systemd/<slug>.service`
   from the example.
4. Idempotent — re-run adopts existing state.

### `install.sh`

Per-host idempotent installer: detects host role (jump / target / proxmox /
dispatcher) from args, copies files with correct modes (`sudoers.d` fragments
0440, wrappers 0755 root:root), validates with `visudo -c` before install,
refuses to run as root-without-tty for safety. Run manually per host during
M5 bring-up (doc `17` §4 has the exact invocations); after that, never again.

## 3. What changes on `jump` LXC

Only an authorized_keys entry (doc `17` §4.1). No software, no wrappers —
the jumphost is a pure forwarder.

## 4. GitHub side

Per-repo (done by onboarding Path A / B — doc `15` §4):

- Secrets (set via App API during onboarding): `DEPLOY_SSH_KEY`,
  `JUMP_HOST`, `JUMP_PORT` (2222), `JUMP_USER` (gh-deploy),
  `PROXMOX_HOST_LAN`, `DISPATCHER_TOKEN`, `DISPATCHER_PUBLIC_URL`.
- Webhook: `https://dispatcher.kmlab.dev/webhooks/github` →
  `GITHUB_WEBHOOK_SECRET` (dispatcher-side, M4).
- Workflows committed from the template (doc `15` §3).

**This repo itself (slykboard repo)** gets the same treatment in M5 — CI from
M0 §5.2 plus a deploy workflow targeting the slykboard LXC. Dogfooding rule:
from M5 on, every change to slykboard itself ships through the pipeline it
implements. That includes the dispatcher LXC (two deploy targets, same chain).

## 5. Deploy flow (sequence)

```
mergebot rebase-merges PR → push to main
  └▶ deploy.yml (cloud runner)
       1. setup-jump-ssh (writes ~/.ssh/config)
       2. read .deploy-target.json → ctid/lanip/svc
       3. ssh proxmox: gh-deploy-snap snapshot <ctid> pre-deploy-<ts>   ← rollback point
       4. build (stack-specific)
       5. rsync -az --delete artifact → gh-deploy@<lanip>:/opt/<slug>/   (via ProxyJump)
       6. ssh target: sudo systemctl restart <svc>
       7. curl https://<subdomain>.kmlab.dev/api/health  (public URL — full CF→Zoraxy→LXC chain)
       8a. ok    → POST /webhooks/deploy {sha, status: success}
       8b. fail  → ssh proxmox: gh-deploy-snap rollback <ctid> <snap>
                   POST /webhooks/deploy {sha, status: failure}
                    └▶ dispatcher: state DEPLOYING→FAILED_DEPLOY (→ BLOCKED_HUMAN per matrix)
```

Dispatcher's `/webhooks/deploy` handler verifies `X-Dispatcher-Token` (the
shared HMAC token — GitHub sends it as a plain header since Actions can't
HMAC bodies natively; the token is a secret either way), matches `sha` →
ticket, writes `DONE` (success) or `FAILED_DEPLOY` (failure) via slykboard's
state API. `DONE` fires the PM email + kanban move — closing the loop.

## 6. Rollback semantics + known gap

- Snapshot name `pre-deploy-<epoch>` is recorded by the workflow and reused
  verbatim for rollback — no "latest snapshot" guessing.
- Retention: dispatcher's nightly job SSHes
  `gh-deploy-snap list <ctid>`-equivalent (wrapper gains a `list` verb) and
  prunes past the newest 5 per CTID. (Upstream §6.8 said a proxmox cron; a
  dispatcher-owned job keeps the logic with the thing that knows deploys
  happened.)
- **Documented gap (memo'd, not fixed in v1):** DB-migration-bearing deploys.
  `pct rollback` restores the filesystem, not Postgres migrations that
  already ran. Slykboard tickets carry this in Phase 6.5's
  migration-bearing-rollback drill; until then the deploy chain assumes
  artifacts are fs-only (true for the five template stacks; slykboard itself
  is the migration-bearing exception — its own deploys keep manual migration
  gating until that drill passes).

## 7. Milestone scope + drill

M5 delivers: `infra/` complete + installed on the three host roles, secrets +
workflows generated by onboarding, `/webhooks/deploy` handler, slykboard +
dispatcher LXCs onboarded as deploy targets (self-hosting), retention job.

Drills (doc `19` §6): happy-path deploy (bump version string in slykboard →
watch it go green end to end), rollback drill (commit a smoke-test-breaking
change → verify auto-rollback + FAILED_DEPLOY ticket + rollback left the LXC
on the previous good build).
