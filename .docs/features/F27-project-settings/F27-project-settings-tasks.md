# F27 — Project settings (rename, columns): Plan + Task Breakdown

> **Feature:** F27 — Project settings (rename, columns) (Phase 7 — Admin & Polish)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F08 (DONE ✅) · **PRD ref:** REQ-2.2
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F08](../F08-projects-slug-columns/F08-projects-slug-columns-tasks.md)

---

## 1. F27 Recap

**Goal:** Evolve a project after creation.

**Ships:** Admin edits project name, slug rules, and columns (add/rename/reorder/delete). Columns edited with stable IDs (rename keeps tickets attached). Deleting a non-empty column — block or force a destination column. Slug renames don't break historical ticket IDs (IDs stay `[SLUG]-[NNN]` with the ORIGINAL slug; display uses current slug — **DECISION: slug rename does NOT change historical ticket IDs** — they're permanent).

**Acceptance (definition of done):**
- Columns editable with stable IDs (rename keeps tickets attached).
- Add/reorder/delete columns; deleting a column moves its tickets to a chosen column OR blocks deletion while non-empty.
- Slug renames don't break historical ticket IDs (ticket_number is permanent; display slug reflects current project slug).
- Admin-only (project settings is an admin function per PRD REQ-2.2).

**Edge cases:**
- Deleting a non-empty column — **DECISION: block deletion while non-empty** (force the admin to move tickets first). Simplest + safest. Document.
- Deleting the last column — **DECISION: block** (always block — a project needs at least one column). Guard: `columns.length <= 1`.
- Slug rename: old slug URLs break — **DECISION: disallow slug rename for MVP** (the board route is `/projects/:slug`; renaming the slug would break deep links + the board route match). Only the project **name** is editable; the slug is permanent. Document. F30 (human-readable ticket URLs) can revisit if needed.
- Column identity: F08 already stores `columns` as `{id, name}[]` JSONB with stable `crypto.randomUUID()` ids — renames are safe.

---

## 2. Codebase Analysis Summary

- **State:** F08 (DONE ✅) ships `projects` table with `name`, `slug`, `columns` JSONB (`{id, name}[]`), `creatorId`. Project settings page (`ProjectSettingsPage.tsx`) EXISTS as a stub routed at `/projects/:slug/settings`. F14 ships `LabelManager` component pattern (settings page UI precedent).
- **Existing structure (citations):**
  - `projects` table (`schema.ts:61-77`) — `name` text, `slug` text unique, `columns` jsonb `$type<Column[]>`. `Column {id: string; name: string}` (`:56-59`).
  - `projectService.ts` — `createProject` + `getProjectBySlug` + `listProjects`. F27 adds `updateProject`.
  - `projects.routes.ts` — `POST /` (create, admin-only) + `GET /:slug` + `GET /:slug/board` + `GET /:slug/settings` page. F27 adds `PATCH /:slug`.
  - `ProjectSettingsPage.tsx` — EXISTS as a stub. Currently just `LabelManager` (F14). F27 adds project name + column management sections.
  - `tickets.statusColumn` references a `Column.id` from `projects.columns`. F09 + F11 use it for board rendering + move. Column rename = safe (ID stable). Column delete = tickets orphaned (F09 D-Unsorted-Bucket catches orphans).
  - `moveTicket` (`ticketService.ts:56-122`) validates `statusColumn` against `project.columns.map(c => c.id)`.
- **Files F27 modifies:** `backend/src/services/projectService.ts` (updateProject), `backend/src/routes/projects.routes.ts` (PATCH route), `frontend/src/pages/ProjectSettingsPage.tsx` (name editor + column manager UI), `frontend/src/api/projects.ts` (updateProject fn), `frontend/src/hooks/useUpdateProject.ts` (new hook).
- **Schema delta: NONE.** `projects.columns` JSONB + `projects.name` text already exist. Column edits are JSONB mutations; name is a text update.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Editable fields | **Name + columns only.** Slug NOT editable (disallow rename for MVP — breaks URLs). | PRD REQ-2.2. Slug rename edge case: old URLs break. F08 established the slug as permanent (project identity). |
| D2 | Column operations | Add (new `{id: randomUUID, name}` appended), rename (update `name` for a given `id`), reorder (rearrange the `columns` array), delete (remove by `id`). | F08 established stable column ids. All ops mutate the `columns` JSONB. |
| D3 | Delete non-empty column | **BLOCK.** Reject deletion if any ticket has `status_column = column.id`. Return CONFLICT with a message. | Spec edge case: "block or force a destination column." Block is safest. Admin moves tickets first. |
| D4 | Delete last column | **BLOCK.** `columns.length <= 1` → reject. | Spec: "Deleting the last column — block." |
| D5 | Admin-only | `requireRole('ADMIN')` on the PATCH route. | PRD REQ-2.2: admin manages settings. |
| D6 | Column JSONB update | Atomic `UPDATE projects SET columns = $newColumns, name = $newName WHERE slug = $slug`. The full `columns` array is sent (client constructs the new array; server validates + persists). | Drizzle `db.update(projects).set({ columns: newColumns, name: newName, updatedAt: new Date() }).where(eq(slug, slug))`. |
| D7 | Ticket ID permanence | `ticket_number` is permanent; display ID `SLUG-NNN` uses the CURRENT project slug (so renaming the name doesn't change it; slug is permanent so this is moot). | F12 D2: ticket_number never changes. F27 D1: slug never changes. |
| D8 | No schema/migration | `projects.columns` + `projects.name` already exist. | F08 migration 0001. |

---

## 4. Architecture Overview

```
backend/src/services/projectService.ts     # MODIFY — updateProject({ slug, name?, columns? })
backend/src/routes/projects.routes.ts      # MODIFY — PATCH /:slug (requireRole ADMIN + Zod body)
frontend/src/pages/ProjectSettingsPage.tsx # MODIFY — name editor + column manager UI
frontend/src/api/projects.ts              # MODIFY or CREATE — updateProject fn
frontend/src/hooks/useUpdateProject.ts    # NEW — mutation hook
```

---

## 5. Tasks

### T1 — BE: updateProject service + PATCH route + column-delete guards

**Batch:** 1 · **Depends on:** F08 (DONE)

**Description:**
1. Add `updateProject({ slug, name?, columns? })` to `projectService.ts`:
   - Load the project by slug (404 if missing).
   - If `columns` provided: validate (each `{id, name}`, no dupes, min 1). If a column is being DELETED (present in old, absent in new): check no ticket has `status_column = deletedColumn.id` → CONFLICT if tickets exist.
   - `db.update(projects).set({ ...(name ? { name } : {}), ...(columns ? { columns } : {}), updatedAt: new Date() }).where(eq(projects.slug, slug)).returning()`.
   - Return the updated project.
2. Add `PATCH /:slug` to `projects.routes.ts`:
   - `authenticate` + `requireRole('ADMIN')` + Zod body `{ name?: string, columns?: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(50) })).min(1) }`.
   - Call `projectService.updateProject({ slug, name, columns })`.
   - Return `success(updatedProject)`.

**Acceptance:**
- [ ] `updateProject` updates name + columns.
- [ ] Column delete blocked if tickets reference it (CONFLICT).
- [ ] Column delete blocked if last column (min 1 validation).
- [ ] `PATCH /api/projects/:slug` admin-only (403 member).
- [ ] `rtk tsc` + `rtk vitest run` (BE) pass.

### T2 — FE: project name editor + column manager UI + hook

**Batch:** 2 · **Depends on:** T1

**Description:**
1. `frontend/src/api/projects.ts` — `updateProject(slug, { name?, columns? })` → `apiFetch('/projects/${slug}', { method: 'PATCH', body })`.
2. `frontend/src/hooks/useUpdateProject.ts` — mutation hook; invalidates `boardKeys.detail(slug)` on success.
3. `frontend/src/pages/ProjectSettingsPage.tsx` — READ the current page (has LabelManager). Add ABOVE the label section:
   - **Project Name** — editable text input + "Save" button. Calls `updateProject(slug, { name })`.
   - **Columns** — a list editor (like F14 LabelManager pattern): each column row shows name (editable text) + up/down reorder buttons + delete button. "Add Column" button appends a new `{id: randomUUID, name: 'New Column'}`. "Save Columns" button sends the full `columns` array.
   - Delete button shows a confirmation modal before executing (per the memory `confirm-modals-for-destructive-actions`).
   - Admin-only (the route is already gated by `RequireRole`).

**Acceptance:**
- [ ] Project name editable + saved.
- [ ] Column add/rename/reorder/delete works.
- [ ] Column delete blocked when non-empty (server CONFLICT shown as error).
- [ ] Confirmation modal for column delete.
- [ ] `rtk tsc` (FE) passes.

### T3 — Verification

Typecheck/lint/format/test/build. Live smoke: `/projects/:slug/settings` → rename project → save → board updates. Add a column → it appears on the board. Rename a column → tickets stay attached. Try delete a column with tickets → blocked.

---

## 6. Final F27 Acceptance Checklist

- [ ] Project name editable + saved.
- [ ] Column add/rename/reorder/delete.
- [ ] Column rename keeps tickets attached (stable ids).
- [ ] Column delete blocked when non-empty (CONFLICT).
- [ ] Column delete blocked when last column (min 1).
- [ ] Slug NOT editable (permanent).
- [ ] Admin-only (403 member).
- [ ] Confirmation modal for destructive column ops.
- [ ] No schema/migration.
- [ ] All tests pass; typecheck/lint/format/build green.

---

## 7. Schema deltas owned by this feature

**F27 owns NONE.** `projects.columns` JSONB + `projects.name` text already exist (F08). No migration, no schema change.

---

## 8. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-25)

1. **Slug NOT editable.** Permanent. Only name + columns. CONFIRMED.
2. **Column delete blocks when non-empty.** Admin moves tickets first. CONFIRMED.
3. **Column delete blocks when last.** Min 1 column. CONFIRMED.
4. **Admin-only.** `requireRole('ADMIN')`. CONFIRMED.
5. **Confirmation modal for column delete.** Per memory `confirm-modals-for-destructive-actions`. CONFIRMED.
6. **No schema/migration.** CONFIRMED.

---

**Sources:**
- PRD REQ-2.2 (project settings: name, slug, columns).
- F08 task doc (projects table + columns JSONB + column identity).
- F14 task doc (LabelManager — settings UI precedent).
- Grounding: `backend/src/db/schema.ts:56-77`; `backend/src/services/projectService.ts`; `backend/src/routes/projects.routes.ts`; `frontend/src/pages/ProjectSettingsPage.tsx`; `frontend/src/routes/index.tsx`.
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
- Memory: `confirm-modals-for-destructive-actions` (column delete needs confirmation modal).
