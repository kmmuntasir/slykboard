# 15 — Project Template (M3)

> The greenfield seed the onboarding orchestrator creates new repos from.
> Upstream reference: `homelab-setup/AUTOMATION-PLAN.md` §3.6.1 (form/stacks),
> §3.6.3 WIRING_GITHUB Path A, §6.4/§6.5 (workflow shapes), §11
> (`project-template/` layout).

## 1. What it is

A directory tree in this repo (`project-template/`) whose contents get pushed
into every newly created project repo. Not a GitHub "template repository" —
the dispatcher composes the repo contents itself via the GitHub App API
(template repos can't be parameterized per-stack; contents-API pushes can).

```
project-template/
  _shared/
    .deploy-target.json.example
    .github/
      actions/setup-jump-ssh/action.yml
      workflows/ci.yml.tmpl
      workflows/deploy.yml.tmpl
    AGENTS.md
  node-express/         # per-stack skeleton (see §2)
  next/
  python-fastapi/
  go/
  static/
```

Onboarding Path A (`source_mode=new`) composes: chosen stack dir + `_shared`
(rendered `.tmpl` values, renamed into place) → single commit on `main` of the
new repo → then branch protection (§4).

## 2. Stack skeletons

Each stack dir is a runnable hello-world with a `/api/health` route (the
SMOKE_TEST contract — doc `13` §7 — requires exactly this path returning 200):

| Stack | Contents | Runtime install (bootstrap-stack.sh) | Port |
|---|---|---|---|
| `node-express` (default) | express 5, one route, vitest, hello test | node 24 via nodesource | 3000 |
| `next` | create-next-app minimal (app router), one page + `/api/health` | node 24 | 3000 |
| `python-fastapi` | fastapi + uvicorn, `/api/health`, pytest | python 3.12 + venv + uvicorn[standard] | 8000 |
| `go` | net/http, `/api/health`, one test, go.mod | go 1.24 | 8080 |
| `static` | caddy serving `./public` + `/api/health` file | caddy | 8080 |

Rules for skeleton contents:

- Each ships a lint + typecheck + test + build script wired to the CI
  workflow's four steps (`npm run lint/typecheck/test/build` or per-stack
  equivalents) — CI must be green on the very first push or onboarding's
  branch-protection step wedges.
- Zero secrets, zero kmlab-specific values beyond the rendered templates.
- `AGENTS.md` seed (from `_shared`) is the PM's "initial agent context"
  written at creation time (upstream §3.6.1). Per-repo content comes from the
  onboarding form; the `_shared` file is the fallback skeleton explaining the
  repo layout, the `/api/health` contract, and the rebase-merge + linear
  history policy.

## 3. Rendered files

### `.deploy-target.json` (written by the orchestrator, not the template)

```json
{
  "lxcCtid": 142,
  "lanIp": "192.168.31.142",
  "systemdService": "inventory-tracker",
  "subdomain": "inventory-tracker",
  "stack": "node-express",
  "port": 3000
}
```

Consumed by `deploy.yml` (doc `16` §5) — the whole deploy chain keys off this
one file. `.example` in the template is documentation only.

### `.github/actions/setup-jump-ssh/action.yml` (verbatim from upstream §6.3)

Composite action writing the runner's `~/.ssh/config`: `km-jump` host entry
(Host/Port/User from repo secrets, `IdentityFile ~/.ssh/deploy`,
`StrictHostKeyChecking accept-new`) + `Host 192.168.31.*` with
`ProxyJump km-jump`, `User gh-deploy`. Identical file in every repo — that's
the point of committing it rather than referencing.

### `ci.yml.tmpl` → `.github/workflows/ci.yml`

Cloud runner only, never touches the LAN (upstream §6.4). Steps: checkout →
runtime setup (per-stack: setup-node 24 + npm cache / setup-python /
setup-go) → install (`npm ci` / `pip install` / `go mod download`) → lint →
typecheck → test → build, each `--if-present`-style so a stack without one of
the steps still passes. `on: [pull_request, push]`.

### `deploy.yml.tmpl` → `.github/workflows/deploy.yml`

`on: push: branches: [main]` only. Steps (full YAML in upstream §6.5; this
template renders it with stack-specific build/rsync commands):

1. checkout + `setup-jump-ssh` + runtime setup
2. resolve deploy target from `.deploy-target.json` (jq → outputs)
3. snapshot via `ssh gh-deploy@${PROXMOX_HOST_LAN} "sudo gh-deploy-snap
   snapshot $CTID pre-deploy-$(date +%s)"` (record name for rollback)
4. build (per-stack)
5. rsync build artifact to `gh-deploy@$LAN_IP:/opt/<slug>/` over ProxyJump
6. `ssh … "sudo systemctl restart $SVC"`
7. smoke: `curl -fsS --max-time 15 https://<subdomain>.kmlab.dev/api/health`
8. `if: failure()` → rollback snapshot
9. `if: always()` → `POST $DISPATCHER_PUBLIC_URL/webhooks/deploy` with
   `{sha, status}` + `X-Dispatcher-Token: $DISPATCHER_TOKEN`

Per-stack build/artifact map:

| Stack | Build | Artifact rsynced |
|---|---|---|
| node-express | `npm ci && npm run build` (tsc) | `dist/` + `package.json` + `package-lock.json` + `node_modules` diff via `npm ci --omit=dev` on target |
| next | `npm ci && npm run build` | `.next/` static + standalone |
| python-fastapi | none (rsync source) | `app/` + `requirements.txt`; restart = uvicorn reload via systemd |
| go | `go build -o bin/app` | single binary |
| static | none | `public/` |

Dockerfile-per-project is deliberately **not** in v1 (LXC + systemd is the
deploy model; upstream §13 "no Kubernetes" ceiling).

## 4. Branch protection (applied by the orchestrator after the first push)

Via App API `PUT /repos/{org}/{repo}/branches/main/protection`:

- require status checks: the CI job name — before first required-check
  config, push an empty commit so the check registers, then set protection
  (order matters; GitHub rejects unknown check names)
- strict = true (up-to-date before merge — makes rebase merges deterministic)
- require linear history, forbid merge commits (matches repo policy)
- **no** required PR reviews (research scope — memo'd; pipeline is the merge
  authority)
- code-owner review on `infra/`, `migrations/`, `.deploy-target.json`,
  `.github/workflows/` — the one human gate (CODEOWNERS shipped in the
  template pointing at the org owners)

Path B (existing repo) opens these same files as a PR instead of direct push
and **waits for merge** before WIRING_AGENT (doc `13` §7); if the existing
repo has protection that conflicts, existing protection wins — warning event,
continue (upstream §3.6.3 Path B step 4).

## 5. Tests for the template itself

- One CI run per stack on this repo (a matrix job in the repo's own `ci.yml`,
  M0 §5.2): `cd project-template/<stack> && <build+test>` — keeps every
  skeleton green as the template evolves.
- Rendering test (unit, in dispatcher tests): `renderStack('node-express', ctx)`
  produces valid YAML/JSON for the workflows and `.deploy-target.json`
  (parse-don't-pattern-match).

## 6. Milestone scope

M3 delivers: this tree fully populated for all five stacks, the matrix CI,
dispatcher-side render + push step inside WIRING_GITHUB Path A, branch
protection step, Path B PR flow. Drill (doc `19` §5): onboard a greenfield
project from the slykboard UI with the real dispatcher — repo created, LXC
up, Zoraxy route live, smoke green, then decommission tears it all down.
