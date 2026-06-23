# F15 — Checklist: Plan + Task Breakdown

> **Feature:** F15 — Checklist (Phase 2 — Board)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F12 (DONE ✅); inherits F14 (DONE ✅), F13 (DONE ✅), F11 (DONE ✅), F10 (DONE ✅), F09 (DONE ✅), F08 (DONE ✅), F06 (DONE ✅), F05 (DONE ✅), F03 (DONE ✅) · **PRD ref:** REQ-3.2, REQ-3.3, PRD §8.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F14](../F14-labels-catalog/F14-labels-catalog-tasks.md), [F13](../F13-ticket-attributes-title-description-assignee-priority/F13-ticket-attributes-title-description-assignee-priority-tasks.md), [F12](../F12-ticket-creation-sequential-ids/F12-ticket-creation-sequential-ids-tasks.md)

---

## 1. F15 Recap

**Goal:** Ship a toggleable list of sub-items on a ticket so users can decompose work and track completion inline, with a live progress indicator on both the board card and the ticket modal.

**Ships:** A ticket carries a `checklist` JSONB array of `{ id, text, done }` items. Any authenticated user can add, edit, delete, and toggle items; each change persists immediately via the existing merged `PATCH /api/tickets/:id`. The board card shows a compact progress chip (e.g. `2/5`); the ticket modal hosts an inline `ChecklistEditor` that renders each item as a checkbox + editable text + delete control plus a header progress bar.

**Acceptance (definition of done):**
- `checklist` JSONB column on `tickets` storing an array of `{ id: string; text: string; done: boolean }`; defaults to `[]`; not null.
- Add, edit, delete, toggle items — every mutation persists to the server.
- Board card shows checklist progress (`done/total`); ticket modal shows progress and the full editable list.
- Item text length capped; max item count enforced at both edges.
- Each persisted change survives reload / 30s repoll.

**Edge cases to resolve up front:**
- **Concurrent edits to the same checklist JSONB can clobber** → **Decision: last-write-wins full-array replace.** The whole `checklist` array is sent on every save (matches the F14 labels-replace pattern via `replaceTicketLabels`). The frontend submits the full array; the backend writes it whole. Concurrent saves by two users can lose one item; this is documented and id-merge is deferred. **Justification:** simplest, consistent with F14 labels, MVP-acceptable; id-merge adds backend merge logic that is out of scope.
- **Item text length cap** → **Decision: 200 chars**, matching the ticket title cap (`backend/src/routes/tickets.schema.ts:20`). Enforced in Zod and in the modal's RHF schema (`frontend/src/components/TicketAttributeForm.tsx:13-19` mirrors title's `.max(200)`).
- **Reasonable max item count** → **Decision: 50 items**, enforced at both edges. Zod `.max(50)` on the array; the `ChecklistEditor` disables the "Add item" button at 50.
- **Reordering checklist items (drag) — in scope or defer?** → **Decision: defer (MVP no drag-reorder).** Items render in stored array order. The feature index recommends "MVP: no reorder." A later feature can add DnD reusing the `@hello-pangea/dnd` already wired into the board.
- **`ChecklistItem.id` generation** → **Decision: client-generated UUID v4.** The frontend mints a `crypto.randomUUID()` id on add; the backend validates with `z.string().uuid()` and writes it through. Server trusts the client UUID (format-validated only). **Justification:** avoids a round-trip on add; client can render the new row optimistically before persist.

---

## 2. Codebase Analysis Summary

- **State:** **Partial — one PRD-planned column missing; UI/service plumbing absent.** F12 (DONE ✅), F14 (DONE ✅), F13 (DONE ✅), F11 (DONE ✅), F10 (DONE ✅), F09 (DONE ✅), F08 (DONE ✅), F06 (DONE ✅), F05 (DONE ✅), F03 (DONE ✅) all satisfied in code. The `tickets` table does NOT have a `checklist` column today (`backend/src/db/schema.ts:98-130`), but PRD §8.3 (`basic-PRD.md:170`) enumerates `checklist | JSONB` — so the column is **PRD-planned**, not a new schema delta. Migrations `0000`–`0006` are applied; F15 = idx 7 → `0007_*.sql`.

- **Existing structure this feature builds on (with path citations):**
    - **Schema (add column, not a delta):** `backend/src/db/schema.ts`. `tickets` table at `:98-130`: `id` uuid PK (`:101`), `projectId` (`:102`), `ticketNumber` integer (`:105`), `title` text notNull (`:106`), `description` text nullable (`:107`), `statusColumn` text (`:108`), `position` doublePrecision default 0 (`:109`), `assigneeId` nullable FK (`:110`), `creatorId` FK (`:111`), `priority` enum default MEDIUM (`:114`), `createdAt`/`updatedAt` timestamptz (`:115-119`). Unique idx `(project_id, ticket_number)` at `:125-128`. **No `checklist` column.**
    - **JSONB typed-column idiom (copy verbatim):** `projects.columns` at `schema.ts:66` = `jsonb('columns').$type<Column[]>()`, with `Column` interface near `:56-59`. `jsonb` is already imported at `:11`. F15 column = `jsonb('checklist').$type<ChecklistItem[]>().notNull().default([])`, with `interface ChecklistItem { id: string; text: string; done: boolean }` co-located near `Column`.
    - **Migration tooling: journal-based files, push-bootstrapped dev DB.** `drizzle.config.ts` sets `out: './src/db/migrations'`; `backend/src/db/migrate.ts:13` runs the Drizzle migrator over `migrations/_journal.json`; 7 migration files `0000`–`0006` exist (each with a `meta/_snapshot.json`). **Generate** the F15 column via `drizzle-kit generate` (do NOT hand-write the migration SQL). **Apply to the local dev DB** (`slykboard-db` docker container) by piping the generated `0007_*.sql` straight into psql — NOT `db:migrate` — because the dev container was bootstrapped with `drizzle-kit push` and has no `__drizzle_migrations` journal, so `drizzle-kit migrate` no-ops/fails on it (project memory `dev-db-push-based-no-migration-journal`).
    - **Update seam: single merged PATCH.** `backend/src/routes/tickets.routes.ts:34-84` = `PATCH /api/tickets/:ticketId`. Computes `hasAttributeFields` (`:43-48`); if present, calls `ticketService.updateTicket({ ticketId, patch: {...}, actingUserId })` (`:51-61`) and returns the updated row. F15 adds `body.checklist !== undefined` to `hasAttributeFields` and forwards `checklist` in the patch object. **No new endpoint.**
    - **Read seam.** `GET /api/tickets/:ticketId` = `tickets.routes.ts:15-27`. `ticketService.getTicket(ticketId)` (`ticketService.ts:218-226`) does a select-all (`db.select().from(tickets)`) then hydrates labels → **auto-includes `checklist` once the column exists; no select change.** BUT `boardService.getBoard` uses an EXPLICIT select list (`boardService.ts:59-78`) and a `BoardTicket` interface (`boardService.ts:24-36`) that OMITS `checklist`. To show card progress, add `checklist: tickets.checklist` to the select (`:60-73`), the `BoardTicket` interface (`:24-36`), and the row map (`:84-105`).
    - **Service types.** `TicketPatch` type at `ticketService.ts:29-35`; per-field patch switch at `:248-260`; `db.update(tickets).set(updateSet)` at `:262-266`. `TicketRow = typeof tickets.$inferSelect` (`:19`). Add `checklist` to `TicketPatch` + the switch.
    - **Zod validation edge.** `backend/src/routes/tickets.schema.ts`: `attributeFields` at `:19-25` (title `.min(1).max(200)`, description `.max(5000)`); `updateTicketBody` merges `moveFields` + `attributeFields` w/ `superRefine` (`:27-46`). Add a `checklist` sub-schema to `attributeFields`.
    - **No controller/repository layers** — route calls service directly (controllers/repositories dirs are `.gitkeep`). Follow the actual existing pattern: route → service → drizzle db.
    - **Frontend Ticket type** `frontend/src/types/ticket.ts:23-36` — no `checklist` field. Add `checklist: ChecklistItem[]` to `Ticket` + `checklist?` to `UpdateTicketDto` (`:38-44`). Add the `ChecklistItem` type.
    - **Frontend API** `frontend/src/api/tickets.ts`: `updateTicket` (`:40-48`) is a generic PATCH taking a `UpdateTicketDto` body — **reuse, no new fn.** `fetchTicket` (`:35-37`).
    - **Mutation hook** `frontend/src/hooks/useUpdateTicket.ts`: optimistic at `:19-47`; `hasAttributeFields` check at `:29-32` (add `vars.dto.checklist !== undefined`); `applyPatchToBoard` lives in `frontend/src/utils/boardPatch.ts:14-33`, per-field spread at `:24-29` (add `if (patch.checklist !== undefined) next.checklist = patch.checklist`). Query keys `frontend/src/api/queryKeys.ts:12-15` (`ticketKeys.detail(id)`, `boardKeys.all` / `.detail(slug)`) — **REUSE, locked by F10.** Checklist is client-owned data (full-array replace, no server-only join) → optimistic spread is **SAFE**, unlike F14 labels.
    - **Modal host EXISTS.** `frontend/src/components/EditTicketModal.tsx` (mounted `BoardPage.tsx:115`, opened via `BoardPage` → `BoardColumn` → `TicketCard`; fetches via `useQuery` on `ticketKeys.detail` `:17-21`; renders `<TicketAttributeForm>` edit mode `:42-54`). `TicketAttributeForm.tsx` is the reusable primitive (F14 added a `LabelMultiSelect` block at `:111-117`; its Zod schema at `:13-19`). **Embed `<ChecklistEditor>` in `TicketAttributeForm` mirroring the `LabelMultiSelect` block.** Modal width `max-w-lg` (`EditTicketModal.tsx:37`) is adequate.
    - **Board card chip.** `frontend/src/components/TicketCard.tsx`: header badges `:33-36` (mono ID + `<PriorityBadge>`); footer labels `:38-48` (`<LabelChip>` list). Add a checklist progress chip (e.g. `2/5`) in the footer, styling analogue to `PriorityBadge.tsx:17-24` / `LabelChip.tsx:14-32`.
    - **Caps pattern.** title `.max(200)` (`tickets.schema.ts:20`), description `.max(5000)` (`:21`); mirrored in `TicketAttributeForm.tsx:13-19`.
    - **Testing.** Vitest both sides (`backend/package.json:11-12`, `backend/vitest.config.ts`, `frontend/package.json:11-12`, `frontend/src/test-setup.ts` + jsdom). Co-located `*.test.ts(x)`. Extend: `backend/src/routes/tickets.routes.test.ts` (mocks `ticketService` `:30-34`, `makeTicketRow` factory `:59-76` — add `checklist: []` default), `frontend/src/components/TicketCard.test.tsx`, `frontend/src/hooks/useUpdateTicket.test.ts`, `frontend/src/utils/boardPatch.test.ts`. New: `frontend/src/components/ChecklistEditor.test.tsx`.

- **Libraries installed (relevant):** `zod ^4.4.3` (BE), `react-hook-form ^7.66+` + `@hookform/resolvers` (FE, F13). **No new FE/BE dep** — `crypto.randomUUID()` is native (Node 24, browser). No DnD for F15 (reorder deferred).

- **Test patterns:** Vitest 3, co-located `*.test.ts(x)`. BE: `supertest` + `vi.mock` services + `vi.hoisted` env. FE: `@testing-library/react` + `renderInDnd` wrapper (when card rendered in DnD context); priority `getByRole`.

- **CI/lint:** ESLint flat config `no-explicit-any` enforced. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (forces `import type`), `isolatedModules`. Prettier: 100-char, 2-space JS, 4-space JSX, trailing commas.

- **Prior art / partial work:** F14 (DONE) shipped the merged-PATCH-with-`{ old, new }` seam and the `TicketAttributeForm` extensible schema (F14 added `LabelMultiSelect`); F15 mirrors that seam to add `checklist`. F13 (DONE) shipped the optimistic `useUpdateTicket` + `boardPatch` per-field spread pattern F15 reuses. F12 (DONE) shipped the ticket-number machinery F15 does not touch.

- **File paths the plan references that do NOT exist yet (will be created):**
    - `backend/src/db/migrations/0007_*.sql`, `backend/src/db/migrations/meta/0007_snapshot.json`
    - `frontend/src/components/ChecklistEditor.tsx`, `frontend/src/components/ChecklistEditor.test.tsx`

- **File paths this plan CHANGES (exist on `main`):**
    - `backend/src/db/schema.ts` (add `ChecklistItem` interface + `tickets.checklist` jsonb column)
    - `backend/src/routes/tickets.schema.ts` (add `checklist` sub-schema to `attributeFields`)
    - `backend/src/routes/tickets.routes.ts` (forward `checklist` in `hasAttributeFields` + patch object)
    - `backend/src/services/ticketService.ts` (add `checklist` to `TicketPatch` + the patch switch)
    - `backend/src/services/boardService.ts` (add `checklist` to explicit select, `BoardTicket` interface, row map)
    - `backend/src/routes/tickets.routes.test.ts` (checklist patch scenarios + factory `checklist: []`)
    - `frontend/src/types/ticket.ts` (`ChecklistItem`, `Ticket.checklist`, `UpdateTicketDto.checklist?`)
    - `frontend/src/hooks/useUpdateTicket.ts` (`hasAttributeFields` += checklist)
    - `frontend/src/utils/boardPatch.ts` (per-field spread += checklist)
    - `frontend/src/components/TicketAttributeForm.tsx` (embed `<ChecklistEditor>`, schema += checklist)
    - `frontend/src/components/TicketCard.tsx` (footer progress chip)
    - `frontend/src/components/TicketCard.test.tsx`, `frontend/src/hooks/useUpdateTicket.test.ts`, `frontend/src/utils/boardPatch.test.ts` (checklist cases)

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F15-checklist`, single-line commits `SLYK-F15: <msg>`, rebase-only no squash, slug SLYK, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful `/api/tickets/:id`, Zod at edge, actual layering route→service→drizzle db, `authenticate` only — REQ-3.3 any authenticated user may edit — NO admin gate, consistent JSON envelope, frontend dirs); `.claude/rules/js-style-guide.md` (PascalCase components, camelCase hooks/utils, SCREAMING_SNAKE_CASE constants, 4-space JSX / 2-space JS, no `any`, import order); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `getByRole` priority, coverage >80% business / >70% components); `.claude/rules/persona.md` (React 19 + Express 5 + Drizzle + Postgres + Vite + Tailwind; `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).

- **Hidden coupling to plan for:**
    - **The `checklist` column is the spine.** Every later task depends on the column existing (the contract). It is PRD-planned (§8.3:170), so it is **NOT** added to the `features.md` deltas table — just implemented.
    - **Board explicit select.** `getTicket` auto-includes `checklist`, but `boardService.getBoard` does NOT (explicit select list). Forgetting the board select = card chip can't render. Sequenced in T3.
    - **Optimistic safety.** Because `checklist` is a full-array replace with client-owned ids (no server-only join, unlike F14 labels), `boardPatch` CAN optimistically spread the patch safely. Do NOT invalidate-only; keep F13's optimistic path.
    - **No audit now.** REQ-5.2 (`basic-PRD.md:77-81`) enumerates Status/Priority/Assignee/Label only; there is no `CHECKLIST_CHANGED` enum value (`:193`). F15 does not write audit logs. Defer to F18.
    - **`noUncheckedIndexedAccess`.** `ChecklistItem[]` indexing returns `T | undefined`; narrow.
    - **`verbatimModuleSyntax`.** `import type { ChecklistItem }` everywhere.
    - **F16 boundary.** F16 owns the unified detail modal hosting all sections. F15 ships `ChecklistEditor` as a reusable primitive F16 can embed; do not fork the modal host.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Storage shape | **JSONB column on `tickets`**, not a join table. `jsonb('checklist').$type<ChecklistItem[]>().notNull().default([])` with `interface ChecklistItem { id: string; text: string; done: boolean }`. | Spec acceptance: "`checklist` JSONB array of `{id, text, done}`" (features.md F15). PRD §8.3:170 lists `checklist \| JSONB`. Copy the `projects.columns` jsonb idiom (`schema.ts:66`, `Column` interface `:56-59`). Items are not shared entities (unlike F14 labels which needed a catalog + cascade) — jsonb is correct. |
| D2 | Migration mechanism | **Generate via `drizzle-kit generate`** → `0007_*.sql` + `meta/0007_snapshot.json`. Apply to the dev DB by piping the SQL to psql (NOT `db:migrate`). | Migration files are journal-based (`drizzle.config.ts` `out: './src/db/migrations'`; `migrate.ts:13` over `_journal.json`; 7 files `0000`–`0006`). Do NOT hand-write the migration. But the local dev container was push-bootstrapped — no `__drizzle_migrations` table — so `db:migrate` no-ops there; pipe the generated SQL to psql instead (project memory `dev-db-push-based-no-migration-journal`). |
| D3 | Update path | **Reuse the merged `PATCH /api/tickets/:ticketId`.** Add `body.checklist !== undefined` to `hasAttributeFields`; forward `checklist` in the patch object. | `tickets.routes.ts:34-84` is already the attribute-patch endpoint (F13). No new endpoint. Matches D7 in the F14 task doc. |
| D4 | Concurrency model | **Last-write-wins full-array replace.** Frontend submits the entire `checklist` array on every save; backend writes it whole. | Matches F14 labels' `replaceTicketLabels` full-replace pattern. Simplest; id-merge deferred. Spec edge case "Concurrent edits ... can clobber — merge by item id or last-write-wins; document." Documented in §1. |
| D5 | Optimistic update | **Safe optimistic spread in `boardPatch`.** Add `if (patch.checklist !== undefined) next.checklist = patch.checklist`. | Checklist is client-owned data (full-array replace, ids client-minted). Unlike F14 labels (which needed server join for colors), no server-only enrichment → optimistic is safe. Reuses F13 pattern (`boardPatch.ts:14-33`). |
| D6 | Audit | **Defer to F18.** F15 does NOT write `ActivityLog`. | REQ-5.2 (`basic-PRD.md:77-81`) enumerates Status/Priority/Assignee/Label only; no `CHECKLIST_CHANGED` value (`:193`). F18 owns the audit expansion. |
| D7 | Modal host | **Embed `<ChecklistEditor>` in `TicketAttributeForm`** (F13 primitive, F14 added `LabelMultiSelect` there). | `EditTicketModal.tsx:42-54` renders `<TicketAttributeForm>`; width `max-w-lg` (`:37`) adequate. F16 owns the unified modal but reuses these primitives — keep `ChecklistEditor` standalone-reusable. |
| D8 | Card progress | **Add `checklist` to `boardService.getBoard` explicit select + `BoardTicket` interface + row map.** | `boardService.ts:59-78` uses an explicit select that omits `checklist`; `getTicket` auto-includes it but the board does not. Without this the card chip can't render. |
| D9 | Item id | **Client-generated UUID v4** (`crypto.randomUUID()`). Backend validates `z.string().uuid()`. | Avoids a round-trip on add; optimistic render before persist. Server trusts the format only. Native to Node 24 + browsers. |
| D10 | Caps | **Text `.max(200)`** (match title, `tickets.schema.ts:20`); **max 50 items** (`z.array(...).max(50)`). Enforced both edges. | Reasonable soft caps; title parity for text. |
| D11 | Reorder | **Defer (MVP no drag-reorder).** Items render in stored array order. | Spec edge case; feature index recommends "MVP: no reorder." Later feature can add `@hello-pangea/dnd`. |
| D12 | Auth | **`authenticate` only — NO `requireRole`.** Any authenticated user may edit a ticket's checklist. | REQ-3.3 (`basic-PRD.md:68`): "any authenticated user may edit tickets." Checklist edit = ticket edit. |
| D13 | No new dependency | **No new FE/BE package.** `crypto.randomUUID()` native; native checkbox input. | D9 covers id; checkbox is a native `<input type="checkbox">`. Avoids dep bloat. |
| D14 | Error responses | **Mirror the existing 401 `{ error: '...' }` pattern.** No invented codes. | `js-development-rules.md` envelope; no canonical error-code enum exists in the repo (no `ErrorCode` additions). Use `VALIDATION_FAILED`/`NOT_FOUND` already in use. |

> **Out of F15 scope (explicitly deferred):**
> - **Checklist reorder (drag-and-drop)** → future feature; reuses `@hello-pangea/dnd`.
> - **`CHECKLIST_CHANGED` audit + ActivityLog** → **F18** (REQ-5.2 doesn't enumerate it today).
> - **"Checklist complete → move ticket to Review" automation** → PRD §9 future hook, POST-MVP.
> - **Unified detail modal hosting all sections** → **F16**. F15 ships `ChecklistEditor` as a reusable primitive.
> - **Per-item assignee / due date / nested sub-items** → not in spec.

> **Owner sign-off needed (see §9):** defer checklist audit to F18 vs add `CHECKLIST_CHANGED` now (recommend defer); max item count 50 + text 200; no reorder in MVP; last-write-wins concurrency acceptable for MVP; item id = client UUID (server validates format only).

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   ├── package.json                                        # unchanged (no new BE dep)
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add ChecklistItem interface + tickets.checklist jsonb column
│       │   └── migrations/
│       │       ├── 0007_<auto>.sql                         # NEW (T1) — ALTER TABLE "Tickets" ADD COLUMN "checklist" jsonb NOT NULL DEFAULT '[]'
│       │       └── meta/0007_snapshot.json                 # NEW (T1, auto)
│       ├── routes/
│       │   ├── tickets.schema.ts                           # MODIFY (T2) — attributeFields += checklist sub-schema
│       │   ├── tickets.routes.ts                           # MODIFY (T2) — hasAttributeFields += checklist; forward in patch
│       │   └── tickets.routes.test.ts                      # MODIFY (T4) — checklist patch scenarios; makeTicketRow += checklist: []
│       └── services/
│           ├── ticketService.ts                            # MODIFY (T2) — TicketPatch += checklist; patch switch += checklist
│           ├── ticketService.test.ts                       # MODIFY (T4) — checklist patch tests (optional, route-level covers)
│           ├── boardService.ts                             # MODIFY (T3) — explicit select += checklist; BoardTicket += checklist; row map += checklist
│           └── boardService.test.ts                        # MODIFY (T4) — checklist hydration in board payload
└── frontend/
    ├── package.json                                        # unchanged (no new FE dep)
    └── src/
        ├── types/
        │   └── ticket.ts                                   # MODIFY (T5) — ChecklistItem interface; Ticket.checklist; UpdateTicketDto.checklist?
        ├── utils/
        │   └── boardPatch.ts                               # MODIFY (T6) — applyPatchToBoard per-field spread += checklist
        ├── hooks/
        │   ├── useUpdateTicket.ts                          # MODIFY (T6) — hasAttributeFields += vars.dto.checklist !== undefined
        │   └── useUpdateTicket.test.ts                     # MODIFY (T9) — checklist optimistic patch
        ├── components/
        │   ├── ChecklistEditor.tsx                         # NEW (T7) — checkbox list + add/edit/delete/toggle + progress header
        │   ├── ChecklistEditor.test.tsx                    # NEW (T9) — add/edit/delete/toggle; caps; a11y
        │   ├── TicketAttributeForm.tsx                     # MODIFY (T7) — embed <ChecklistEditor>; RHF schema += checklist
        │   ├── TicketAttributeForm.test.tsx                # MODIFY (T9) — checklist field submit
        │   ├── TicketCard.tsx                              # MODIFY (T8) — footer progress chip (done/total)
        │   └── TicketCard.test.tsx                         # MODIFY (T9) — progress chip render
```

**Request lifecycle (`PATCH /api/tickets/:ticketId` with `checklist`, post-F15):**

1. Client `updateTicket(id, { checklist })` → `apiFetch(\`/tickets/${id}\`, { method: 'PATCH', body: JSON.stringify({ checklist }) })` → Bearer injected.
2. `authenticate` (F05): verifies JWT → `req.user = { id, email, role }`. **No `requireRole`** (REQ-3.3).
3. `validateRequest({ params: ticketIdParam, body: updateTicketBody })`: Zod partial now includes `checklist: z.array(checklistItemSchema).max(50).optional()` → `VALIDATION_FAILED`/400 on fail (bad uuid, text > 200, > 50 items).
4. Handler sees `hasAttributeFields` true (checklist present), calls `ticketService.updateTicket({ ticketId, patch: { checklist }, actingUserId })`.
5. Service: load ticket → missing → `NOT_FOUND`/404. Snapshot `old`. Switch on `patch.checklist !== undefined` → `updateSet.checklist = patch.checklist`. `db.update(tickets).set(updateSet).where(eq(tickets.id, ticketId))`. Return `{ old, new }` (F13 seam — F18 hooks later).
6. Returns `200` + `success(new)` (envelope).
7. FE `useUpdateTicket.onMutate`: snapshot board + detail; `applyPatchToBoard` spreads `patch.checklist` into the matched ticket's board row **optimistically** (safe — client-owned). `onSettled` invalidates `boardKeys.all` + `ticketKeys.detail(id)`.

**Card progress lifecycle:** board payload now carries `checklist: ChecklistItem[]` per ticket; `TicketCard` computes `done = checklist.filter(i => i.done).length`, `total = checklist.length`; renders `2/5` chip in footer when `total > 0` (hidden when empty).

---

## 5. Parallelization Strategy

Tasks are grouped into **5 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently. The backend chain and frontend chain share only the `ChecklistItem` type contract — defined once in the schema (BE) and mirrored in the FE type (T5), split cleanly across the BE/FE boundary.

### Batch dependency diagram

```
 ┌─ Batch 1 (BE contract: schema + migration) ──────────────────────────┐
 │  T1  schema.ts: add ChecklistItem + tickets.checklist;                │
 │      drizzle-kit generate → 0007_*.sql; db:migrate                    │
 │      [db/schema.ts, db/migrations/0007_*, db/migrations/meta/0007_*]  │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (checklist column exists)
                          ▼
 ┌─ Batch 2 (BE service + route + board) ────────────────────────────────┐
 │  T2  tickets.schema += checklist sub-schema; tickets.routes forward;  │
 │      ticketService TicketPatch += checklist + switch                  │
 │      [routes/tickets.schema.ts, routes/tickets.routes.ts,             │
 │       services/ticketService.ts]                                      │
 │  T3  boardService explicit select += checklist; BoardTicket +=        │
 │      checklist; row map += checklist                                  │
 │      [services/boardService.ts]                                       │
 │  (T2 ‖ T3 disjoint files — both depend on T1 only)                    │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (HTTP contracts stable: PATCH + GET board)
                          ▼
 ┌─ Batch 3 (FE foundation) ─────────────────────────────────────────────┐
 │  T5  types/ticket.ts: ChecklistItem + Ticket.checklist +              │
 │      UpdateTicketDto.checklist?                                       │
 │      [types/ticket.ts]                                                │
 │  T6  useUpdateTicket hasAttributeFields += checklist;                 │
 │      boardPatch per-field spread += checklist                         │
 │      [hooks/useUpdateTicket.ts, utils/boardPatch.ts]                  │
 │  (T5 → T6 serialized WITHIN B3; T6 imports ChecklistItem from T5)     │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (types + optimistic plumbing available)
                          ▼
 ┌─ Batch 4 (FE components) ─────────────────────────────────────────────┐
 │  T7  ChecklistEditor component; embed in TicketAttributeForm;         │
 │      RHF schema += checklist                                          │
 │      [components/ChecklistEditor.tsx,                                  │
 │       components/TicketAttributeForm.tsx]                              │
 │  T8  TicketCard footer progress chip                                  │
 │      [components/TicketCard.tsx]                                      │
 │  (T7 ‖ T8 disjoint files; both depend on T5/T6)                       │
 └────────────────────────┬──────────────────────────────────────────────┘
                          │ (feature wired)
                          ▼
 ┌─ Batch 5 (tests + terminal verification) ─────────────────────────────┐
 │  T4  backend tests (route + board + service)                          │
 │      [routes/tickets.routes.test.ts, services/boardService.test.ts,   │
 │       services/ticketService.test.ts]                                 │
 │  T9  frontend tests (ChecklistEditor + TicketCard + hooks + patch +   │
 │      TicketAttributeForm)                                             │
 │      [components/ChecklistEditor.test.tsx, components/TicketCard.test,│
 │       hooks/useUpdateTicket.test, utils/boardPatch.test,              │
 │       components/TicketAttributeForm.test]                            │
 │  (T4 ‖ T9 disjoint — BE vs FE test files)                             │
 │  T10 Integration gate: typecheck/lint/format/test/build + live smoke  │
 │      (no new feature files)                                           │
 └───────────────────────────────────────────────────────────────────────┘
```

- **B1 hard barrier:** every later task needs `tickets.checklist` to exist. B1 merges first.
- **B1 → B2 hard barrier:** service/route/board code references the column.
- **Within B2: T2 ‖ T3.** T2 owns `tickets.schema` + `tickets.routes` + `ticketService`; T3 owns `boardService`. **Zero file overlap.**
- **B2 → B3 hard barrier:** FE needs the PATCH + GET board HTTP contracts stable (`checklist` in both responses).
- **Within B3: T5 → T6.** T6 imports `ChecklistItem` from T5 (`types/ticket.ts`).
- **B3 → B4 hard barrier:** components consume the type + optimistic plumbing.
- **Within B4: T7 ‖ T8.** `ChecklistEditor` + `TicketAttributeForm` vs `TicketCard` — disjoint.
- **B4 → B5 hard barrier:** tests run against the as-built feature.
- **Within B5: T4 ‖ T9.** BE tests vs FE tests — disjoint. T10 runs last.

### Merge order rules

1. **B1 (T1) merges first.** Schema is the spine. `main` must have T1 before any other batch branches.
2. **B2 (T2 ‖ T3) merges second.** Either order; both touch disjoint files. `main` must have both before B3.
3. **B3 (T5 → T6) merges third.** FE foundation; T6 needs T5's type.
4. **B4 (T7 ‖ T8) merges fourth.** Either order; disjoint files.
5. **B5 (T4 ‖ T9 → T10) merges last.** Tests then verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0007_*.sql`, `backend/src/db/migrations/meta/0007_snapshot.json` | F12–F14 (DONE) | — |
| **T2** | 2 | `backend/src/routes/tickets.schema.ts`, `backend/src/routes/tickets.routes.ts`, `backend/src/services/ticketService.ts` | T1 | T3 |
| **T3** | 2 | `backend/src/services/boardService.ts` | T1 | T2 |
| **T4** | 5 | `backend/src/routes/tickets.routes.test.ts`, `backend/src/services/boardService.test.ts`, `backend/src/services/ticketService.test.ts` | T2, T3 | T9 |
| **T5** | 3 | `frontend/src/types/ticket.ts` | T2, T3 (contracts) | — |
| **T6** | 3 | `frontend/src/hooks/useUpdateTicket.ts`, `frontend/src/utils/boardPatch.ts` | T5 | — |
| **T7** | 4 | `frontend/src/components/ChecklistEditor.tsx`, `frontend/src/components/TicketAttributeForm.tsx` | T5, T6 | T8 |
| **T8** | 4 | `frontend/src/components/TicketCard.tsx` | T5 | T7 |
| **T9** | 5 | `frontend/src/components/ChecklistEditor.test.tsx`, `frontend/src/components/TicketCard.test.tsx`, `frontend/src/components/TicketAttributeForm.test.tsx`, `frontend/src/hooks/useUpdateTicket.test.ts`, `frontend/src/utils/boardPatch.test.ts` | T7, T8 | T4 |
| **T10** | 5 | (verification record only) | T1–T9 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → (T2 ‖ T3) → (T5 → T6) → (T7 ‖ T8) → (T4 ‖ T9) → T10. ~1.5 days (smaller scope than F14 — single column, no new tables/routes/dep).
- **2 devs:**
    - **Dev-A (backend):** T1 → (T2 ‖ T3) → T4.
    - **Dev-B (frontend):** waits for B1 + B2 contracts, then (T5 → T6) → (T7 ‖ T8) → T9.
    - Merge order: B1 → B2 → B3 → B4 → B5(T4 ‖ T9 → T10).
- **3 devs:** Dev-A backend T2; Dev-B backend T3 (after T1); Dev-C waits then frontend track. Converge on T4 ‖ T9 → T10.

---

## 6. Tasks

### T1 — BE schema: add `ChecklistItem` + `tickets.checklist`; migration 0007

**Batch:** 1 · **Depends on:** F12–F14 (DONE) · **Parallel with:** —

**Description:** The schema spine for every later task. Add the `ChecklistItem` interface and a `checklist` jsonb column to the `tickets` table in `backend/src/db/schema.ts`, copying the `projects.columns` jsonb idiom (`schema.ts:66`, `Column` interface `:56-59`). Then `drizzle-kit generate` produces `0007_*.sql`; apply to the dev DB by piping that SQL to psql (`db:migrate` no-ops on the push-bootstrapped dev container — project memory `dev-db-push-based-no-migration-journal`). Do not hand-write the migration file.

Modify `backend/src/db/schema.ts` — add the interface near `Column` (`:56-59`) and the column in the `tickets` table (e.g. after `priority` at `:114`):

```typescript
// Near the Column interface (schema.ts:56-59):
export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

// In the tickets table, after `priority`:
checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default([]),
```

(`jsonb` is already imported at `schema.ts:11`.)

Then:
- Run `npm run db:generate -w backend` → produces `0007_<auto-name>.sql` (single `ALTER TABLE "Tickets" ADD COLUMN "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb;`) + `meta/0007_snapshot.json`.
- Inspect `0007_*.sql` for sanity (no `$1` partial-index bug expected — that memory concerns enum partial indexes, not jsonb columns; but verify the snapshot is consistent).
- Apply to the local dev DB by piping the SQL to psql (the `slykboard-db` container was push-bootstrapped, so `db:migrate` no-ops/fails — project memory `dev-db-push-based-no-migration-journal`):
  ```
  docker exec -i slykboard-db psql -U slyk -d slykboard -v ON_ERROR_STOP=1 < backend/src/db/migrations/0007_*.sql
  ```

**Acceptance Criteria:**
- [ ] `backend/src/db/schema.ts` exports `interface ChecklistItem { id: string; text: string; done: boolean }`.
- [ ] `tickets` table has `checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default([])`.
- [ ] `npm run db:generate -w backend` produced `0007_*.sql` + `meta/0007_snapshot.json`.
- [ ] `0007_*.sql` contains `ALTER TABLE "Tickets" ADD COLUMN "checklist" jsonb NOT NULL DEFAULT '[]'` (or equivalent).
- [ ] Migration applied to the dev DB via the psql pipe above (NOT `db:migrate`); `tickets.checklist` column exists.
- [ ] `rtk tsc` (BE) passes.
- [ ] No other migration files modified (`0000`–`0006` untouched).
- [ ] No new dependency added to `backend/package.json`.

**Dependencies:** F12–F14 (DONE — `tickets` table exists).

---

### T2 — BE validation + route forwarding + TicketPatch/service switch

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** T3

**Description:** Wire `checklist` through the merged PATCH path. Three edits: (1) Zod sub-schema in `tickets.schema.ts` `attributeFields`; (2) route handler in `tickets.routes.ts` forwards `checklist` in `hasAttributeFields` + the patch object; (3) `ticketService.ts` adds `checklist` to `TicketPatch` + the patch switch. No new endpoint (D3).

Modify `backend/src/routes/tickets.schema.ts` — add to `attributeFields` (`:19-25`):

```typescript
const checklistItemSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(200),
  done: z.boolean(),
})

const attributeFields = {
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: priorityEnum.optional(),
  assigneeId: z.uuid().nullable().optional(),
  labelIds: z.array(z.string().uuid()).optional(),        // F14
  checklist: z.array(checklistItemSchema).max(50).optional(),  // NEW — F15
}
```

Modify `backend/src/routes/tickets.routes.ts` — extend `hasAttributeFields` (`:43-48`) and forward `checklist` in the patch (`:51-61`):

```typescript
const hasAttributeFields =
  body.title !== undefined ||
  body.description !== undefined ||
  body.priority !== undefined ||
  body.assigneeId !== undefined ||
  body.labelIds !== undefined ||
  body.checklist !== undefined  // NEW — F15

// ... in the service call:
patch: {
  // ...existing fields...
  ...(body.checklist !== undefined ? { checklist: body.checklist } : {}),
},
```

Modify `backend/src/services/ticketService.ts` — add `checklist` to `TicketPatch` (`:29-35`) and the patch switch (`:248-260`):

```typescript
export type TicketPatch = {
  // ...existing fields...
  checklist?: ChecklistItem[]
}

// In the switch:
if (patch.checklist !== undefined) updateSet.checklist = patch.checklist
```

(`ChecklistItem` imported from `../db/schema`.)

**Acceptance Criteria:**
- [ ] `tickets.schema.ts` `attributeFields` includes `checklist: z.array(checklistItemSchema).max(50).optional()`.
- [ ] `checklistItemSchema` requires `id: uuid()`, `text: min(1).max(200)`, `done: boolean()`.
- [ ] `tickets.routes.ts` `hasAttributeFields` returns true when `body.checklist !== undefined`.
- [ ] PATCH handler forwards `checklist` into the service patch object.
- [ ] `ticketService.ts` `TicketPatch` includes `checklist?: ChecklistItem[]`.
- [ ] Patch switch sets `updateSet.checklist = patch.checklist` when present.
- [ ] `rtk tsc` (BE) passes.
- [ ] No `any`; `import type { ChecklistItem }`.

**Dependencies:** T1 (column). Decision D3 (merged PATCH), D9 (client UUID), D10 (caps), D12 (`authenticate` only).

---

### T3 — BE board select: add `checklist` to `BoardTicket` + explicit select + row map

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** T2

**Description:** The card chip needs `checklist` in the board payload. `getTicket` auto-includes it (select-all), but `boardService.getBoard` uses an EXPLICIT select (`boardService.ts:59-78`) and a `BoardTicket` interface (`boardService.ts:24-36`) that omit `checklist`. Add it in three spots: the select list, the interface, and the row map.

Modify `backend/src/services/boardService.ts`:

```typescript
import type { ChecklistItem } from '../db/schema'

export interface BoardTicket {
  // ...existing fields...
  checklist: ChecklistItem[]  // NEW — F15
}

// In getBoard's explicit select (boardService.ts:60-73):
const rows = await db
  .select({
    // ...existing columns...
    checklist: tickets.checklist,  // NEW — F15
  })
  .from(tickets)
  // ...

// In the row map (boardService.ts:84-105):
return {
  // ...existing fields...
  checklist: row.checklist ?? [],  // NEW — F15 (defensive; column defaults to [])
}
```

**Acceptance Criteria:**
- [ ] `BoardTicket` interface includes `checklist: ChecklistItem[]`.
- [ ] `getBoard` explicit select includes `checklist: tickets.checklist`.
- [ ] Row map assigns `checklist: row.checklist ?? []`.
- [ ] Board payload returns `checklist` per ticket (verified in T4).
- [ ] Ticket with empty checklist returns `checklist: []` (not omitted, not null).
- [ ] `rtk tsc` (BE) passes.
- [ ] No `any`; `import type { ChecklistItem }`.

**Dependencies:** T1 (column). Decision D8 (card progress via board select).

---

### T4 — BE tests: route PATCH checklist + board payload + service patch

**Batch:** 5 · **Depends on:** T2, T3 · **Parallel with:** T9

**Description:** Backend Vitest coverage. Extend the route test, the board service test, and (optionally) the ticket service test. The route test's `makeTicketRow` factory (`tickets.routes.test.ts:59-76`) needs a `checklist: []` default so existing tests don't drift; add new checklist scenarios.

Modify `backend/src/routes/tickets.routes.test.ts`:
- Update `makeTicketRow` factory to include `checklist: []`.
- Add scenarios:
  - `PATCH /api/tickets/:id` with `{ checklist: [{ id, text, done }] }` → 200; response includes the new checklist; service called with `patch.checklist`.
  - `PATCH` with a checklist item whose `id` is not a uuid → 400 `VALIDATION_FAILED`.
  - `PATCH` with text empty (`.min(1)`) → 400.
  - `PATCH` with text > 200 chars → 400.
  - `PATCH` with > 50 items → 400.
  - `PATCH` with `done` non-boolean → 400.
  - `PATCH` with empty checklist `[]` → 200 (clears all).
  - `PATCH` without `authenticate` → 401.
  - Member (non-admin) `PATCH` with checklist → 200 (REQ-3.3 — any authenticated user).

Modify `backend/src/services/boardService.test.ts`:
- Board payload includes `checklist` per ticket.
- Ticket with empty checklist → `checklist: []`.
- Ticket with items → `checklist: [{ id, text, done }, ...]`.

Modify `backend/src/services/ticketService.test.ts` (optional, route-level covers the path):
- `updateTicket` with `patch.checklist` sets `updateSet.checklist`; returns `{ old, new }` with checklist diffed.

**Acceptance Criteria:**
- [ ] `makeTicketRow` factory includes `checklist: []` default.
- [ ] `PATCH /:id` with valid checklist returns 200 and the new checklist in the response.
- [ ] `PATCH` with non-uuid item id returns 400.
- [ ] `PATCH` with empty text returns 400.
- [ ] `PATCH` with text > 200 returns 400.
- [ ] `PATCH` with > 50 items returns 400.
- [ ] `PATCH` with non-boolean `done` returns 400.
- [ ] `PATCH` with empty `[]` checklist returns 200.
- [ ] `PATCH` without token returns 401.
- [ ] Member `PATCH` with checklist returns 200 (no admin gate).
- [ ] Board payload test asserts `checklist` present per ticket.
- [ ] Coverage of new/modified code > 80%.
- [ ] No `any`; `import type { ChecklistItem }`.

**Dependencies:** T2 (route/schema), T3 (board).

---

### T5 — FE types: `ChecklistItem`, `Ticket.checklist`, `UpdateTicketDto.checklist?`

**Batch:** 3 · **Depends on:** T2, T3 (contracts) · **Parallel with:** —

**Description:** Frontend type foundation. Add `ChecklistItem` and wire `checklist` into `Ticket` + `UpdateTicketDto`. No new file — co-locate `ChecklistItem` in `types/ticket.ts` (it is ticket-scoped, not a shared catalog like F14 labels).

Modify `frontend/src/types/ticket.ts` (`:23-36` Ticket, `:38-44` UpdateTicketDto):

```typescript
export interface ChecklistItem {
    id: string
    text: string
    done: boolean
}

export interface Ticket {
    id: string
    ticketNumber: number
    projectId: string
    title: string
    description: string | null
    statusColumn: string
    position: number
    priority: Priority
    labels: Label[]
    checklist: ChecklistItem[]  // NEW — F15
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
    labelIds?: string[]
    checklist?: ChecklistItem[]  // NEW — F15
}
```

(`CreateTicketDto` does NOT need `checklist` — a new ticket starts with `[]`; the column default handles it. Add only if the create flow wants to seed items; spec does not require it.)

**Acceptance Criteria:**
- [ ] `types/ticket.ts` exports `interface ChecklistItem { id: string; text: string; done: boolean }`.
- [ ] `Ticket` includes `checklist: ChecklistItem[]`.
- [ ] `UpdateTicketDto` includes `checklist?: ChecklistItem[]`.
- [ ] `rtk tsc` (FE) passes.
- [ ] No `any`.

**Dependencies:** T2, T3 (HTTP contracts define the shape).

---

### T6 — FE optimistic plumbing: `useUpdateTicket` hasAttributeFields + `boardPatch` spread

**Batch:** 3 · **Depends on:** T5 · **Parallel with:** —

**Description:** Reuse F13's optimistic path. Checklist is client-owned data (full-array replace, client UUIDs) → optimistic spread is **safe** (unlike F14 labels which needed server join for colors). Two edits: extend `hasAttributeFields` in `useUpdateTicket`, and add the per-field spread in `boardPatch.applyPatchToBoard`.

Modify `frontend/src/hooks/useUpdateTicket.ts` (`:29-32`):

```typescript
const hasAttributeFields =
  vars.dto.title !== undefined ||
  vars.dto.description !== undefined ||
  vars.dto.priority !== undefined ||
  vars.dto.assigneeId !== undefined ||
  vars.dto.labelIds !== undefined ||
  vars.dto.checklist !== undefined  // NEW — F15
```

Modify `frontend/src/utils/boardPatch.ts` (`:24-29` per-field spread):

```typescript
if (patch.title !== undefined) next.title = patch.title
if (patch.description !== undefined) next.description = patch.description
if (patch.priority !== undefined) next.priority = patch.priority
if (patch.assigneeId !== undefined) next.assigneeId = patch.assigneeId
if (patch.labelIds !== undefined) next.labelIds = patch.labelIds
if (patch.checklist !== undefined) next.checklist = patch.checklist  // NEW — F15
```

**Acceptance Criteria:**
- [ ] `useUpdateTicket.hasAttributeFields` returns true when `vars.dto.checklist !== undefined`.
- [ ] `boardPatch.applyPatchToBoard` spreads `patch.checklist` into the matched board ticket.
- [ ] Optimistic snapshot/rollback path (F13) works for checklist patches (no special-case invalidation — full-array replace is safe).
- [ ] `rtk tsc` (FE) passes.
- [ ] No `any`; `import type { ChecklistItem }`.

**Dependencies:** T5 (`ChecklistItem`). Decision D5 (optimistic safe).

---

### T7 — FE `ChecklistEditor` component + embed in `TicketAttributeForm` + RHF schema

**Batch:** 4 · **Depends on:** T5, T6 · **Parallel with:** T8

**Description:** The modal edit surface. `ChecklistEditor` is a controlled component rendering the list with per-item checkbox + editable text + delete, an "Add item" row, and a progress header (`done/total` + bar). Embed it in `TicketAttributeForm` mirroring the F14 `LabelMultiSelect` block (`TicketAttributeForm.tsx:111-117`). Bridge RHF via `setValue`/`watch` (F13 controlled-component pattern).

Create `frontend/src/components/ChecklistEditor.tsx`:

```typescript
import { useState } from 'react'
import type { ChecklistItem } from '../types/ticket'

interface ChecklistEditorProps {
    value: ChecklistItem[]
    onChange: (items: ChecklistItem[]) => void
}

const MAX_ITEMS = 50
const MAX_TEXT = 200

export function ChecklistEditor({ value, onChange }: ChecklistEditorProps) {
    const [draft, setDraft] = useState('')

    const doneCount = value.filter((i) => i.done).length
    const total = value.length
    const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100)

    function addItem() {
        const text = draft.trim()
        if (!text || value.length >= MAX_ITEMS) return
        const item: ChecklistItem = {
            id: crypto.randomUUID(),
            text: text.slice(0, MAX_TEXT),
            done: false,
        }
        onChange([...value, item])
        setDraft('')
    }

    function toggle(id: string) {
        onChange(value.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
    }

    function editText(id: string, text: string) {
        onChange(
            value.map((i) =>
                i.id === id ? { ...i, text: text.slice(0, MAX_TEXT) } : i,
            ),
        )
    }

    function removeItem(id: string) {
        onChange(value.filter((i) => i.id !== id))
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Checklist</span>
                <span className="text-xs text-gray-500">
                    {doneCount}/{total}
                </span>
            </div>
            {total > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200">
                    <div
                        className="h-full bg-green-500"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
            <ul className="space-y-1">
                {value.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() => toggle(item.id)}
                            aria-label={`Toggle ${item.text}`}
                            className="h-4 w-4"
                        />
                        <input
                            type="text"
                            value={item.text}
                            onChange={(e) => editText(item.id, e.target.value)}
                            maxLength={MAX_TEXT}
                            aria-label="Checklist item text"
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                        <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Delete ${item.text}`}
                            className="text-sm text-red-600"
                        >
                            Delete
                        </button>
                    </li>
                ))}
            </ul>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            addItem()
                        }
                    }}
                    placeholder="Add an item"
                    maxLength={MAX_TEXT}
                    aria-label="New checklist item"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                    type="button"
                    onClick={addItem}
                    disabled={!draft.trim() || value.length >= MAX_ITEMS}
                    className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                    Add
                </button>
            </div>
            {value.length >= MAX_ITEMS && (
                <p className="text-xs text-gray-500">
                    Maximum {MAX_ITEMS} items reached.
                </p>
            )}
        </div>
    )
}
```

Modify `frontend/src/components/TicketAttributeForm.tsx`:
- Add `checklist` to the RHF schema (`:13-19`):

```typescript
import { ChecklistEditor } from './ChecklistEditor'
import type { ChecklistItem } from '../types/ticket'

const schema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
    assigneeId: z.string().uuid().nullable(),
    labelIds: z.array(z.string().uuid()).default([]),
    checklist: z
        .array(
            z.object({
                id: z.string().uuid(),
                text: z.string().min(1).max(200),
                done: z.boolean(),
            }),
        )
        .max(50)
        .default([]),  // NEW — F15
})
```

- Embed the editor mirroring the `LabelMultiSelect` block (`:111-117`):

```tsx
<ChecklistEditor
    value={watch('checklist')}
    onChange={(items: ChecklistItem[]) => setValue('checklist', items)}
/>
```

(On edit-mode load, seed `checklist` from the fetched ticket's `checklist` alongside the other fields.)

**Acceptance Criteria:**
- [ ] `ChecklistEditor` is a controlled component (`value`/`onChange`).
- [ ] Add item: typing + Enter or Add button appends a `{ id: crypto.randomUUID(), text, done: false }` item.
- [ ] Toggle: clicking checkbox flips `done`; `onChange` fires.
- [ ] Edit text: typing updates `text`; capped at 200 chars (`maxLength`).
- [ ] Delete: button removes the item; `onChange` fires.
- [ ] Progress header shows `done/total` + a bar.
- [ ] Add disabled at 50 items; explanatory text shown.
- [ ] `TicketAttributeForm` schema validates `checklist` (uuid id, text 1–200, boolean done, ≤ 50 items).
- [ ] `TicketAttributeForm` submit calls `onSubmit` with `checklist` included.
- [ ] Edit mode seeds `checklist` from the ticket.
- [ ] Checkboxes accessible via `getByRole('checkbox', { name: /Toggle/ })`; text inputs via `getByLabelText`; delete via `getByRole('button', { name: /Delete/ })`.
- [ ] No `any`; `import type { ChecklistItem }`.
- [ ] Prettier + ESLint clean.

**Dependencies:** T5 (`ChecklistItem`), T6 (optimistic plumbing). Decision D7 (modal host), D9 (client UUID), D10 (caps), D11 (no reorder).

---

### T8 — FE card progress chip on `TicketCard`

**Batch:** 4 · **Depends on:** T5 · **Parallel with:** T7

**Description:** The board card shows checklist progress. Add a compact `done/total` chip in the `TicketCard` footer (`TicketCard.tsx:38-48`), styled analogously to `PriorityBadge.tsx:17-24` / `LabelChip.tsx:14-32`. Hidden when the checklist is empty.

Modify `frontend/src/components/TicketCard.tsx`:

```tsx
// In the footer (TicketCard.tsx:38-48), after the labels block:
{ticket.checklist.length > 0 && (
    <span
        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
        aria-label={`Checklist progress ${ticket.checklist.filter((i) => i.done).length} of ${ticket.checklist.length} done`}
    >
        <span aria-hidden="true">☑</span>
        {ticket.checklist.filter((i) => i.done).length}/{ticket.checklist.length}
    </span>
)}
```

**Acceptance Criteria:**
- [ ] `TicketCard` renders a `done/total` chip in the footer when `checklist.length > 0`.
- [ ] Chip hidden when `checklist` is empty.
- [ ] Chip shows correct counts (e.g. `2/5`).
- [ ] Chip accessible via `getByLabelText(/Checklist progress/)`.
- [ ] No `any`; `import type { ChecklistItem }` (or use `Ticket` directly).
- [ ] Prettier + ESLint clean.

**Dependencies:** T5 (`Ticket.checklist`). Decision D8 (card progress).

---

### T9 — FE tests: `ChecklistEditor` + `TicketCard` + `useUpdateTicket` + `boardPatch` + `TicketAttributeForm`

**Batch:** 5 · **Depends on:** T7, T8 · **Parallel with:** T4

**Description:** Frontend Vitest coverage. New `ChecklistEditor.test.tsx`; extend `TicketCard.test.tsx`, `useUpdateTicket.test.ts`, `boardPatch.test.ts`, `TicketAttributeForm.test.tsx`.

Create `frontend/src/components/ChecklistEditor.test.tsx`:
- Renders existing items as checkbox + text input + delete button.
- Add item: type + Enter → `onChange` called with appended item (uuid id, `done: false`).
- Add item: type + click Add → same.
- Add disabled when draft empty or at 50 items.
- Toggle: click checkbox → `onChange` called with `done` flipped for that id.
- Edit text: type in item input → `onChange` called with updated `text`; capped at 200.
- Delete: click Delete → `onChange` called without that item.
- Progress header shows `done/total`.
- A11y: checkbox via `getByRole('checkbox', { name: /Toggle/ })`; delete via `getByRole('button', { name: /Delete/ })`; new-item input via `getByLabelText('New checklist item')`.

Extend `frontend/src/components/TicketCard.test.tsx`:
- Ticket with `checklist: [{ done: true }, { done: false }, { done: true }]` renders chip `2/3`.
- Ticket with empty `checklist: []` renders no chip.

Extend `frontend/src/hooks/useUpdateTicket.test.ts`:
- Mutation with `dto.checklist` triggers the optimistic path; `applyPatchToBoard` spreads `checklist`.

Extend `frontend/src/utils/boardPatch.test.ts`:
- `applyPatchToBoard` with `patch.checklist` sets `next.checklist`.

Extend `frontend/src/components/TicketAttributeForm.test.tsx`:
- Renders `<ChecklistEditor>` in edit mode seeded from the ticket.
- Submit includes `checklist`.
- Schema rejects > 50 items / text > 200 / non-uuid id.

**Acceptance Criteria:**
- [ ] `ChecklistEditor.test.tsx` covers add (Enter + button), toggle, edit, delete, caps, a11y.
- [ ] `TicketCard.test.tsx` covers chip render with counts + empty-hidden.
- [ ] `useUpdateTicket.test.ts` covers checklist optimistic patch.
- [ ] `boardPatch.test.ts` covers `patch.checklist` spread.
- [ ] `TicketAttributeForm.test.tsx` covers editor embed + submit + schema rejection.
- [ ] Coverage of new/modified components > 70%.
- [ ] No `any`; `import type { ChecklistItem }`.

**Dependencies:** T7 (`ChecklistEditor`), T8 (`TicketCard` chip).

---

### T10 — Integration verification & sign-off

**Batch:** 5 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does.

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations (especially `no-explicit-any`).
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on new files >80% business / >70% components.
5. **Build:** `npm run build -w frontend` — FE production build succeeds.
6. **Migration applied:** confirm `0007_*.sql` applies cleanly to the dev DB (psql pipe, NOT `db:migrate`); `tickets.checklist` column exists with default `'[]'`.
7. **Live browser smoke (manual):**
   - Start backend + frontend locally; apply migration.
   - Log in, open a project board.
   - Open a ticket → edit modal → `ChecklistEditor` renders.
   - Add 3 items ("Design", "Build", "Test"); toggle "Build" done; the card chip updates to `1/3`.
   - Edit an item's text; delete an item; chip updates.
   - Reload the page → checklist persists (DB write confirmed).
   - Add 50 items → Add button disables; 51st rejected.
   - Type > 200 chars in an item → capped (input `maxLength`) / Zod rejects if bypassed.
   - As a different user (member, non-admin): can add/toggle/delete checklist items (REQ-3.3 — no admin gate).
   - Open two browsers (or two tabs) on the same ticket; both add an item and save — confirm last-write-wins behavior (one item lost is acceptable per the documented decision).
8. **Verify no audit log written** for checklist edits (F18 owns it; `CHECKLIST_CHANGED` does not exist).
9. **Verify F12/F13/F14 inheritance:** ticket create still lands in the first column; title/priority/assignee/label edits still work; cards still render labels.
10. **Record proof:** fill the integration record below with commit SHAs, exit codes, and a screenshot path / textual smoke summary.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage on new files >80% / >70%.
- [ ] `npm run build -w frontend` exit 0.
- [ ] Migration `0007_*.sql` applies cleanly; `tickets.checklist` column exists.
- [ ] Live smoke: add/toggle/edit/delete persist across reload.
- [ ] Live smoke: card chip shows correct `done/total`; hidden when empty.
- [ ] Live smoke: 50-item cap + 200-char cap enforced.
- [ ] Live smoke: member (non-admin) can edit checklist (no 403).
- [ ] Live smoke: last-write-wins behavior confirmed and documented.
- [ ] Live smoke: no `CHECKLIST_CHANGED` audit log entry created.
- [ ] F12/F13/F14 inherited flows still work.

**Dependencies:** all prior tasks merged.

---

## 7. Final F15 Acceptance Checklist

- [ ] `tickets.checklist` JSONB column exists; defaults to `'[]'`; not null; stores `{ id, text, done }[]`.
- [ ] Add / edit / delete / toggle items — each mutation persists via `PATCH /api/tickets/:id`.
- [ ] `PATCH` validates: `id` uuid, `text` 1–200, `done` boolean, ≤ 50 items.
- [ ] `GET /api/tickets/:id` returns `checklist` (select-all auto-includes).
- [ ] `GET /api/projects/:slug/board` returns `checklist` per ticket (explicit select widened).
- [ ] Board card shows progress chip (`done/total`); hidden when empty.
- [ ] Ticket modal hosts `ChecklistEditor` with add/edit/delete/toggle + progress header.
- [ ] `useUpdateTicket` optimistic-spreads `checklist` into the board (safe — client-owned).
- [ ] Any authenticated user may edit (REQ-3.3 — `authenticate` only, no admin gate).
- [ ] Concurrent edits documented as last-write-wins full-array replace.
- [ ] No `CHECKLIST_CHANGED` audit (deferred to F18); `{ old, new }` seam preserved.
- [ ] No reorder in MVP (deferred).
- [ ] No new FE/BE dependency.
- [ ] All tests pass (Vitest BE + FE).
- [ ] Typecheck / lint / format / build all green.

**Integration record (fill during T10):**
- Feature commit SHA: `________`
- `PATCH /api/tickets/:id` (checklist patch) sample response: `________`
- `GET /api/projects/:slug/board` sample ticket (with `checklist`): `________`
- Migration applied: `0007_*.sql` — column `tickets.checklist` exists: `yes / no`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`
- Live browser smoke: add/toggle/edit/delete persist OK / card chip OK / caps OK / member-edit OK / last-write-wins OK / no-audit OK

---

## 8. Schema deltas owned by this feature

**F15 owns NO new schema delta.** The `checklist` column is **PRD-planned** (PRD §8.3, `basic-PRD.md:170`: `checklist | JSONB`), not a feature-introduced delta. It is therefore **NOT** added to the `features.md` deltas table — it is simply implemented. (Contrast F14, which owned the `Labels` + `TicketLabels` delta flagged in `features.md` because the PRD §8 had no Labels table.)

| Column | Detail | Migration |
| --- | --- | --- |
| `tickets.checklist` | `jsonb NOT NULL DEFAULT '[]'`, typed `ChecklistItem[]` where `ChecklistItem { id: string; text: string; done: boolean }` | `ALTER TABLE "Tickets" ADD COLUMN "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb` (generated by `drizzle-kit generate` into `0007_*.sql`) |

**`CHECKLIST_CHANGED` ActivityLog action_type** is **NOT** owned by F15 — REQ-5.2 (`basic-PRD.md:77-81`) does not enumerate checklist among the audited attribute changes, and no such enum value exists (`:193`). F18 owns any audit expansion. F15 only preserves the `{ old, new }` seam on ticket checklist patches so F18 can diff and write the log later.

---

## 9. Cross-cutting decisions needing owner sign-off

1. **Defer checklist audit to F18 vs add a `CHECKLIST_CHANGED` enum now.** **Recommendation: defer.** REQ-5.2 enumerates Status/Priority/Assignee/Label only; the ActivityLog action_type enum (`basic-PRD.md:193`) has no `CHECKLIST_CHANGED` value. F18 is the natural home for audit expansion, and F15 preserves the `{ old, new }` seam so F18 can hook without rework. Adding the enum now would be spec creep.
2. **Max item count = 50 and text cap = 200 chars — confirm acceptable.** Text 200 matches the ticket title cap (`tickets.schema.ts:20`). 50 is a reasonable soft cap for a sub-task list; enforced at both edges (Zod + UI).
3. **No reorder in MVP — confirm.** The feature index recommends "MVP: no reorder." Items render in stored array order. Reorder via `@hello-pangea/dnd` can ship in a later feature.
4. **Last-write-wins concurrency acceptable for MVP — confirm.** Concurrent saves by two users can lose one item (full-array replace). This is documented and consistent with the F14 labels-replace pattern. Id-merge (backend merge by item id) is deferred as it adds backend logic out of scope for F15.
5. **Item id = client-generated UUID — confirm server trusts client UUID (format-validated only).** The frontend mints `crypto.randomUUID()` on add; the backend validates `z.string().uuid()` and writes the id through unchanged. The server does not regenerate ids. This avoids an add-round-trip and enables optimistic render, at the cost of trusting the client's format-valid id.
