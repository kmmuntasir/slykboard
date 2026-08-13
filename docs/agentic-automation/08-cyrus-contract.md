# 08 — Cyrus Contract (Reference Only)

> **Slykboard never talks to Cyrus directly.** This document exists so
> slykboard engineers understand what the dispatcher will transform
> slykboard's ticket payload into, but **no Cyrus-specific code belongs
> in this repo**. All Cyrus interaction is the dispatcher's job.

## Why this matters

When a PM creates a ticket in slykboard, the dispatcher receives the
ticket payload (see `07-dispatcher-contract.md`) and translates it
into a Linear-shape webhook that Cyrus accepts. Cyrus's `/linear-webhook`
endpoint is the entry point — it expects payloads that look exactly
like Linear's webhook events, signed with the Linear webhook secret.

This works because Cyrus was originally built to receive Linear
webhooks. The dispatcher pretends to be Linear (signs with the same
secret, sends the same JSON shape), and Cyrus treats slykboard
tickets exactly like Linear issues.

## What the dispatcher emits to Cyrus (for context)

When slykboard POSTs `ticket_created` to dispatcher, the dispatcher
signs + sends this to `${CYRUS_BASE_URL}/linear-webhook`:

```json
{
  "action": "create",
  "type": "Issue",
  "data": {
    "id": "<slykboard ticket uuid — Cyrus treats this as the Linear issue id>",
    "identifier": "SLYK-42",
    "title": "<slykboard ticket title>",
    "description": "<slykboard ticket description, markdown>",
    "teamId": "<slykboard project slug — fake team UUID>",
    "team": {
      "id": "<same>",
      "key": "<UPPERCASE slug, e.g. INVENTORYTRACKER>",
      "name": "<slykboard project name>"
    },
    "assigneeId": "slykboard-dispatcher",
    "assignee": { "id": "slykboard-dispatcher", "name": "Cyrus" },
    "state": { "id": "uuid", "name": "In Progress" },
    "priority": 3,
    "labels": { "nodes": [ { "name": "feature" } ] },
    "url": "https://slykboard.kmlab.dev/projects/<slug>/tickets/SLYK-42",
    "createdAt": "<ISO 8601>",
    "updatedAt": "<ISO 8601>"
  },
  "url": "https://slykboard.kmlab.dev/projects/<slug>/tickets/SLYK-42",
  "createdAt": "<ISO 8601>",
  "webhookId": "<slykboard project uuid>",
  "webhookTimestamp": <unix ms>,
  "organizationId": "<slykboard workspace uuid>"
}
```

Headers:
```
Content-Type: application/json
Linear-Signature: <hex HMAC-SHA256 of raw body, key = LINEAR_WEBHOOK_SECRET>
Linear-Event: Issue.create
Linear-Delivery: <dispatcher-generated uuid>
User-Agent: slykboard-dispatcher/1.0
```

## Field mapping (slykboard → Linear shape)

| Slykboard field | Linear-shape field | Notes |
|---|---|---|
| `tickets.id` (uuid) | `data.id` | Cyrus uses this for worktree dedup. Must be stable across re-dispatches. |
| `tickets.number` + project prefix | `data.identifier` | e.g. `42` + `SLYK` → `SLYK-42` |
| `tickets.title` | `data.title` | |
| `tickets.description` | `data.description` | Markdown forwarded as-is. |
| `projectAgentMeta.teamKey` | `data.team.key` | Uppercase project slug. Cyrus routes by this. |
| `projectAgentMeta.slug` | `data.team.id`, `data.teamId` | |
| `project.name` | `data.team.name` | |
| `tickets.priority` | `data.priority` | Map: `LOW=0,MEDIUM=1,HIGH=2,URGENT=3,CRITICAL=4` |
| `tickets.labels[].name` | `data.labels.nodes[].name` | |
| `https://slykboard.kmlab.dev/projects/<slug>/tickets/<prefix>-<n>` | `data.url`, top-level `url` | PM-clickable link |

## PM chat → Cyrus

When PM replies in chat, dispatcher forwards to Cyrus as a Linear-
shape `Comment.create` webhook:

```json
{
  "action": "create",
  "type": "Comment",
  "data": {
    "id": "<slykboard message uuid>",
    "body": "<PM message body>",
    "issueId": "<slykboard ticket uuid — same as data.id in Issue.create>",
    "user": { "name": "<PM display name>" },
    "createdAt": "<ISO 8601>"
  },
  "createdAt": "<ISO 8601>",
  "webhookId": "<uuid>",
  "webhookTimestamp": <unix ms>,
  "organizationId": "<workspace uuid>"
}
```

Same signing scheme. Cyrus's existing comment-handling code injects
the body into the running Claude session.

## Cyrus → slykboard (status)

Cyrus does NOT call back to slykboard directly. Status flows:

```
Cyrus → GitHub (opens PR)
GitHub → Dispatcher (PR webhook)
Dispatcher → Slykboard (state callback: PR_OPEN)
```

```
Cyrus → (writes a question to its own /status endpoint)
Dispatcher polls Cyrus /status
Dispatcher → Slykboard (message callback: AGENT message)
```

Slykboard is read-only w.r.t. Cyrus throughout.

## Why slykboard engineers need to know this

Three reasons:

1. **Stable IDs are load-bearing.** Cyrus dedupes worktrees on
   `data.id`. If slykboard regenerates ticket UUIDs on edit, Cyrus
   would see it as a new ticket and spawn a new worktree. Ticket
   UUIDs are immutable in slykboard's existing schema — keep it that
   way.

2. **Identifier format matters.** `SLYK-42` is what Cyrus displays in
   its session log + PR titles + commit messages. The format is
   `<TEAM_KEY>-<n>` where `<n>` is zero-padded to 3 digits on display.
   Don't change this format unilaterally.

3. **Label routing.** Cyrus may eventually route based on labels
   (`bug`, `feature`, `docs`, etc.). Slykboard's existing `Labels`
   table is forwarded verbatim. Don't add slykboard-internal labels
   that look like routing keys (e.g. don't name a label `cyrus-ignore`
   unless you mean it).

## Cyrus writeback to slykboard

For slykboard-origin tickets, Cyrus may try to write back via Linear
OAuth (comment on the "issue"). This **fails silently** with a 404
from Linear's API — the slykboard-origin issue id isn't a real Linear
issue. Cyrus logs the error and moves on. Status flows through the
dispatcher instead.

If this log noise becomes a problem on the Cyrus side, that's a
Cyrus-side fix (Phase 6 cleanup, optional). Slykboard does nothing
about it.

## What slykboard does NOT need to know

- Cyrus's `/linear-webhook` route handler internals.
- Cyrus's signature verification exact code.
- Cyrus's worktree model.
- Cyrus's Claude session management.
- Cyrus's `cyrus self-add-repo` CLI flags.

Those are dispatcher concerns. Slykboard's contract is with the
dispatcher, full stop.
