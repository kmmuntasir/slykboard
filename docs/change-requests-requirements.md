# Change Requests — Requirements Specification

| Field | Value |
| --- | --- |
| **Document Status** | Draft v11 — all active CRs (CR-01 … CR-06, CR-08 … CR-12, CR-14, CR-15) delivered (2026-09-25). CR-07 and CR-13 remain deferred by client. |
| **Source** | Client meeting notes, `docs/change-requests.md` |
| **Date** | 2026-09-25 |
| **Baseline** | Slykboard current `main` (PRD: `.docs/basic-PRD.md`) |

## 1. Purpose

This document expands the raw client meeting notes into clarified, testable requirements. Each note is traced to a numbered change request (CR-01 … CR-14, in the order the notes were taken; CR-15 was added from a client follow-up on 2026-09-25), analyzed against the current codebase, and specified with functional requirements, acceptance criteria, impact areas, assumptions, and open questions.

Items marked **Decision required** block final sign-off of that CR; proposed defaults are given so work can proceed once confirmed.

## 2. Current-State Baseline

What exists today (verified against the code, not the PRD):

| Area | Current behavior |
| --- | --- |
| Columns | Stored as `Projects.columns` JSONB (`{id, name}[]`). Full replacement via `PATCH /api/projects/:slug`, gated to **Platform Admin only**. Removing a column that still holds live tickets is blocked. |
| Labels | Already fully implemented: project-scoped CRUD (`/api/projects/:slug/labels`, `/api/labels/:id`), gated to Project Admin, managed in Project Settings (`LabelManager`). |
| Ticket hierarchy | None. All tickets are flat; no `type` or `parentId`. |
| Reports | Per-project, per-user **totals only** (weekly/monthly windows with offset), plus a resolved-tickets-by-priority summary. No breakdown rows, no hierarchy roll-up. |
| Timer exclusivity | One active timer per user **platform-wide** (partial unique index on open rows); starting a new timer auto-stops the previous one. |
| Timer UI | Start/stop and the live elapsed display live on the ticket (`TimerHeroCard` / `TimerControls`, server-time-synced). There is no global timer indicator in the top bar. |
| Ticket fields | `title` required; `statusColumn` required; `description` optional; `priority` defaults to `MEDIUM`; `dueDate` optional; `checklist` optional (default `[]`); labels optional. |
| Entry source display | Each time log row already carries `type: 'manual' \| 'timer'` and is shown in the ticket Time Log. |
| Board card | Shows priority, title, checklist progress, labels, assignee — **no time summary**. |
| Adjustments | Not possible. Timer entries are immutable once closed; manual entries cannot be edited after creation. |

## 3. Requirements

### CR-01 — Project Admin column management

**Source note:** _"Project Admin should be add/modify columns or column order for his project."_

**Status:** **DONE — implemented 2026-09-25.** See Implementation notes below.

**Requirement:** A Project Admin must be able to add columns, rename columns, and change column order for their own project, without involving a Platform Admin.

**Functional requirements**

- FR-01.1: Project Admins (and Platform Admins) may perform column operations on projects they administer. Ordinary Members may not.
- FR-01.2: Supported operations: add a column (at any position), rename a column, reorder columns. Column identity remains `{id, name}` — renaming preserves `id` so `Tickets.statusColumn` references stay stable.
- FR-01.3: Removing a column that still contains live (non-deleted) tickets remains blocked, as today. Removing an empty column is allowed.
- FR-01.4: Project rename and project activation/deactivation remain Platform-Admin-only — this CR touches columns only.
- FR-01.5: Column changes are visible to all project members on the next board refresh (existing 30s polling); no restart required.
- FR-01.6: The Project Settings column manager UI becomes available to Project Admins (currently it renders for Platform Admins only).

**Acceptance criteria**

- As a Project Admin, I can add, rename, and reorder columns from Project Settings and see the change reflected on the board.
- As a Member, all column-management controls are hidden and the API rejects my attempts with `FORBIDDEN`.
- Dragging a ticket into a column never breaks, regardless of column renames/reorders performed after the board was loaded.

**Impact:** `projects.routes.ts` / `projectService.ts` (authorization change, possibly granular column endpoints), `ProjectColumnsManager.tsx` gating, tests.

**Assumptions**

- "Modify" means rename; column deletion (of empty columns) is included since it already exists today for Platform Admins.
- The current full-array replacement API shape may stay; only the authorization tier changes. Granular endpoints are optional refinement.

**Implementation notes (2026-09-25)**

- Backend: new nested route `PATCH /api/projects/:slug/columns` — columns-only body, chain `authenticate` → `validateRequest` → `requireProjectMember` → `requireProjectAdmin` — reusing `projectService.updateProject({ slug, columns })` unchanged. Rename/activation stay on the PA-only `PATCH /api/projects/:slug` (FR-01.4); Zod strips smuggled `name`/`isActive` before the service is called. Platform Admins are admitted without a membership row (existing PA bypass). Service rules unchanged: min-1 columns, unique ids, removing a column with live tickets blocked (`CONFLICT`) — removing an EMPTY column is allowed, settling **OQ-01a per the proposed default**.
- Frontend: new `updateProjectColumns()` API function + `useUpdateProjectColumns` hook (same cache invalidations as rename); `ProjectColumnsManager` now persists through it. `ProjectSettingsPage` gates the rename section to Platform Admins only — a Project Admin sees columns + labels but not rename, fixing the pre-existing mismatch where the UI offered a rename the backend would reject.
- Tests: 12-case route suite (project-admin 200, PA bypass, member/non-member 403, 401, `name`/`isActive` stripping, malformed-body matrix, slug validation) + a permission-matrix row (`ADMIN_PLUS`). Full suites green: backend 880/880, frontend 1063/1063; typecheck, builds, eslint, and prettier clean on all touched files.

---

### CR-02 — Project Admin label management

**Source note:** _"Project Admin needs to be able to add label for his project."_

**Status:** **DONE — verified with client 2026-09-25.** The existing implementation fully satisfies this CR (label CRUD is Project-Admin-gated in API + Project Settings UI); no work was needed. OQ-02a closed: nothing beyond the existing flow was requested.

**Requirement:** A Project Admin must be able to add labels to their project.

**Analysis:** This exists end-to-end today: `POST /api/projects/:slug/labels` requires `PROJECT_ADMIN`, and the Label Manager UI lives in Project Settings. The client may be unaware of the feature location, or may have hit a discoverability problem rather than a capability gap.

**Action**

- Demo the existing flow to the client before scheduling any work.
- If the gap is discoverability, treat as a UX task (e.g., quick label creation from the ticket editor / board filters) — separate small ticket, to be scoped after the demo.

**Acceptance criteria**

- Client confirms the existing Project Settings → Labels flow satisfies the need, or a follow-up UX ticket is created.

**Open questions**

- OQ-02a: Was the client asking for something beyond what exists (e.g., creating labels inline while editing a ticket)? *(Proposed: verify first, then decide.)*

---

### CR-03 — Ticket hierarchy: Epic / Story / Task / Subtask

**Source note:** _"Epic/Story/Task/Subtask needed"_

**Status:** New feature. **DONE — implemented 2026-09-25** (client-confirmed parenting, delete, and board behavior).

**Implementation notes (2026-09-25)**

- **Schema + migration `0003_cr03_ticket_hierarchy.sql`:** `TicketType` enum (`EPIC | STORY | TASK | SUBTASK`), `tickets.type` (default `TASK`, backfills existing rows), `tickets.parent_id` self-FK, indexes on `parent_id` and `(project_id, type)`, plus `PARENT_CHANGED` / `TYPE_CHANGED` activity actions.
- **Services:** rank-ordered parenting enforced in `ticketService` (`assertHierarchyRules` — parent must outrank child, same project, live; subtask requires a parent; self-parent rejected; type changes additionally validated against live children). `recomputeAncestorColumns` walks the parent chain transactionally, deriving each ancestor's column from its least-progressed live child and logging `STATUS_CHANGED` per move. `deleteTicket` cascades the soft-delete through the subtree, closes timers on every affected ticket, and recomputes the orphaned chain. The board payload carries `type`, `parent`, `epic`, `childCount`, `childDoneCount`, and an `epics[]` roll-up list.
- **Frontend:** all four types render as board cards (type badge, epic chip, subtask parent chip + same-column nesting, child-progress + derived-column lock); Type + Parent selectors on create and edit (parent options = strictly-higher-ranked tickets, subtask-parent enforced client- and server-side); type + epic board filters; a Board | Epics view with per-epic completion bars; cascade-delete confirmation lists the descendant tree and requires a second confirmation.
- **Tests:** 6 real-DB integration cases (rank rules, auto-progression cascade, derived-move rejection, re-parent + both-chain recompute, cascade delete, hydration summaries) + pure `earliestChildColumn` unit tests + route validation/pass-through cases; frontend suites extended (hierarchy utils, card decorations, delete tree, type/parent fields, board guard/filters/epics view). Suites green: backend 896, frontend 1093.
- **Deferred to CR-04/CR-05:** tracked-time roll-ups in the Hierarchy panel and the Epics table (the doc's FR-03.5 time component). Child completion progress (done/total) ships here.

**Requirement:** Tickets gain a type and an optional parent, forming a rank-ordered work-breakdown structure: **Epic → Story → Task → Subtask**, where Epic, Story, and Task may all exist at root level.

**Model (client-confirmed)**

- New `type` column on `tickets`: enum `EPIC | STORY | TASK | SUBTASK`, default `TASK` (backfill for existing rows).
- New `parentId` column on `tickets`: self-referencing FK (nullable), `ON DELETE` behavior per FR-03.6.
- Type rank: `EPIC` (3) > `STORY` (2) > `TASK` (1) > `SUBTASK` (0). Parenting rules (enforced at service layer):
  - A ticket may be root iff its type is `EPIC`, `STORY`, or `TASK`; a `SUBTASK` must have a parent.
  - A parent-child link is valid iff the parent's type rank is strictly greater than the child's. Consequences: an Epic can never belong to a Story (or to anything else); a Story can never belong to a Task; a Subtask may sit under an Epic, Story, or Task.
  - Longest chain is Epic → Story → Task → Subtask (depth ≤ 3); cycles are impossible because rank strictly decreases downward.
- Ticket numbering stays per-project and type-agnostic (`SLYK-042` may be an epic; a subtask gets its own number). No per-type sequences.

**Functional requirements**

- FR-03.1: Any project member may create tickets of any type and set/choose the parent within the rules above (creation form shows allowed parents only).
- FR-03.2: Re-parenting an existing ticket is allowed, subject to the same rules; invalid pairings (e.g., an epic under a story, a story under a task, a root-level subtask) are rejected with `VALIDATION_FAILED`.
- FR-03.3: Board behavior by type (OQ-03d — ALL types are board cards):
  - Every type renders as an ordinary board card. Non-TASK types carry a type badge; epics are visually distinct.
  - A parent card (one with live children) shows child progress (done/total) and a derived-column lock hint; it cannot be dragged across columns (FR-03.10).
  - Descendants carry a colored epic chip naming their top-level epic; subtasks show a parent chip and are indented under their parent's card when both sit in the same column.
  - Children are filterable by type (Epic/Story/Task/Subtask) and by epic ("show only EPIC X's work").
- FR-03.4: The board gains a filter: by type (Epic/Story/Task/Subtask) and by Epic ("show only EPIC X's work").
- FR-03.5: Parent tickets show roll-ups: total tracked time (CR-04/05) and child completion progress (`done / total` children, plus checklist progress).
- FR-03.6: Deleting a ticket that has live descendants is allowed but guarded: the confirmation modal first shows the full descendant tree (children, grandchildren, … — display ID, type, title, rendered as a tree) and requires an explicit second confirmation ("also delete these N tickets"). On confirm, the soft-delete cascades to the entire subtree and running timers on every affected ticket are stopped (reusing the existing stop-on-delete hook).
- FR-03.7: Activity log records `PARENT_CHANGED` and `TYPE_CHANGED` actions (old/new values carry ticket references).
- FR-03.8: Beyond board cards, epics are visible in a dedicated "Epics" list/view (e.g., a tab on the board or Reports page) showing each epic's children count, completion %, and tracked time.
- FR-03.9: **Parent auto-progression (client-confirmed):** a ticket's `statusColumn` is system-maintained whenever it has at least one live child — Epics, Stories, AND Tasks alike (OQ-03e). It always equals the earliest board column (per `Projects.columns` order) occupied by any of its live direct children:
  - The parent advances as its least-progressed child advances, and moves backward if a child moves backward or a less-progressed child is added or re-parented in.
  - Recomputed inside the same transaction as the triggering mutation: child created, child moved, child soft-deleted, child re-parented in or out (re-parenting recomputes BOTH the old and the new parent chain).
  - A childless parent (Story/Task with no live children — the common case) keeps its current column and is freely draggable again; a freshly created epic starts in the first column.
  - Auto-moves are logged as ordinary `STATUS_CHANGED` activity rows on the parent, attributed to the user whose action triggered the recompute. The walk stops as soon as an ancestor's column is unchanged (higher ancestors cannot be affected).
- FR-03.10: Manual override is prohibited for tickets WITH live children: API requests that set a derived `statusColumn` are rejected with `VALIDATION_FAILED`, and the board refuses cross-column drags with an explanatory toast. Vertical (within-column) reordering stays allowed for every ticket, and cross-column drags remain allowed for childless tickets.

**Acceptance criteria**

- I can create an Epic, add Stories/Tasks under it, add Subtasks under those, and the rules above reject every illegal shape.
- Filtering the board by an epic shows only its descendants; each card carries the epic chip.
- An epic with children in To Do, In Progress, and Done sits in To Do; moving the To Do child to Done advances the epic to In Progress; when every child is Done the epic is Done; dragging a child backward pulls the epic back. Stories and Tasks with children behave identically.
- Attempting to move a parent with live children across columns — via drag or API — is rejected/disabled, while reordering it within its column works; a childless ticket moves freely again.
- Soft-deleting a leaf ticket removes it (and only it) from the board; its parent's roll-ups update.
- Soft-deleting a parent first shows the descendant-tree confirmation modal; on confirm the whole subtree disappears, all its running timers stop, and no orphaned children remain.
- Time entered on any descendant is reflected in the ancestors' totals (see CR-04).

**Impact:** `schema.ts` (enum + FK + indexes on `parentId`, `type`), `ticketService` (parenting rules, cascade soft-delete, epic column recompute on child mutations), `tickets.routes` + schemas (reject manual epic status changes), board query (parent/epic joins), `TicketCard` (epic styling), `CreateTicketModal`, `TicketDetailModal`, `BoardFilters`, `DeleteTicketConfirm` (descendant-tree confirm modal), activity log enum, migration + backfill (`type = 'TASK'`).

**Assumptions**

- Nesting is bounded by the type ranking (longest chain Epic → Story → Task → Subtask); arbitrary-depth nesting is out of scope.
- Equal-type parenting (Epic under Epic, Story under Story, Task under Task) is forbidden by the strict-rank rule — flagged for client veto if same-type nesting is ever needed.
- Any ticket type — including an Epic — can be time-tracked like any other; its own entries count toward its roll-up.
- "Least progressed" is measured by column order in `Projects.columns` (earliest index) — not by tracked time, checklists, or dates.
- Only direct live children drive a parent's column; grandchild positions influence the epic only through their intermediate parent's (derived) column.
- Childless Story/Task cards (the common case) stay freely draggable — auto-progression only applies while a ticket has children.

**Resolved decisions (client, 2026-09-25)**

- Epic, Story, and Task may all be root level (OQ-03a, OQ-03b).
- Parent delete is not blocked: tree-view confirm modal + cascade soft-delete to the whole subtree (OQ-03c).
- Epics render as board cards and auto-progress: the epic's column always mirrors its least-progressed child.
- Every type — Epic, Story, Task, Subtask — gets a board card (OQ-03d).
- Intermediate parents (Story with Task children, Task with Subtasks) auto-progress exactly like Epics (OQ-03e).

**Open questions**

- None.

---

### CR-04 — Roll-up time report for an Epic/Story/Task

**Source note:** _"Time Tracking Report for Entire Epic/Story/Task is needed"_

**Status:** New feature (depends on CR-03). **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- `reportService.getNodeTimeRollup` — windowed subtree total via one shared entry read (`loadSubtreeEntries`) over the node's live descendants (BFS, depth ≤ 3, soft-deleted excluded). Returns `totalMs` + the **auto/manual split** (OQ-04a applied default: yes) + entry count; running timers contribute 0 (FR-04.5). Exposed as `GET /api/projects/:slug/reports/time/rollup?node=SLYK-42&period&offset&member&source`.
- Effective duration lives in one exported helper (`effectiveDurationMs`) so roll-ups, rows, members, and entries can never disagree — CR-14's adjustment delta folds into that single spot.
- Detail reads (`GET /tickets/:id`, `GET /projects/:slug/tickets/:displayId`) now carry `trackedTotalMs` + `descendantCount` (all-time roll-up, FR-04.2); the detail HierarchyPanel shows "Tracked (incl. sub-tickets)". Kept off the `getTicket` hot path so the resolver middleware is unaffected.
- Reports page mounts `HierarchyTimeReport` sharing the existing period/offset window; node picker offers every epic/story/task.
- Tests: 9 real-DB integration cases (doc acceptance 1h+2h+30m = 3h30m, running-timer/soft-delete/window exclusion, row fold, member split, member + source filters, entries scoping, all-time total, displayId resolution) + 7 route cases (pass-through, defaults, malformed node 400, unknown node 404, non-member 403, anon 401). Backend suite 913/913.

**Functional requirements**

- FR-04.1: Total = sum of effective durations (timer entries incl. CR-14 adjustments + manual entries) of the node and every descendant, within the selected time window.
- FR-04.2: The roll-up is shown in the ticket detail (beside the title, consistent with CR-12) and in the Reports page for any selected epic/story/task.
- FR-04.3: The existing weekly/monthly window selector applies; `window` metadata returned as today.
- FR-04.4: Soft-deleted descendants' time is excluded from the roll-up (they leave the working set).
- FR-04.5: Running timers count as 0 in roll-ups (consistent with today's `totalMs` semantics) until stopped.
- FR-04.6: Roll-ups ship with the auto/manual split (OQ-04a proposed default applied).

**Acceptance criteria**

- Given an epic with two stories (1h + 2h tracked) and 30m tracked on the epic itself, the epic reports 3h 30m.
- Changing the window to "last month" excludes entries logged this week.

**Impact:** `reportService` (subtree roll-up query — fixed max depth 3), Reports page, ticket detail header.

**Open questions**

- OQ-04a: Should roll-ups also split auto vs manual time (a one-line split given CR-11)? *(Proposed: yes.)*

---

### CR-05 — Time-tracking breakdown for an Epic/Story/Task

**Source note:** _"Individual Breakdown of Time Tracking for an Epic/Story/Task"_

**Status:** New feature (depends on CR-03/CR-04). **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- `reportService.getNodeTimeBreakdown` — one row per ticket in the subtree with `ownMs` and `rollupMs` (own + descendants, folded up the ancestor chain), a per-member summary, and the same totals as CR-04; rows arrive sorted by tracked time. `GET .../reports/time/breakdown`.
- `reportService.getNodeTimeEntries` — raw entries behind a row, optionally scoped to that row's subtree (`?ticket=SLYK-43`), each entry labeled Auto/Manual with the CR-14 `adjusted` flag already on the contract (false until CR-14 ships). `GET .../reports/time/entries`.
- Frontend: `NodeBreakdownTable` (own vs tracked columns, local sort toggle, controlled expansion with per-entry source chips) inside `HierarchyTimeReport` (node picker, roll-up summary, member table, member + source filters that recompute every aggregate server-side). 16 component tests; frontend suite 1109/1109.

**Functional requirements**

- FR-05.1: Breakdown view for a node lists one row per descendant ticket: display ID, title, type, own tracked time (children of that child folded in), member split.
- FR-05.2: Each row is expandable to the raw entries (who, when, duration, source: auto/manual, adjustment flag + reason per CR-14).
- FR-05.3: A member-dimension summary is available: per member total across the subtree, with entry counts.
- FR-05.4: Rows are sortable by tracked time and filterable by member, entry source, and window (weekly/monthly as today).

**Acceptance criteria**

- Opening the breakdown for an epic shows per-story rows summing exactly to the CR-04 total.
- Filtering by member X shows only X's entries, and per-row subtotals recompute.

**Impact:** `reportService`, Reports page (new breakdown panel), possibly a dedicated `GET /api/projects/:slug/reports/time/breakdown` endpoint.

**Assumptions**

- Breakdown depth is capped at the hierarchy's fixed depth (3); no arbitrary recursion needed.

---

### CR-06 — Member-wise time report with breakdown

**Source note:** _"Member-wise Time Tracking Report with Breakdown"_

**Status:** **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- `getTimeReport` now aggregates from the SAME windowed entry read + `effectiveDurationMs` as the hierarchy reports, so member totals, ticket rows, and roll-ups can never drift. Each member carries `autoMs`/`manualMs`/`entryCount` plus a `tickets[]` breakdown (display id, title, type, epic reference, split, entry count) sorted by time; member names resolve in one query.
- Route accepts optional `member` + `source` filters that narrow totals AND breakdown rows in the same pass.
- Frontend: extracted `MemberTimeReport` (expandable member rows → per-ticket table with epic reference and auto/manual split, sortable by member total); OQ-06a/OQ-06b defaults applied (weekly/monthly windows kept, no CSV in this CR).
- Tests: 2 new integration cases (per-ticket/epic breakdown + sum-equals-total; member/source filters) + 7 component cases; suites green (backend 920, frontend 1121).

**Requirement:** The existing member-wise time report (per-project totals per member) gains a breakdown: each member row expands to show where the time went.

**Functional requirements**

- FR-06.1: Existing behavior preserved: per-member totals, weekly/monthly window, current project scope.
- FR-06.2: Each member row expands to a per-ticket breakdown: ticket display ID + title, ticket type, parent epic (once CR-03 lands), and time split auto/manual.
- FR-06.3: Rows are sortable (member total, ticket time) and filterable (member, ticket type, entry source).
- FR-06.4: Entries flagged as adjusted (CR-14) use the adjusted duration and are marked.

**Acceptance criteria**

- The sum of a member's breakdown rows equals the member's headline total for the window.
- Filtering to manual-only shows only manually logged time.

**Impact:** `reportService.getTimeReport` (aggregate + detail query), `ReportsPage`, API response shape (additive).

**Open questions**

- OQ-06a: Are the fixed weekly/monthly windows sufficient, or are arbitrary custom date ranges needed? *(Proposed: keep weekly/monthly for this CR; custom ranges as a follow-up if asked.)*
- OQ-06b: Is CSV export of this report needed now? *(Proposed: not in this CR; fast follow-up.)*

---

### CR-07 — Member-wise comparative time chart (segmented bar chart)

**Source note:** _"Member-wise Comparative Time Tracking chart (segmented bar chart) - We need to discuss this - deferred."_

**Status:** Deferred by client (reconfirmed 2026-09-25).

**Requirement:** N/A — explicitly deferred pending a future discussion.

**Notes for that future discussion:** A segmented bar chart (one bar per member, segments = e.g. per-epic or per-ticket-type time) is a pure presentation layer over the CR-06 data. No schema work is blocked by deferring this.

---

### CR-08 — Column-wise time tracking for a ticket

**Source note:** _"Column-wise Time Tracking for Individual Task or Subtask, sortable and filterable (we need to know how long this ticket was in ToDo, then how long it was in 'In Progress', etc)"_

**Status:** New feature. Both metrics confirmed by client (2026-09-25). **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- New `columnTimeService.getColumnTimeReport` derives residence intervals from the ticket's own transition history (the first `STATUS_CHANGED` row's `oldValue` recovers the original column; the open interval runs to `now`, or to `deletedAt` for a deleted ticket), then attributes tracked time to the same intervals: timer entries are split proportionally across every column they overlap, manual entries go to the column occupied at the entry instant. Unknown/legacy column ids render as "Archived column".
- Window (`?period=&offset=`), member and source filters apply: residence is wall-clock and therefore member-independent (only tracked time narrows) — asserted in tests. Effective duration comes from the shared `effectiveDurationMs` (CR-14 folds in there). Endpoint: `GET /:slug/reports/column-time?ticket=SLYK-42&period&offset&member&source`; omitted period = the ticket's whole lifetime.
- Frontend: `ColumnTimePanel` in the ticket-detail Metadata tab — per-column residence (with share %), tracked time, visit count, sortable headers, and window/member/source filters fed by the project roster.
- Legacy-ticket robustness (FR-08.4) falls out of the interval model: a ticket whose history predates activity logging simply has one interval from `createdAt`.
- Tests: 6 real-DB integration cases (per-column order, visits across returns, overlap split, member filter, running timers excluded, 404) + 4 component cases; suites green (backend 944, frontend 1127).

**Requirement:** For any ticket (task or subtask), show per board column both (a) how long the ticket **resided** there (wall-clock, derived from status-transition history) and (b) how much **tracked working time** overlaps that column — in a sortable, filterable table.

**Data source & method**

- Column residence intervals are derived from `activityLogs`: each `STATUS_CHANGED` (and the initial `CREATED`) timestamp starts a new interval in the destination column; the interval ends at the next transition (or `now` for the current column; capped at `deletedAt` for soft-deleted tickets).
- The board columns' display order comes from `Projects.columns`.

**Functional requirements**

- FR-08.1: Table per ticket: one row per column the ticket has ever been in — column name, total residence time, tracked working time, number of separate visits, % of ticket lifetime.
- FR-08.2: Sortable by column order (default), column name, residence duration, or tracked duration; filterable to hide zero/never-visited columns, by member (applies to the tracked-time metric only), and by a date window (only time falling inside the window counts).
- FR-08.6: **Tracked working time per column** (client-confirmed): for each column residence interval, sum the overlapping time entries —
  - Timer entries: overlap duration of the entry's `[startTime, endTime)` with the column interval. A CR-14 adjustment is attributed to the column containing the entry's `endTime` (where the member stopped the timer — matching the phantom-time example).
  - Manual entries (instantaneous rows): attributed to the column the ticket occupied at the entry's creation instant.
  - Per-member filter recomputes tracked time from that member's entries only; wall-clock residence is member-independent.
- FR-08.3: Available in the ticket detail view for Tasks and Subtasks (and any ticket type, harmlessly).
- FR-08.4: Historical robustness: tickets created before activity logging existed get a single synthetic interval from `tickets.createdAt` in their current column until the first logged transition (or `now`).
- FR-08.5: Column renames (CR-01) are reflected automatically because intervals reference column `id`, resolved to the current name at read time. Deleted/unknown column IDs render as "Archived column".

**Acceptance criteria**

- Given a ticket created Monday 10:00 in To Do, moved to In Progress Monday 12:00, moved to Done Tuesday 09:00: the table shows To Do 2h, In Progress 21h, Done (running, if today is Tuesday) — sums match wall-clock.
- Sorting by duration re-orders rows; filtering by "this week" excludes Monday's residence if the week rolled over.
- A 2h timer entry spanning a column boundary splits its time across the two columns' tracked totals by overlap; the member filter isolates one member's tracked time without touching residence times.

**Impact:** New report/service (interval folding over `activityLogs` + time-entry overlap aggregation), ticket detail panel, tests including legacy-ticket backfill and boundary-spanning entries.

**Assumptions**

- Residence time is **wall-clock** ("how long did this ticket sit in X"); tracked time per column is worked time — the two are shown side by side and never summed together.
- Adjustment attribution (FR-08.6: to the column containing the entry's stop time) is a clarified rule, to be confirmed by the client when reviewing the first build.
- Backdating is not supported: since transitions are timestamped at write time, there is no way to rewrite history; manual status fixes after the fact create new intervals.

**Resolved decisions (client, 2026-09-25)**

- Show tracked working time per column alongside wall-clock residence (OQ-08a).

---

### CR-09 — One active timer per member, platform-wide

**Source note:** _"A Member should be able to track time for one ticket only at once - in the whole platform."_

**Status:** Backend behavior confirmed (keep auto-stop); new frontend confirmation UX required.

**Analysis:** Enforced today by a partial unique index (one open `timeEntries` row per user across **all** projects) plus a transactional auto-stop: starting a timer anywhere stops the user's previous running timer first. A concurrent race is mapped to `409 CONFLICT`. The client confirmed the auto-stop semantics stay, but the switch must never happen silently.

**Functional requirements**

- FR-09.1: When a member with a running timer starts a timer on another ticket, the UI first shows a confirmation alert: "You are currently tracking time for **X** (ticket title and display ID). Starting this timer will stop that one." Proceeding calls the existing start endpoint (which auto-stops transactionally); cancelling does nothing.
- FR-09.2: The active-timer payload available to the frontend includes the ticket reference (display ID + title + project slug) so the alert can name the task — today it returns only the raw entry.
- FR-09.3: Backend semantics are unchanged: start remains auto-stop + insert in one transaction; the confirmation is a UX guard, and the `409 CONFLICT` race path remains as defense-in-depth.
- FR-09.4: The confirmation alert also fires when the other timer runs in a different project (platform-wide exclusivity).

**Acceptance criteria**

- With a timer running on ticket A, clicking start on ticket B shows the alert naming A; confirm → B runs, A is stopped and appears in A's Time Log as a closed entry; cancel → A keeps running and no API call was made.
- No silent auto-stop path remains reachable from the UI.

**Resolved decisions (client, 2026-09-25)**

- Keep auto-stop; add explicit confirmation mentioning the currently tracked task (OQ-09a).

---

### CR-10 — Ticket field constraints

**Source note:** _"Ticket Constraints: Required (no Default value): Title, Description, Status, Priority, Due Date (Alternative needed: Start Date and End Date). Optional: Labels, Checklist."_

**Status:** **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- Migration `0004_cr10_required_fields.sql` (backfill runs before every constraint): `end_date` added and backfilled from `due_date`/`created_at`, legacy NULL descriptions set to `''`, `description` and `priority` constraints tightened (the MEDIUM default is dropped), `due_date` renamed to `start_date`, then `start_date` + `end_date` set NOT NULL. Applied to the dev and test databases.
- API: create requires `title`, `description` (non-empty), `statusColumn`, `priority`, `startDate`, `endDate`, with `endDate > startDate` enforced by a shared schema refinement. PATCH accepts the window as optional-but-not-nullable (a move-only patch doesn't resend it) and rejects an inverted window; description can be edited but never cleared (empty legacy strings stay editable).
- Frontend: `StartEndDateFields` (native datetime-local) replaces `DueDateField` on create + edit; Start pre-fills with "right now" and End must be picked; the form schema is mode-aware (`makeTicketFormSchema`) so CREATE requires a description + an explicit priority (no MEDIUM default) while EDIT tolerates legacy blanks. `PrioritySelect` renders a "not set" state for null.
- FR-10.6 overdue chip: cards past their `endDate` show an Overdue badge, except in the project's last column; it self-refreshes each minute.
- OQ-10b: the backfill used the more truthful reading (start = created_at, end = due_date when it is after creation, else created_at) rather than both = created_at — flagged here for client review.
- Tests: 9 route cases for the required-field matrix + 7 form-contract cases + 3 card overdue cases; suites green (backend 938, frontend 1123).

**Requirement:** At ticket creation, Title, Description, Status, Priority, and a date (Due Date, or the Start/End pair — see decision below) are mandatory with **no defaults**. Labels and Checklist remain optional.

**Functional requirements**

- FR-10.1: Create-ticket API and form require: `title`, `description` (non-empty, sanitized rich text), `statusColumn`, `priority` (explicit choice — the `MEDIUM` default is removed from the creation path), `startDate`, and `endDate`.
- FR-10.2: Date model (client-confirmed): two required fields, `startDate` + `endDate`, replacing the single `due_date` (migration). `endDate` acts as the due date everywhere (overdue logic, board cards, filters).
- FR-10.3: Creation form pre-fills **Start with "right now"** (current date-time, editable by the user; the value is still submitted explicitly — the server applies no default). **End must be manually picked** (date-time picker, no default). Validation enforces `endDate > startDate` on create and on every edit.
- FR-10.4: Edit path: required fields can be changed but never cleared (PATCH rejects null/empty for them).
- FR-10.5: Existing tickets are backfilled during migration so `NOT NULL` constraints can be applied. **Decision required — OQ-10b** on backfill values.
- FR-10.6: Overdue visualization (due date passed, ticket not in the last column) is shown on cards — cheap now that dates are always present.
- FR-10.7: `Labels` and `checklist` remain optional, unchanged.

**Acceptance criteria**

- Creating a ticket without any required field fails with `VALIDATION_FAILED` naming the field; the form blocks submit equally.
- The create form opens with Start pre-filled to the current date-time; End is empty and must be picked; an End earlier than or equal to Start is rejected.
- No code path can create a ticket with a defaulted priority — the API requires the value.
- After migration, no live ticket has a null required field.

**Impact:** `schema.ts` (`NOT NULL` changes, possibly new columns), `tickets.schema.ts` (Zod), `CreateTicketModal`, `TicketAttributeForm`, `TicketCard` (overdue badge), migration + backfill script, full test-suite updates.

**Assumptions**

- "Status" = board column, as today (`statusColumn`), already required — unchanged.
- Description "required" means non-empty after HTML sanitization/stripping (not merely a non-null empty string).

**Resolved decisions (client, 2026-09-25)**

- Start + End date pair; Start defaults to "right now" in the form; End is manually picked (OQ-10a).

**Open questions**

- OQ-10b: Backfill for existing tickets — e.g., `startDate = endDate = createdAt`, `priority = MEDIUM` (current default), or a one-time manual data-fix session with the client? *(Proposed: mechanical backfill with those values, then a client review pass on the board.)*

---

### CR-11 — Auto vs manual indicator on every tracking duration

**Source note:** _"A single tracking duration should show whether it was Auto tracked or Manually Input Tracked"_

**Status:** **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- The ticket Time Log already labeled each entry; the new surfaces now do too: roll-up summaries show the auto/manual split, member rows read "1h 20m auto · 30m manual", the CR-05 breakdown carries `ownAutoMs/ownManualMs/rollupAutoMs/rollupManualMs` with a Split column, and expanded entries carry Auto/Manual chips.
- Entries gained the `adjusted` + `adjustmentReason` fields ahead of CR-14 (always false/null today), so the UI contract is stable when adjustments land.

**Requirement:** Everywhere a tracking duration is displayed, it is labeled as auto-tracked (timer) or manually logged.

**Functional requirements**

- FR-11.1: Ticket Time Log already shows this per entry — unchanged.
- FR-11.2: Every new report/breakdown surface (CR-04, CR-05, CR-06, CR-12 summaries where entries are listed) carries the source label.
- FR-11.3: Entries adjusted under CR-14 additionally show an "adjusted" marker (with reason tooltip), distinct from the auto/manual source label.
- FR-11.4: Aggregates that mix sources show a split (e.g., "3h 20m — 2h 50m auto · 30m manual") wherever a total is presented with enough space; otherwise the split appears on row expansion.

**Acceptance criteria**

- No view in the product shows a bare duration for a time entry without its source being discoverable in that view.

---

### CR-12 — Time-tracking summary beside the ticket title

**Source note:** _"Time Tracking summary beside the Ticket Title and Board view"_

**Status:** **DONE — implemented 2026-09-25.**

**Implementation notes (2026-09-25)**

- Board payload gained `trackedTotalMs` (closed entries, this ticket only) and `runningTimer` (userId + startTime) from two batched aggregates — no N+1 (FR-12.4). Effective duration stays server-authoritative; CR-14 folds in via the same SQL.
- `TicketCard` shows a clock badge (hidden at zero with no running timer) that turns emerald + pulsing when ANY member has a timer running, with the live elapsed ticking against the server clock (lazy-seeded keyed sub-component; persisted totals untouched).
- `Modal` gained a `headerAdornment` slot so the detail modal can render the tracked total beside the title WITHOUT changing the dialog's accessible name; parents read "incl. sub-tickets" (the CR-04 roll-up).
- Tests: 5 new boardService aggregate cases + 4 card badge cases + detail/modal adjustments; suites green (backend 918, frontend 1114).

**Requirement:** The total tracked time of a ticket is visible at a glance — beside the title in the ticket detail view and on the board card.

**Functional requirements**

- FR-12.1: Board card shows a compact badge (icon + `3h 20m`) with the ticket's total tracked time (closed entries; adjusted durations per CR-14). Hidden when zero to reduce noise.
- FR-12.2: When a timer is actively running on the ticket (by anyone), the badge shows a live/pulse state and the running elapsed time ticks client-side from the server-synced start (reusing `TimerHeroCard` sync logic).
- FR-12.3: Ticket detail shows the same total beside the title; for parent tickets (CR-03) this is the subtree roll-up (CR-04), labeled "incl. sub-tickets".
- FR-12.4: The board payload includes per-ticket totals from a single aggregate query (no N+1); card render stays under existing polling budget.

**Acceptance criteria**

- Board card badge matches the ticket's Time Log total.
- Starting a timer on a ticket makes the badge go live within one poll cycle on other members' boards.

**Impact:** `boardService` (aggregate join), `TicketCard`, `TicketDetailModal` header, backend/frontend tests.

---

### CR-13 — Recurring tasks

**Source note:** _"Recurring Tasks - need to think about the business logic and decide (Examples: Weekly bKash Lunch Booking [every Thursday 6 pm a PX member needs to send this booking email], Daily Expenses Record [every day a PX member need to finish the daily expenses record at 7 pm])"_

**Status:** **Deferred** (client decision, 2026-09-25) — entirely out of the current scope. The analysis below is retained for the future discussion; no work is scheduled.

**Requirement:** The system can generate tickets on a schedule (e.g., "every Thursday at 18:00", "every day at 19:00") so routine operational duties are tracked and reportable like any other work.

**Proposed business logic (parked — for the future discussion)**

- A **recurrence rule** is attached to a ticket: frequency (`DAILY | WEEKLY | MONTHLY`), for weekly — weekday selection (multi), for monthly — day-of-month, a **time of day**, an optional end condition (date or occurrence count), and an optional default assignee.
- **Generation model — lazy, template-based:** the rule plus the ticket act as a template; concrete instance tickets are materialized ahead of each occurrence (e.g., next occurrence always exists; generate on board load / API access, plus a manual "generate now"). No server cron/scheduler is required for MVP; a daily cron can be added later for stricter guarantees.
- Each generated instance is a normal ticket (full hierarchy support per CR-03, time tracking, completion). Completing an instance never affects future ones.
- **Missed occurrences are not skipped:** if nobody completes Thursday's ticket, it stays overdue; the next instance still generates.
- **Editing semantics:** edits to a generated instance affect only that instance; edits to the template/rule affect only future instances. Generated instances link back to their rule (shown as a recurrence chip on the card).
- **Timezone:** occurrence times are evaluated in a configured timezone (platform setting; per-project override later). The examples (18:00 / 19:00 local) imply a non-UTC business timezone — needs the client's zone.

**Reference functional requirements (parked)**

- FR-13.1: Any member can create a recurring ticket (choose rule + time + assignee) in any project they belong to; Project Admins can edit/cancel any rule, members only their own.
- FR-13.2: Frequency constraints: weekly rules select ≥1 weekday; monthly rules pick a day 1–31 (months lacking the day skip that month — e.g., the 31st); time-of-day is required.
- FR-13.3: Instance tickets carry the template's title (occurrence-dated, e.g., "bKash Lunch Booking — Thu 12 Feb"), description, labels, priority, dates (per CR-10 model), assignee.
- FR-13.4: Cancelling a rule stops future generation; past instances remain for reporting.
- FR-13.5: Recurring instances are identifiable in reports (recurrence chip / filter) so routine work can be separated from project work.
- FR-13.6: Duplicate-generation is prevented (idempotency key = rule + scheduled occurrence timestamp), so concurrent board loads cannot double-create.

**Reference acceptance criteria (parked)**

- A "every Thursday 18:00" rule produces exactly one ticket per Thursday at the configured timezone's 18:00, assigned and dated, even if multiple users open the board simultaneously.
- Cancelling the rule immediately stops future instances; last week's instance and its tracked time remain in reports.

**Impact (when scheduled):** New table(s) (`recurrence_rules` + template linkage on `tickets`), generation service (transactional, idempotent), board/report surfacing, settings for timezone, migration, extensive tests.

**Parked questions (revisit when scheduled)**

- Generation trigger — lazy-on-access (proposed MVP) vs dedicated scheduler (cron/queue) from day one?
- Missed occurrence handling — keep as overdue (proposed) vs auto-skip/auto-close?
- Which timezone(s)? Single platform timezone vs per-project? *(Proposed: single platform setting — likely `Asia/Dhaka` given the examples.)*
- Should instances be created already **due at** the occurrence time (e.g., 18:00) with generation slightly earlier, or generated exactly at the occurrence time? *(Proposed: generated up to 24h ahead, due at the occurrence time.)*
- Reporting — do recurring instances count toward member time reports by default? *(Proposed: yes — they are normal tickets; the filter exists to exclude them when needed.)*

---

### CR-14 — Manual adjustment of auto-tracked time

**Source note:** _"Manual adjustment of auto-tracked time (need to be recorded) [Example: A member starts a task, works for 30 minutes, then for an extreme urgency, he has to leave the desk. He comes back 2 hours later, and then he stops the timer. It shows 2 hours and 30 minutes. He should be perform a manual adjustment - increase or decrease - with a mandatory 'Reason' text field]"_

**Status:** **DONE — implemented 2026-09-25.**

**Requirement:** A member can correct an auto-tracked (timer) entry by increasing or decreasing its duration, with a mandatory reason; the original measurement and every adjustment are preserved for audit.

**Implementation notes (2026-09-25)**

- Migration `0005_cr14_time_adjustments`: nullable `adjustment_minutes` / `adjustment_reason` / `adjusted_by_id` / `adjusted_at` on `TimeEntries` plus the `TIME_ADJUSTED` activity action. `startTime`/`endTime` are never rewritten (FR-14.6).
- `timerService.adjustTimeEntry` validates in one transaction: reason ≥ 10 chars, non-zero whole minutes, closed entry only, timer entries only, owner-or-admin, and effective duration stays > 0 (FR-14.5). Every adjustment appends a `TIME_ADJUSTED` activity row (original ms + signed delta + reason). A second correction overwrites the delta/reason with a mandatory new one and audits it again (OQ-14c settled this way).
- Endpoint `PATCH /api/tickets/:ticketId/timer/entries/:entryId/adjustment` (membership-resolved; the entry must belong to the ticket's scope).
- Effective duration now flows through the single shared `effectiveDurationMs` (the CR-14 hook this document reserved in CR-04/05/06/08): ticket Time Log totals, board badges (SQL aggregate), hierarchy roll-ups, member reports, and column-time tracked splits all use adjusted minutes. The Time Log entry carries `originalDurationMs` + `adjustmentMinutes`/`adjustmentReason`, shows an "Adjusted ±Nm" marker, the original duration, and the reason.
- UI: an Adjust action on closed timer entries only (never running or manual), opening a modal with signed-minutes input and a mandatory reason; one entry at a time, no batch path (FR-14.7).
- Tests: 3 real-DB cases (meeting example + audit row, all guards, re-adjustment) + 4 route cases + 5 component cases; suites green (backend 958, frontend 1141).
- OQ-14b remains open: whether member totals should carry an explicit "includes adjustments" marker (entries are already marked individually).

**Proposed model**

- Timer rows stay immutable. New nullable columns on `timeEntries`: `adjustmentMinutes` (signed integer), `adjustmentReason` (text, mandatory when `adjustmentMinutes` is set), `adjustedById`, `adjustedAt`.
- **Effective duration** = `(endTime − startTime) + adjustmentMinutes`. Validation: effective duration must remain > 0; adjustments on open (running) entries are rejected — stop the timer first.
- One adjustment per entry in this model; a second correction **overwrites with mandatory new reason** — final call pending OQ-14c (single-overwrite vs append-only adjustment history).
- Every adjustment writes an `activityLogs` row (`TIME_ADJUSTED`) on the ticket: who, delta, reason — visible in the existing activity feed.
- All totals, roll-ups, and reports (CR-04/05/06/12) use effective durations and mark adjusted entries (CR-11).

**Functional requirements**

- FR-14.1: The entry owner and Project Admins (and Platform Admins) can adjust a closed timer entry on tickets they can see; other members cannot.
- FR-14.2: Adjustment UI: on a timer entry, "Adjust" opens a small form — signed minutes/hours input (increase or decrease) + reason (min length, e.g., 10 chars; mandatory).
- FR-14.3: The Time Log shows the adjusted duration, an "adjusted" marker, the original duration, and the reason (tooltip/expand).
- FR-14.4: Manual entries (`type: manual`) are out of scope for adjustment in this CR (they are already deliberate inputs); deletion/re-entry remains the path for correcting them.
- FR-14.5: Effective-duration guardrails: cannot adjust to zero/negative; server-side validation, not just UI.
- FR-14.6: Adjustments are auditable: entry-level fields + `TIME_ADJUSTED` activity log rows; nothing silently rewrites `startTime`/`endTime`.
- FR-14.7: Adjustments are strictly **one entry at a time** — no batch/bulk adjustment UI or API, even across entries of the same ticket (client-confirmed).

**Acceptance criteria**

- The meeting example works: 2h30m auto entry → member decreases by 2h with reason → entry shows 30m effective, 2h30m original, reason recorded, activity feed logs it, all reports use 30m.
- Attempting to adjust without a reason (or on a running timer) fails with `VALIDATION_FAILED`.
- A non-owner member's adjust attempt returns `FORBIDDEN`.

**Impact:** `schema.ts` (`timeEntries` columns + migration), `time.routes`/`timerService` (new endpoint, e.g., `PATCH /api/time/entries/:id/adjustment`), `TimeLog.tsx` (UI), activity log enum, report aggregation switch to effective duration, tests.

**Assumptions**

- Adjustment is expressed as a signed delta (matching "increase or decrease"), not a replacement end-time.
- Reasons are plain text (sanitized), visible to anyone who can see the ticket's time log.

**Resolved decisions (client, 2026-09-25)**

- No time limit on adjustments; entries are adjusted individually, one by one — no batch adjustment (OQ-14a).

**Open questions**

- OQ-14b: Should adjusted entries be visually flagged in member totals (e.g., "includes adjustments")? *(Proposed: yes, cheap marker at breakdown level.)*
- OQ-14c: Single adjustment overwriting the previous one (proposed — keeps the schema flat), or append-only adjustment history (full ledger, more schema)?

---

### CR-15 — Global timer indicator in the top bar

**Source:** Client follow-up (2026-09-25, post-meeting): _"If I am currently tracking time for a ticket, the top bar should show a pulsing icon indicating that time tracking is running. Clicking it should show a simple dropdown showing the card title and elapsed time for the current tracking session. I can stop it. And after a while I can start tracking for the same card from the same dropdown. The icon should not be pulsing when not tracking. The dropdown should always show the last tracked card by a user, until he starts tracking another card."_

**Status:** New feature. Depends on CR-09 FR-09.2 (enriched active-timer payload).

**Requirement:** The top bar carries a personal, platform-wide timer widget: a pulsing clock icon while the user's timer is running, opening a dropdown that shows the tracked card with its live elapsed time, lets the user stop the session, and later restart tracking on the same (last tracked) card — or whichever card was tracked most recently.

**Functional requirements**

- FR-15.1: While the signed-in user has a running timer (in any project), the top bar shows a clock icon with a pulsing animation. When no timer is running, the same icon stays visible but static — it is the entry point to the last-tracked-card dropdown. The icon never pulses when nothing is running, and it reflects only the user's own timer (never other members').
- FR-15.2: Clicking the icon opens a dropdown showing the tracked card — ticket title + display ID (+ project name when different from the current one) — and, while tracking, the live elapsed time for the current session, ticking client-side from the server-synced start time (same drift-free mechanism as the ticket's timer card).
- FR-15.3: While tracking, the dropdown offers **Stop**, which ends the session via the existing stop endpoint. The icon stops pulsing; the closed session lands in the ticket's Time Log; the card remains in the dropdown with the finished session's duration and a **Start** action.
- FR-15.4: While not tracking, the dropdown offers **Start** on the last tracked card, beginning a new session on that same ticket via the existing start endpoint. Because no timer is running at that moment, the CR-09 switch-confirmation never triggers from this widget.
- FR-15.5: **Last tracked card:** derived from the user's most recent timer entry (latest `startTime`, platform-wide). It is replaced only when the user starts a timer on a different ticket; manual (non-timer) entries never change it (client-confirmed). Soft-deleted tickets are skipped when resolving it (falls back to the next most recent, else an empty state: "No time tracked yet").
- FR-15.6: State stays in sync across tabs, projects, and entry points: start/stop from the ticket view, another browser tab, or the dropdown itself is reflected in the top bar within the existing polling interval.
- FR-15.7: Clicking the card title in the dropdown navigates to that ticket — its detail modal opens, switching to the ticket's project first if the user is currently viewing a different one (client-confirmed).

**Acceptance criteria**

- Starting a timer on any ticket makes the icon pulse within one poll cycle; the dropdown shows that card and a ticking elapsed time; Stop closes the session (visible in the ticket's Time Log), the pulsing stops, and the card stays in the dropdown with a Start action.
- Restarting the same card from the dropdown begins a second session; the ticket's Time Log shows both.
- Starting a timer on a different ticket replaces the dropdown's card.
- A fresh user (no timer history) sees the static icon and the empty-state dropdown; the icon never pulses for a user who is not tracking.
- Stopping the timer from a ticket view or another tab updates the top-bar icon within one poll cycle.
- Clicking the card title in the dropdown opens that ticket's detail, switching project when it lives in another project.

**Impact:** `TopNav.tsx` (indicator + dropdown widget), timer-state API — extend FR-09.2's enriched active-timer payload into a combined endpoint returning the active session plus the last tracked ticket — React Query polling integration, reuse of the server-time-sync elapsed logic from `TimerHeroCard`, frontend tests.

**Assumptions**

- The icon remains visible when idle (otherwise the last-tracked dropdown would be unreachable); only the pulse is state-dependent.
- A stopped session's duration is frozen at stop time; the running elapsed is display-only until stopped.

**Resolved decisions (client, 2026-09-25)**

- Manual time entries do not update the "last tracked card" — only auto-tracked (timer) sessions do (OQ-15a).
- Clicking the card title in the dropdown navigates to that ticket, opening its detail and switching project if needed (OQ-15b).

---

## 4. Cross-Cutting Concerns

- **Migrations & backfill:** CR-03 (type/parent), CR-10 (required fields), CR-14 (adjustment columns) all need journal-based Drizzle migrations with explicit backfill steps; existing rows must satisfy new `NOT NULL` constraints before indexes are applied. (CR-13 would add a rules table when un-deferred.)
- **Activity log vocabulary:** new actions `PARENT_CHANGED`, `TYPE_CHANGED`, `TIME_ADJUSTED` (enum extension; note the known Drizzle enum-partial-index migration caveat in this repo).
- **Effective duration everywhere:** one definition — timer `(end − start) + adjustmentMinutes`, manual `minutes × 60_000` — used by every surface (ticket log, board badge, all reports, CR-08 tracked-per-column) so numbers can never disagree. Suggest a single shared helper.
- **Permissions summary (deltas only):** Project Admin gains column management (CR-01); Project Admin/owner gain time adjustments (CR-14); all other role boundaries unchanged.
- **Performance:** board payload gains per-ticket time totals (CR-12) and parent/epic chips (CR-03) — must remain single aggregate-query based; reports gain breakdown endpoints with window-scoped filters (index review on `timeEntries.startTime`); the CR-15 top-bar widget polls a lightweight timer-state endpoint on the existing interval.
- **Tests:** every CR's acceptance criteria map to backend integration tests (supertest) plus frontend component tests per repo rules; migration/backfill paths get dedicated test cases.

## 5. Proposed Phasing

| Phase | CRs | Rationale |
| --- | --- | --- |
| 1 — Quick wins | CR-01 ✅, CR-02 ✅, CR-09 ✅, CR-10 ✅, CR-11 ✅, CR-12 ✅, CR-15 ✅ (all done 2026-09-25) | Small, independent, high client visibility; unblock daily usage. |
| 2 — Time integrity & forensics | CR-08 ✅, CR-14 ✅ (both done 2026-09-25) | Make recorded time trustworthy and explainable before building more reporting on it. |
| 3 — Hierarchy & reports | CR-03 ✅, CR-04 ✅, CR-05 ✅ (all done 2026-09-25), CR-06 | Largest chunk; CR-03/04/05 shipped; CR-06 remains. |
| Deferred | CR-07, CR-13 | Per client (2026-09-25): comparative chart and recurring tasks are out of the current scope. |

## 6. Decisions & Remaining Open Questions

### 6.1 Resolved by client (2026-09-25)

| Topic | CR | Decision |
| --- | --- | --- |
| OQ-03a / OQ-03b | CR-03 | Epic, Story, and Task may all be root level; type ranking EPIC > STORY > TASK > SUBTASK governs parenting. |
| OQ-03c | CR-03 | Parent delete allowed with a tree-view confirmation modal; cascades to descendants. |
| Feature | CR-03 | Epics render as board cards; column auto-follows the least-progressed child. |
| Feature | CR-15 | Top-bar timer indicator: pulsing while tracking; dropdown with stop and restart of the last tracked card. |
| OQ-15a | CR-15 | Manual time entries do not update the "last tracked card". |
| OQ-15b | CR-15 | Clicking the dropdown's card title navigates to that ticket. |
| OQ-03d | CR-03 | Epic, Story, Task, and Subtask all render as board cards. |
| OQ-03e | CR-03 | Intermediate parents (Story/Task with children) auto-progress exactly like Epics. |
| OQ-04a | CR-04 | Roll-ups ship with the auto/manual split (proposed default applied at implementation). |
| OQ-06a/b | CR-06 | Weekly/monthly windows kept and no CSV export in this CR (proposed defaults applied). |
| OQ-10b | CR-10 | Backfill applied: start = created_at, end = due_date (floored at created_at) — awaiting client review. |
| Feature | CR-02 | Existing label flow confirmed sufficient; no work needed. |
| OQ-08a | CR-08 | Show tracked working time per column alongside wall-clock residence. |
| OQ-09a | CR-09 | Keep auto-stop; add explicit confirmation naming the currently tracked task. |
| OQ-10a | CR-10 | Start + End dates; Start pre-filled "right now"; End manually picked. |
| OQ-14a | CR-14 | No time limit; one-by-one adjustments only, no batch. |
| Feature | CR-13 | Recurring tasks deferred entirely. |
| Feature | CR-07 | Comparative segmented bar chart reconfirmed deferred. |

### 6.2 Still open

| ID | CR | Question | Proposed default |
| --- | --- | --- | --- |
| OQ-14b | CR-14 | Flag adjusted totals in reports? | Yes |
| OQ-14c | CR-14 | Implemented as a single overwrite with a mandatory new reason (audited each time) |
