# 06 — Frontend UI (Agent Mode)

All components feature-gated on `useRuntimeConfig(s => s.agentMode)`.
Plain mode imports zero of these files. The build must not pull agent
code into the plain-mode bundle (use dynamic imports for any cross-
mode shared utility).

## Pages

### `/admin/onboarding` — Add Project page

**Visible:** platform admins only (`is_platform_admin = true`).
Non-admins redirect to `/boards`.

**Form fields** (see `05-backend-routes.md` POST `/api/v1/admin/projects`):

| Field | Component | Notes |
|---|---|---|
| Project name | `<TextInput>` | Display name |
| Slug | `<TextInput>` | Auto-derived from name, editable. URL-safe lower. |
| Subdomain | `<TextInput>` | `<sub>.kmlab.dev`. Validated for uniqueness + reserved list. |
| **Source mode toggle** | `<ToggleSwitch>` | Default: "New from template". Switch right: "Existing repo". |
| GitHub repo URL | `<TextInput>` (conditional) | Shown only when Source mode = Existing. Label: "SSH URL preferred (`git@github.com:org/repo.git`) — HTTPS accepted for PAT-authenticated repos". |
| Stack | `<SelectInput>` | `node-express`, `next`, `python-fastapi`, `go`, `static`. |
| Agent backend | `<SelectInput>` | `cyrus` (default), future options. "Use global default" option = null. |
| Visibility | `<RadioGroup>` | `internal` (default) / `public`. |
| Initial agent context | `<MarkdownTextarea>` (optional) | Becomes `AGENTS.md` seed. Collapsed by default. |

**Submit button** disabled until required fields valid. On submit:
1. POST `/api/v1/admin/projects`.
2. On `201`: redirect to `/admin/projects/:slug/onboarding` (timeline page).
3. On `4xx`: render inline validation errors.
4. On `5xx`: toast "Failed to start onboarding — see project page for details".

**Toggle UX**:

```
┌──────────────────────────────────────────────────────────────┐
│  Source mode                                                  │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                   │
│  │ New from         │  │ Existing repo    │  ← toggle buttons │
│  │ template    [✓]  │  │                  │                   │
│  └──────────────────┘  └──────────────────┘                   │
│                                                               │
│  (when New from template selected, no repo URL field)         │
│                                                               │
│  ── OR ──                                                     │
│                                                               │
│  (when Existing repo selected):                               │
│                                                               │
│  GitHub repo URL *                                            │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ git@github.com:org/repo.git                            │   │
│  └────────────────────────────────────────────────────────┘   │
│  SSH URL preferred (matches Cyrus's GitHub user auth).        │
│  HTTPS accepted for PAT-authenticated repos — operator must   │
│  configure git credential helper on Cyrus separately.         │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### `/admin/projects/:slug/onboarding` — Onboarding Timeline

**Visible:** platform admins only.

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  Project: Inventory Tracker                          [Remove] │
│  Status: PROVISIONING_LXC                                    │
│                                                              │
│  Timeline                                                    │
│                                                              │
│  ✓ Pending                          2 min ago                │
│  ✓ Provisioning LXC                 2 min ago                │
│    → ctid=142, lanIp=192.168.31.142                         │
│  ↻ Wiring GitHub                    1 min ago                │
│  ⋯ Wiring agent                                              │
│  ⋯ Wiring Zoraxy                                             │
│  ⋯ Smoke test                                                │
│  ⋯ Live                                                     │
│                                                              │
│  On error: red badge with detail + "Retry from <step>" btn   │
└──────────────────────────────────────────────────────────────┘
```

Polls `GET /api/v1/me/projects/:slug/onboarding/events` every 3s
while state is in-flight; stops polling when state is terminal
(`LIVE`, `FAILED`, `DECOMMISSIONED`).

### `/admin/projects` — Project Admin List

**Visible:** platform admins only. Lists all projects with their
onboarding state badges. Filter by state. Search by name/slug.

## Components

### `<PipelinePanel>` — Ticket Pipeline Tab

Renders inside the ticket detail page as a tab alongside Comments +
Attachments.

```
Pipeline
─────────────────────────────────────────────────────────────
✓ Task queued                        2 min ago
✓ Agent started (Cyrus session)      2 min ago    · 4m 12s
✓ Pull request #123 opened           6 min ago
✓ Automated tests passed             9 min ago    · 2m 30s
↻ Merging to main                    9 min ago
─────────────────────────────────────────────────────────────
```

Each row = one `PipelineEvent`. Failed terminal states get a red
badge + "Need human help" button.

Empty state: ticket not in pipeline → render "This ticket isn't queued
for agent work" + button "Queue for agent" (sets state to `QUEUED`).

### `<AgentChatPanel>` — PM ↔ Agent Chat Tab

Renders inside ticket detail page as a tab. Visible only when ticket
is in `AGENT_RUNNING`, `AGENT_WAITING`, or any terminal state with
existing messages.

```
Chat
─────────────────────────────────────────────────────────────
                                              (right-aligned)
                                              [PM]
                                              Should this
                                              delete cascade?
                                              2 min ago

(left-aligned)
[Cyrus]
Yes, cascade delete is safe — the schema has
ON DELETE CASCADE on ticket_labels already.
1 min ago

(left-aligned)
[Cyrus, waiting]
Should I add a confirm dialog before deleting?
                                      ↳ Reply input enabled
─────────────────────────────────────────────────────────────
[Reply input box — disabled when state ∉ {AGENT_RUNNING, AGENT_WAITING}]
```

Input box disabled unless `pipelineJobs.state ∈ {AGENT_RUNNING,
AGENT_WAITING}`. Send on Enter (Shift+Enter for newline). Character
counter up to 4000.

`SYSTEM` messages render centered with a subtle background:

```
─────────────────────────────────────────────────────────────
         ⚙ Pull request #123 opened
─────────────────────────────────────────────────────────────
```

Live updates via SSE (`GET /api/v1/me/tickets/:id/events`).

### `<DecommissionDialog>` — Confirmation Modal

Triggered by "Remove" button on the project admin page.

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠ Remove project                                            │
│                                                              │
│  This will:                                                  │
│    • destroy LXC container 142                              │
│    • delete Zoraxy proxy host inventory-tracker.kmlab.dev    │
│    • deregister the repo from the Cyrus agent                │
│    • delete the GitHub repo (created by onboarding)          │
│                                                              │
│  This action cannot be undone.                              │
│                                                              │
│  Type the project slug to confirm:                          │
│  ┌────────────────────────────────────┐                      │
│  │                                    │                      │
│  └────────────────────────────────────┘                      │
│                                                              │
│              [Cancel]   [Remove project] (disabled)         │
└──────────────────────────────────────────────────────────────┘
```

Submit button enables only when typed text matches `project.slug`.
On submit: POST `/api/v1/admin/projects/:slug/decommission` with
`{confirmSlug: <typed>}`.

If `githubRepoCreated === false`, the "delete the GitHub repo" bullet
replaced with "close any open onboarding PR (repo left intact)".

### `<AgentTokenGenerateDialog>`

For generating a new dispatcher HMAC token. Shows raw token **once**
on success with copy button + "I've copied it" gate before
dismissal. Token cannot be retrieved again.

### `<FailedPipelineBadge>` — Inline Ticket Badge

On the ticket card (kanban view) and in the ticket detail header.
Renders when `pipelineJobs.state` is a `FAILED_*` or `BLOCKED_HUMAN`:

```
┌─────────────────────────────────────┐
│  ❌ Failed: tests failed            │
│  Agent will retry up to 2 more times│
└─────────────────────────────────────┘
```

On terminal failure (`BLOCKED_HUMAN`):
```
┌─────────────────────────────────────┐
│  ❌ Blocked: needs human help       │
│  [Need human help]                 │
└─────────────────────────────────────┘
```

"Need human help" → POST to a Slack webhook (configured via
`SLYKBOARD_SLACK_ESCALATION_WEBHOOK` env, optional). If unset, button
is hidden — admin sees in dashboard instead.

## State → plain English mapping

Used by `<PipelinePanel>` and `<FailedPipelineBadge>`:

| State | Plain English |
|---|---|
| `BACKLOG` | Task queued |
| `QUEUED` | Dispatcher acknowledged |
| `AGENT_RUNNING` | Agent started (Cyrus session) |
| `AGENT_WAITING` | Agent has a question for you |
| `PR_OPEN` | Pull request opened |
| `CI_RUNNING` | Automated tests running |
| `MERGING` | Merging to main |
| `CONFLICT_RETRY` | Resolving merge conflict |
| `DEPLOYING` | Deploying to production |
| `DONE` | Deployed |
| `FAILED_AGENT` | Agent couldn't complete |
| `FAILED_CI` | Automated tests failed |
| `FAILED_CONFLICT` | Couldn't resolve merge conflict |
| `FAILED_DEPLOY` | Deploy failed, rolled back |
| `BLOCKED_HUMAN` | Needs human help |

Keep this map in `frontend/src/constants/pipelineStates.ts`.

## Notifications

PM can opt in (per-project) to email when:
- Their ticket reaches `DONE`.
- Their ticket is `BLOCKED_HUMAN`.
- Their ticket entered `AGENT_WAITING` (agent has a question).

No intermediate-state emails. Stored in a new `NotificationPreferences`
table (per user, per project, three booleans). Backend emails via
existing email service (Resend / SendGrid / SMTP — pick whichever
slykboard already uses).

Slack DM optional, gated on Slack SSO being connected (Phase 6).

## Routing

Frontend router gains these routes in agent mode:

```tsx
// frontend/src/App.tsx (paraphrased)
const agentMode = useRuntimeConfig(s => s.agentMode);

<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/boards" element={<BoardPage />} />
  <Route path="/projects/:slug" element={<ProjectPage />} />
  <Route path="/tickets/:id" element={<TicketDetailPage />}>
    <Route path="comments" element={<CommentsTab />} />
    {agentMode && <Route path="pipeline" element={<PipelineTab />} />}
    {agentMode && <Route path="chat" element={<ChatTab />} />}
  </Route>
  {agentMode && <Route path="/admin/onboarding" element={<OnboardingPage />} />}
  {agentMode && <Route path="/admin/projects" element={<AdminProjectsPage />} />}
  {agentMode && <Route path="/admin/projects/:slug" element={<ProjectAdminPage />} />}
  {agentMode && <Route path="/admin/tokens" element={<AdminTokensPage />} />}
</Routes>
```

Plain mode: only the non-`agentMode` routes exist. Tree-shaking strips
the rest.

## Tests

Co-located per AGENTS.md:

```
frontend/src/components/
  AgentChatPanel.tsx
  AgentChatPanel.test.tsx
  PipelinePanel.tsx
  PipelinePanel.test.tsx
  ...
```

Tests must cover:
- Toggle interaction in onboarding form (URL field appears/disappears).
- Validation rules for SSH/HTTPS URLs.
- Chat input enable/disable based on ticket state.
- Decommission dialog: submit button stays disabled until slug matches.
- Feature-gating: components render in agent mode, absent in plain mode
  (test by mocking `useRuntimeConfig`).
