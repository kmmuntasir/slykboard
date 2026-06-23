# F14 — Labels catalog (project-scoped, color-coded): Plan + Task Breakdown

> **Feature:** F14 — Labels catalog (project-scoped, color-coded) (Phase 2 — Board)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F12 (DONE ✅); inherits F13 (DONE ✅), F09 (DONE ✅), F11 (DONE ✅), F08 (DONE ✅), F06 (DONE ✅), F05 (DONE ✅), F03 (DONE ✅) · **PRD ref:** REQ-3.2, REQ-5.2, PRD §8.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F13](../F13-ticket-attributes-title-description-assignee-priority/F13-ticket-attributes-title-description-assignee-priority-tasks.md), [F12](../F12-ticket-creation-sequential-ids/F12-ticket-creation-sequential-ids-tasks.md), [F09](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md)

---

## 1. F14 Recap

**Goal:** Ship a managed, project-scoped catalog of color-coded labels that tickets can attach (multi-select); labels render as color chips on the board card and the ticket modal, and admins can create/rename/recolor/delete them from a project settings surface.

**Ships:** A project has a managed set of labels (name + normalized hex color). Tickets reference multiple labels by ID via a `ticket_labels` join table. The board card + ticket modal render `LabelChip` components with the correct color and a WCAG-readable text color. Admins manage labels (create/rename/recolor/delete-with-cascade) from a new project-scoped settings page at `/projects/:slug/settings`. Members can read labels and apply/remove them on tickets; only admins mutate the catalog.

**Acceptance (definition of done):**
- `Labels` table (project-scoped): `{ id, project_id, name, color }` with `UNIQUE (project_id, name)`.
- `ticket_labels` join table references label IDs; deleting a label cascade-removes the join rows from every ticket (no dangling chips).
- Multi-select on the ticket; chips render with the correct color on the card + modal.
- Manage labels (create / rename / recolor / delete) from project settings.
- Hex color validated at the edge (3- or 6-digit, normalized to 6-digit uppercase on write).
- Duplicate label names within a project rejected by DB constraint + Zod.
- Board payload hydrates label `{ id, name, color }` per ticket (no longer bare `string[]`).

**Edge cases to resolve up front:**
- **PRD schema lacks a `Labels` table** → **Decision:** Add it. Flagged schema delta (features.md:576). `Labels` + `ticket_labels` join, migrate existing `tickets.labels: string[]` denormalized data into the join in the same migration (single-shot, then drop the jsonb column). Source: features.md:576, Agent C (PRD §8 has no Labels table).
- **Deleting a label → cascade-remove from all tickets (don't leave dangling chips)** → **Decision:** Hard delete with `ON DELETE CASCADE` on `ticket_labels.label_id`. Labels are not auditable entities themselves; F18 records the diff on the *ticket* (`LABELS_CHANGED` is F18's row, features.md:579). Cross-cutting decision #7 (features.md:593) concerns *tickets*, not labels. Source: Agent D §3.
- **Color validation (hex); ensure contrast/legibility with text** → **Decision:** Zod regex `^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$` + transform normalizing 3→6 uppercase. Chip text color computed via WCAG luminance helper `readableTextColor(hex)`. Source: Agent D §2, §4.
- **Duplicate label names within a project — allow or reject?** → **Decision:** Reject. `UNIQUE (project_id, name)` constraint + Zod check. Matches Linear convention; prevents confusion in the multi-select. Source: Agent A §4.
- **Storage shape — references label IDs (normalized) or stores denormalized?** → **Decision:** Normalize. `Labels` table + `ticket_labels` join. Drop the `tickets.labels` jsonb column after backfill. Required by the "cascade-remove" edge case and by F18's need for readable diffs (features.md:383). Source: Agent B (existing column), Agent D §3.
- **`LABELS_CHANGED` ActivityLog action_type** → **Decision:** F18 owns it (features.md:579). F14 only preserves the `{ old, new }` seam on ticket label patches via `ticketService.updateTicket`. Source: Agent C.
- **Ticket delete is NOT F14** → **Decision:** F17 owns ticket delete (F13 §3 reassignment). F14 owns labels only. Source: Agent B §7.

---

## 2. Codebase Analysis Summary

- **State:** **Partial — schema delta required, services/routes/UI absent.** F12 (DONE ✅), F13 (DONE ✅), F09 (DONE ✅), F11 (DONE ✅), F08 (DONE ✅), F06 (DONE ✅), F05 (DONE ✅), F03 (DONE ✅) are all satisfied in code. The `tickets` table already holds a denormalized `labels: jsonb string[]` column (`schema.ts:114`, default `[]`) — F14 migrates this into a normalized `Labels` + `ticket_labels` shape and drops the jsonb column. F13 shipped `TicketAttributeForm` (RHF + zodResolver) with NO label field — F14 adds `LabelMultiSelect`. F13's `TicketCard.tsx:39-50` renders labels as plain `<li>` chips with `bg-secondary` — F14 swaps these for `LabelChip` with project label colors.
- **Existing structure this feature builds on (with path citations):**
    - **Schema (needs delta):** `backend/src/db/schema.ts`. `projects` table at `:59-75` (conventions: snake_case column names, camelCase keys, `uuid` PK `defaultRandom()`, UTC `timestamptz` with `$onUpdate`, PascalCase table names). `tickets` table at `:79-101`: `id`, `projectId` FK→Projects, `ticketNumber`, `title`, `description`, `statusColumn`, `position`, `assigneeId`, `creatorId`, `priority`, **`labels: jsonb('labels').$type<string[]>().default([]).notNull()` at `:95`** (comment at `:113`: *"F09: labels as jsonb string[] for forward-compat"*), `createdAt`/`updatedAt`.
    - **Migrations:** `backend/src/db/migrations/` — journal at `meta/_journal.json`; current idx 0–5; F14 = idx 6 → file `0006_*.sql` + `meta/0006_snapshot.json`. **CRITICAL memory `drizzle-partial-index-enum-dollar1`:** `drizzle-kit generate` emits unapplyable `$1` SQL for the F06 `usersOneAdminIdx` enum partial index when regenerated. F14 MUST inspect the new SQL and hand-edit any `WHERE "role" = $1` to literal `'ADMIN'`.
    - **Backend routing:** Routers wired at `backend/src/index.ts:50-54`: `/api/auth`, `/api/projects`, `/api/tickets`, `/api/users` (F13). F14 mounts `labelsRouter` nested under `projectsRouter` (`/api/projects/:slug/labels`) for list/create, and standalone label-id routes (`/api/labels/:id`) for PATCH/DELETE.
    - **Backend Zod:** `backend/src/routes/*.schema.ts`. `createTicketBody` at `projects.schema.ts:37-44` (F12 T4) accepts `labels: z.array(z.string()).optional()`. F14 changes this to `z.array(z.string().uuid()).optional()`. `updateTicketBody` at `tickets.schema.ts` (F13 T7) has no `labels` key — F14 adds `labelIds`.
    - **Backend services:** `ticketService.ts` (F13 added `getTicket`, `updateTicket` returning `{ old, new }`); `boardService.ts:48-149` left-joins users on assigneeId and returns `labels: string[]` today (bare jsonb). F14 changes board payload to `labels: { id, name, color }[]`. `projectService.ts:75-78` has `getProjectBySlug(slug)`. Services query `db` directly (repositories/controllers dirs are `.gitkeep`).
    - **Auth middleware** `backend/src/middleware/auth.ts:9-43`: sets `req.user = { id, email, role }` (`:41`). `requireRole(...roles)` at `middleware/requireRole.ts:9-23` throws FORBIDDEN; run AFTER `authenticate`. Existing admin-only: `POST /api/projects` (F08). F14: reads open to members; writes admin-only.
    - **Envelope:** `backend/src/utils/envelope.ts`: `success<T>(data) → { data }` (`:28-30`), `error(code, message, details?)` (`:42-48`). Closed `ErrorCode` (`:5-12`): `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR`. Duplicate name → `CONFLICT`; hex parse fail → `VALIDATION_FAILED`. No new codes needed.
    - **Frontend API + state:** React Query v5 + Zustand v5. `apiFetch<T>` at `frontend/src/api/client.ts:45-131`. Query keys at `frontend/src/api/queryKeys.ts`: `projectKeys`, `boardKeys`, `ticketKeys` (F13). F14 adds `labelKeys`.
    - **Frontend ticket API:** `frontend/src/api/tickets.ts` (F11/F12/F13: `moveTicket`, `createTicket`, `fetchTicket`, `updateTicket`). F14 widens `CreateTicketDto` + `UpdateTicketDto` with `labelIds`.
    - **Frontend types:** `frontend/src/types/ticket.ts`: `Ticket.labels: string[]` (`:29`) — F14 changes to `Label[]`. `UpdateTicketDto` (`:36-41`) — F14 adds `labelIds?`. F14 adds `frontend/src/types/label.ts`.
    - **Frontend components:** `TicketCard.tsx:39-50` renders labels as plain `<li>` (F14 swaps to `<LabelChip>`). `TicketAttributeForm.tsx` (F13) — F14 adds `LabelMultiSelect` field. `PriorityBadge.tsx:1-25` is the chip pattern reference (but keyed off a fixed enum map, not arbitrary hex — F14 uses inline `style` for dynamic color). `CreateTicketModal.tsx` + `EditTicketModal.tsx` wrap `TicketAttributeForm`.
    - **Frontend routes:** `frontend/src/routes/index.tsx:33-63`: `/projects/:slug`, `/settings` (global stub). F14 adds `/projects/:slug/settings`.
    - **DnD:** `@hello-pangea/dnd` wired; `renderInDnd` wrapper at `frontend/src/test/dndWrapper.tsx`.
    - **Project settings UI:** `frontend/src/pages/SettingsPage.tsx` is an 8-line stub ("Settings content arrives in F07"). No project-scoped settings route exists today. F14 decides URL shape → `/projects/:slug/settings` (project-scoped data deserves project-scoped URL).
- **Libraries installed (relevant):** `zod ^4.4.3` (BE), `react-hook-form ^7.66+` + `@hookform/resolvers` (FE, F13), `@tiptap/*` (FE, F13). **No color picker** (need `react-colorful`). **No headless UI / cmdk** (F14 ships native primitives for the multi-select to avoid a dep explosion — see D9).
- **Test patterns:** Vitest 3, co-located `*.test.ts(x)`. BE: `supertest` + `vi.mock` services + `vi.hoisted` env (e.g. `projects.routes.test.ts`). FE: `@testing-library/react` + `renderInDnd` wrapper; priority `getByRole`.
- **CI/lint:** ESLint flat config `no-explicit-any` enforced. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (forces `import type`), `isolatedModules`. Prettier: 100-char, 2-space JS, 4-space JSX, trailing commas.
- **Prior art / partial work:** F13 (DONE) ships `TicketAttributeForm` without a label field; F13 task doc L121 explicitly defers labels to F14. F12 (DONE) ships `createTicket` accepting `labels?: string[]` (now legacy). F09 (DONE) ships board read returning bare `labels: string[]`. F08 (DONE) ships projects + slug.
- **File paths the plan references that do NOT exist yet (will be created):**
    - `backend/src/db/migrations/0006_*.sql`, `backend/src/db/migrations/meta/0006_snapshot.json`
    - `backend/src/routes/labels.routes.ts`, `backend/src/routes/labels.schema.ts`, `backend/src/routes/labels.routes.test.ts`
    - `backend/src/services/labelService.ts`, `backend/src/services/labelService.test.ts`
    - `frontend/src/types/label.ts`
    - `frontend/src/api/labels.ts`, `frontend/src/api/labels.test.ts`
    - `frontend/src/components/LabelChip.tsx`, `frontend/src/components/LabelChip.test.tsx`
    - `frontend/src/components/LabelMultiSelect.tsx`, `frontend/src/components/LabelMultiSelect.test.tsx`
    - `frontend/src/components/LabelManager.tsx`, `frontend/src/components/LabelManager.test.tsx`
    - `frontend/src/hooks/useLabels.ts`, `frontend/src/hooks/useLabels.test.ts`
    - `frontend/src/hooks/useLabelMutations.ts`, `frontend/src/hooks/useLabelMutations.test.ts`
    - `frontend/src/utils/color.ts`, `frontend/src/utils/color.test.ts`
    - `frontend/src/pages/ProjectSettingsPage.tsx`, `frontend/src/pages/ProjectSettingsPage.test.tsx`
- **File paths this plan CHANGES (exist on `main`):**
    - `backend/src/db/schema.ts` (add `labels` + `ticket_labels` tables; drop `tickets.labels` jsonb after backfill)
    - `backend/src/index.ts` or `backend/src/routes/projects.routes.ts` (mount `labelsRouter` nested + standalone)
    - `backend/src/services/ticketService.ts` (label handling on ticket create/update — `labelIds` patch + `{ old, new }` seam)
    - `backend/src/services/boardService.ts` (hydrate `labels: { id, name, color }[]`)
    - `backend/src/routes/projects.schema.ts:41` (`createTicketBody.labels` → `uuid().array()`)
    - `backend/src/routes/tickets.schema.ts` (`updateTicketBody` — add `labelIds`)
    - `frontend/src/types/ticket.ts:29` (`Ticket.labels: Label[]`), `:36-41` (`UpdateTicketDto` + `CreateTicketDto`)
    - `frontend/src/api/queryKeys.ts` (add `labelKeys`)
    - `frontend/src/api/tickets.ts` (DTOs carry `labelIds`)
    - `frontend/src/components/TicketCard.tsx:39-50` (use `LabelChip`)
    - `frontend/src/components/TicketAttributeForm.tsx` (add `LabelMultiSelect`)
    - `frontend/src/routes/index.tsx` (add `/projects/:slug/settings`)
    - `frontend/package.json` (add `react-colorful`)
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F14-labels-catalog`, single-line commits `SLYK-F14: <msg>`, rebase-only no squash, slug SLYK, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful `/api/projects/:slug/labels` + `/api/labels/:id`, Zod at edge, layering routes→services, `authenticate` + `requireRole('ADMIN')` for writes, frontend dirs); `.claude/rules/js-style-guide.md` (PascalCase components, camelCase hooks, SCREAMING_SNAKE_CASE constants, 4-space JSX / 2-space JS, no `any`, **inline styles allowed for dynamic runtime color** per Tailwind JIT limitation); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `getByRole` priority, coverage >80% business / >70% components); `.claude/rules/persona.md` (React 19 + Express 5 + Drizzle + Postgres + Vite + Tailwind; `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).
- **Hidden coupling to plan for:**
    - **Schema migration is the spine.** Every later task depends on `Labels` + `ticket_labels` existing. The migration also backfills existing `tickets.labels: string[]` into the join (per F12 T1 `INSERT ... SELECT ... ON CONFLICT DO NOTHING` precedent) and then drops the jsonb column. Single-shot migration — no two-cycle keep-legacy path.
    - **`drizzle-partial-index-enum-dollar1` memory.** After `drizzle-kit generate`, hand-edit any `WHERE "role" = $1` in the new `0006_*.sql` to literal `'ADMIN'`. Inspect before commit.
    - **Backfill data shape.** Existing `tickets.labels` is `string[]` of free-text. Backfill must dedupe per project: for each distinct string in a project's tickets' labels arrays, create one `Labels` row (assign a default color — pick `#6B7280` gray), then link via `ticket_labels`. Order matters: insert labels first, then joins.
    - **Board payload shape change is breaking.** `BoardTicket.labels` goes from `string[]` to `{ id, name, color }[]`. FE `Ticket` type + `TicketCard` + `boardPatch` must update atomically with the BE deploy. Sequence B3 (BE board hydration) before B5 (FE card render).
    - **F13 optimistic seam.** `useUpdateTicket.onMutate` snapshots board + detail; `applyPatchToBoard` must now handle `labelIds` patches by mapping to hydrated labels (or invalidating board on settle to re-fetch colors). Recommend: board optimistic for `labelIds` invalidates board on settle (label color comes from server, not the patch).
    - **Tailwind dynamic color limitation.** `bg-${color}` and `bg-[${hex}]` fail — JIT cannot see runtime values. Use `style={{ backgroundColor: hex, color: readableTextColor(hex) }}` + Tailwind layout classes. Source: Tailwind discussion #12211.
    - **`noUncheckedIndexedAccess`.** Label arrays, cmdk option lists must be narrowed.
    - **`verbatimModuleSyntax`.** `import type { Label }` everywhere.
    - **Activity-log seam for F18.** F14's `ticketService.updateTicket` already returns `{ old, new }` (F13 seam); F14 extends the patch to include labelIds but keeps the return shape. F18 will diff labels and write `LABELS_CHANGED` (features.md:579 — F18's row). F14 does NOT write logs.
    - **F16 boundary.** F16 owns the unified detail modal hosting all sections. F14 ships `LabelChip` + `LabelMultiSelect` as reusable primitives F16 can embed.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Storage shape | **Normalize.** Add `Labels` + `ticket_labels` join; drop `tickets.labels` jsonb after backfill. | Spec edge case "deleting a label → cascade-remove" (features.md:319) + F18 audit needs readable diffs (features.md:383). Source: Agent B (existing jsonb column), Agent D §3 (cascade pattern). |
| D2 | Label table columns | **`{ id uuid PK defaultRandom, projectId uuid FK→Projects NOT NULL, name text NOT NULL, color text NOT NULL (normalized #RRGGBB uppercase), createdAt/updatedAt timestamptz }`** + **`UNIQUE (projectId, name)`**. | Matches `projects` conventions (`schema.ts:59-75`). Unique constraint rejects duplicate names per project (features.md:321 edge case). Source: Agent A §4. |
| D3 | Join table shape | **`ticket_labels { ticket_id uuid FK→tickets ON DELETE CASCADE, label_id uuid FK→labels ON DELETE CASCADE, assigned_at timestamptz defaultNow, PRIMARY KEY (ticket_id, label_id) }`** + index on `label_id`. | Cascade on `label_id` implements the "delete label → remove from all tickets" edge case (features.md:319). Cascade on `ticket_id` keeps ticket delete clean (F17). Source: Agent D §3. |
| D4 | Color storage + validation | **Hex `^#[0-9A-Fa-f]{6}$` post-transform.** Zod accepts 3- or 6-digit, transforms 3→6 uppercase. Stored as `#RRGGBB`. UI: `react-colorful` `HexColorPicker` + `HexColorInput`. | Normalization prevents dual-format ambiguity. `react-colorful` is ~1.8KB, React 19-compatible, WAI-ARIA complete. Avoid `react-color` (stale). Source: Agent D §1, §2. |
| D5 | Cascade policy | **Hard delete labels, `ON DELETE CASCADE` on `ticket_labels.label_id`.** | Labels are not auditable entities (F18 records the diff on the *ticket*, features.md:383: "readable diff of added/removed names"). Cross-cutting decision #7 (features.md:593) concerns *tickets*, not labels. Source: Agent C, Agent D §3. |
| D6 | Label CRUD routes | **RESTful, nested for project-scoped ops, flat for label-id ops.** `GET /api/projects/:slug/labels` (list, `authenticate`); `POST /api/projects/:slug/labels` (create, `authenticate` + `requireRole('ADMIN')`); `PATCH /api/labels/:id` (rename/recolor, `authenticate` + `requireRole('ADMIN')`); `DELETE /api/labels/:id` (cascade-untag, `authenticate` + `requireRole('ADMIN')`). | Reads open to members (apply labels on tickets); writes admin-only — mirrors `POST /api/projects` precedent (F08). Source: Agent A §6, Agent B §7. |
| D7 | Ticket label patch path | **Widen existing `PATCH /api/tickets/:ticketId` (F13).** Add `labelIds: z.array(z.string().uuid()).optional()` to `updateTicketBody`. Preserve `{ old, new }` seam for F18. | F13 already merged the endpoint; adding `labelIds` to the same body keeps one handler. Splitting would force a rewire. Source: Agent B §6. |
| D8 | Board payload | **`boardService.getBoard` joins `Labels` via `ticket_labels` per ticket → `labels: { id, name, color }[]`.** Drop `tickets.labels` jsonb column after backfill. | Board card needs colors; bare string[] is useless post-normalization. Single-shot migration — no legacy column. Source: Agent A §4, Agent B §4. |
| D9 | FE `Ticket.labels` type | **`Label[]` where `Label = { id: string; name: string; color: string }`.** | Matches hydrated board payload. Source: Agent B §10. |
| D10 | LabelChip rendering | **Inline `style={{ backgroundColor: color, color: readableTextColor(color) }}` + Tailwind layout classes.** New `frontend/src/components/LabelChip.tsx`. | Tailwind JIT cannot see runtime hex values (`bg-[${hex}]` fails — Tailwind discussion #12211). WCAG luminance helper picks black/white text. Source: Agent D §4, §7. |
| D11 | LabelMultiSelect UX | **Native popover pattern (no cmdk dep).** Trigger button shows selected `LabelChip`s; popover lists all project labels with checkbox + color dot + name. Controlled `value: string[]`, `onChange: (ids: string[]) => void`. | Avoids net-new UI deps (Radix/cmdk). Matches F13 native-`<select>` precedent. Contract matches F13 primitives. Source: Agent D §5. |
| D12 | LabelManager surface | **`/projects/:slug/settings` (new route + `ProjectSettingsPage`).** Project-scoped data deserves project-scoped URL. Inline CRUD: create row, inline rename, color swatch popover (`react-colorful`), trash with confirm. | Source: Agent A §9, Agent D §6 (Linear/Trello inline pattern). |
| D13 | Ticket delete | **NOT F14.** F17 owns ticket delete. | F13 §3 D-list reassigned; F12 §1 named F14 originally. Source: Agent B §7 conflict. |
| D14 | `LABELS_CHANGED` audit action | **F18 owns it.** F14 only preserves `{ old, new }` seam on ticket label patches. | features.md:579 tags the action_type delta to F18. Source: Agent C. |
| D15 | Migration safety | **Inspect `0006_*.sql` after `drizzle-kit generate`.** Hand-edit any `WHERE "role" = $1` to `'ADMIN'` (memory `drizzle-partial-index-enum-dollar1`). Backfill existing `tickets.labels` string[] → `ticket_labels` in the same migration (`INSERT ... SELECT ... ON CONFLICT DO NOTHING`, F12 T1 precedent). | Single-shot migration; no two-cycle keep-legacy. Source: Agent B §8. |
| D16 | Backfill default color | **`#6B7280` (Tailwind `gray-500` equivalent) for migrated free-text labels.** | Neutral default; admins can recolor post-migration. |

> **Out of F14 scope (explicitly deferred):**
> - **Activity-log writes (`LABELS_CHANGED`)** → **F18**. F14 preserves the `{ old, new }` seam; F18 hooks capture.
> - **Full detail modal hosting all sections** → **F16**. F14 ships `LabelChip` + `LabelMultiSelect` as reusable primitives.
> - **Ticket delete** → **F17**. F14 only touches labels.
> - **Custom ticket fields / custom priority levels** → explicitly out per PRD §4.
> - **Per-project user membership** → **F25**.

> **Owner sign-off RESOLVED (2026-06-23) — all recommendations accepted:**
> - **Q1 (storage shape):** ✅ **Normalize** — `Labels` + `ticket_labels` join, drop jsonb after backfill.
> - **Q2 (duplicate names):** ✅ **Reject** — `UNIQUE (projectId, name)` + Zod.
> - **Q3 (cascade policy):** ✅ **Hard delete + cascade** — `ON DELETE CASCADE` on `ticket_labels.label_id`.
> - **Q4 (label manager URL):** ✅ **`/projects/:slug/settings`** — project-scoped URL.
> - **Q5 (multi-select dep):** ✅ **Native popover** — no cmdk/Radix dep explosion.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   ├── package.json                                        # unchanged (no new BE dep)
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add labels + ticket_labels tables; drop tickets.labels
│       │   └── migrations/
│       │       ├── 0006_<auto>.sql                         # NEW (T1) — CREATE TABLE Labels + ticket_labels, backfill, DROP tickets.labels
│       │       └── meta/0006_snapshot.json                 # NEW (T1, auto)
│       ├── index.ts                                        # MODIFY (T3) — mount labelsRouter (nested + flat)
│       ├── routes/
│       │   ├── projects.routes.ts                          # MODIFY (T3) — nest labelsRouter under /projects/:slug
│       │   ├── projects.schema.ts                          # MODIFY (T4) — createTicketBody.labels → uuid().array()
│       │   ├── labels.routes.ts                            # NEW (T3) — GET/POST nested; PATCH/DELETE flat; requireRole('ADMIN') on writes
│       │   ├── labels.schema.ts                            # NEW (T3) — createLabelBody, updateLabelBody, labelIdParam, slugParam
│       │   ├── labels.routes.test.ts                       # NEW (T3) — supertest scenarios
│       │   ├── tickets.schema.ts                           # MODIFY (T4) — updateTicketBody += labelIds
│       │   └── tickets.routes.test.ts                      # MODIFY (T4) — label patch scenarios
│       └── services/
│           ├── labelService.ts                             # NEW (T2) — listLabels, createLabel, updateLabel, deleteLabel, hydrateLabelsForTickets
│           ├── labelService.test.ts                        # NEW (T2)
│           ├── ticketService.ts                            # MODIFY (T4) — create/update apply labelIds via ticket_labels; preserve {old,new}
│           ├── ticketService.test.ts                       # MODIFY (T4) — label patch tests
│           ├── boardService.ts                             # MODIFY (T4) — hydrate labels: {id,name,color}[] per ticket
│           └── boardService.test.ts                        # MODIFY (T4) — label hydration tests
└── frontend/
    ├── package.json                                        # MODIFY (T5) — add react-colorful
    └── src/
        ├── types/
        │   ├── label.ts                                    # NEW (T5) — Label { id, name, color }, CreateLabelDto, UpdateLabelDto
        │   └── ticket.ts                                   # MODIFY (T5) — Ticket.labels: Label[]; UpdateTicketDto += labelIds?; CreateTicketDto += labelIds?
        ├── api/
        │   ├── queryKeys.ts                                # MODIFY (T5) — add labelKeys { all, forProject(slug), detail(id) }
        │   ├── labels.ts                                   # NEW (T5) — listLabels(slug), createLabel, updateLabel, deleteLabel
        │   ├── labels.test.ts                              # NEW (T5)
        │   └── tickets.ts                                  # MODIFY (T5) — DTOs carry labelIds
        ├── utils/
        │   ├── color.ts                                    # NEW (T5) — readableTextColor(hex) WCAG luminance
        │   └── color.test.ts                               # NEW (T5) — table-driven luminance tests
        ├── hooks/
        │   ├── useLabels.ts                                # NEW (T6) — useLabels(slug) useQuery
        │   ├── useLabels.test.ts                           # NEW (T6)
        │   ├── useLabelMutations.ts                        # NEW (T6) — useCreateLabel, useUpdateLabel, useDeleteLabel (optimistic on labelKeys)
        │   └── useLabelMutations.test.ts                   # NEW (T6)
        ├── components/
        │   ├── LabelChip.tsx                               # NEW (T7) — inline style bg+text color, Tailwind layout
        │   ├── LabelChip.test.tsx                          # NEW (T7)
        │   ├── LabelMultiSelect.tsx                        # NEW (T7) — native popover, checkbox list, controlled value/onChange
        │   ├── LabelMultiSelect.test.tsx                   # NEW (T7)
        │   ├── LabelManager.tsx                            # NEW (T9) — inline CRUD: create row, rename input, color popover, delete confirm
        │   ├── LabelManager.test.tsx                       # NEW (T9)
        │   ├── TicketCard.tsx                              # MODIFY (T8) — render <LabelChip> instead of <li>
        │   ├── TicketAttributeForm.tsx                     # MODIFY (T8) — add <LabelMultiSelect> field; schema += labelIds
        │   └── TicketAttributeForm.test.tsx                # MODIFY (T8) — label select tests
        ├── pages/
        │   ├── ProjectSettingsPage.tsx                     # NEW (T9) — hosts <LabelManager> at /projects/:slug/settings
        │   └── ProjectSettingsPage.test.tsx                # NEW (T9)
        └── routes/
            └── index.tsx                                   # MODIFY (T9) — add /projects/:slug/settings route
```

**Request lifecycle (`PATCH /api/tickets/:ticketId` with `labelIds`, post-F14):**

1. Client `updateTicket(id, { labelIds })` → `apiFetch(\`/tickets/${id}\`, { method: 'PATCH', body: JSON.stringify({ labelIds }) })` → Bearer injected.
2. `authenticate` (F05): verifies JWT → `req.user = { id, email, role }`.
3. `validateRequest({ params: ticketIdParam, body: updateTicketBody })`: Zod partial (now includes `labelIds: uuid().array().optional()`) → `VALIDATION_FAILED`/400 on fail.
4. Handler calls `ticketService.updateTicket({ ticketId, patch, actingUserId })`:
   - Load ticket by id → missing → `NOT_FOUND`/404.
   - Snapshot `old` row (including current labelIds via `ticket_labels`).
   - If `labelIds` in patch → diff against current set; `DELETE` removed joins, `INSERT` added joins (validate all labelIds belong to the same project — else `VALIDATION_FAILED`).
   - If other attribute fields present → apply (F13 path).
   - Return `{ old, new }` for F18 to hook.
5. Returns `200` + `success(new)`.
6. FE `useUpdateTicket.onMutate`: snapshot board + detail; for `labelIds` patches, **invalidate** `boardKeys.all` on settle (label colors come from server, not the patch — cannot optimistically render correct colors without the join). For title/priority/assignee patches, keep F13 optimistic path.

**Label CRUD lifecycle (`DELETE /api/labels/:id`, post-F14):**

1. `authenticate` + `requireRole('ADMIN')` → non-admin → `FORBIDDEN`/403.
2. `validateRequest({ params: labelIdParam })` → non-uuid → `VALIDATION_FAILED`/400.
3. Handler calls `labelService.deleteLabel(id)` → `DELETE FROM Labels WHERE id = $1` → Postgres cascades `DELETE FROM ticket_labels WHERE label_id = $1`.
4. Returns `200` + `success({ id })`.
5. FE `useDeleteLabel.onSettled` invalidates `labelKeys.forProject(slug)` + `boardKeys.all` (board cards need re-render to drop the chip).

---

## 5. Parallelization Strategy

Tasks are grouped into **6 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
 ┌─ Batch 1 (BE schema migration) ──────────────────────────────────────┐
 │  T1  schema.ts: add labels + ticket_labels; generate 0006_*.sql;      │
 │      hand-edit $1 bug; backfill SQL; drop tickets.labels jsonb        │
 │      [db/schema.ts, db/migrations/0006_*, db/migrations/meta/0006_*]  │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (tables exist)
                          ▼
 ┌─ Batch 2 (BE label service + routes) ─┐   ┌─ Batch 3 (BE ticket/board integration) ─┐
 │  T2  labelService + tests             │   │  T4  ticketService label patch +          │
 │      [services/labelService.ts,       │   │      boardService hydration + schema      │
 │       services/labelService.test]     │   │      widenings + tests                    │
 │  T3  labels.routes + labels.schema +  │   │      [services/ticketService.ts,          │
 │      mount in index.ts + tests        │   │       services/ticketService.test,        │
 │      [routes/labels.routes.ts,        │   │       services/boardService.ts,           │
 │       routes/labels.schema.ts,        │   │       services/boardService.test,         │
 │       routes/labels.routes.test,      │   │       routes/projects.schema.ts,          │
 │       routes/projects.routes.ts,      │   │       routes/tickets.schema.ts,           │
 │       index.ts]                       │   │       routes/tickets.routes.test]         │
 │  (T2 → T3 serialized WITHIN B2;       │   │  (T4 disjoint from B2 — touches            │
 │   T3 imports labelService)            │   │   ticketService/boardService, not          │
 └────────────────────────┬──────────────┘    │   labelService/labels.routes)             │
                          │                   └────────────────────────┬──────────────────┘
                          │ (HTTP contracts stable)                     │
                          ▼                                              ▼
 ┌─ Batch 4 (FE foundation) ─────────────────────────────────────────────┐
 │  T5  deps + Label type + labelKeys + api/labels + utils/color + tests │
 │      [package.json, types/label.ts, types/ticket.ts, api/queryKeys,   │
 │       api/labels.ts, api/labels.test, api/tickets.ts, utils/color,    │
 │       utils/color.test]                                               │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (types + api available)
                          ▼
 ┌─ Batch 5 (FE primitives + hooks) ─────────────────────────────────────┐
 │  T6  hooks/useLabels + useLabelMutations + tests                      │
 │      [hooks/useLabels.ts, hooks/useLabels.test,                       │
 │       hooks/useLabelMutations.ts, hooks/useLabelMutations.test]       │
 │  T7  LabelChip + LabelMultiSelect + tests                             │
 │      [components/LabelChip.tsx, components/LabelChip.test,            │
 │       components/LabelMultiSelect.tsx, components/LabelMultiSelect]   │
 │  (T6 ‖ T7 disjoint files)                                             │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (hooks + primitives available)
                          ▼
 ┌─ Batch 6 (FE integration) ────────────────────────────────────────────┐
 │  T8  TicketCard LabelChip + TicketAttributeForm LabelMultiSelect +    │
 │      useUpdateTicket labelIds invalidation + tests                    │
 │      [components/TicketCard.tsx, components/TicketAttributeForm.tsx,  │
 │       components/TicketAttributeForm.test, components/TicketCard.test]│
 │  T9  LabelManager + ProjectSettingsPage + route + tests               │
 │      [components/LabelManager.tsx, components/LabelManager.test,      │
 │       pages/ProjectSettingsPage.tsx, pages/ProjectSettingsPage.test,  │
 │       routes/index.tsx]                                               │
 │  (T8 ‖ T9 disjoint files)                                             │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (feature complete)
                          ▼
 ┌─ Batch 7 (terminal) ──────────────────────────────────────────────────┐
 │  T10 Integration gate: typecheck/lint/format/test/build + live smoke  │
 │      (no new feature files)                                           │
 └───────────────────────────────────────────────────────────────────────┘
```

- **B1 hard barrier:** every later task needs `Labels` + `ticket_labels` to exist. B1 merges first.
- **B1 → (B2 ‖ B3) soft barrier:** B2 (label service/routes) and B3 (ticket/board integration) can be parallel-developer-assigned once B1 is on `main`. B2 owns `labelService.*` + `labels.routes.*`; B3 owns `ticketService.*` + `boardService.*` + `tickets.schema`. **Zero file overlap** — B3 does NOT touch `labelService` (it queries `ticket_labels` directly or imports a pure hydrate helper from T2). Coordinate: if T4 needs `hydrateLabelsForTickets`, T2 ships it first within B2, then B3 branches. Practically sequence B2 → B3 to avoid cross-batch imports.
- **Within B2: T2 → T3.** T3 imports `labelService` (T2).
- **(B2 ‖ B3) → B4 hard barrier:** FE needs all HTTP contracts stable (`GET /api/projects/:slug/labels`, `POST`, `PATCH /api/labels/:id`, `DELETE`, `PATCH /api/tickets/:id` with `labelIds`, board payload with hydrated labels).
- **B4 → B5 hard barrier:** primitives + hooks need types + api.
- **Within B5: T6 ‖ T7.** Hooks and components are disjoint.
- **B5 → B6 hard barrier:** integration consumes primitives + hooks.
- **Within B6: T8 ‖ T9.** Card/form wiring and LabelManager/settings page are disjoint.
- **B6 → B7 hard barrier:** verification runs against as-merged feature.

### Merge order rules

1. **B1 (T1) merges first.** Schema is the spine. `main` must have T1 before any other batch branches.
2. **B2 (T2 → T3) merges second.** Label CRUD contracts land.
3. **B3 (T4) merges third.** Ticket label patch + board hydration. Can run in parallel with B2 dev (disjoint files) but merges after to avoid cross-batch import churn.
4. **B4 (T5) merges fourth.** FE types + api + color util.
5. **B5 (T6 ‖ T7) merges fifth.** Hooks + primitives; either order.
6. **B6 (T8 ‖ T9) merges sixth.** Integration; either order.
7. **B7 (T10) merges last.** Verification record only.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0006_*.sql`, `backend/src/db/migrations/meta/0006_snapshot.json` | F12, F13 (DONE) | — |
| **T2** | 2 | `backend/src/services/labelService.ts`, `backend/src/services/labelService.test.ts` | T1 | — |
| **T3** | 2 | `backend/src/routes/labels.routes.ts`, `backend/src/routes/labels.schema.ts`, `backend/src/routes/labels.routes.test.ts`, `backend/src/routes/projects.routes.ts`, `backend/src/index.ts` | T2 | — |
| **T4** | 3 | `backend/src/services/ticketService.ts`, `backend/src/services/ticketService.test.ts`, `backend/src/services/boardService.ts`, `backend/src/services/boardService.test.ts`, `backend/src/routes/projects.schema.ts`, `backend/src/routes/tickets.schema.ts`, `backend/src/routes/tickets.routes.test.ts` | T1 | T2/T3 (disjoint files) |
| **T5** | 4 | `frontend/package.json`, `frontend/src/types/label.ts`, `frontend/src/types/ticket.ts`, `frontend/src/api/queryKeys.ts`, `frontend/src/api/labels.ts`, `frontend/src/api/labels.test.ts`, `frontend/src/api/tickets.ts`, `frontend/src/utils/color.ts`, `frontend/src/utils/color.test.ts` | T3, T4 (contracts) | — |
| **T6** | 5 | `frontend/src/hooks/useLabels.ts`, `frontend/src/hooks/useLabels.test.ts`, `frontend/src/hooks/useLabelMutations.ts`, `frontend/src/hooks/useLabelMutations.test.ts` | T5 | T7 |
| **T7** | 5 | `frontend/src/components/LabelChip.tsx`, `frontend/src/components/LabelChip.test.tsx`, `frontend/src/components/LabelMultiSelect.tsx`, `frontend/src/components/LabelMultiSelect.test.tsx` | T5 | T6 |
| **T8** | 6 | `frontend/src/components/TicketCard.tsx`, `frontend/src/components/TicketCard.test.tsx`, `frontend/src/components/TicketAttributeForm.tsx`, `frontend/src/components/TicketAttributeForm.test.tsx` | T6, T7 | T9 |
| **T9** | 6 | `frontend/src/components/LabelManager.tsx`, `frontend/src/components/LabelManager.test.tsx`, `frontend/src/pages/ProjectSettingsPage.tsx`, `frontend/src/pages/ProjectSettingsPage.test.tsx`, `frontend/src/routes/index.tsx` | T6, T7 | T8 |
| **T10** | 7 | (verification record only) | T1–T9 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → (T2 → T3) → T4 → T5 → (T6 ‖ T7) → (T8 ‖ T9) → T10. ~3 days.
- **2 devs (max parallelism):**
    - **Dev-A (backend):** T1 → (T2 → T3) → T4.
    - **Dev-B (frontend):** waits for B1 + B2/B3 contracts, then T5 → (T6 ‖ T7) → (T8 ‖ T9) → help T10.
    - Merge order: B1 → (B2 → B3) → B4 → (B5 → B6) → B7.
- **3 devs:**
    - Dev-A: backend label service/routes (T2, T3).
    - Dev-B: backend ticket/board integration (T4) — branches after T1, merges after B2.
    - Dev-C: waits, then frontend track (T5 → T6 ‖ T7 → T8 ‖ T9).
    - All converge on T10.

---

## 6. Tasks

### T1 — BE schema: add `Labels` + `ticket_labels`; migration with backfill + drop jsonb

**Batch:** 1 · **Depends on:** F12, F13 (DONE) · **Parallel with:** —

**Description:** The schema spine for every later task. Add two tables to `backend/src/db/schema.ts` following the conventions confirmed in §2 (snake_case column names, camelCase keys, `uuid` PK `defaultRandom()`, UTC `timestamptz` with `$onUpdate`, PascalCase table names). Then generate the migration, hand-edit the `$1` partial-index bug (memory `drizzle-partial-index-enum-dollar1`), append backfill SQL that migrates existing `tickets.labels: string[]` into the join, and finally drop the legacy jsonb column. Single-shot migration — no two-cycle keep-legacy path.

Modify `backend/src/db/schema.ts`:
```typescript
// Add after the tickets table:

export const labels = pgTable('Labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull(),  // normalized #RRGGBB uppercase
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => ({
  // Reject duplicate label names per project (features.md:321 edge case).
  projectLabelNameUniq: uniqueIndex('labels_project_name_uniq').on(t.projectId, t.name),
}));

export const ticketLabels = pgTable('TicketLabels', {
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  labelId: uuid('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.ticketId, t.labelId] }),
  labelIdx: index('ticket_labels_label_id_idx').on(t.labelId),
}));
```

Remove the existing `labels` jsonb column from the `tickets` table (`schema.ts:114`) — the migration will drop it after backfilling.

Then:
- Run `npm run db:generate -w backend` → produces `0006_<auto-name>.sql` + `meta/0006_snapshot.json`.
- **Inspect `0006_*.sql`** for the `drizzle-partial-index-enum-dollar1` bug: any `WHERE "role" = $1` in the F06 `usersOneAdminIdx` partial index must be hand-edited to `WHERE "role" = 'ADMIN'`.
- Append backfill SQL to `0006_*.sql` (before any `DROP TABLE` or column drop; AFTER the `CREATE TABLE` for `Labels` and `TicketLabels`):

```sql
-- Backfill: migrate tickets.labels jsonb string[] -> Labels + TicketLabels.
-- Per project, dedupe distinct label strings, assign default color, link via join.
-- (F12 T1 precedent: INSERT ... SELECT ... ON CONFLICT DO NOTHING.)
INSERT INTO "Labels" ("project_id", "name", "color", "created_at", "updated_at")
SELECT DISTINCT t."project_id", elem AS "name", '#6B7280' AS "color", NOW(), NOW()
FROM "Tickets" t,
     jsonb_array_elements_text(t."labels") AS elem
ON CONFLICT DO NOTHING;  -- unique (project_id, name) dedupes

-- Link tickets to backfilled labels.
INSERT INTO "TicketLabels" ("ticket_id", "label_id", "assigned_at")
SELECT t."id", l."id", NOW()
FROM "Tickets" t,
     jsonb_array_elements_text(t."labels") AS elem
JOIN "Labels" l ON l."project_id" = t."project_id" AND l."name" = elem
ON CONFLICT DO NOTHING;

-- Finally drop the legacy jsonb column.
ALTER TABLE "Tickets" DROP COLUMN IF EXISTS "labels";
```

(If Drizzle's generator already emitted the `DROP COLUMN`, do not duplicate it — remove from the hand-appended block.)

**Acceptance Criteria:**
- [ ] `backend/src/db/schema.ts` exports `labels` and `ticketLabels` tables.
- [ ] `labels` has `id, projectId, name, color, createdAt, updatedAt` + `uniqueIndex('labels_project_name_uniq').on(projectId, name)`.
- [ ] `ticketLabels` has composite PK `(ticketId, labelId)` + `index('ticket_labels_label_id_idx').on(labelId)` + both FKs `ON DELETE CASCADE`.
- [ ] The legacy `tickets.labels` jsonb column is removed from `schema.ts`.
- [ ] `npm run db:generate -w backend` produced `0006_*.sql` + `meta/0006_snapshot.json`.
- [ ] `0006_*.sql` inspected: any `WHERE "role" = $1` hand-edited to `'ADMIN'` (memory `drizzle-partial-index-enum-dollar1`).
- [ ] `0006_*.sql` contains backfill `INSERT INTO Labels ... SELECT DISTINCT ... FROM Tickets, jsonb_array_elements_text(...)` with `ON CONFLICT DO NOTHING`.
- [ ] `0006_*.sql` contains backfill `INSERT INTO TicketLabels ... JOIN Labels ...` with `ON CONFLICT DO NOTHING`.
- [ ] `0006_*.sql` contains `ALTER TABLE Tickets DROP COLUMN labels` (after backfill).
- [ ] `npm run db:migrate -w backend` applies cleanly against a dev DB (or `db:push` for local).
- [ ] `rtk tsc` (BE) passes.
- [ ] No other migration files modified (idx 0–5 untouched).

**Dependencies:** F12, F13 (DONE — existing `tickets.labels` jsonb to backfill).

---

### T2 — BE labelService + tests

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** —

**Description:** Service layer for the label catalog. Pure data-access functions over `db` (follow precedent — services query `db` directly, no repositories layer). Includes a `hydrateLabelsForTickets` helper used by `boardService` (T4) to batch-fetch labels per ticket set.

Create `backend/src/services/labelService.ts`:
```typescript
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { labels, ticketLabels, projects, tickets } from '../db/schema'
import { AppError } from '../utils/appError'

export type LabelRow = typeof labels.$inferSelect
export type HydratedLabel = { id: string; name: string; color: string }

export async function listLabels(projectSlug: string): Promise<HydratedLabel[]> {
  const rows = await db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .innerJoin(projects, eq(labels.projectId, projects.id))
    .where(eq(projects.slug, projectSlug))
    .orderBy(labels.name)
  return rows
}

export async function createLabel(args: {
  projectSlug: string
  name: string
  color: string  // already normalized by Zod transform
}): Promise<LabelRow> {
  const project = await db.select().from(projects).where(eq(projects.slug, args.projectSlug)).limit(1)
  if (!project[0]) throw new AppError('NOT_FOUND', 'Project not found')
  try {
    const inserted = await db.insert(labels).values({
      projectId: project[0].id,
      name: args.name,
      color: args.color,
    }).returning()
    if (!inserted[0]) throw new AppError('INTERNAL_ERROR', 'Insert returned no row')
    return inserted[0]
  } catch (err: unknown) {
    // unique (project_id, name) violation
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'Label name already exists in this project')
    throw err
  }
}

export async function updateLabel(args: {
  labelId: string
  patch: { name?: string; color?: string }
}): Promise<{ old: LabelRow; new: LabelRow }> {
  const oldRows = await db.select().from(labels).where(eq(labels.id, args.labelId)).limit(1)
  if (!oldRows[0]) throw new AppError('NOT_FOUND', 'Label not found')
  const set: Partial<LabelRow> = { updatedAt: new Date() }
  if (args.patch.name !== undefined) set.name = args.patch.name
  if (args.patch.color !== undefined) set.color = args.patch.color
  try {
    const updated = await db.update(labels).set(set).where(eq(labels.id, args.labelId)).returning()
    if (!updated[0]) throw new AppError('INTERNAL_ERROR', 'Update returned no row')
    return { old: oldRows[0], new: updated[0] }
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw new AppError('CONFLICT', 'Label name already exists in this project')
    throw err
  }
}

export async function deleteLabel(labelId: string): Promise<{ id: string }> {
  const deleted = await db.delete(labels).where(eq(labels.id, labelId)).returning({ id: labels.id })
  if (!deleted[0]) throw new AppError('NOT_FOUND', 'Label not found')
  // ON DELETE CASCADE removes ticket_labels rows automatically.
  return deleted[0]
}

/** Batch-fetch hydrated labels for a set of ticket IDs. Used by boardService. */
export async function hydrateLabelsForTickets(ticketIds: string[]): Promise<Map<string, HydratedLabel[]>> {
  const map = new Map<string, HydratedLabel[]>()
  if (ticketIds.length === 0) return map
  const rows = await db
    .select({
      ticketId: ticketLabels.ticketId,
      labelId: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(ticketLabels)
    .innerJoin(labels, eq(ticketLabels.labelId, labels.id))
    .where(inArray(ticketLabels.ticketId, ticketIds))
  for (const r of rows) {
    const arr = map.get(r.ticketId) ?? []
    arr.push({ id: r.labelId, name: r.name, color: r.color })
    map.set(r.ticketId, arr)
  }
  return map
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505'
}

/** Replace a ticket's label set (DELETE removed, INSERT added). Validates all labelIds belong to the same project. */
export async function replaceTicketLabels(args: {
  ticketId: string
  labelIds: string[]
}): Promise<void> {
  const ticket = await db.select().from(tickets).where(eq(tickets.id, args.ticketId)).limit(1)
  if (!ticket[0]) throw new AppError('NOT_FOUND', 'Ticket not found')

  // Validate all labels belong to the same project.
  if (args.labelIds.length > 0) {
    const found = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, ticket[0].projectId), inArray(labels.id, args.labelIds)))
    if (found.length !== args.labelIds.length) {
      throw new AppError('VALIDATION_FAILED', 'One or more labels do not belong to this project')
    }
  }

  await db.delete(ticketLabels).where(eq(ticketLabels.ticketId, args.ticketId))
  if (args.labelIds.length > 0) {
    await db.insert(ticketLabels).values(
      args.labelIds.map((labelId) => ({ ticketId: args.ticketId, labelId })),
    )
  }
}
```

Create `backend/src/services/labelService.test.ts` — table-driven + scenario tests:
- `listLabels`: empty project, labels sorted by name, only returns labels for the given slug.
- `createLabel`: creates with normalized color; duplicate name → `CONFLICT`; missing project → `NOT_FOUND`.
- `updateLabel`: rename + recolor; duplicate name on rename → `CONFLICT`; missing label → `NOT_FOUND`; returns `{ old, new }`.
- `deleteLabel`: deletes label; cascade-removes joins (verify via mock or integration); missing label → `NOT_FOUND`.
- `hydrateLabelsForTickets`: empty input → empty map; single ticket with labels; multiple tickets; ticket with no labels → empty array in map.
- `replaceTicketLabels`: sets new set; validates project membership (foreign label → `VALIDATION_FAILED`); empty set clears all.

Use `vi.hoisted` + Drizzle chain mock (matches existing `ticketService.test.ts` style).

**Acceptance Criteria:**
- [ ] `labelService.ts` exports `listLabels`, `createLabel`, `updateLabel`, `deleteLabel`, `hydrateLabelsForTickets`, `replaceTicketLabels`, `LabelRow`, `HydratedLabel`.
- [ ] `createLabel` on duplicate name throws `AppError('CONFLICT', ...)`.
- [ ] `createLabel` on missing project throws `AppError('NOT_FOUND', ...)`.
- [ ] `updateLabel` returns `{ old, new }`.
- [ ] `deleteLabel` on missing label throws `AppError('NOT_FOUND', ...)`.
- [ ] `hydrateLabelsForTickets([])` returns empty map without querying.
- [ ] `replaceTicketLabels` validates all labelIds belong to the ticket's project; foreign label → `VALIDATION_FAILED`.
- [ ] `replaceTicketLabels` with empty array clears all joins.
- [ ] Coverage of new service code > 80%.
- [ ] No `any`; `import type` for `LabelRow`, `HydratedLabel`.

**Dependencies:** T1 (`labels`, `ticketLabels` tables in schema).

---

### T3 — BE labels.routes + labels.schema + mount + tests

**Batch:** 2 · **Depends on:** T2 · **Parallel with:** —

**Description:** HTTP surface for the label catalog. RESTful: project-scoped list/create nested under `/api/projects/:slug/labels`, label-id rename/recolor/delete flat under `/api/labels/:id`. Reads open to members (`authenticate`); writes admin-only (`authenticate` + `requireRole('ADMIN')`) — mirrors `POST /api/projects` precedent (F08).

Create `backend/src/routes/labels.schema.ts`:
```typescript
import { z } from 'zod'

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/

export const hexColorSchema = z
  .string()
  .regex(HEX_RE, 'Invalid hex color')
  .transform((h) => {
    const clean = h.slice(1).toUpperCase()
    return clean.length === 3
      ? '#' + clean.split('').map((c) => c + c).join('')
      : '#' + clean
  })

export const slugParam = z.object({ slug: z.string().min(1) })

export const labelIdParam = z.object({ id: z.uuid() })

export const createLabelBody = z.object({
  name: z.string().min(1).max(50),
  color: hexColorSchema,
})

export const updateLabelBody = z
  .object({
    name: z.string().min(1).max(50).optional(),
    color: hexColorSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Body must include at least one field' })
```

Create `backend/src/routes/labels.routes.ts`:
```typescript
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/requireRole'
import { validateRequest } from '../middleware/validateRequest'
import { success } from '../utils/envelope'
import {
  slugParam, labelIdParam, createLabelBody, updateLabelBody,
} from './labels.schema'
import {
  listLabels, createLabel, updateLabel, deleteLabel,
} from '../services/labelService'

// Nested under /api/projects/:slug — list + create.
export const projectLabelsRouter = Router()

projectLabelsRouter.get(
  '/labels',
  authenticate,
  validateRequest({ params: slugParam }),
  async (req, res) => {
    const { slug } = req.params
    const rows = await listLabels(slug)
    res.json(success(rows))
  },
)

projectLabelsRouter.post(
  '/labels',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ params: slugParam, body: createLabelBody }),
  async (req, res) => {
    const { slug } = req.params
    const created = await createLabel({ projectSlug: slug, name: req.body.name, color: req.body.color })
    res.status(201).json(success(created))
  },
)

// Flat under /api/labels/:id — update + delete.
export const labelsRouter = Router()

labelsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ params: labelIdParam, body: updateLabelBody }),
  async (req, res) => {
    const { id } = req.params
    const { new: updated } = await updateLabel({ labelId: id, patch: req.body })
    res.json(success(updated))
  },
)

labelsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ params: labelIdParam }),
  async (req, res) => {
    const { id } = req.params
    const removed = await deleteLabel(id)
    res.json(success(removed))
  },
)
```

Modify `backend/src/routes/projects.routes.ts` — mount `projectLabelsRouter` nested:
```typescript
import { projectLabelsRouter } from './labels.routes'
// ...
projectsRouter.use('/', projectLabelsRouter)  // GET/POST /:slug/labels
```

Modify `backend/src/index.ts` — mount flat `labelsRouter`:
```typescript
import { labelsRouter } from './routes/labels.routes'
// ...
app.use('/api/labels', labelsRouter)  // PATCH/DELETE /:id
```

Create `backend/src/routes/labels.routes.test.ts` — supertest scenarios (use `vi.hoisted` env + `vi.mock` for `labelService`):
- `GET /api/projects/:slug/labels` 401 without token; 200 with `{ data: HydratedLabel[] }` with token; sorted by name.
- `POST /api/projects/:slug/labels` 401 without token; 403 for member (non-admin); 201 for admin with `{ data: LabelRow }`; 400 `VALIDATION_FAILED` for invalid hex (`#GGGGGG`); 400 for 3-char hex accepted + normalized (`#abc` → `#AABBCC`); 409 `CONFLICT` for duplicate name.
- `PATCH /api/labels/:id` 401 without token; 403 for member; 200 for admin with `{ data: LabelRow }`; 400 for non-uuid param; 400 for empty body; 404 for missing id.
- `DELETE /api/labels/:id` 401 without token; 403 for member; 200 for admin with `{ data: { id } }`; 404 for missing id.

**Acceptance Criteria:**
- [ ] `GET /api/projects/:slug/labels` returns 200 `{ data: HydratedLabel[] }` behind `authenticate`; sorted by name.
- [ ] `POST /api/projects/:slug/labels` returns 201 behind `authenticate` + `requireRole('ADMIN')`; member gets 403.
- [ ] `POST` accepts 3-digit hex and normalizes to 6-digit uppercase in the response (`#abc` → `#AABBCC`).
- [ ] `POST` with invalid hex returns 400 `VALIDATION_FAILED`.
- [ ] `POST` duplicate name returns 409 `CONFLICT`.
- [ ] `PATCH /api/labels/:id` returns 200 behind admin; member gets 403.
- [ ] `PATCH` empty body returns 400.
- [ ] `PATCH` non-uuid id returns 400.
- [ ] `DELETE /api/labels/:id` returns 200 `{ data: { id } }` behind admin; member gets 403.
- [ ] `projectLabelsRouter` mounted nested under `projectsRouter`; `labelsRouter` mounted at `/api/labels`.
- [ ] Coverage of new route code > 80%.
- [ ] No `any`; `import type` for `LabelRow`, `HydratedLabel`.

**Dependencies:** T2 (`labelService`). Decision D6 (route shape).

---

### T4 — BE ticketService label patch + boardService label hydration + schema widenings + tests

**Batch:** 3 · **Depends on:** T1 · **Parallel with:** T2/T3 (disjoint files)

**Description:** Wire the ticket-side of labels. Three changes:
1. **`ticketService.createTicket` / `updateTicket`** accept `labelIds` and apply via `replaceTicketLabels` (imported from `labelService` — or duplicate logic here if you prefer no cross-service import; recommend importing the helper). Preserve the `{ old, new }` seam for F18.
2. **`boardService.getBoard`** hydrates `labels: { id, name, color }[]` per ticket via `hydrateLabelsForTickets` (batch fetch — one query for all board tickets).
3. **Zod schemas** widen: `createTicketBody.labels` changes from `z.array(z.string())` to `z.array(z.string().uuid())`; `updateTicketBody` gains `labelIds: z.array(z.string().uuid()).optional()`.

Modify `backend/src/services/ticketService.ts`:
```typescript
import { replaceTicketLabels, hydrateLabelsForTickets } from './labelService'  // or inline

// In createTicket: after ticket insert, if input.labelIds provided, call replaceTicketLabels({ ticketId, labelIds }).

// In updateTicket:
//   - Snapshot old labelIds (query ticket_labels).
//   - If patch.labelIds !== undefined, call replaceTicketLabels({ ticketId, labelIds: patch.labelIds }).
//   - Return { old: { ...oldRow, labelIds: oldLabelIds }, new: { ...newRow, labelIds: patch.labelIds ?? oldLabelIds } }.
```

Modify `backend/src/services/boardService.ts`:
```typescript
import { hydrateLabelsForTickets } from './labelService'

// In getBoard: after fetching tickets, batch-fetch labels:
const ticketIds = rows.map(r => r.id)
const labelMap = await hydrateLabelsForTickets(ticketIds)
// Build each BoardTicket with labels: labelMap.get(ticketId) ?? []
```

Modify `backend/src/routes/projects.schema.ts:41` — `createTicketBody`:
```typescript
labels: z.array(z.string().uuid()).optional(),  // was z.array(z.string())
// (Consider renaming to labelIds for symmetry; if renaming, update createTicket service + FE DTO.)
```
Recommend renaming `labels` → `labelIds` across create/update DTOs for consistency. If renaming, update F12/F13 consumers atomically in this task.

Modify `backend/src/routes/tickets.schema.ts` — `updateTicketBody`:
```typescript
const attributeFields = {
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),  // NEW — F14
}
```

Modify tests:
- `backend/src/services/ticketService.test.ts` — append label patch tests: `updateTicket` with `labelIds` replaces set; foreign-project label → `VALIDATION_FAILED`; empty array clears; returns `{ old, new }` with label sets diffed; create with `labelIds` links them.
- `backend/src/services/boardService.test.ts` — append label hydration: tickets with labels render `{ id, name, color }[]`; ticket with no labels renders `[]`.
- `backend/src/routes/tickets.routes.test.ts` — append `PATCH /:id` with `labelIds` → 200, labels replaced; non-uuid labelId → 400.

**Acceptance Criteria:**
- [ ] `ticketService.updateTicket` accepts `labelIds` in patch; calls `replaceTicketLabels`.
- [ ] `updateTicket` returns `{ old, new }` with label sets included.
- [ ] `ticketService.createTicket` accepts `labelIds`; links via `replaceTicketLabels`.
- [ ] `boardService.getBoard` returns `labels: { id, name, color }[]` per ticket (hydrated in a single batch query, not N+1).
- [ ] Ticket with no labels renders `labels: []` on the board.
- [ ] `createTicketBody.labels` (or `labelIds`) accepts `uuid().array()`.
- [ ] `updateTicketBody` accepts `labelIds: uuid().array().optional()`.
- [ ] `PATCH /api/tickets/:id` with foreign-project label returns 400 `VALIDATION_FAILED`.
- [ ] Coverage of new/modified code > 80%.
- [ ] No `any`; `import type` for `HydratedLabel`.

**Dependencies:** T1 (schema). Imports `replaceTicketLabels` + `hydrateLabelsForTickets` from T2 (coordinate merge — if branching B3 before B2 merges, inline the helpers instead and refactor when both land).

---

### T5 — FE deps + Label type + labelKeys + api/labels + color util + tests

**Batch:** 4 · **Depends on:** T3, T4 (HTTP contracts stable) · **Parallel with:** —

**Description:** Frontend foundation. Install `react-colorful` (color picker for the LabelManager). Add the `Label` type and DTOs. Widen `Ticket.labels` from `string[]` to `Label[]`. Add `labelKeys` to the query-keys module. Add the `labels` API client module. Add `readableTextColor` WCAG luminance helper for chip contrast.

Modify `frontend/package.json`:
- Add `"react-colorful": "^5.6.0"` (latest stable, React 19-compatible). Run `npm install -w frontend`.

Create `frontend/src/types/label.ts`:
```typescript
export interface Label {
    id: string
    name: string
    color: string  // #RRGGBB
}

export interface CreateLabelDto {
    name: string
    color: string
}

export interface UpdateLabelDto {
    name?: string
    color?: string
}
```

Modify `frontend/src/types/ticket.ts`:
```typescript
import type { Label } from './label'

export interface Ticket {
    id: string
    ticketNumber: number
    projectId: string
    title: string
    description: string | null
    statusColumn: string
    position: number
    priority: Priority
    labels: Label[]  // was string[] — F14
    assignee: Assignee | null
    creatorId: string
    createdAt: string
    updatedAt: string
}

export interface UpdateTicketDto {
    title?: string
    description?: string | null
    priority?: Priority
    assigneeId?: string | null
    labelIds?: string[]  // NEW — F14
}

export interface CreateTicketDto {
    title: string
    description?: string | null
    priority?: Priority
    assigneeId?: string | null
    labelIds?: string[]  // NEW — F14 (renamed from labels)
}
```

Modify `frontend/src/api/queryKeys.ts`:
```typescript
export const labelKeys = {
    all: ['labels'] as const,
    forProject: (slug: string) => [...labelKeys.all, 'project', slug] as const,
    detail: (id: string) => [...labelKeys.all, 'detail', id] as const,
}
```

Create `frontend/src/api/labels.ts`:
```typescript
import { apiFetch } from './client'
import type { Label, CreateLabelDto, UpdateLabelDto } from '../types/label'

export async function listLabels(projectSlug: string): Promise<Label[]> {
    return apiFetch<Label[]>(`/projects/${projectSlug}/labels`)
}

export async function createLabel(projectSlug: string, dto: CreateLabelDto): Promise<Label> {
    return apiFetch<Label>(`/projects/${projectSlug}/labels`, {
        method: 'POST',
        body: JSON.stringify(dto),
    })
}

export async function updateLabel(labelId: string, dto: UpdateLabelDto): Promise<Label> {
    return apiFetch<Label>(`/labels/${labelId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
    })
}

export async function deleteLabel(labelId: string): Promise<{ id: string }> {
    return apiFetch<{ id: string }>(`/labels/${labelId}`, {
        method: 'DELETE',
    })
}
```

Create `frontend/src/api/labels.test.ts` — mock `apiFetch`, assert URL/method/body for each function.

Create `frontend/src/utils/color.ts`:
```typescript
/** WCAG luminance-based text color picker. Returns black or white for readable contrast on a hex background. */
export function readableTextColor(hex: string): '#000000' | '#FFFFFF' {
    const h = hex.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    const lin = (c: number) =>
        c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return L > 0.179 ? '#000000' : '#FFFFFF'
}
```

Create `frontend/src/utils/color.test.ts` — table-driven:
- White `#FFFFFF` → black text.
- Black `#000000` → white text.
- Red `#FF0000` → white text.
- Yellow `#FFFF00` → black text.
- Mid-gray `#6B7280` → white text.

Modify `frontend/src/api/tickets.ts` — update `CreateTicketDto` / `UpdateTicketDto` usage to carry `labelIds`.

**Acceptance Criteria:**
- [ ] `npm install -w frontend react-colorful` succeeds.
- [ ] `frontend/src/types/label.ts` exports `Label`, `CreateLabelDto`, `UpdateLabelDto`.
- [ ] `Ticket.labels` is `Label[]` (not `string[]`).
- [ ] `UpdateTicketDto` and `CreateTicketDto` include `labelIds?: string[]`.
- [ ] `labelKeys.forProject(slug)` and `labelKeys.detail(id)` exist.
- [ ] `listLabels`, `createLabel`, `updateLabel`, `deleteLabel` call the correct URLs with correct methods.
- [ ] `readableTextColor('#FFFFFF')` === `'#000000'`; `readableTextColor('#000000')` === `'#FFFFFF'`.
- [ ] `rtk tsc` (FE) passes.
- [ ] No `any`; `import type` for `Label`, DTOs.

**Dependencies:** T3, T4 (HTTP contracts: label CRUD + ticket label patch + board hydration).

---

### T6 — FE hooks: useLabels + useLabelMutations + tests

**Batch:** 5 · **Depends on:** T5 · **Parallel with:** T7

**Description:** React Query hooks for the label catalog. `useLabels(slug)` is a simple `useQuery`. `useLabelMutations` exposes three optimistic mutations (create, update, delete) that update the `labelKeys.forProject(slug)` cache and invalidate `boardKeys.all` on settle (board cards need re-render when labels change).

Create `frontend/src/hooks/useLabels.ts`:
```typescript
import { useQuery } from '@tanstack/react-query'
import { listLabels } from '../api/labels'
import { labelKeys } from '../api/queryKeys'

export function useLabels(projectSlug: string) {
    return useQuery({
        queryKey: labelKeys.forProject(projectSlug),
        queryFn: () => listLabels(projectSlug),
        staleTime: 60_000,
    })
}
```

Create `frontend/src/hooks/useLabelMutations.ts`:
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createLabel, updateLabel, deleteLabel } from '../api/labels'
import { labelKeys } from '../api/queryKeys'
import { boardKeys } from '../api/queryKeys'
import type { Label, CreateLabelDto, UpdateLabelDto } from '../types/label'

export function useCreateLabel(projectSlug: string) {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (dto: CreateLabelDto) => createLabel(projectSlug, dto),
        onSettled: () => {
            qc.invalidateQueries({ queryKey: labelKeys.forProject(projectSlug) })
        },
    })
}

export function useUpdateLabel(projectSlug: string) {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: ({ labelId, dto }: { labelId: string; dto: UpdateLabelDto }) =>
            updateLabel(labelId, dto),
        onMutate: async ({ labelId, dto }) => {
            await qc.cancelQueries({ queryKey: labelKeys.forProject(projectSlug) })
            const prev = qc.getQueryData<Label[]>(labelKeys.forProject(projectSlug))
            if (prev) {
                qc.setQueryData<Label[]>(
                    labelKeys.forProject(projectSlug),
                    prev.map((l) => (l.id === labelId ? { ...l, ...dto } : l)),
                )
            }
            return { prev }
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(labelKeys.forProject(projectSlug), ctx.prev)
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: labelKeys.forProject(projectSlug) })
            qc.invalidateQueries({ queryKey: boardKeys.all })  // board chips may change color/name
        },
    })
}

export function useDeleteLabel(projectSlug: string) {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (labelId: string) => deleteLabel(labelId),
        onMutate: async (labelId) => {
            await qc.cancelQueries({ queryKey: labelKeys.forProject(projectSlug) })
            const prev = qc.getQueryData<Label[]>(labelKeys.forProject(projectSlug))
            if (prev) {
                qc.setQueryData<Label[]>(
                    labelKeys.forProject(projectSlug),
                    prev.filter((l) => l.id !== labelId),
                )
            }
            return { prev }
        },
        onError: (_e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(labelKeys.forProject(projectSlug), ctx.prev)
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: labelKeys.forProject(projectSlug) })
            qc.invalidateQueries({ queryKey: boardKeys.all })  // cascade-removed chips need re-render
        },
    })
}
```

Create `frontend/src/hooks/useLabels.test.ts` + `frontend/src/hooks/useLabelMutations.test.ts`:
- `useLabels`: query renders; returns data; error handling.
- `useCreateLabel`: success invalidates label list.
- `useUpdateLabel`: optimistic update applies to cache; rollback on error; invalidates label list + board.
- `useDeleteLabel`: optimistic removal from cache; rollback on error; invalidates label list + board.

**Acceptance Criteria:**
- [ ] `useLabels(slug)` uses query key `labelKeys.forProject(slug)`; staleTime 60s.
- [ ] `useCreateLabel.onSettled` invalidates label list.
- [ ] `useUpdateLabel.onMutate` snapshots + optimistically patches the label in cache.
- [ ] `useUpdateLabel.onError` rolls back.
- [ ] `useUpdateLabel.onSettled` invalidates label list + board.
- [ ] `useDeleteLabel.onMutate` optimistically removes the label from cache.
- [ ] `useDeleteLabel.onSettled` invalidates label list + board (cascade re-render).
- [ ] Coverage of new hooks > 80%.
- [ ] No `any`; `import type` throughout.

**Dependencies:** T5 (api/labels, labelKeys, Label type).

---

### T7 — FE LabelChip + LabelMultiSelect + tests

**Batch:** 5 · **Depends on:** T5 · **Parallel with:** T6

**Description:** Two reusable primitives. `LabelChip` renders a single label with correct color + WCAG-readable text via inline `style` (Tailwind JIT cannot see runtime hex). `LabelMultiSelect` is a native popover (no cmdk/Radix dep) — trigger button shows selected chips; popover lists all project labels with checkbox + color dot + name. Controlled `value: string[]` + `onChange: (ids: string[]) => void` matches the F13 primitives contract.

Create `frontend/src/components/LabelChip.tsx`:
```typescript
import type { Label } from '../types/label'
import { readableTextColor } from '../utils/color'

interface LabelChipProps {
    label: Label
    onRemove?: () => void
}

export function LabelChip({ label, onRemove }: LabelChipProps) {
    const textColor = readableTextColor(label.color)
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: label.color, color: textColor }}
        >
            {label.name}
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remove ${label.name}`}
                    className="ml-0.5 rounded-full hover:bg-black/10"
                >
                    ×
                </button>
            )}
        </span>
    )
}
```

Create `frontend/src/components/LabelChip.test.tsx`:
- Renders label name + correct inline `style.backgroundColor`.
- `onRemove` button calls handler; accessible via `getByRole('button', { name: /Remove/ })`.
- Contrast: `readableTextColor` mocked or verified via computed style for known colors.

Create `frontend/src/components/LabelMultiSelect.tsx`:
```typescript
import { useState, useRef, useEffect } from 'react'
import type { Label } from '../types/label'
import { useLabels } from '../hooks/useLabels'
import { LabelChip } from './LabelChip'

interface LabelMultiSelectProps {
    projectSlug: string
    value: string[]
    onChange: (ids: string[]) => void
}

export function LabelMultiSelect({ projectSlug, value, onChange }: LabelMultiSelectProps) {
    const { data: labels = [], isLoading } = useLabels(projectSlug)
    const [open, setOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Close on outside click.
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const selected = labels.filter((l: Label) => value.includes(l.id))

    function toggle(id: string) {
        if (value.includes(id)) onChange(value.filter((v: string) => v !== id))
        else onChange([...value, id])
    }

    return (
        <div ref={containerRef} className="relative">
            <span className="mb-1 block text-sm font-medium">Labels</span>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="Labels"
                aria-expanded={open}
                className="flex min-h-[40px] w-full flex-wrap items-center gap-1 rounded border border-gray-300 p-2 text-left"
                disabled={isLoading}
            >
                {selected.length === 0 && <span className="text-gray-400">No labels</span>}
                {selected.map((l: Label) => (
                    <LabelChip key={l.id} label={l} />
                ))}
            </button>
            {open && (
                <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border border-gray-300 bg-white shadow-lg">
                    {labels.length === 0 && (
                        <div className="p-2 text-sm text-gray-500">No labels defined</div>
                    )}
                    {labels.map((l: Label) => (
                        <label
                            key={l.id}
                            className="flex cursor-pointer items-center gap-2 p-2 hover:bg-gray-100"
                        >
                            <input
                                type="checkbox"
                                checked={value.includes(l.id)}
                                onChange={() => toggle(l.id)}
                                className="h-4 w-4"
                            />
                            <span
                                className="inline-block h-3 w-3 rounded-full"
                                style={{ backgroundColor: l.color }}
                            />
                            <span className="text-sm">{l.name}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    )
}
```

Create `frontend/src/components/LabelMultiSelect.test.tsx`:
- Renders trigger button accessible via `getByRole('button', { name: 'Labels' })`.
- Click opens popover; lists all labels from mocked `useLabels`.
- Selected labels render as `<LabelChip>` in the trigger.
- Toggling checkbox fires `onChange` with added/removed id.
- Outside click closes popover.
- Loading state disables trigger.

**Acceptance Criteria:**
- [ ] `LabelChip` renders label name with inline `style.backgroundColor = label.color`.
- [ ] `LabelChip` text color computed via `readableTextColor(label.color)`.
- [ ] `LabelChip` `onRemove` button accessible via `getByRole('button', { name: /Remove/ })`.
- [ ] `LabelMultiSelect` trigger accessible via `getByRole('button', { name: 'Labels' })`; `aria-expanded` reflects open state.
- [ ] Popover lists all project labels with checkbox + color dot + name.
- [ ] Selected labels render as chips in the trigger.
- [ ] Toggling checkbox fires `onChange` with the correct added/removed id.
- [ ] Outside click closes the popover.
- [ ] Loading state disables the trigger.
- [ ] No `any`; `import type` for `Label`.
- [ ] Prettier + ESLint clean.

**Dependencies:** T5 (`Label` type, `useLabels` via T6 is NOT a dependency — T7 imports `useLabels` but the hook is in T6; since T6 and T7 are parallel within B5, either sequence them T6 → T7 or stub the hook import in T7 tests). **Recommended:** sequence T6 → T7 to avoid stub churn, OR accept a soft dependency (T7 tests mock `useLabels` directly without needing T6's file — this works since the hook is imported by name). Pick the parallel-with-mock approach; tests mock the hook.

---

### T8 — FE TicketCard LabelChip + TicketAttributeForm LabelMultiSelect + useUpdateTicket labelIds + tests

**Batch:** 6 · **Depends on:** T6, T7 · **Parallel with:** T9

**Description:** Wire labels into the board card and ticket form. Three integration points:
1. **`TicketCard.tsx:39-50`** — replace the plain `<li>` label chips with `<LabelChip>` using the hydrated `Label[]` from the board payload.
2. **`TicketAttributeForm.tsx`** — add a `LabelMultiSelect` field. RHF schema gains `labelIds: z.array(z.string().uuid())`; `setValue`/`watch` bridge to the controlled select (matches F13 primitives pattern).
3. **`useUpdateTicket`** — for `labelIds` patches, **invalidate** `boardKeys.all` on settle (cannot optimistically render correct colors without the join — the patch carries IDs, the board carries hydrated `Label[]`). Keep F13's optimistic path for title/priority/assignee.

Modify `frontend/src/components/TicketCard.tsx` (the labels block at `:39-50`):
```tsx
// Before:
// {ticket.labels.map((label: string) => (
//     <li key={label} className="... bg-secondary">{label}</li>
// ))}

// After:
{ticket.labels.map((label: Label) => (
    <li key={label.id}>
        <LabelChip label={label} />
    </li>
))}
```

Modify `frontend/src/components/TicketAttributeForm.tsx`:
```typescript
import { LabelMultiSelect } from './LabelMultiSelect'

const schema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
    assigneeId: z.string().uuid().nullable(),
    labelIds: z.array(z.string().uuid()).default([]),  // NEW — F14
})

// In the form body, after UserSelect:
<LabelMultiSelect
    projectSlug={projectSlug}
    value={watch('labelIds')}
    onChange={(ids: string[]) => setValue('labelIds', ids)}
/>
```
(Requires `projectSlug` prop on `TicketAttributeForm` — add to the props interface; thread from `CreateTicketModal` / `EditTicketModal` which already have the slug.)

Modify `frontend/src/hooks/useUpdateTicket.ts`:
```typescript
// In onSettled, detect if the patch included labelIds:
onSettled: (_data, _err, vars) => {
    qc.invalidateQueries({ queryKey: boardKeys.all })
    qc.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) })
    if (vars.dto.labelIds !== undefined) {
        // Label colors come from the server join — board must refetch.
        // (boardKeys.all already invalidated above; this is explicit.)
    }
},
```
(The `applyPatchToBoard` helper for `labelIds` cannot map IDs to hydrated `Label[]` without the label catalog; rely on settle-invalidated board refetch for correct colors. Title/priority/assignee remain optimistic.)

Modify tests:
- `frontend/src/components/TicketCard.test.tsx` — labels render as `<LabelChip>` with correct colors.
- `frontend/src/components/TicketAttributeForm.test.tsx` — label select renders; selecting/deselecting updates form value; submit includes `labelIds`.
- `frontend/src/hooks/useUpdateTicket.test.ts` — labelIds patch invalidates board on settle.

**Acceptance Criteria:**
- [ ] `TicketCard` renders `<LabelChip>` for each `ticket.labels` entry (no longer plain `<li>` text).
- [ ] `TicketAttributeForm` includes a `LabelMultiSelect` field.
- [ ] `TicketAttributeForm` schema validates `labelIds: uuid().array()`.
- [ ] `TicketAttributeForm` submit calls `onSubmit` with `labelIds` included.
- [ ] `useUpdateTicket` invalidates board on settle when `labelIds` is in the patch.
- [ ] F13 optimistic path for title/priority/assignee preserved.
- [ ] `TicketAttributeForm` accepts a `projectSlug` prop (threaded from modals).
- [ ] No `any`; `import type` for `Label`.

**Dependencies:** T6 (useLabels — via `LabelMultiSelect`), T7 (`LabelChip`, `LabelMultiSelect`). F13 (DONE — `TicketAttributeForm`, `useUpdateTicket`).

---

### T9 — FE LabelManager + ProjectSettingsPage + route + tests

**Batch:** 6 · **Depends on:** T6, T7 · **Parallel with:** T8

**Description:** The admin label-management surface. Inline CRUD pattern (Linear/Trello): create row at top, each label row has an inline rename input, a color swatch that opens a `react-colorful` popover, and a trash button with confirm. Hosted on a new project-scoped settings page at `/projects/:slug/settings`.

Create `frontend/src/components/LabelManager.tsx`:
```typescript
import { useState } from 'react'
import { HexColorPicker, HexColorInput } from 'react-colorful'
import { useLabels } from '../hooks/useLabels'
import { useCreateLabel, useUpdateLabel, useDeleteLabel } from '../hooks/useLabelMutations'
import { LabelChip } from './LabelChip'
import { readableTextColor } from '../utils/color'

interface LabelManagerProps {
    projectSlug: string
}

const DEFAULT_COLOR = '#6B7280'

export function LabelManager({ projectSlug }: LabelManagerProps) {
    const { data: labels = [] } = useLabels(projectSlug)
    const createMut = useCreateLabel(projectSlug)
    const updateMut = useUpdateLabel(projectSlug)
    const deleteMut = useDeleteLabel(projectSlug)

    const [newName, setNewName] = useState('')
    const [newColor, setNewColor] = useState(DEFAULT_COLOR)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [editColor, setEditColor] = useState('')
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    function handleCreate() {
        if (!newName.trim()) return
        createMut.mutate({ name: newName.trim(), color: newColor })
        setNewName('')
        setNewColor(DEFAULT_COLOR)
    }

    function startEdit(id: string, name: string, color: string) {
        setEditingId(id)
        setEditName(name)
        setEditColor(color)
    }

    function saveEdit() {
        if (!editingId || !editName.trim()) return
        updateMut.mutate({ labelId: editingId, dto: { name: editName.trim(), color: editColor } })
        setEditingId(null)
    }

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">Labels</h2>

            {/* Create row */}
            <div className="flex items-center gap-2">
                <span
                    className="inline-block h-6 w-6 rounded"
                    style={{ backgroundColor: newColor }}
                />
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New label name"
                    aria-label="New label name"
                    className="rounded border border-gray-300 p-1"
                />
                <HexColorInput
                    value={newColor}
                    onChange={setNewColor}
                    aria-label="New label color"
                    className="w-20 rounded border border-gray-300 p-1"
                />
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!newName.trim() || createMut.isPending}
                    className="rounded bg-blue-600 px-3 py-1 text-white"
                >
                    Add
                </button>
            </div>

            {/* Label list */}
            <ul className="space-y-2">
                {labels.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                        {editingId === l.id ? (
                            <>
                                <span
                                    className="inline-block h-6 w-6 rounded"
                                    style={{ backgroundColor: editColor }}
                                />
                                <HexColorPicker color={editColor} onChange={setEditColor} />
                                <HexColorInput
                                    value={editColor}
                                    onChange={setEditColor}
                                    aria-label="Edit label color"
                                    className="w-20 rounded border border-gray-300 p-1"
                                />
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    aria-label="Edit label name"
                                    className="rounded border border-gray-300 p-1"
                                />
                                <button type="button" onClick={saveEdit} className="rounded bg-green-600 px-2 py-1 text-white">Save</button>
                                <button type="button" onClick={() => setEditingId(null)} className="rounded border px-2 py-1">Cancel</button>
                            </>
                        ) : confirmDeleteId === l.id ? (
                            <>
                                <LabelChip label={l} />
                                <span className="text-sm">Delete? Removes from all tickets.</span>
                                <button
                                    type="button"
                                    onClick={() => { deleteMut.mutate(l.id); setConfirmDeleteId(null) }}
                                    className="rounded bg-red-600 px-2 py-1 text-white"
                                >Confirm</button>
                                <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded border px-2 py-1">Cancel</button>
                            </>
                        ) : (
                            <>
                                <LabelChip label={l} />
                                <button
                                    type="button"
                                    onClick={() => startEdit(l.id, l.name, l.color)}
                                    className="text-sm text-blue-600"
                                >Edit</button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(l.id)}
                                    className="text-sm text-red-600"
                                >Delete</button>
                            </>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}
```

Create `frontend/src/components/LabelManager.test.tsx`:
- Renders label list from mocked `useLabels`.
- Create row: type name + pick color + click Add → calls `createLabel` mutation.
- Edit: click Edit → rename + recolor → Save → calls `updateLabel`.
- Delete: click Delete → confirm prompt → Confirm → calls `deleteLabel`.
- Empty state: no labels → list empty.

Create `frontend/src/pages/ProjectSettingsPage.tsx`:
```typescript
import { useParams } from 'react-router-dom'
import { LabelManager } from '../components/LabelManager'

export function ProjectSettingsPage() {
    const { slug = '' } = useParams()
    return (
        <div className="mx-auto max-w-2xl p-4">
            <h1 className="mb-4 text-xl font-bold">Project Settings</h1>
            <LabelManager projectSlug={slug} />
        </div>
    )
}
```

Create `frontend/src/pages/ProjectSettingsPage.test.tsx` — renders LabelManager with slug from route.

Modify `frontend/src/routes/index.tsx` — add route:
```typescript
import { ProjectSettingsPage } from '../pages/ProjectSettingsPage'
// ...
<Route path="/projects/:slug/settings" element={<ProjectSettingsPage />} />
```

**Acceptance Criteria:**
- [ ] `LabelManager` renders the label list + create row.
- [ ] Create: entering name + color + clicking Add calls `useCreateLabel.mutate`.
- [ ] Edit: clicking Edit on a row reveals inline rename + `HexColorPicker`; Save calls `useUpdateLabel.mutate`.
- [ ] Delete: clicking Delete reveals a confirm prompt; Confirm calls `useDeleteLabel.mutate`.
- [ ] `LabelManager` accessible: inputs reachable via `getByLabelText`; buttons via `getByRole('button')`.
- [ ] `ProjectSettingsPage` renders at `/projects/:slug/settings` with `<LabelManager>`.
- [ ] Route wired in `routes/index.tsx`.
- [ ] Empty state renders without error.
- [ ] No `any`; `import type` for `Label`.
- [ ] Prettier + ESLint clean.

**Dependencies:** T6 (mutation hooks), T7 (`LabelChip`). `react-colorful` from T5.

---

### T10 — Integration verification & sign-off

**Batch:** 7 · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Inherited F11/F13 live-browser-smoke risk carries forward — F14's optimistic label patch + color picker + cascade-delete needs its own live smoke (jsdom cannot fully exercise `react-colorful` pointer events or the cascade semantics).

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations (especially `no-explicit-any`).
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on new files >80% business / >70% components.
5. **Build:** `npm run build -w frontend` — FE production build succeeds.
6. **Migration applied:** confirm `backend/src/db/migrations/0006_*.sql` applies cleanly; backfilled labels exist in `Labels` + `TicketLabels`; `Tickets.labels` column dropped.
7. **Live browser smoke (manual):**
   - Start backend + frontend locally; apply migration.
   - Log in as admin, open a project board.
   - Navigate to `/projects/:slug/settings` → LabelManager renders.
   - Create a label "Bug" with red color; create "Urgent" with orange.
   - Open a ticket → edit modal → `LabelMultiSelect` lists both labels; select both; save.
   - Card on board renders two `<LabelChip>` with correct colors + readable text.
   - Back to settings → rename "Bug" to "Defect" + recolor blue → card chip updates on board refresh.
   - Delete "Urgent" → confirm → chip disappears from the card (cascade-removed).
   - As a member (non-admin): verify `POST /api/projects/:slug/labels` returns 403; verify member can still apply existing labels to tickets.
   - Verify duplicate name create rejected with `CONFLICT` toast/error.
   - Verify 3-digit hex color input (`#abc`) normalizes to `#AABBCC`.
8. **Contrast verification:** inspect a dark-color chip (e.g. `#000000`) → text is white; light-color chip (`#FFFF00`) → text is black.
9. **Backfill verification:** if the dev DB had pre-F14 tickets with `labels: ["foo","bar"]`, confirm those now appear as `Labels` rows (color `#6B7280`) linked via `TicketLabels`.
10. **Record proof:** commit a short verification note (this file's integration record section) with commit SHAs, exit codes, and a screenshot path (or textual description of the live smoke).

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage on new files >80% / >70%.
- [ ] `npm run build -w frontend` exit 0.
- [ ] Migration `0006_*.sql` applies cleanly; `$1` bug hand-edited; backfill + drop-column succeeded.
- [ ] Live smoke: label CRUD works from settings; cards render correct colors.
- [ ] Live smoke: cascade delete removes chip from all tickets.
- [ ] Live smoke: member cannot create/update/delete labels (403); admin can.
- [ ] Live smoke: duplicate name rejected.
- [ ] Live smoke: 3-digit hex normalized.
- [ ] Live smoke: chip text contrast correct on dark + light backgrounds.
- [ ] Live smoke: backfilled free-text labels appear with default color.
- [ ] F13 drag-drop + create + attribute edit still work (inherited smoke).

**Dependencies:** all prior tasks merged.

---

## 7. Final F14 Acceptance Checklist

- [ ] `Labels` table exists with project scoping (`projectId` FK + `UNIQUE (projectId, name)`).
- [ ] `ticket_labels` join table with `ON DELETE CASCADE` on both FKs + composite PK + `label_id` index.
- [ ] Migration backfills existing `tickets.labels: string[]` into `Labels` + `TicketLabels` (default color `#6B7280`), then drops the jsonb column.
- [ ] CRUD routes: `GET /api/projects/:slug/labels`, `POST /api/projects/:slug/labels`, `PATCH /api/labels/:id`, `DELETE /api/labels/:id`.
- [ ] Admin-only writes enforced server-side (`requireRole('ADMIN')`); reads open to members.
- [ ] Hex color validation (3- and 6-digit; normalized to 6-digit uppercase via Zod transform).
- [ ] Chip contrast via `readableTextColor` (WCAG luminance).
- [ ] `LabelChip` component renders correct color + readable text on `TicketCard` + ticket modal.
- [ ] `LabelMultiSelect` in `TicketAttributeForm` (controlled `value`/`onChange` contract).
- [ ] `LabelManager` in project settings (create / rename / recolor / delete-with-confirm).
- [ ] Duplicate label name rejected per project (`CONFLICT` + DB unique constraint).
- [ ] `useUpdateTicket` invalidates board on settle for `labelIds` patches (correct colors require server join).
- [ ] `PATCH /api/tickets/:id` `{ old, new }` seam preserved for F18.
- [ ] Drizzle `$1` partial-index bug hand-edited in `0006_*.sql`.
- [ ] Board payload hydrates `labels: { id, name, color }[]` per ticket (single batch query, not N+1).
- [ ] All tests pass (Vitest BE + FE).
- [ ] Typecheck / lint / format / build all green.

**Integration record (fill during T10):**
- Feature commit SHA: `________`
- `GET /api/projects/:slug/labels` sample response: `________`
- `POST /api/projects/:slug/labels` sample response (with 3-digit hex normalization): `________`
- `PATCH /api/tickets/:id` (labelIds patch) sample response: `________`
- `GET /api/projects/:slug/board` sample ticket (with hydrated labels): `________`
- Migration applied + backfill count: `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`
- Live browser smoke: CRUD OK / cascade-delete OK / member-403 OK / duplicate-rejected OK / hex-normalized OK / contrast OK

---

## 8. Schema deltas owned by this feature

F14 owns the `Labels` schema delta flagged at features.md:576 (`Labels table (project-scoped, color)`).

| Delta | Detail | Migration |
| --- | --- | --- |
| `Labels` table | `id uuid PK defaultRandom`, `project_id uuid FK→Projects ON DELETE CASCADE NOT NULL`, `name text NOT NULL`, `color text NOT NULL (normalized #RRGGBB uppercase)`, `created_at timestamptz defaultNow NOT NULL`, `updated_at timestamptz defaultNow $onUpdate NOT NULL`, `UNIQUE (project_id, name)` | `CREATE TABLE "Labels" (...)` + `CREATE UNIQUE INDEX labels_project_name_uniq ON "Labels" ("project_id", "name")` |
| `TicketLabels` join table | `ticket_id uuid FK→Tickets ON DELETE CASCADE NOT NULL`, `label_id uuid FK→Labels ON DELETE CASCADE NOT NULL`, `assigned_at timestamptz defaultNow NOT NULL`, `PRIMARY KEY (ticket_id, label_id)`, `INDEX on label_id` | `CREATE TABLE "TicketLabels" (...)` + `CREATE INDEX ticket_labels_label_id_idx ON "TicketLabels" ("label_id")` |
| `Tickets.labels` (jsonb) | **Dropped** after backfill | `ALTER TABLE "Tickets" DROP COLUMN IF EXISTS "labels"` |
| Backfill | Migrate existing `tickets.labels: string[]` → `Labels` rows (default `#6B7280`) + `TicketLabels` joins | `INSERT INTO Labels ... SELECT DISTINCT ... FROM Tickets, jsonb_array_elements_text(labels) ON CONFLICT DO NOTHING` + `INSERT INTO TicketLabels ... SELECT ... JOIN Labels ... ON CONFLICT DO NOTHING` |

**`LABELS_CHANGED` ActivityLog action_type** (features.md:579) is **NOT** owned by F14 — tagged F18. F14 only preserves the `{ old, new }` seam on ticket label patches so F18 can diff and write the log.
