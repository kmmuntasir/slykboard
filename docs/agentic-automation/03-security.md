# 03 — Security Model

## Threat isolation principle

Slykboard is the **user-facing** service. It has:

- Google OAuth cookies + session tokens.
- PM-supplied text inputs (ticket descriptions, comments, chat messages).
- Public internet exposure via Zoraxy + Cloudflare.
- XSS / SSRF / CSRF attack surface typical of any web app.

The dispatcher (separate service) holds **infrastructure credentials**:

- Cyrus LXC SSH key (RCE on Cyrus).
- GitHub App private key (org-wide repo write).
- Zoraxy API key.
- Proxmox host sudoers path.
- Dispatcher→slykboard HMAC token.

**If slykboard is compromised (XSS, SSRF, session hijack, dependency
CVE), the attacker must NOT be able to pivot to dispatcher-grade
secrets.** The defense is structural: slykboard's process literally
does not have those secrets in env or memory.

## Slykboard secret inventory (complete list)

Slykboard in **either mode** holds only these secrets:

| Secret | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | env | Postgres connect string |
| `GOOGLE_CLIENT_ID` | env | OAuth client id (public-ish) |
| `GOOGLE_CLIENT_SECRET` | env | OAuth client secret |
| `GOOGLE_CALLBACK_URL` | env | OAuth callback |
| `JWT_SECRET` | env | Session JWT signing |
| `ALLOWED_DOMAIN` | env | Restrict login to one G-Suite domain |
| `SLYKBOARD_DISPATCHER_TOKEN` | env (agent mode only) | HMAC shared secret for dispatcher↔slykboard comms |
| `SLYKBOARD_DISPATCHER_URL` | env (agent mode only) | Dispatcher base URL, e.g. `https://dispatcher.kmlab.dev` |

**Slykboard does NOT have** (verify with `grep -R` at code review):

- `ANTHROPIC_API_KEY`
- `CYRUS_SSH_KEY` / `CYRUS_PASSWORD` / any Cyrus LXC SSH private key
- `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_ID`
- `ZORAXY_API_KEY`
- `CLOUDFLARE_API_TOKEN`
- `PROXMOX_*` anything
- `LINEAR_WEBHOOK_SECRET` (lives on Cyrus + dispatcher; slykboard's
  HMAC token to dispatcher is enough — slykboard never signs Cyrus-
  bound Linear payloads directly)

If any of these appears in slykboard env or code, it's a bug.

## Auth flows

### User auth (PM)

Existing flow, unchanged. Google OAuth via `@react-oauth/google` on
frontend, `google-auth-library` on backend. Session JWT in HTTP-only
cookie. `ALLOWED_DOMAIN` filters at login callback. Roles:

- **Member** (`is_platform_admin = false`): can create tickets,
  comment, chat with agent on tickets they have access to, view
  projects they're a member of.
- **Platform admin** (`is_platform_admin = true`): everything a member
  can do + create/decommission projects, view all projects, manage
  users.

In agent mode, admin-only routes mount under `/api/v1/admin/*` behind
`requirePlatformAdmin()` middleware (factory — invoke with `()`; see
`11-existing-patterns.md`).

### Dispatcher → slykboard (HMAC)

Every request from dispatcher to slykboard carries an HMAC signature
in the `X-Dispatcher-Signature` header. Signing key =
`SLYKBOARD_DISPATCHER_TOKEN` (shared symmetric secret).

```ts
// backend/src/middleware/agentTokenAuth.ts (paraphrased)
import { createHmac, timingSafeEqual } from 'node:crypto';

export const agentTokenAuth: RequestHandler = (req, res, next) => {
  const sig = req.header('X-Dispatcher-Signature');
  if (!sig) return res.status(401).json({ error: 'Missing signature' });

  const rawBody = req.rawBody;  // see note below on raw body capture
  const expected = createHmac('sha256', process.env.SLYKBOARD_DISPATCHER_TOKEN!)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
};
```

**Raw body capture:** signature is over raw bytes. Express's default
JSON body parser consumes the stream. Capture the raw body before
JSON parsing for routes that verify HMAC:

```ts
// backend/src/index.ts
app.use('/api/v1/internal',
  express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }),
  requireAgentMode, agentTokenAuth, internalRoutes);
```

Cyrus's webhook signature scheme is HMAC-SHA256 hex — same scheme we
use here. Symmetric, simple, no JWT expiry to manage.

### Slykboard → dispatcher (HMAC, same token)

When slykboard POSTs to dispatcher (e.g. ticket creation event), it
signs the request body with the same
`SLYKBOARD_DISPATCHER_TOKEN`:

```ts
// backend/src/services/dispatcherClient.ts (paraphrased)
import { createHmac } from 'node:crypto';

export async function postToDispatcher(path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', process.env.SLYKBOARD_DISPATCHER_TOKEN!)
    .update(raw)
    .digest('hex');

  const res = await fetch(`${process.env.SLYKBOARD_DISPATCHER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slykboard-Signature': sig,
    },
    body: raw,
  });

  if (!res.ok) {
    throw new Error(`Dispatcher ${path} returned ${res.status}`);
  }
  return res.json();
}
```

Dispatcher verifies with the same shared secret (its env var name may
differ — see `07-dispatcher-contract.md`).

## Decommission safety

Project decommission is the most destructive action in the system. It
can:

- Destroy an LXC container.
- Delete a Zoraxy proxy host.
- Delete a GitHub repo (only if dispatcher created it during
  onboarding — see `projects.github_repo_created` column).
- Deregister the repo from the agent backend.

The actual teardown runs on the dispatcher. Slykboard only triggers it
via `POST /api/v1/admin/projects/:slug/decommission`. Safety layers:

1. **Auth**: only `is_platform_admin = true` users can hit this
   endpoint.
2. **Three-word destructive confirmation**: the request body must
   include `confirmSlug: <project-slug>`. Server compares against
   `projects.slug`. Mismatch → `400 Bad Request`. UI shows a modal:
   *"Type the project slug to confirm: `<slug>`"* — multi-step
   destructive op, full English, no fragments per the security
   auto-clarity rule.
3. **Idempotency**: dispatcher's teardown steps are idempotent. If
   slykboard retries after a network blip, the dispatcher skips
   already-deleted resources.
4. **No auto-recur**: decommission is a one-shot POST. No cron, no
   background retry. If dispatcher returns failure, slykboard marks
   `onboardingState = 'DECOMMISSIONING'` and the admin retries
   manually.
5. **Audit**: every decommission attempt appends to
   `OnboardingEvents` with the initiating user id + timestamp.

## Input validation

All inputs validated with Zod at the route edge. Schema definitions
live in `05-backend-routes.md`. Reject early with `400 Bad Request` +
machine-readable error code. Never accept untrusted JSON without a
schema.

PM-supplied text (ticket description, comment body, chat message,
agent context for onboarding) is:

- Stored as `text` in Postgres (no length cap at DB layer; app-layer
  cap of 50,000 chars to bound request size).
- Rendered as **markdown** on the frontend — never raw HTML. Use
  `react-markdown` with `rehype-sanitize` to strip dangerous tags.
- Re-displayed escaped in plain-text contexts (e.g. email subject
  lines).
- Forwarded verbatim to dispatcher (dispatcher forwards to agent).
  Agent prompt-injection risk is the dispatcher's problem, not
  slykboard's.

## CORS

`FRONTEND_URL` env var gates the CORS allowlist. Single origin.
Production: `https://slykboard.kmlab.dev`. No wildcard, no
credentials-with-wildcard combo.

## Rate limiting

TBD per route. Phase 5 concern. For v1:

- `/api/v1/internal/*` (dispatcher callbacks): no rate limit —
  dispatcher is trusted, single source, low volume.
- `/api/v1/admin/projects/:slug/onboard`: 1 request per 10s per admin
  user (onboarding is expensive).
- User-authenticated ticket creation / chat post: 30/min/user.

## Logging

Structured JSON logs (`pino`). Never log:

- Full session JWT.
- `SLYKBOARD_DISPATCHER_TOKEN` value.
- `GOOGLE_CLIENT_SECRET` value.
- PM-supplied text longer than 200 chars (truncate to bound log
  volume + avoid leaking sensitive ticket details into ops logs).

Always log:

- `trace_id` (uuid v4) per pipeline transition, propagated dispatcher→slykboard→agent.
- `user_id` for authenticated requests.
- `ticket_id`, `project_id` when applicable.
- HTTP method + path + status + duration.

## What slykboard is NOT responsible for

- Agent prompt injection filtering (dispatcher's job).
- PR review / branch protection (GitHub's job).
- Cost limits on Anthropic API (Cyrus's job — key never seen here).
- LXC isolation / network policy (Proxmox's job).
- Backup of pipeline state (handled by Postgres backups of the
  shared DB — same backup as core kanban data).

## Research-phase scope acceptance (2026-08-13)

This deployment is a **research/dev sandbox, not production**. Trusted
single-operator PM input, test Linear account, single-host network.
Several items below are *deliberately deferred* under those
assumptions — not oversights. Revisit before real users, real Linear
workspace, or real production data touch this pipeline.

| Item | Research-phase stance | Revisit trigger |
|---|---|---|
| **Prompt injection via ticket description** | Tolerated. Ticket authors are trusted PMs only — not external/untrusted input. | Before slykboard accepts tickets from anyone outside the current trusted operator set. |
| **Shared `LINEAR_WEBHOOK_SECRET` (real Linear + dispatcher)** | Non-issue — test Linear account, single dev host. | Before pointing this at a real/production Linear workspace. |
| **No cost circuit-breaker** | Out of slykboard's scope entirely (key never seen here). Dispatcher-side item; see Phase 6.5. | Before Phase 6, or sooner if spend spikes. |
| **No human code review before auto-merge** | Out of slykboard's scope (merge happens on dispatcher). | Dispatcher's Phase 6.5 item. |

For the dispatcher-side analog of this table, see
[`homelab-setup/RESEARCH-SCOPE-MEMO.md`](../../../homelab-setup/RESEARCH-SCOPE-MEMO.md)
(path relative to this repo — the memo lives in the homelab-setup repo).
Slykboard's role for the mergebot decision log (Phase 6.5 input) is
just to store the `pipelineEvents.detail` jsonb blob verbatim — see
`04-schema.md` for the shape.
