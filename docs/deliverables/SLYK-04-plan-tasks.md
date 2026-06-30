# Task Breakdown — SLYK-04 (Project Deactivation)

**Plan:** `docs/deliverables/SLYK-04-plan.md`
**Ticket:** `docs/deliverables/SLYK-04.md`
**Type:** Feature — reversible soft-hide of a project (Platform Admin only)
**Generated:** 2026-06-30

---

## Summary

SLYK-04 introduces a reversible **deactivate** capability so a Platform Admin can
retire a project without deleting it (the `projects.isActive` column already
exists — **no schema/migration changes**). Deactivation (a) stops every running
timer in the project atomically, (b) hides the project from the picker for
Members/Project Admins, (c) makes every `…/projects/:slug/…` deep link return a
**byte-identical, non-revealing** FORBIDDEN to non-Platform-Admins, while Platform
Admins continue to see deactivated projects (badged "Deactivated") and can
**Reactivate** them. A member whose only project is deactivated lands on an
empty-state ("You have no Projects. Contact Admin") and can still reach the
profile menu / Account Settings.

The work splits into **7 tasks across 3 batches**. Backend and frontend are
mostly disjoint, so most batches parallelize cleanly.

---

## Parallelization Strategy

### Batch model

| Batch | Tasks | Gate | Can run in parallel? |
|-------|-------|------|----------------------|
| **Batch 1** (foundation) | T1, T2 | none | ✅ T1 ∥ T2 — backend timer vs frontend type, fully disjoint |
| **Batch 2** (backend service → route → frontend hooks) | T3, T4, T5 | T1 (for T3), T2 (for T5) | T3 and T5 are disjoint (backend vs frontend) → T3 ∥ T5 once Batch 1 lands; T4 strictly after T3 |
| **Batch 3** (UI) | T6, T7 | T5 (T6), T2 (T7) | ✅ T6 ∥ T7 — disjoint files (`ProjectSettingsPage.tsx` vs `ProjectPicker.tsx`/`ProjectsPage.tsx`) |

### Merge-order rules

1. **Batch 1 merges first** — T1 and T2 are independent primitives; either order.
2. **Batch 2**: T3 must merge **before** T4 (T4's route tests assert T3's service
   contract: transactional `updateProject` + `getProjectBySlug` non-revealing gate).
   T5 depends only on T2 (frontend DTO type) at the unit level and can merge in
   parallel with T3/T4; full-flow integration presumes T4 is merged.
3. **Batch 3**: T6 requires T5's hooks; T7 requires only T2's type. If T5 slips,
   T7 can still ship while T6 waits. T6 and T7 touch disjoint files → any merge
   order within Batch 3.

### Visual dependency diagram

```
                              SLYK-04  Project Deactivation
 ─────────────────────────────────────────────────────────────────────
 Batch 1 (foundation, parallel)        Batch 2 (service→route→hooks)   Batch 3 (UI, parallel)
 ─────────────────────────────────────────────────────────────────────

  ┌──────────────────────┐
  │ T1  timerService     │
  │  stopTimersForProject│
  │  (+ new .test.ts)    │
  └─────────┬────────────┘
            │ (called inside deactivation tx)
            ▼
  ┌──────────────────────┐            ┌──────────────────────┐
  │ T2  FE types         │            │ T3  projectService   │
  │  Project.isActive    │            │  + listProjects      │──┐
  │  UpdateProjectDto    │            │    member filter     │  │
  │   .isActive?         │            │  + getProjectBySlug  │  │ (uses T1)
  └─────────┬────────────┘            │    non-revealing deny│  │
            │                         │  + updateProject tx  │  │
            │                         └──────────┬───────────┘  │
            │                                    │              │
            │                                    ▼              │
            │                         ┌──────────────────────┐  │
            │                         │ T4  routes + Zod     │  │
            │                         │  PATCH /:slug        │  │
            │                         │  isActive (+tests)   │  │
            │                         └──────────┬───────────┘  │
            │                                    │              │
            │              ┌─────────────────────┘              │
            │              ▼                                    │
            │     ┌──────────────────────┐                      │
            └────▶│ T5  FE api + hooks   │◀─────────────────────┘
                  │  useDeactivateProject│
                  │  useReactivateProject│
                  │  (invalidate keys)   │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
  ┌──────────────────────┐         ┌──────────────────────┐
  │ T6  ProjectSettings  │         │ T7  Picker + Projects│
  │  PA-only section     │  ∥      │  Badge (PA) +        │
  │  ConfirmDialog       │         │  member empty-state  │
  │  (deps: T5 + T2)     │         │  + reconcile slug    │
  └──────────────────────┘         │  (deps: T2)          │
                                   └──────────────────────┘
```

### Summary table

| # | Batch | Target File(s) | Dependencies | Can Parallel With |
|---|-------|----------------|--------------|-------------------|
| **T1** | 1 | `backend/src/services/timerService.ts` (CREATE `timerService.test.ts`) | — | T2 |
| **T2** | 1 | `frontend/src/types/project.ts` | — | T1 |
| **T3** | 2 | `backend/src/services/projectService.ts` (append `.test.ts`) | T1 | T5 (disjoint stack) |
| **T4** | 2 | `backend/src/routes/projects.routes.ts`, `projects.schema.ts` (append `.routes.test.ts`) | T3 | T5 (after T3 merges) |
| **T5** | 2 | `frontend/src/api/projects.ts` (verify), `frontend/src/hooks/useDeactivateProject.ts`, `useReactivateProject.ts` (NEW) | T2 | T3, T4 |
| **T6** | 3 | `frontend/src/pages/ProjectSettingsPage.tsx` (CREATE `.test.tsx`) | T5, T2 | T7 |
| **T7** | 3 | `frontend/src/pages/ProjectsPage.tsx`, `frontend/src/components/ProjectPicker.tsx` (CREATE `.test.tsx`) | T2 | T6 |

### Developer assignment tracks (suggested, 2 devs)

- **Track A — Backend dev:** T1 → T3 → T4 (strict backend sequence; T1 is the
  timer primitive, T3 wires it into the service tx, T4 surfaces it over HTTP).
  After T4, free to pair on T6 if frontend is blocked.
- **Track B — Frontend dev:** T2 → T5 → (T6 ∥ T7). T2 unblocks all UI; T5 wires
  the hooks; then T6 (settings section) and T7 (picker/page badges + empty-state
  + slug reconcile) ship in parallel. T7 can start as soon as T2 lands (does not
  wait on T5), so it can overlap with T5.

> **Note on line numbers:** the codebase has drifted slightly from the plan's
> citations. Insertion *anchors* (e.g. "after the PA bypass return, before the
> membership probe") are authoritative; **re-confirm exact line numbers before
> editing.**

---

# Batch 1 — Foundation (parallel)

## T1 — Add `stopTimersForProject` to `timerService` + unit tests (new file)

**Type:** backend / service + unit test
**Dependencies:** None
**Files touched:**
- MODIFY `backend/src/services/timerService.ts`
- CREATE `backend/src/services/timerService.test.ts`
**Parallelizable with:** T2 (frontend types)

### Description

Add a transactional bulk-stop helper that closes every running time entry whose
ticket belongs to a given project. This is the timer-teardown primitive the
`updateProject` deactivation transaction (T3) will call so deactivation stops all
running timers atomically. **This task delivers only the primitive + its unit
tests** — wiring it into `projectService.updateProject` is T3.

#### Why this shape

- `timeEntries` has **no `projectId` column** (`backend/src/db/schema.ts`,
  `timeEntries` definition) — every timer row references `tickets.id`. So "all
  timers in project X" is reached by joining through `tickets.projectId`.
- Mirror the existing `stopTimerForTicket(tx, ticketId)` idiom at
  `backend/src/services/timerService.ts:117-123`:
  ```ts
  export async function stopTimerForTicket(tx: Tx, ticketId: string): Promise<void> {
    await tx
      .update(timeEntries)
      .set({ endTime: new Date() })
      .where(and(eq(timeEntries.ticketId, ticketId), isNull(timeEntries.endTime)));
  }
  ```
  `stopTimersForProject` is the project-scoped analogue: same
  `tx.update(timeEntries).set({ endTime })` pattern, same "only open entries
  (`endTime IS NULL`)" guard, but the `ticketId` predicate becomes
  `inArray(timeEntries.ticketId, <subquery>)`.
- The function accepts the `Tx` alias so it runs **inside the caller's
  transaction** (atomic with the `isActive` flip). `Tx` is already defined at
  `backend/src/services/timerService.ts:8`:
  ```ts
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]>;
  ```
- Only `endTime` is written. `durationMs` is computed at read time
  (`timerService.ts:144-152`), so no duration math is needed. The partial unique
  index `time_entries_one_active` (schema) guarantees at most one open timer per
  user, but a project can have many users each with one open timer — the single
  bulk `UPDATE … WHERE endTime IS NULL` closes all of them.

#### Code to add — `backend/src/services/timerService.ts`

1. **Imports** — extend the existing drizzle import line. Add `inArray`:
   ```ts
   import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
   ```
   `db` (from `'../db/client'`) and `tickets`, `timeEntries` (from
   `'../db/schema'`) are already imported. `Tx` alias already defined. **No new
   imports beyond `inArray`.**

2. **Function** — place it adjacent to `stopTimerForTicket` (directly below it,
   so ticket-scoped and project-scoped bulk-stops sit together):
   ```ts
   // SLYK-04: project-scoped bulk-stop. Closes every running timer whose ticket
   // belongs to projectId. Runs inside the caller's transaction (atomic with the
   // deactivation isActive flip). timeEntries has no projectId column, so the
   // ticket set is resolved via a subquery on tickets.projectId.
   export async function stopTimersForProject(tx: Tx, projectId: string): Promise<void> {
     await tx
       .update(timeEntries)
       .set({ endTime: new Date() })
       .where(
         and(
           isNull(timeEntries.endTime),
           inArray(
             timeEntries.ticketId,
             db.select({ id: tickets.id }).from(tickets).where(eq(tickets.projectId, projectId)),
           ),
         ),
       );
   }
   ```
   Note: the subquery is built with the **module-level `db`** (not `tx`) — it is a
   select query embedded into the `WHERE`, executed in the same statement context
   as the `UPDATE`. This matches the codebase's drizzle idiom for
   `WHERE x IN (SELECT …)`.

#### Tests — CREATE `backend/src/services/timerService.test.ts`

The file does **not** exist today. Mirror the `vi.hoisted` fluent-mock convention
from `backend/src/services/projectService.test.ts:18-132` exactly — a hoisted
`bag` of `vi.fn()`s, a `vi.mock('../db/client', …)` factory that builds a fluent
`db` mock, and a `resetBag()` in `beforeEach`.

Required mock surface for `stopTimersForProject`:
- `db.transaction(async (tx) => …)` → invokes `cb(txMock)`.
- `tx.update(table).set(v).where(w)` → terminal; resolve to `Promise<[]>`.
- The `.where(...)` predicate carries the `inArray(..., db.select(...))` subquery
  — the mock must accept an arbitrary `where` arg without inspecting it (the
  subquery object is opaque to the mock). Capture the `set` arg to assert
  `endTime` is a `Date`, and capture the `where` arg (as a captured value, not
  introspected) to assert it was passed.

**Test cases (one behavior per `it`, table-driven where natural):**

1. **Calls `tx.update(timeEntries).set({ endTime: <Date> })`** — assert the table
   arg is `timeEntries`, the `set` object has an `endTime` key that is a `Date`.
2. **Passes a `where` predicate** — assert `.where(...)` was invoked (predicate
   composition is the DB's job; the mock cannot meaningfully evaluate drizzle's
   SQL AST).
3. **Table-driven: invoked with several projectIds** (`'p1'`, `'p-active'`, `''`)
   — assert each call routes the `projectId` through; `update`/`set`/`where` fire
   exactly once each per invocation (no double-close, no scan-all).
4. **Resolves to `void`** — `expect(result).toBeUndefined()`; UPDATE terminal
   mock resolves `[]`.
5. **Idempotency semantics:** re-running when no timers are open still issues the
   same single statement (no select-then-update refactor; the SQL
   `WHERE endTime IS NULL` handles the empty case natively). Assert `tx.update`
   is called exactly once even with zero open timers.
6. **Runs inside a transaction** (call-shape guard): a thin wrapper test that
   calls `stopTimersForProject` from within
   `db.transaction(async (tx) => stopTimersForProject(tx, 'p1'))` and asserts the
   `tx` passed to the helper is the transaction client mock — documents the
   contract that this function is **only** ever called transactionally.

**Mock wiring skeleton** (adapt the `projectService.test.ts:18-132` bag):
```ts
const bag = vi.hoisted(() => ({
  txUpdateSetArg: {} as Record<string, unknown>,
  txUpdateWhereCalled: vi.fn(),
  txUpdateTable: null as unknown,
  dbTransaction: vi.fn(),
}));

vi.mock('../db/client', () => {
  const tx = {
    update: (table: unknown) => {
      bag.txUpdateTable = table;
      return {
        set: (v: Record<string, unknown>) => {
          bag.txUpdateSetArg = v;
          return { where: () => (bag.txUpdateWhereCalled(), Promise.resolve([])) };
        },
      };
    },
  };
  const db = {
    select: vi.fn(() => ({ from: () => ({ where: () => ({}) }) })), // opaque subquery builder
    transaction: vi.fn(async (cb) => bag.dbTransaction(cb(tx))),
  };
  return { db };
});
```

### Acceptance Criteria

- [ ] `backend/src/services/timerService.ts` exports
      `stopTimersForProject(tx: Tx, projectId: string): Promise<void>`.
- [ ] Implementation issues the drizzle shape:
      `tx.update(timeEntries).set({ endTime: new Date() }).where(and(isNull(timeEntries.endTime), inArray(timeEntries.ticketId, db.select({id: tickets.id}).from(tickets).where(eq(tickets.projectId, projectId)))))`.
- [ ] Only `endTime` is set — no `durationMs`, no per-row math.
- [ ] The `inArray` import is added to the drizzle import line; no other import
      changes (`db`, `tickets`, `timeEntries`, `and`, `eq`, `isNull`, `Tx` already in scope).
- [ ] Function is placed adjacent to `stopTimerForTicket`.
- [ ] `backend/src/services/timerService.test.ts` exists, co-located with source.
- [ ] Test file uses the `vi.hoisted` bag + `vi.mock('../db/client', …)` fluent-mock
      convention mirrored from `projectService.test.ts:18-132` (NOT a different style).
- [ ] Tests assert: `.update(timeEntries)` table arg; `.set({ endTime: <Date> })`;
      `.where(...)` invoked exactly once per call; resolves to `undefined`; one
      statement issued regardless of open-timer count.
- [ ] `npm test -- backend/src/services/timerService.test.ts` passes.
- [ ] No changes to any other backend file (NOT `projectService.ts`, routes, or
      schema) — this task is primitive-only.

### Subtasks

1. Add `inArray` to the drizzle-orm import at `timerService.ts:1`.
2. Add `stopTimersForProject` below `stopTimerForTicket`.
3. Create `timerService.test.ts` with the hoisted-bag fluent mock and the test
   cases above.
4. Run `npm test -- backend/src/services/timerService.test.ts`; confirm green.

### Dependencies

**None.** Downstream: T3 (`updateProject` deactivation transaction) depends on this.

---

## T2 — Extend frontend `Project` type and `UpdateProjectDto` with `isActive`

**Type:** frontend / types
**Dependencies:** None
**Files touched:**
- MODIFY `frontend/src/types/project.ts`
**Parallelizable with:** T1 (backend timer)

### Description

Make the project's deactivation state representable on the frontend so downstream
tasks (API client + hook wrappers T5, `ProjectSettingsPage` section T6,
`ProjectPicker`/`ProjectsPage` badges T7) can consume `project.isActive`. This
task is **types-only** — no component, hook, or API call changes.

#### Why

The backend `projects.isActive` boolean column already exists. Once the SLYK-04
backend ships, `GET /api/projects` and `GET /api/projects/:slug` will carry
`isActive` on every row, and `PATCH /api/projects/:slug` will accept `isActive`
in the body. The frontend types must be ready to receive and send that field.

This is a pure, additive type change with no runtime impact — it can land ahead
of the backend and ahead of any UI task.

#### Current state (verified — `frontend/src/types/project.ts`)

```ts
// :3-13
export interface Column { id: string; name: string; }
export interface Project {
  id: string;
  name: string;
  slug: string;
  columns: Column[];
  creatorId: string;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

// :19-23
export interface UpdateProjectDto {
  name?: string;
  columns?: Column[];
}
```

Neither mentions `isActive` today.

#### Changes

1. **`Project` interface (`:5-13`)** — add `isActive: boolean` as a **required**
   field (the backend always returns it). Place it near `creatorId`/`updatedAt`
   (lifecycle/state metadata):
   ```ts
   export interface Project {
     id: string;
     name: string;
     slug: string;
     columns: Column[];
     creatorId: string;
     isActive: boolean; // SLYK-04: false = deactivated (soft-hidden, timers stopped)
     createdAt: string; // ISO timestamp
     updatedAt: string;
   }
   ```
2. **`UpdateProjectDto` (`:19-23`)** — add `isActive?: boolean` as **optional**
   (the PATCH body is partial):
   ```ts
   // F27/SLYK-04: PATCH /api/projects/:slug. Platform-Admin-only. Server blocks
   // deleting a column that still has live tickets (CONFLICT), enforces min-1
   // columns, and on isActive=false atomically stops all running timers in the
   // project.
   export interface UpdateProjectDto {
     name?: string;
     columns?: Column[];
     isActive?: boolean; // SLYK-04: deactivate (false) / reactivate (true)
   }
   ```
   Update the doc comment above `UpdateProjectDto` to mention the SLYK-04
   `isActive` toggle and the Platform-Admin-only gate.

#### Cross-check: does any existing consumer break?

Both additions are additive. Existing `updateProject` callers pass only
`{ name }` / `{ columns }` — an optional field cannot break them. `Project.isActive`
becomes required, which will flag any mock/test fixture that constructs a
`Project` literal without `isActive` — that is **intended** (it surfaces fixtures
the downstream UI tasks must update). Search scope: `frontend/src/types/project.ts`
only. Fixtures elsewhere are owned by their respective UI tasks (T6/T7) and are
**out of scope** here.

### Acceptance Criteria

- [ ] `Project` interface has `isActive: boolean` (required), adjacent to
      `creatorId`/`updatedAt`.
- [ ] `UpdateProjectDto` interface has `isActive?: boolean` (optional), after `columns?`.
- [ ] The doc comment above `UpdateProjectDto` documents the `isActive` toggle and
      the Platform-Admin-only gate.
- [ ] `npx tsc --noEmit` (frontend) compiles the type change itself. (Expected:
      `Project` literal fixtures omitting `isActive` will now error; those are
      **expected** and owned by downstream UI tasks — list them in completion notes,
      do not fix them here.)
- [ ] No other file modified — types-only. (Do NOT touch `api/projects.ts`,
      hooks, `ProjectSettingsPage`, `ProjectPicker`, `ProjectsPage`.)
- [ ] Backward-compatible at the wire level: `name`/`columns` remain optional; no
      field removed or renamed.

### Subtasks

1. Add `isActive: boolean` to `Project`.
2. Add `isActive?: boolean` to `UpdateProjectDto`; refresh its doc comment.
3. Run `npx tsc --noEmit` in `frontend/`; capture (do not fix) any
   `isActive`-missing fixture errors in the task notes for downstream UI tasks.

### Dependencies

**None.** Foundation for T5, T6, T7; disjoint from T1.

---

# Batch 2 — Service → Route → Hooks

## T3 — Backend `projectService`: non-revealing `isActive` gate, member list filter, transactional deactivation/reactivation

**Type:** MODIFY · **Dependencies:** T1 · **Parallel with:** T5

### Description

Three behavior changes in `backend/src/services/projectService.ts`, all
preserving the codebase's **anti-oracle / non-revealing** philosophy (a non-PA
must not distinguish "deactivated" from "never existed" / "not a member").
Deactivation must atomically stop every running timer. No schema/migration
changes — `projects.isActive` already exists.

**Files:**
- `backend/src/services/projectService.ts` (EDIT — `listProjects`,
  `getProjectBySlug`, `updateProject`)
- `backend/src/services/projectService.test.ts` (EDIT — append `describe` blocks)

**Imports:** `eq`, `and` already imported (`projectService.ts:2`). Add
`import { stopTimersForProject } from './timerService';`. `inArray` is NOT needed
here (it's internal to `stopTimersForProject`, owned by T1).

#### 3a. `listProjects` — member branch `isActive` filter (`projectService.ts:101-126`)

The PA branch (`:106`, `db.select().from(projects).orderBy(projects.createdAt)`)
is **unchanged** — Platform Admins see deactivated rows (badged in UI).

In the member branch (`:110-124`), the `.where(eq(projectMembers.userId, userId))`
must become
`.where(and(eq(projectMembers.userId, userId), eq(projects.isActive, true)))`.
Wrap the existing predicate in `and(...)` — do not replace it.

**Update the stale deferral comment** at `:108-109` (currently "deactivation
behavior is owned by DEL-04; here we only scope") to reflect that the filter is
now applied, e.g. *"Members see only active projects — deactivated rows are
hidden (SLYK-04). Platform Admins bypass this filter."*

#### 3b. `getProjectBySlug` — non-revealing `isActive` gate (`projectService.ts:131-167`)

Insert the gate **after** the PA bypass return (`:149-151`,
`if (isPlatformAdmin === true) return row;`) and **before** the membership probe
(`:155`, `const allowed = await db.transaction(...)`):

```ts
// SLYK-04: deactivated projects are indistinguishable from not-found /
// non-member for non-PAs (anti-oracle). PAs already returned above.
if (!row.isActive) {
  throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
}
```

This must use the **byte-identical** literal already used by the not-found throw
(`:145`) and the non-member throw (`:157`) — both are
`new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')`. Do
**not** introduce a distinct error code or message. Do **not** gate the PA branch.

> ⚠️ Placement is critical: PAs must NOT be denied (gate goes *after* the
> `isPlatformAdmin === true` early-return). The no-user overload
> (`userId === undefined`, `:139-141`) must remain untouched — it is the
> slug-uniqueness probe and must NOT throw on deactivated rows.

#### 3c. `updateProject` — transactional deactivation/reactivation (`projectService.ts:172-234`)

`updateProject` is currently **not** transactional. Wrap the whole body in
`db.transaction(async (tx) => { ... })`, mirroring `createProject` (`:79-99`). All
existing reads/writes (column-removal ticket-count probe, the final `db.update`)
run inside the tx and use `tx` instead of `db`.

**Input extension** — add optional `isActive?: boolean` to `args`:
```ts
export async function updateProject(args: {
  slug: string;
  name?: string;
  columns?: Column[];
  isActive?: boolean;
}): Promise<ProjectRow> {
```

**Timer teardown ordering (critical):** when `args.isActive === false`, call
`await stopTimersForProject(tx, project.id)` **inside the tx, before the
`.update`**. When `args.isActive === true` (reactivate), do **not** call it —
stopped timers remain stopped (data preserved). Build `updateSet.isActive` only
when provided:

```ts
const updateSet: Partial<ProjectRow> = { updatedAt: new Date() };
// ...existing name/columns population...
if (args.isActive !== undefined) {
  updateSet.isActive = args.isActive;
  if (args.isActive === false) {
    await stopTimersForProject(tx, project.id);
  }
}
```

The existing column-removal probe loop (the `removed` loop) currently uses bare
`db.select` — switch those to `tx.select`. The final `db.update(...).returning()`
becomes `tx.update(...).returning()` and the result is returned from the tx
callback (`return await db.transaction(async (tx) => { ... return updated!; })`).

`stopTimersForProject` is imported from `./timerService` (delivered by T1).

#### 3d. Coupling verification subtask — id-keyed routes (`resolveProject.ts`)

`backend/src/middleware/resolveProject.ts` does **not** call `getProjectBySlug` —
it re-implements the membership decision via `authorizeProjectAccess` for
id-keyed routes (ticket/label by id). Audit every id-resolved route and confirm
each is reachable **only** behind a `requireProjectMember` slug-gate (which calls
`getProjectBySlug` and thus hits the new `isActive` deny).

For any id-resolved route reachable **without** a preceding slug-gate, mirror the
non-revealing deny inside `resolveProject.authorizeProjectAccess`: after resolving
the project from the id, if `!project.isActive && !isPlatformAdmin`, throw
`new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')`
(same literal). Report findings (paths verified + any route that needed the
mirrored gate) in the task's verification notes. **Investigation-first; only edit
`resolveProject.ts` if a gap is found.**

#### 3e. Tests — append to `backend/src/services/projectService.test.ts`

The file already exists with a fluent-mock `db` bag (`dbUpdateReturning`,
`dbUpdateSetArg`, `txInserts`) supporting the update path. Append new
`describe` blocks. For the timer-delegation assertion, mock `./timerService` via
`vi.mock('./timerService', () => ({ stopTimersForProject: vi.fn() }))` and assert
it is/isn't called within the same tx.

- **`describe('updateProject — deactivation')`** (table-driven):
  - `active → inactive`: passes `isActive: false`; asserts the `tx.update` `set`
    arg carries `isActive: false` AND `stopTimersForProject` invoked once with
    `(tx, project.id)`.
  - `already-inactive idempotency`: project row already `isActive: false`;
    passing `isActive: false` still writes (updatedAt bumps) and
    `stopTimersForProject` still called once (idempotent bulk stop — closing
    already-closed timers is a no-op at the SQL level).
  - `name + isActive:false combined`: both fields land in the `set` arg; timer
    stop still fires.
- **`describe('updateProject — reactivation')`**:
  - `inactive → active`: passes `isActive: true`; asserts `set` carries
    `isActive: true` and `stopTimersForProject` was **NOT** called.
- **`describe('listProjects — isActive filter')`**:
  - Member branch: seed two rows where one `isActive: false`; assert only the
    active row is returned (assert the `.where` arg shape via the mock harness).
  - PA branch: assert the query is unchanged (`db.select().from(projects).orderBy`,
    no `.where`) — both rows visible.
- **`describe('getProjectBySlug — deactivated deny')`**:
  - Non-PA on a deactivated row (`isActive: false`) throws
    `AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')` —
    byte-identical to the existing non-member/not-found throw.
  - PA on the same deactivated row returns the row unchanged (gate is after the
    bypass).
  - No-user overload (`userId === undefined`) still returns the deactivated row
    as `row ?? null` (uniqueness-probe path unaffected — do NOT gate it).

### Acceptance Criteria

- [ ] `listProjects` member branch `.where` wraps the existing
      `eq(projectMembers.userId, userId)` in `and(..., eq(projects.isActive, true))`;
      PA branch unchanged; stale comment updated.
- [ ] `getProjectBySlug` throws the byte-identical FORBIDDEN literal on
      `!row.isActive` for non-PAs, inserted **after** the PA bypass return and
      **before** the membership probe; PA path and no-user overload unchanged.
- [ ] `updateProject` body runs inside `db.transaction`; accepts optional
      `isActive`; writes `isActive` into the update set only when provided.
- [ ] When `isActive === false`, `stopTimersForProject(tx, project.id)` is awaited
      **inside the tx before the `.update`**; when `isActive === true`, it is never
      called.
- [ ] Slug remains non-editable; existing column-removal ticket-count probe +
      validation behavior preserved (now via `tx`).
- [ ] `projectService.test.ts` green for all new cases; `npm test -- projectService`
      clean; `tsc` clean; no `any`.
- [ ] Subtask 3d: report lists every id-resolved route audited; any ungated route
      has the mirrored non-revealing deny (or an explicit "no gap found" note).

### Subtasks

1. Add `import { stopTimersForProject } from './timerService';` to `projectService.ts`.
2. Update `listProjects` member branch `.where` + comment.
3. Insert the `!row.isActive` non-revealing gate in `getProjectBySlug`.
4. Extend `updateProject` signature with `isActive?: boolean`.
5. Wrap `updateProject` in `db.transaction`; convert internal `db.*` to `tx.*`.
6. Wire `stopTimersForProject` ordering (false → call before update; true → no call).
7. Audit id-keyed routes via `resolveProject.ts`; mirror the deny only if a gap is
   found; document findings.
8. Append the four `describe` blocks to `projectService.test.ts`; add the
   `vi.mock('./timerService', ...)` harness.

### Dependencies

- **T1** — `stopTimersForProject(tx, projectId)` must exist in `timerService.ts`
  before this task can import/call it.

---

## T4 — Backend `projects` route + Zod schema: extend `PATCH /:slug` with `isActive` + route tests

**Type:** MODIFY · **Dependencies:** T3 · **Parallel with:** T5

### Description

Surface the deactivation/reactivation capability over HTTP by extending the
existing PA-only `PATCH /api/projects/:slug` endpoint to accept an optional
`isActive` flag, mirroring the user-deactivation precedent
(`PATCH /:userId/blocked` + `setUserBlocked`). No new route, no new middleware —
the existing `authenticate → requirePlatformAdmin() → validateRequest` stack
already gates the toggle to Platform Admins only.

**Files:**
- `backend/src/routes/projects.schema.ts` (EDIT — `updateProjectBodySchema`, `:40-51`)
- `backend/src/routes/projects.routes.ts` (EDIT — `PATCH /:slug` handler, `:177-198`)
- `backend/src/routes/projects.routes.test.ts` (EDIT — append cases)

#### 4a. Zod schema — `updateProjectBodySchema` (`projects.schema.ts:40-51`)

Add `isActive: z.boolean().optional()`. Keep `name` and `columns` exactly as-is.
The derived `UpdateProjectBody` type picks up `isActive?: boolean` automatically.

```ts
export const updateProjectBodySchema = z.object({
  name: z.string().min(1, 'Name must be ≥1 char').max(100, 'Name must be ≤100 chars').optional(),
  columns: z.array(/* unchanged */).min(1).refine(/* unchanged */).optional(),
  isActive: z.boolean().optional(),
});
```

#### 4b. Route handler — `PATCH /:slug` (`projects.routes.ts:177-198`)

Pass `isActive: body.isActive` through to `projectService.updateProject`. The
middleware stack is unchanged — `requirePlatformAdmin()` already restricts this to
Platform Admins (`:181`), satisfying "Platform Admins only; Project Admins must
NOT be able to deactivate." Mirror `users.routes.ts` `PATCH /:userId/blocked`
(`:62-78`) and `setUserBlocked` (`userService.ts:194-211`).

```ts
const updated = await projectService.updateProject({
  slug,
  name: body.name,
  columns: body.columns,
  isActive: body.isActive,
});
```

Because `updateProject` is wrapped in a transaction by T3 and calls
`stopTimersForProject` when `isActive === false`, the route needs **no** timer
logic of its own.

#### 4c. Route tests — append to `projects.routes.test.ts`

The test file already mocks `projectService` wholesale
(`vi.mock('../services/projectService', …)` around `:55-60`) and declares the
byte-identical `FORBIDDEN_PROJECT` constant (`:91-95`). `mockedUpdate` is already
wired. Reuse these.

Append `describe('PATCH /:slug — deactivation/reactivation')`:

- **Deactivate as PA → 200:** `PATCH /:slug { isActive: false }` with a PA token →
  `200`; `mockedUpdate` called with `{ slug, isActive: false }`; response echoes
  the updated row.
- **Deactivate as non-PA → 403:** same body with a Member / Project-Admin token →
  `403` from `requirePlatformAdmin` (assert `mockedUpdate` NOT called). Table-drive
  across Member and Project-Admin roles.
- **Reactivate as PA → 200:** `PATCH /:slug { isActive: true }` with a PA token →
  `200`; `mockedUpdate` called with `{ slug, isActive: true }`.
- **Combined update:** `PATCH /:slug { name: 'New', isActive: false }` →
  `mockedUpdate` called with both fields.
- **Validation:** `PATCH /:slug { isActive: 'true' }` (string) → `400` from
  `validateRequest` (Zod `z.boolean()` rejects strings).
- **`isActive: undefined` / omitted:** existing behavior unchanged (no `isActive`
  in the service call's args — assert `mockedUpdate` called without `isActive` or
  with `undefined`).

Append `describe('deep-link deny — deactivated project')`. Because the test mocks
`projectService.getProjectBySlug`, simulate a deactivated project by overriding
`mockedGetBySlug` per-test to **reject** with `FORBIDDEN_PROJECT` (the service
contract from T3 makes the deactivated deny byte-identical to not-found/non-member,
so the route-level test asserts the middleware propagates that throw). For each of
`GET /:slug`, `GET /:slug/board`, `GET /:slug/tickets/:displayId` (well-formed ref
like `SLYK-1`):

- **Non-PA → 403 byte-identical:** assert the response body equals the body
  produced by a non-member access of a random slug (deep-equal against the
  `FORBIDDEN_PROJECT`-shaped body — same `error.code` + same `error.message`). This
  is the anti-oracle test.
- **PA → 200 / passes through:** `mockedGetBySlug.mockResolvedValueOnce(deactivatedRow)`
  with a PA token → request succeeds (PA bypass; gate is after the bypass per T3).
- **Reactivate restores access:** after a `PATCH /:slug { isActive: true }` (PA),
  a previously-denying deep link for a non-PA now resolves (reset
  `mockedGetBySlug` to resolve the row normally) → 200.

The deactivated-row fixture extends the existing `projectRow` (around `:97`) with
`isActive: false` (or override `mockedGetBySlug` to reject, since the contract is
identical).

### Acceptance Criteria

- [ ] `updateProjectBodySchema` includes `isActive: z.boolean().optional()`;
      `UpdateProjectBody` derives `isActive?: boolean`.
- [ ] `PATCH /:slug` handler passes `isActive: body.isActive` into
      `projectService.updateProject`; middleware stack unchanged.
- [ ] Non-PA (Member and Project-Admin) requests to `PATCH /:slug { isActive }` →
      `403` from `requirePlatformAdmin`; `updateProject` not called.
- [ ] PA `PATCH /:slug { isActive: false }` → `200`; PA
      `PATCH /:slug { isActive: true }` → `200`.
- [ ] `isActive: 'true'` (non-boolean) → `400` from `validateRequest`.
- [ ] Deep-link deny: deactivated project as non-PA → `403` body **byte-identical**
      to the non-member FORBIDDEN (`FORBIDDEN_PROJECT` at `:91-95`); PA still
      reaches the deactivated row.
- [ ] Reactivate (`{ isActive: true }`) restores a previously-denying non-PA deep
      link to `200`.
- [ ] `npm test -- projects.routes` green; `tsc` clean; no `any`.

### Subtasks

1. Add `isActive: z.boolean().optional()` to `updateProjectBodySchema`.
2. Pass `isActive: body.isActive` in the `PATCH /:slug` handler's `updateProject` call.
3. Append `PATCH /:slug — deactivation/reactivation` `describe` block (PA 200,
   non-PA 403 table-driven, reactivate, combined, validation, omitted).
4. Append `deep-link deny — deactivated project` `describe` block (`GET /:slug`,
   `/board`, `/tickets/:displayId` — non-PA byte-identical 403, PA 200,
   reactivate-restores).

### Dependencies

- **T3** — relies on T3's transactional `updateProject` (calls
  `stopTimersForProject` on deactivation) and the `getProjectBySlug` non-revealing
  gate that produces the byte-identical FORBIDDEN the deep-link tests assert.

---

## T5 — Frontend API client + reactivate/deactivate hooks

**Type:** MODIFY · **Dependencies:** T2 · **Parallel with:** T3, T4

### Description

Wire the frontend to the extended `PATCH /:slug` endpoint. **No new API verb** —
`updateProject` already PATCHes `/projects/:slug`
(`frontend/src/api/projects.ts:20-26`) and will carry `isActive` once the DTO is
extended (T2). Add thin, intent-specific mutation hooks that wrap `updateProject`
and invalidate the right caches.

**Files:**
- `frontend/src/api/projects.ts` (VERIFY — `updateProject` already generic over
  `UpdateProjectDto`; confirm no literal field allowlist blocks `isActive`)
- `frontend/src/hooks/useUpdateProject.ts` (REFERENCE — invalidation +
  `meta.revertMessage` pattern to mirror)
- `frontend/src/hooks/useDeactivateProject.ts` (NEW)
- `frontend/src/hooks/useReactivateProject.ts` (NEW) — *or* a single
  `useToggleProjectActive.ts` (see Alternative)
- `frontend/src/api/queryKeys.ts:1-5` (REFERENCE — `projectKeys.detail(slug)`,
  `projectKeys.lists()`)

#### 5a. Verify the API client carries `isActive`

`updateProject(slug, dto: UpdateProjectDto)` JSON-stringifies the whole DTO
(`projects.ts:24`). Once T2 adds `isActive?: boolean` to `UpdateProjectDto`, this
needs **no** code change. Verify there is no explicit field allowlist that would
strip `isActive`. If one exists, widen it — otherwise leave `projects.ts` untouched.

#### 5b. Hooks — mirror `useUpdateProject.ts`

`useUpdateProject` (`frontend/src/hooks/useUpdateProject.ts:1-20`) is the canonical
pattern: calls `updateProject(slug, dto)`, sets
`meta: { revertMessage: "Couldn't save project settings" }`, and on success
invalidates `projectKeys.detail(slug)`, `projectKeys.lists()`, and `boardKeys.all`.
The deactivate/reactivate hooks **must invalidate the same three keys** — list
invalidation re-filters the picker (PA keeps the row, now badged; members drop
it), detail invalidation refreshes `ProjectSettingsPage`, and board invalidation
discards stale board state for the now-unreachable project.

Create **two** intent-specific hooks (clearer call sites in `ProjectSettingsPage`
than a single toggler, with distinct `revertMessage` copy per direction):

`frontend/src/hooks/useDeactivateProject.ts`:
```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProject } from '@/api/projects';
import { projectKeys, boardKeys } from '@/api/queryKeys';

export function useDeactivateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => updateProject(slug, { isActive: false }),
    meta: { revertMessage: "Couldn't deactivate project" },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: projectKeys.detail(slug) });
      qc.invalidateQueries({ queryKey: projectKeys.lists() });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
```

`frontend/src/hooks/useReactivateProject.ts`: identical shape with
`updateProject(slug, { isActive: true })` and
`meta: { revertMessage: "Couldn't reactivate project" }`.

**Alternative (single toggler):** ship one `useToggleProjectActive(slug)` that
accepts `(nextActive: boolean)` and reuses one `revertMessage`. Both shapes are
acceptable; pick whichever yields clearer `ProjectSettingsPage` call sites.
Document the choice in the task notes.

#### 5c. Cache invalidation rationale (document inline)

Each hook's `onSuccess` comment should note *why* all three keys are invalidated
(mirroring `useUpdateProject`'s comment): detail refreshes settings, lists
re-filters the picker, board discards stale state. **No optimistic update** — the
member-side filter is server-authoritative and a misapplied optimistic toggle
would briefly show a deactivated project to a non-PA.

#### 5d. Tests

Co-locate `*.test.ts` next to each hook (per `AGENTS.md`), mirroring whatever
harness `useUpdateProject.test.ts` uses (if none exists yet, mock
`@/api/projects.updateProject` with `vi.fn()`, assert it is called with the right
`{ isActive }` payload, and assert `qc.invalidateQueries` is called for each of the
three keys on success). Table-drive the deactivate/reactivate pair if a single
toggler is chosen.

### Acceptance Criteria

- [ ] `frontend/src/api/projects.ts` `updateProject` carries `isActive` through
      (verified — no field allowlist strips it; if one exists, widened).
- [ ] `useDeactivateProject(slug)` calls `updateProject(slug, { isActive: false })`;
      `useReactivateProject(slug)` calls `updateProject(slug, { isActive: true })`
      (or one `useToggleProjectActive` with the documented choice).
- [ ] Both hooks invalidate `projectKeys.detail(slug)`, `projectKeys.lists()`, and
      `boardKeys.all` on success.
- [ ] Both hooks keep the `meta.revertMessage` toast pattern (direction-specific copy).
- [ ] No optimistic update (server-authoritative member filter).
- [ ] Co-located `*.test.ts` for each new hook; payload + invalidation assertions
      green; `npm test -- useDeactivateProject useReactivateProject` clean; `tsc`
      clean; no `any`.

### Subtasks

1. Verify (don't blindly edit) `frontend/src/api/projects.ts` `updateProject`
   passes `isActive` through.
2. Create `useDeactivateProject.ts` mirroring `useUpdateProject.ts` (payload,
   three-key invalidation, `revertMessage`).
3. Create `useReactivateProject.ts` (or the single toggler alternative — document
   choice).
4. Add co-located `*.test.ts` per hook (mock `updateProject`, assert payload + the
   three `invalidateQueries` calls).

### Dependencies

- **T2** — `UpdateProjectDto.isActive?` (and `Project.isActive`) must be present
  on the frontend type before these hooks type-check. Does **not** depend on T4 at
  the unit level (the hook calls the same `PATCH /:slug` the route already exposes;
  T4 extends the accepted body, but the frontend compiles and unit-tests against
  the typed DTO alone). Integration/e2e validation of the full deactivate flow
  presumes T4 is merged.

---

# Batch 3 — UI Layer (parallel)

## T6 — ProjectSettingsPage: PA-only Deactivate/Reactivate section with ConfirmDialog

**Type:** MODIFY · **Dependencies:** T5, T2 · **Parallel with:** T7

### Description

Add a **Platform-Admin-only** lifecycle section inside the General pane of
`frontend/src/pages/ProjectSettingsPage.tsx`. Project Admins must **not** be able
to deactivate, so the gate is `isPlatformAdmin` (wired at
`ProjectSettingsPage.tsx:49`), **not** `canManage` (`:58` = `isPlatformAdmin || isProjectAdmin`).

**Files & references**
- `frontend/src/pages/ProjectSettingsPage.tsx`
  - `useProject(slug)` → `data: project` at `:48`; `isPlatformAdmin` at `:49`.
  - `renderGeneral` defined at `:138-160` — currently takes
    `(slug, name, columns, canManage, membershipReady)`. **Add `isActive` and
    `isPlatformAdmin` params** (or pass the whole `project` + flags) so the new
    section can render.
  - **Mirror pattern for a settings section owning a mutation + local state:**
    `ProjectNameSection` at `:181-219` (uses `useUpdateProject(slug)`, local
    `useState`, `mutateAsync`, `disabled={mut.isPending}`). Model
    `ProjectLifecycleSection` on it.
  - General pane renders `<ProjectNameSection />` + `<ProjectColumnsManager />`
    around `:166-169`. Insert the new section **after** them, gated on
    `isPlatformAdmin` (independent of `canManage`/`membershipReady`).
- `frontend/src/components/ConfirmDialog.tsx` — props at `:10-31`: `isOpen`,
  `title`, `titleId` (unique aria), `message?`/`children?`, `confirmLabel?`,
  `cancelLabel?`, `variant 'default'|'destructive'`, `pending`, `onConfirm`,
  `onCancel`, `blockBackdropClose?`.
- **Destructive ConfirmDialog precedent:** `frontend/src/pages/ProjectMembersPage.tsx:194-209`
  (Remove member) — title, unique `titleId` constant, `variant="destructive"`,
  `pending={remove.isPending}`, `message={…}`, `onConfirm`/`onCancel`. Copy this
  shape exactly.

**Component shape (to be implemented)**
```tsx
function ProjectLifecycleSection({ slug, isActive }: { slug: string; isActive: boolean }) {
  const deactivate = useDeactivateProject(slug);   // T5
  const reactivate = useReactivateProject(slug);   // T5
  const [open, setOpen] = useState(false);
  const mut = isActive ? deactivate : reactivate;
  // button label: isActive ? 'Deactivate project' : 'Reactivate project'
  // button variant: isActive ? 'destructive' : 'primary'
  // ConfirmDialog:
  //   variant destructive only when deactivating
  //   message copy: running timers stop, members lose access, data preserved
  //   pending = mut.isPending; onConfirm = () => mut.mutateAsync().then(() => setOpen(false))
}
```

**Copy (plan acceptance):** Deactivate — "Deactivating this project stops all
running timers immediately, members lose access, and the project is hidden from
their picker. All data is preserved and you can reactivate it later." Reactivate —
"Reactivate this project to restore access for all members. All data is intact."

### Acceptance Criteria

- [ ] A new `<section>` appears in the General pane **only when
      `isPlatformAdmin === true`**. Project Admins (non-PA) never see it.
- [ ] When `project.isActive === true`: section shows a **"Deactivate project"**
      button, `variant="destructive"`.
- [ ] When `project.isActive === false`: section shows a **"Reactivate project"**
      button (primary/non-destructive).
- [ ] Clicking the button opens a `ConfirmDialog` (destructive variant for
      deactivate) with the required copy (timers stop / members lose access / data
      preserved).
- [ ] `ConfirmDialog.pending` is wired to the active mutation's `isPending`; both
      buttons disable while pending and the confirm label appends `…`.
- [ ] `onConfirm` calls the T5 deactivate (or reactivate) mutation; on success the
      dialog closes and `project.isActive` flips in the UI (mutation invalidates
      `projectKeys.detail(slug)` — T5's responsibility).
- [ ] `onCancel` / Esc / backdrop closes the dialog without firing the mutation.
- [ ] `titleId` is a unique module constant (mirror `REMOVE_DIALOG_TITLE_ID` at
      `ProjectMembersPage.tsx`).
- [ ] No change to rename/columns/labels behavior; no change to `canManage` gating
      for those sections.
- [ ] Co-located `ProjectSettingsPage.test.tsx` covers: PA sees section
      (active→deactivate, inactive→reactivate); non-PA sees no section; ConfirmDialog
      confirm triggers mutation; pending disables buttons.

### Subtasks

1. Extend `renderGeneral` signature to receive `isActive` + `isPlatformAdmin` (pass
   `project.isActive` and the already-computed `isPlatformAdmin` from `SettingsBody`).
2. Add `ProjectLifecycleSection` component (modeled on `ProjectNameSection`) using
   `useDeactivateProject` / `useReactivateProject` from T5.
3. Render it inside the General pane fragment **after** `ProjectColumnsManager`,
   gated on `isPlatformAdmin` (independent of `canManage`/`membershipReady`).
4. Wire `ConfirmDialog` with unique `titleId`, destructive variant for deactivate,
   copy per spec, `pending`→`mut.isPending`, `onConfirm`→`mut.mutateAsync`.
5. Add `useState` open flag; close on confirm-success and on cancel.
6. Write co-located `ProjectSettingsPage.test.tsx` cases.

### Dependencies

- **T5** — `useDeactivateProject(slug)` / `useReactivateProject(slug)` hooks must exist.
- **T2** — `Project.isActive: boolean` on the type so `project.isActive` compiles.

---

## T7 — ProjectPicker + ProjectsPage: Deactivated badge (PA), member empty-state, and stale `lastSelectedSlug` reconciliation

**Type:** MODIFY · **Dependencies:** T2 · **Parallel with:** T6

### Description

Three cohesive, PA-vs-member-aware changes on the project-listing surfaces. All
in listing files — no overlap with `ProjectSettingsPage.tsx`.

### Files & references

#### (a) "Deactivated" badge for PAs

- `frontend/src/components/ProjectPicker.tsx` — `projects.map` render at
  `:113-145`; `isAdmin` available at top of `ProjectPicker()`.
- `frontend/src/pages/ProjectsPage.tsx` — list `<ul>/<li>/<button>` render at
  `:85-95`; `isAdmin` at `:34`.
- `frontend/src/components/ui/Badge.tsx` — `BadgeVariant` includes `'warning'` and
  `'secondary'`. Plan prefers **`warning`** (signals impaired state).
- **Rule:** render `<Badge variant="warning">Deactivated</Badge>` next to the name
  **iff `p.isActive === false && isAdmin`**. Members/Project Admins never receive
  deactivated rows (backend T3 filter), so they never see the badge — this is
  purely a PA-facing affordance.

#### (b) Member empty-state copy

- `frontend/src/pages/ProjectsPage.tsx` — empty branch at `:62-78` currently
  renders one `EmptyState` ("No projects yet" + admin-only "Create project" action).
- **Split by role:**
  - `isAdmin && projects.length === 0` → keep current `EmptyState` ("No projects
    yet", "Create project" action).
  - `!isAdmin && projects.length === 0` → `EmptyState` title **"You have no
    Projects"**, description **"Contact Admin"**, **no action**. (A member whose
    only project was deactivated now lands here.)
- `EmptyState` API: see `frontend/src/components/EmptyState.tsx` (already used here).

#### (c) Stale `lastSelectedSlug` reconciliation

- `frontend/src/stores/useProjectStore.ts` — Zustand store (`persist 'slyk-project'`);
  `lastSelectedSlug`, `setLastSelectedSlug`, and **`clear()` already exist**
  (`:9-17`). No store change needed.
- **Problem:** if a member's persisted `lastSelectedSlug` points at a now-deactivated
  project, `IndexRedirect` (`routes/index.tsx:18-35`) sends them to
  `/projects/<deactivated-slug>` → backend non-revealing 403 (T3) → repeated 403
  round-trips on every `/` visit.
- **Fix location:** `frontend/src/pages/ProjectsPage.tsx`. Add a reconcile
  `useEffect`: once `projects` is loaded, if `lastSelectedSlug` is set **and not
  present in the list**, call `clear()` (or `setLastSelectedSlug(firstAvailable.slug)`).
  This is the member-facing surface where the authoritative list lives;
  `ProjectPicker.tsx` already derives `selected = projects?.find(...)` defensively
  so it tolerates a cleared slug.
- A single reconcile in `ProjectsPage` is the cleanest chokepoint. `TopNav.tsx`
  and `ProjectPicker.tsx` consumers do not need their own reconcile.

### Acceptance Criteria

- [ ] `ProjectPicker.tsx`: when `p.isActive === false && isAdmin`, a
      `<Badge variant="warning">Deactivated</Badge>` renders inline next to the
      project name in the dropdown item.
- [ ] `ProjectsPage.tsx`: when `p.isActive === false && isAdmin`, the same badge
      renders next to the list button label.
- [ ] Non-admins never see the badge (assert in test that no badge renders when
      `!isAdmin`).
- [ ] `ProjectsPage.tsx` empty branch: `isAdmin` with `[]` → "No projects yet" +
      "Create project" action (unchanged).
- [ ] `ProjectsPage.tsx` empty branch: `!isAdmin` with `[]` → `EmptyState` title
      **"You have no Projects"**, description **"Contact Admin"**, **no** action prop.
- [ ] `ProjectsPage.tsx` reconcile effect: when `projects` loaded and
      `lastSelectedSlug` is not in the list, `clear()` is called exactly once per
      drift (guard against loops).
- [ ] After reconcile, navigating to `/` no longer 403-loops for a member whose
      project was deactivated.
- [ ] No change to store shape (`clear()` reused; no new action).
- [ ] Co-located tests: `ProjectsPage.test.tsx` (badge for PA on inactive row;
      member empty-state copy; reconcile clears stale slug) and
      `ProjectPicker.test.tsx` (badge for PA on inactive row).

### Subtasks

1. `ProjectsPage.tsx`: split the empty branch on `isAdmin`; add member `EmptyState`
   ("You have no Projects" / "Contact Admin", no action).
2. `ProjectsPage.tsx`: in the list map, render
   `<Badge variant="warning">Deactivated</Badge>` when `!p.isActive && isAdmin`.
3. `ProjectPicker.tsx`: in the `projects.map` item (`:113-145`), render the same
   badge when `!p.isActive && isAdmin` (next to the name span; ensure the `Check`
   icon keeps `ml-auto`).
4. `ProjectsPage.tsx`: add `lastSelectedSlug = useProjectStore(s=>s.lastSelectedSlug)`
   + `clear = useProjectStore(s=>s.clear)`; add `useEffect` that clears when the
   slug is stale w.r.t. the loaded list (guard against re-loops).
5. Write `ProjectsPage.test.tsx` + `ProjectPicker.test.tsx` cases.

### Dependencies

- **T2** — `Project.isActive: boolean` on the type so `p.isActive` reads compile.
