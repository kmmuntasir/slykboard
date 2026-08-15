# 14 — Agent Backend (M2 + M4 rebase)

> The `AgentBackend` abstraction and its Cyrus implementation. Upstream
> reference: `homelab-setup/AUTOMATION-PLAN.md` §3.7 (interface, verbatim
> basis), §3.2 (Linear-shape payload), §3.4 (chat). Wire-shape reference for
> the emitter: doc `08` in this folder.

## 1. The interface

`dispatcher/src/agents/types.ts` — adopted verbatim from upstream §3.7.2
(methods summarized; the upstream file is authoritative for signatures):

```typescript
export interface AgentBackend {
  readonly name: string;
  health(): Promise<boolean>;
  registerRepo(opts: { repoUrl: string; teamKey: string; projectSlug: string }): Promise<void>;
  deregisterRepo(opts: { repoUrl: string }): Promise<void>;
  dispatchTask(opts: {
    agentIssueId: string;      // slykboard ticket uuid — becomes Linear data.id
    teamKey: string;
    title: string;
    description: string;
    priority: number;
    labels: string[];
    replyUrl: string;          // dispatcher endpoint for status posts
  }): Promise<{ accepted: boolean; agentSessionId?: string }>;
  sendReply(opts: { agentIssueId: string; agentSessionId?: string; body: string }): Promise<void>;
  fetchPendingAgentMessages(opts: { agentIssueId: string }): Promise<AgentMessage[]>;
  canRebaseConflicts(): boolean;
  rebaseConflicts(opts: { repoUrl: string; branch: string; base: string })
    : Promise<{ outcome: 'resolved' | 'give_up'; reason?: string }>;
  markBlocked?(opts: { agentIssueId: string; reason: string }): Promise<void>;
}
```

Selection: `getAgent(project)` — `project.agentBackend ?? process.env.AGENT_BACKEND`.
Registered map starts `{cyrus}`; a `mock` backend (the existing scenario
engine wrapped) is registered in test builds only.

**Rule from upstream §3.7.5, enforced in review:** `grep -r "cyrus"
dispatcher/src --exclude-dir=agents/cyrus` must return nothing. Core
dispatcher code never names Cyrus.

## 2. M2 spike — verify Cyrus assumptions first (half day)

Before writing the adapter, run against the real Cyrus LXC:

1. `ssh <cyrus> 'cyrus list-repos --json'` — confirm subcommand exists + shape.
2. `cyrus self-add-repo --help` — capture flags; does it accept a teamKey /
   does it record workspace mapping? (Upstream §3.6.3 WIRING_AGENT step 5
   flags exactly this question.)
3. Send one hand-signed Linear-shape Issue.create (doc `08` payload, HMAC with
   `LINEAR_WEBHOOK_SECRET`) with a throwaway `data.id` → expect 200, worktree
   appears, PR opens on a scratch repo. **This validates the plan's central
   adapter claim on the installed build.**
4. Poll `/status` — capture the JSON shape of a running session and of an
   agent question (drives §5's parser).
5. Confirm a real Linear ticket still processes normally afterwards
   (coexistence).

Findings get written back into this doc before adapter code starts. If
`self-add-repo` doesn't cover teamKey routing, fallback: dispatcher appends
the §3.3.1-style synthetic workspace block via `cyrus config set` if exposed;
else direct `~/.cyrus/config.json` edit over SSH (documented exception path,
never the default).

## 3. Layout

```
dispatcher/src/agents/cyrus/
  index.ts          # cyrusBackend — implements AgentBackend
  linearShape.ts    # Issue/Comment payload builders + HMAC signer
  sshClient.ts      # exec wrapper (key file from env, non-root user)
  statusPoller.ts   # /status polling + utterance extraction
  aiRebase.ts       # (M4) triggers cyrus ai-rebase sub-session over SSH
```

## 4. Repo register / deregister

```typescript
async registerRepo({ repoUrl, teamKey, projectSlug }) {
  await sshExec(`cyrus self-add-repo ${shellQuote(repoUrl)}`);
  const known = JSON.parse(await sshExec('cyrus list-repos --json'));
  if (!known.includes(repoUrl)) throw new Error(`Cyrus did not register ${repoUrl}`);
}
```

- `shellQuote` everywhere — repo URLs are PM-influenced input; never template
  them raw into SSH commands.
- Idempotency: registering a known repo must be a no-op (check `list-repos`
  first; if the spike shows `self-add-repo` errors on duplicates, treat that
  error as success).
- `deregisterRepo` mirrors with `self-remove-repo`; "not found" = success.

## 5. Task dispatch + status bridge

**Dispatch** (`dispatchTask`): build the doc-`08` payload from the ticket,
sign raw bytes with `LINEAR_WEBHOOK_SECRET`, POST
`${CYRUS_BASE_URL}/linear-webhook` with headers `Linear-Signature`,
`Linear-Event: Issue.create`, `Linear-Delivery: <uuid>`,
`User-Agent: slykboard-dispatcher/1.0`. Hard rules (doc 08 + upstream §3.2):

- Sign the **exact bytes sent** — build the string once, HMAC it, send it.
- `data.id` = slykboard ticket uuid, forever stable (worktree dedupe key).
- Same ticket re-dispatched (CI retry) reuses the same id.

**Status bridge** (`fetchPendingAgentMessages` + a 2s poll loop in
`services/agentChat.ts`): poll `${CYRUS_BASE_URL}/status`, diff against the
last-seen cursor per session, extract agent questions/utterances → for each:

1. `POST /api/v1/internal/jobs/:ticketId/messages` (authorRole AGENT,
   idempotencyKey = sha256 of utterance + cursor — dedupes poll overlap).
2. If the utterance is a *question* (marker per the spike's findings): also
   `POST .../state {state: AGENT_WAITING}` — the badge + email fire on
   slykboard's side.

**PM reply** (`sendReply`): build the doc-`08` Comment.create payload
(`data.id` = slykboard message uuid, `issueId` = ticket uuid), same signing,
same endpoint. Fired from the `/webhooks/ticket-events` `pm_reply` handler
immediately (never queued — chat latency is the feature).

Cyrus's Linear writeback failures (404 against real Linear for synthetic ids)
are expected noise — nothing to handle, per doc `08` § "Cyrus writeback".

## 6. 72h AGENT_WAITING timeout (closes audit F8b)

Slykboard's docs (07 § failure scenarios, upstream §4.5/§8.4) promise
`AGENT_WAITING ──72h──▶ BLOCKED_HUMAN`; the audit found nobody owns the clock.
Owner = dispatcher (it already polls; slykboard stays stateless about time).

Implementation: the agentChat poll loop records `waiting_since` per ticket (in
`onboarding_progress`-style scratch, or derived from slykboard's last
`AGENT_WAITING` event via the state API). On `now - waiting_since > 72h` and
state still AGENT_WAITING: write `BLOCKED_HUMAN` via the state API (matrix
allows `AGENT_WAITING→FAILED_AGENT` only — so first `FAILED_AGENT` with
detail `{reason: 'pm-reply-timeout'}`, then `BLOCKED_HUMAN`; both legal
edges), Slack-alert, `agent.markBlocked`.

## 7. AI rebase (M4)

`canRebaseConflicts() → true` for Cyrus. `rebaseConflicts` SSHes:

```
cyrus ai-rebase --repo <repoUrl> --branch <branch> --base <base> --json
```

- Parses `{outcome: 'resolved'|'give_up', reason?}`. `MERGEBOT_GIVE_UP` from
  the upstream prompt maps to `give_up`.
- **If the spike (§2) finds no `ai-rebase` subcommand on the installed Cyrus:**
  fallback = dispatcher SSHes a `claude` invocation inside the Cyrus LXC with
  the upstream §5.3 conflict-resolver prompt (bound to the worktree, 10-min
  wall clock, network allow-list github.com + npmjs.org). The Anthropic key
  stays in Cyrus's env either way — dispatcher never sees it.
- Migrations in the conflict set → mergebot never calls this; escalates
  (doc `13` §8.4).

`markBlocked`: emits Linear-shape `Issue.update` with
`data.state.name = "Blocked"`, same signing — Cyrus treats it as a state
change and stops the session.

## 8. Backend contract checklist (for future backends)

From upstream §3.7.6 — a new backend must provide: cheap `health()`,
idempotent register/deregister, a stable agent issue id, no Anthropic key on
the dispatcher, and a reply path. The `mock` backend (scenario engine) is the
reference implementation of the contract; keeping it passing every scenario
is the regression net while Cyrus specifics change.

## 9. Milestone scope

- **M2:** §1 interface + mock backend registration, §2 spike (blocking),
  §3 layout, §4 register, §5 dispatch + status bridge + reply, §6 timeout.
  Drill (doc 19 §4): real ticket in slykboard UI → real Cyrus opens a real PR.
- **M4 (agent half):** §7 rebase + markBlocked + the mergebot integration from
  doc `13` §8. Drill: two conflicting PRs, second auto-rebases.
