# F13 — Ticket attributes: title, description, assignee, priority: Plan + Task Breakdown

> **Feature:** F13 — Ticket attributes: title, description, assignee, priority (Phase 2 — Board)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F12 (DONE ✅); inherits F09 (DONE ✅), F11 (DONE ✅), F08 (DONE ✅), F06 (DONE ✅), F05 (DONE ✅), F03 (DONE ✅) · **PRD ref:** REQ-3.2, REQ-3.3, REQ-5.2, REQ-5.3, PRD §8.1, PRD §8.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F12](../F12-ticket-creation-sequential-ids/F12-ticket-creation-sequential-ids-tasks.md), [F09](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md), [F11](../F11-drag-drop-order-persistence/F11-drag-drop-order-persistence-tasks.md)

---

## 1. F13 Recap

**Goal:** Capture the core editable fields on a ticket — title, rich-text description, an assignee (user dropdown), `created_by` (system), and a priority enum.

**Ships:** A ticket can hold title (required), description (WYSIWYG rich text stored as sanitized HTML), an optional assignee selected from a workspace-wide user dropdown, a system-set `creator_id`, and a priority from the fixed `LOW | MEDIUM | HIGH | URGENT | CRITICAL` enum (default `MEDIUM`). Any authenticated user can create a full-attribute ticket or edit any of these attributes on an existing ticket. Edits persist, validate (enum + length caps), and render optimistically on the board. Removed-from-workspace assignees render as "Unknown user" rather than 500.

**Acceptance (definition of done):**
- Title required, non-empty (1–200 chars); description optional WYSIWYG rich text (≤ 5000 chars sanitized HTML).
- Assignee dropdown populated from the workspace user list; nullable.
- Priority enum `LOW | MEDIUM | HIGH | URGENT | CRITICAL`; default `MEDIUM`.
- All edits persisted; backend validation enforces enum + length limits (Zod at the edge per `js-development-rules.md`).
- Description stored as one format (sanitized HTML); rendering handles empty / null / rich safely.
- WYSIWYG editor chosen, sanitize-on-write (server) to strip scripts and prevent stored XSS.
- Removed-from-workspace assignee does not break board read or ticket detail — app-layer guard renders "Unknown user".

**Edge cases to resolve up front:**
- **WYSIWYG editor choice (TipTap / Lexical) — pick one, sanitize on save to prevent stored XSS** → **Decision:** TipTap v3 (`@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/pm`). React 19 first-class support, namespaced imports for tree-shaking, `.getHTML()` returns HTML string. Less glue than Lexical, steadier cadence than Slate, not overkill like BlockNote. Sanitizer: `isomorphic-dompurify` (BE, server-side write) + `dompurify` (FE re-sanitize on render). **CRITICAL: jsdom only — happy-dom explicitly unsafe per cure53 README.** Config: `ALLOWED_TAGS ['p','br','strong','em','ul','ol','li','code','pre','blockquote','a','h3','h4']`, `ALLOWED_ATTR ['href']`, `ALLOW_DATA_ATTR false`. Sources: cure53 DOMPurify README, TipTap v3 docs. **No owner sign-off (decision anchored in F13 spec edge case).**
- **Assignee removed from workspace (F25) → keep `assignee_id`, show "unknown user" rather than 500** → **Decision:** App-layer guard in `boardService.buildAssignee` (`boardService.ts:87-93`) and any new `ticketService.getTicket`. If the FK row is missing, return `{ id: assigneeId, fullName: 'Unknown user', avatarUrl: null }`. Schema stays `ON DELETE no action` today; F25 may relax to `SET NULL`. Documented seam.
- **Description stored as one format; rendering must handle empty/rich safely** → **Decision:** HTML (sanitized on write + re-sanitized on render). Simpler XSS surface than TipTap JSON; matches DOMPurify's native input. F13 acceptance explicitly allows "HTML/Markdown" — pick HTML.
- **Title length cap; description size cap** → **Decision:** Title 1–200 (matches existing `createTicketBody` at `projects.schema.ts:37-44`), description ≤ 5000 (matches existing). No new caps.

---

## 2. Codebase Analysis Summary

- **State:** **Partial — schema already shipped; gaps are service/route/UI/dep.** F12 (DONE ✅), F09 (DONE ✅), F11 (DONE ✅), F08 (DONE ✅), F06 (DONE ✅), F05 (DONE ✅), F03 (DONE ✅) are all satisfied in code. The `tickets` table already holds every F13 column since F09/F12 migrations — no DB work. F12 shipped a title-only `NewTicketButton`; its task doc L97 explicitly defers the full attribute modal to F13: *"Full attribute modal (description WYSIWYG, assignee dropdown, labels multi-select, checklist) → F13"*. The `tickets.schema.ts:3` comment reads **"F13 widens the body later"** — F13 owns that widening.
- **Existing structure this feature builds on (with path citations):**
    - **Schema (DONE, no F13 delta):** `backend/src/db/schema.ts:96-130` `tickets` table — `title: text NOT NULL` (`:104`), `description: text nullable` (`:105`), `assigneeId: uuid nullable FK→users.id ON DELETE no action` (`:108`), `creatorId: uuid NOT NULL FK→users.id` (`:109-111`), `priority: priorityEnum NOT NULL default 'MEDIUM'` (`:112`). `priorityEnum` at `schema.ts:90`: `['LOW','MEDIUM','HIGH','URGENT','CRITICAL']`. `Users` table `schema.ts:24-49`: `id, googleId, email, fullName, avatarUrl, role, tokenVersion, createdAt, updatedAt`. No migrations needed for F13.
    - **Backend routing:** Routers wired at `backend/src/index.ts:50-52`: `/api/auth`, `/api/projects`, `/api/tickets`. `ticketsRouter` (`backend/src/routes/tickets.routes.ts`) has ONE route today: `PATCH /:ticketId` for move (F11). Comment at `tickets.schema.ts:3`: **"F13 widens the body later"**. Ticket create nested under projects: `POST /api/projects/:slug/tickets` at `projects.routes.ts:51-65` (F12) already accepts all F13 fields.
    - **Backend Zod (create):** `createTicketBody` at `projects.schema.ts:37-44` already accepts title (1–200), description (≤5000), priority enum, labels, assigneeId uuid, statusColumn. F13 reuses for create.
    - **Backend services:** `ticketService.ts:126-184` `createTicket` accepts all F13 fields. `TicketRow` = `typeof tickets.$inferSelect` at `ticketService.ts:16`. `boardService.ts:48-149` left-joins users on assigneeId; assignee build at `boardService.ts:87-93` is unsafe to FK dangle (will produce `{fullName: undefined}`). `UserService` has `findUserById`, `findUserByGoogleId`, `upsertByGoogleId` — **NO `listUsers`**.
    - **Auth middleware** `backend/src/middleware/auth.ts:9-43`: sets `req.user = { id, email, role }` (`:41`) — no `fullName`/`avatarUrl`. `requireRole(...roles)` at `middleware/requireRole.ts:9-23`. F13 create/edit = `authenticate` only (REQ-3.3: any authenticated user); admin-only delete is F17.
    - **Envelope:** `backend/src/utils/envelope.ts`: `success<T>(data) → { data }` (`:28-30`), `error(code, message, details?)` (`:42-48`). Closed `ErrorCode` (`:5-12`): `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR`. `validateRequest({ body?, query?, params? })` at `middleware/validateRequest.ts:33-66`. `AppError(code, message, { details? })`. Adding codes needs owner sign-off; F13 reuses existing codes only.
    - **Frontend API + state:** React Query v5 (`@tanstack/react-query ^5.101.0`) + Zustand v5. QueryClient at `frontend/src/lib/queryClient.ts` (staleTime 30s). `apiFetch<T>` at `frontend/src/api/client.ts:45-131` injects Bearer, unwraps `{ data }`, throws `ApiClientError { status, code, details }`, 401-coalesced refresh. Query keys at `frontend/src/api/queryKeys.ts`: `projectKeys`, `boardKeys`. **No `ticketKeys` yet.**
    - **Frontend ticket API:** `frontend/src/api/tickets.ts` has `moveTicket` (F11), `createTicket` (F12). **No `updateTicket`, no `fetchTicket`.**
    - **Frontend types:** `frontend/src/types/ticket.ts`: `Priority` (`:2`), `PRIORITY_DISPLAY` (`:5-11`), `Assignee { id, fullName, avatarUrl|null }` (`:13-17`), `Ticket` (`:21-33`). **`Ticket` does NOT include `description` — F13 must add it.**
    - **Frontend components:** `TicketCard.tsx:17-54` renders ticketId, title, `<PriorityBadge>`, `<AssigneeAvatar>`, labels. No description render, no edit affordance. `PriorityBadge.tsx` and `AssigneeAvatar.tsx` are ready-made and null-safe. `NewTicketButton.tsx` is **title-only**. F13 owns the full-attribute create form. `ProjectPicker.tsx` is the only existing dropdown pattern — native `<select>` + `aria-label` + Tailwind. No headless UI lib.
    - **Frontend routes:** `frontend/src/routes/index.tsx:33-63`: only `/projects/:slug`. No ticket-detail route.
    - **Optimistic-mutation precedent (F11/F12):** `onMutate` = cancelQueries + snapshot + setQueryData; `onError` = rollback; `onSettled` = invalidate `boardKeys.all`. Pure utility helpers in `frontend/src/utils/` (e.g. `applyMoveToBoard`, `applyCreateToBoard`).
- **Libraries installed (relevant):** `zod ^4.4.3` (BE only). **No form lib** (no react-hook-form, formik). **No rich-text editor** (no TipTap, Lexical, Quill, Slate). **No sanitizer** (no dompurify, sanitize-html, isomorphic-dompurify). **No UI primitives lib** (no Radix, Headless UI, shadcn, lucide-react). Pure Tailwind v4 + native HTML.
- **Test patterns:** Vitest 3, co-located `*.test.ts(x)`. BE service tests use `vi.hoisted` + Drizzle chain mock. BE route tests use `supertest`. FE tests use `@testing-library/react` priority `getByRole`.
- **CI/lint:** ESLint flat config `tseslint.configs.recommended` — `no-explicit-any` enforced. `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true` (forces `import type`), `isolatedModules: true`. Prettier: 100-char line, 2-space JS, 4-space JSX, trailing commas.
- **Prior art / partial work:** F12 (DONE) ships create + sequential IDs + title-only form. F11 (DONE) ships move + optimistic precedent. F09 (DONE) ships board read and omits `description` from `BoardTicket` (F09 acceptance) — F13 keeps description off the card; description lives on detail/edit only. F08 (DONE) ships projects + slug + columns. F06 (DONE) ships `Users` table. F03 (DONE) locks envelope + `validateRequest`.
- **File paths the plan references that do NOT exist yet (will be created):**
    - `backend/src/routes/users.routes.ts`, `backend/src/routes/users.schema.ts`
    - `backend/src/utils/sanitizeHtml.ts`, `backend/src/utils/sanitizeHtml.test.ts`
    - `frontend/src/api/users.ts`, `frontend/src/api/users.test.ts`
    - `frontend/src/hooks/useUsers.ts`, `frontend/src/hooks/useUsers.test.ts`
    - `frontend/src/hooks/useUpdateTicket.ts`, `frontend/src/hooks/useUpdateTicket.test.ts`
    - `frontend/src/components/RichTextEditor.tsx`, `frontend/src/components/RichTextEditor.test.tsx`
    - `frontend/src/components/UserSelect.tsx`, `frontend/src/components/UserSelect.test.tsx`
    - `frontend/src/components/PrioritySelect.tsx`, `frontend/src/components/PrioritySelect.test.tsx`
    - `frontend/src/components/TicketAttributeForm.tsx`, `frontend/src/components/TicketAttributeForm.test.tsx`
    - `frontend/src/components/CreateTicketModal.tsx`, `frontend/src/components/CreateTicketModal.test.tsx`
    - `frontend/src/utils/sanitizeHtml.ts`, `frontend/src/utils/sanitizeHtml.test.ts`
    - `frontend/src/utils/boardPatch.ts`, `frontend/src/utils/boardPatch.test.ts`
- **File paths this plan CHANGES (exist on `main`):**
    - `backend/src/index.ts` (mount `usersRouter`)
    - `backend/src/services/userService.ts` (add `listUsers()`)
    - `backend/src/services/ticketService.ts` (add `getTicket`, `updateTicket`)
    - `backend/src/services/ticketService.test.ts` (append getTicket/updateTicket tests)
    - `backend/src/services/boardService.ts` (assignee FK-dangle guard in `buildAssignee`)
    - `backend/src/routes/tickets.routes.ts` (add `GET /:ticketId`, widen `PATCH /:ticketId`)
    - `backend/src/routes/tickets.schema.ts` (add `updateTicketBody`, widen existing)
    - `backend/src/routes/tickets.routes.test.ts` (append get/patch attribute tests)
    - `frontend/package.json` (add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `react-hook-form`, `@hookform/resolvers`, `dompurify`, `@types/dompurify`)
    - `backend/package.json` (add `isomorphic-dompurify`)
    - `frontend/src/types/ticket.ts` (add `description` to `Ticket`, add `UpdateTicketDto`)
    - `frontend/src/api/queryKeys.ts` (add `ticketKeys`)
    - `frontend/src/api/tickets.ts` (add `updateTicket`, `fetchTicket`)
    - `frontend/src/components/NewTicketButton.tsx` (open new `CreateTicketModal`) OR replace with modal trigger
    - `frontend/src/components/TicketCard.tsx` (edit affordance: click card → edit form)
    - `frontend/src/pages/BoardPage.tsx` (wire `useUpdateTicket`, modal trigger)
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F13-ticket-attributes`, single-line commits `SLYK-F13: <msg>`, rebase-only no squash, slug SLYK, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful JSON envelope, layering routes→services, Zod at edge, parameterized queries, `authenticate` + permission MW for roles, frontend dirs pages/components/hooks/api/types/stores, React Query server state + Zustand UI + useState local); `.claude/rules/js-style-guide.md` (Prettier, 100 chars, 4-space JSX / 2-space JS, trailing commas, PascalCase components, camelCase hooks/vars, SCREAMING_SNAKE_CASE constants, explicit prop interfaces, import order external→internal→type→relative, no `any`/`console.log`/inline-styles/unnecessary useMemo|useCallback/magic-numbers/prop-drilling); `.claude/rules/js-testing-rules.md` (Vitest, co-located `*.test.ts(x)`, table-driven preferred, `vi.fn()`, RTL priority `getByRole`>`getByLabelText`>`getByByText`>`getByTestId`, coverage business >80% / components >70%); `.claude/rules/persona.md` (React 19 + Express 5 + Postgres + Vite + Tailwind; `verbatimModuleSyntax` → `import type`; `noUncheckedIndexedAccess` → narrow indexed access).
- **Hidden coupling to plan for:**
    - **No DB migration for F13.** Schema already has every column. Regenerating migrations would re-trigger `drizzle-partial-index-enum-dollar1` (MEMORY) — explicitly DO NOT regenerate. F13 ships zero SQL.
    - **`req.user` lacks `fullName`/`avatarUrl`.** `auth.ts:41` sets `{ id, email, role }` only. The user dropdown reads from `listUsers()`, not from `req.user`. Don't widen the JWT.
    - **Description not on the board card.** `BoardTicket` (`boardService.ts:22-34`) intentionally omits `description` (F09 acceptance). F13 keeps it off the card; description is only on detail/edit. The optimistic patch helper therefore updates title/priority/assignee on the board, but description changes do not need to reflect on the card (no description in `BoardTicket`).
    - **`tickets.routes.ts:3` comment "F13 widens the body later" is the contract.** F11 mounted `PATCH /:ticketId` with a move-only body. F13 widens it.
    - **`noUncheckedIndexedAccess`**: indexed access returns `T | undefined`. The TipTap editor instance, array of users, and enum arrays must be narrowed.
    - **`verbatimModuleSyntax`**: every type-only import uses `import type`. DOMPurify config objects are values; type imports (`import type { Config } from 'dompurify'`) stay separate.
    - **DOMPurify jsdom-only.** `isomorphic-dompurify` provides jsdom-backed server sanitize. **Never swap to happy-dom** — cure53 README calls it out as unsafe.
    - **TipTap v3 + React Hook Form pairing.** RHF is uncontrolled; TipTap `useEditor` owns the editor state. Use a ref + `setValue` bridge (Controller or manual) so RHF stays source of truth on submit. TanStack Form conflicts with TipTap's state model — explicitly rejected.
    - **Sanitize twice: write + render.** Server sanitizes on `updateTicket`/`createTicket` write. FE re-sanitizes on render (`frontend/src/utils/sanitizeHtml.ts`) in case stale DB rows predate sanitization or a non-F13 path wrote raw HTML.
    - **Activity-log seam for F18.** F13's `ticketService.updateTicket` returns `{ old, new }` so F18 can diff and write ActivityLogs (REQ-5.2/5.3). F13 does NOT write logs itself. Document the seam in code (`TODO(F18)`).
    - **F16 boundary.** F16 owns the full detail modal that hosts F13's primitives + checklist + labels + activity. F13 ships a create modal + an inline edit form; F16 will host them in a unified surface. Keep `TicketAttributeForm` reusable so F16 can embed it.
    - **Workspace-wide user list.** No `ProjectMembers` table exists (PRD model). All users see all projects. F13's `GET /api/users` is workspace-wide.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Description storage format | **HTML, sanitized on write + re-sanitized on render.** | Simpler XSS surface than TipTap JSON. DOMPurify's native input is HTML. F13 acceptance allows "HTML/Markdown" — pick HTML. Render path handles empty/null/blank safely. |
| D2 | WYSIWYG editor | **TipTap v3** (`@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/pm`). | React 19 first-class. `.getHTML()` returns sanitized-ready HTML. Namespaced imports for tree-shaking. Less glue than Lexical, steadier than Slate, less overkill than BlockNote. Sources: TipTap v3 docs. |
| D3 | Sanitizer | **`isomorphic-dompurify` (BE) + `dompurify` (FE re-sanitize on render). jsdom only.** | cure53 DOMPurify README explicitly flags happy-dom unsafe. Server sanitize on write is the primary defense; FE re-sanitize defends against stale rows or non-F13 write paths. Config: `ALLOWED_TAGS ['p','br','strong','em','ul','ol','li','code','pre','blockquote','a','h3','h4']`, `ALLOWED_ATTR ['href']`, `ALLOW_DATA_ATTR false`. |
| D4 | Form library | **React Hook Form v7.66+ + `@hookform/resolvers/zodResolver`.** | TS-first, uncontrolled (pairs with TipTap `useEditor`). TanStack Form conflicts with TipTap state (rejected); Formik is legacy (rejected). No form lib today — adding one is a net-new dep. |
| D5 | User-list endpoint scope | **`GET /api/users` (workspace-wide, behind `authenticate`).** Returns `{ id, fullName, avatarUrl }[]` only — no email/role (PII minimization). | No `ProjectMembers` table in PRD model → all users see all projects. Per-project endpoint would imply membership the data model lacks. PRD §8.1 `Users` table columns. **Owner Q2.** |
| D6 | Edit endpoint shape | **Widen `PATCH /api/tickets/:ticketId` — one merged body, all fields optional.** Single `updateTicketBody` Zod schema: any subset of `{ title?, description?, priority?, assigneeId? }` PLUS existing move fields `{ statusColumn?, position? }`. | F11 already mounted the router with move-only body; widening is the comment at `tickets.schema.ts:3` literally says to do. Splitting into `PATCH /:id/move` + `PATCH /:id` would force an F11 rewire + duplicate middleware. Merged body keeps one handler. **Owner Q1.** |
| D7 | Ticket-detail endpoint | **`GET /api/tickets/:ticketId`** returns the full `TicketRow` including description. | F13's edit form needs description (not on board). F16 detail modal depends on this endpoint. F13 ships it now so F16 can consume without a backend round-trip later. **Owner Q4.** |
| D8 | Length caps | **Title 1–200, description ≤ 5000.** | Matches existing `createTicketBody` at `projects.schema.ts:37-44`. No new caps. |
| D9 | Priority enum | **Leave existing pgEnum.** No schema change. | `priorityEnum` at `schema.ts:90` already `['LOW','MEDIUM','HIGH','URGENT','CRITICAL']`. PRD §4 out-of-scope: "Custom dynamic priority levels" — fixed enum. |
| D10 | Activity-log integration | **F13 does NOT write ActivityLogs. F18 owns capture.** `ticketService.updateTicket` returns `{ old, new }` so F18 can diff. | PRD REQ-5.2 (priority/assignee/labels → ActivityLogs with old→new) + REQ-5.3 (description → generic `CONTENT_UPDATED`) are F18 territory. F13 leaves a `TODO(F18)` seam and a stable return shape. **Owner Q5.** |
| D11 | Removed-user assignee handling | **App-layer guard.** `boardService.buildAssignee` and `ticketService.getTicket` return `{ id: assigneeId, fullName: 'Unknown user', avatarUrl: null }` if the FK row is missing. Schema stays `ON DELETE no action`; F25 may relax. | F13 spec edge case verbatim: "keep `assignee_id`, show 'unknown user' rather than 500". |
| D12 | UI surface | **Create modal + inline edit form.** `CreateTicketModal` (new) replaces the title-only `NewTicketButton` expand. `TicketCard` gets a click affordance → opens `TicketAttributeForm` in edit mode (modal or inline panel). F16 will host the unified detail modal later. | F12 task doc L97 defers the full attribute modal to F13. F13 must ship something F16 can replace/host — `TicketAttributeForm` is the reusable primitive. **Owner Q3.** |
| D13 | Optimistic-update strategy | **Follow F11/F12 precedent.** `onMutate` = cancelQueries + snapshot BOTH board cache and (new) ticket detail cache + setQueryData; `onError` = rollback; `onSettled` = invalidate `boardKeys.all` + `ticketKeys.detail(id)`. | F11/F12 precedent. TanStack Query v5.90+ tightened mutation callback signatures — use `useQueryClient()` + ctx from `onMutate`. Board patch helper updates title/priority/assignee on the card; description is NOT in `BoardTicket` so it doesn't render on the card. |

> **Out of F13 scope (explicitly deferred):**
> - **Activity-log writes** → **F18**. F13 returns `{ old, new }` from `updateTicket`; F18 hooks capture. `TODO(F18)` seam.
> - **Full detail modal hosting all sections (checklist, labels, activity feed)** → **F16**. F13 ships the attribute-edit primitives + a create modal; F16 unifies.
> - **Labels multi-select and color chips** → **F14** (labels catalog). F13 reuses the existing labels storage but ships no label-picker UI.
> - **Checklist** → later feature. Out of F13.
> - **Per-project user membership** → **F25** (workspace removal). F13 ships workspace-wide user list + FK-dangle guard; F25 owns removal semantics.
> - **Admin-only delete** → **F17**. F13 wires `authenticate` only.
> - **Slug-rename / displayId immutability** → **F27** (inherited from F12). No change in F13.
> - **Custom priority levels / custom ticket fields** → explicitly out per PRD §4.

> **Owner sign-off needed (5 questions — surface in chat before Batch 1 merges):**
> - **Q1 (edit endpoint shape):** single widened PATCH (recommended, merged move + attributes) vs split (`PATCH /:id/move` + `PATCH /:id`). Recommend merged — F11 already mounted; `tickets.schema.ts:3` comment says "F13 widens the body later".
> - **Q2 (user-list endpoint):** `GET /api/users` workspace-wide (recommended) vs `GET /api/projects/:slug/users` (would imply per-project membership the data model lacks). Recommend workspace-wide.
> - **Q3 (UI surface):** create modal (recommended) vs inline-expand; click-card behavior — open edit form directly (F13, recommended) vs open detail modal (F16). Recommend F13 ships modal + inline edit; F16 hosts unified detail later.
> - **Q4 (ticket-detail endpoint):** ship `GET /api/tickets/:id` now (recommended) vs defer to F16. Recommend now — F13 edit form needs description.
> - **Q5 (activity-log signal):** F13 `updateTicket` returns `{ old, new }` diff for F18 (recommended) vs F18 re-queries. Recommend service returns old + new.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   ├── package.json                                        # MODIFY (T1) — add isomorphic-dompurify
│   └── src/
│       ├── index.ts                                        # MODIFY (T5) — app.use('/api/users', usersRouter)
│       ├── routes/
│       │   ├── users.routes.ts                             # NEW (T5) — GET / (authenticate → listUsers → success)
│       │   ├── users.schema.ts                             # NEW (T5) — empty (no params/query needed); placeholder
│       │   ├── users.routes.test.ts                        # NEW (T5) — supertest scenarios
│       │   ├── tickets.routes.ts                           # MODIFY (T7) — add GET /:ticketId; widen PATCH /:ticketId body
│       │   ├── tickets.schema.ts                           # MODIFY (T7) — add updateTicketBody (merged partial)
│       │   └── tickets.routes.test.ts                      # MODIFY (T7) — GET detail + PATCH attribute supertest
│       ├── services/
│       │   ├── userService.ts                              # MODIFY (T5) — add listUsers(): {id, fullName, avatarUrl}[]
│       │   ├── userService.test.ts                         # MODIFY (T5) — listUsers tests
│       │   ├── ticketService.ts                            # MODIFY (T6) — add getTicket(id), updateTicket({ticketId, patch, actingUserId}) → {old, new}
│       │   ├── ticketService.test.ts                       # MODIFY (T6) — getTicket/updateTicket tests (incl sanitize, FK-dangle)
│       │   └── boardService.ts                             # MODIFY (T8) — buildAssignee FK-dangle guard → "Unknown user"
│       └── utils/
│           ├── sanitizeHtml.ts                             # NEW (T2) — sanitizeDescription(html) using isomorphic-dompurify + ALLOWED_TAGS config
│           └── sanitizeHtml.test.ts                        # NEW (T2) — table-driven XSS/edge tests
└── frontend/
    ├── package.json                                        # MODIFY (T1) — add @tiptap/react, @tiptap/starter-kit, @tiptap/pm, react-hook-form, @hookform/resolvers, dompurify, @types/dompurify
    └── src/
        ├── types/
        │   └── ticket.ts                                   # MODIFY (T1) — add description: string|null to Ticket; add UpdateTicketDto
        ├── api/
        │   ├── queryKeys.ts                                # MODIFY (T1) — add ticketKeys { all, detail(id) }
        │   ├── tickets.ts                                  # MODIFY (T9) — add fetchTicket(id), updateTicket(id, dto)
        │   ├── tickets.test.ts                             # MODIFY (T9) — fetch/update tests
        │   ├── users.ts                                    # NEW (T9) — listUsers(): Promise<UserOption[]>
        │   └── users.test.ts                               # NEW (T9) — listUsers tests
        ├── utils/
        │   ├── sanitizeHtml.ts                             # NEW (T10) — FE re-sanitize on render (dompurify, same config)
        │   ├── sanitizeHtml.test.ts                        # NEW (T10)
        │   ├── boardPatch.ts                               # NEW (T10) — PURE applyPatchToBoard(board, ticketId, patch) → Board
        │   └── boardPatch.test.ts                          # NEW (T10)
        ├── hooks/
        │   ├── useUsers.ts                                 # NEW (T10) — useQuery listUsers, queryKey users
        │   ├── useUsers.test.ts                            # NEW (T10)
        │   ├── useUpdateTicket.ts                          # NEW (T10) — useMutation optimistic (board + detail snapshot)
        │   └── useUpdateTicket.test.ts                     # NEW (T10)
        ├── components/
        │   ├── RichTextEditor.tsx                          # NEW (T11) — TipTap wrapper, RHF bridge via Controller
        │   ├── RichTextEditor.test.tsx                     # NEW (T11)
        │   ├── PrioritySelect.tsx                          # NEW (T12) — native <select> + PRIORITY_DISPLAY
        │   ├── PrioritySelect.test.tsx                     # NEW (T12)
        │   ├── UserSelect.tsx                              # NEW (T12) — native <select>, options from useUsers
        │   ├── UserSelect.test.tsx                         # NEW (T12)
        │   ├── TicketAttributeForm.tsx                     # NEW (T13) — RHF + zodResolver, composes RichTextEditor + selects; mode='create'|'edit'
        │   ├── TicketAttributeForm.test.tsx                # NEW (T13)
        │   ├── CreateTicketModal.tsx                       # NEW (T14) — wraps TicketAttributeForm mode='create'
        │   ├── CreateTicketModal.test.tsx                  # NEW (T14)
        │   ├── NewTicketButton.tsx                         # MODIFY (T14) — open CreateTicketModal instead of title-only expand
        │   ├── TicketCard.tsx                              # MODIFY (T14) — click affordance → TicketAttributeForm mode='edit'
        │   └── TicketCard.test.tsx                         # MODIFY (T14) — click → edit form
        └── pages/
            └── BoardPage.tsx                               # MODIFY (T14) — wire CreateTicketModal + useUpdateTicket
```

**Request lifecycle (`PATCH /api/tickets/:ticketId`, post-F13):**

1. Client `updateTicket(id, dto)` → `apiFetch(\`/tickets/${id}\`, { method: 'PATCH', body: JSON.stringify(dto) })` → Bearer injected.
2. `authenticate` (F05): verifies JWT → `req.user = { id, email, role }`.
3. `validateRequest({ params: ticketIdParam, body: updateTicketBody })`: Zod partial (any subset of title 1–200, description ≤5000, priority enum, assigneeId uuid|null, plus existing move fields) → `VALIDATION_FAILED`/400 on fail.
4. Handler calls `ticketService.updateTicket({ ticketId, patch: body, actingUserId: req.user.id })`:
   - Load ticket by id → missing → `NOT_FOUND`/404.
   - If `description` in patch → `sanitizeDescription(description)` (DOMPurify + ALLOWED_TAGS).
   - Snapshot `old` row.
   - `db.update(tickets).set({ ...patch, updatedAt: new Date() }).where(eq(id, ticketId)).returning()` → `new` row.
   - Return `{ old, new }` for F18 to hook.
5. Returns `200` + `success(new)`. (Service internally returns `{ old, new }`; route responds with `new` so the HTTP envelope is stable. F18 reads the service shape, not the HTTP shape.)
6. FE `useUpdateTicket.onMutate`: cancelQueries (`boardKeys.all`, `ticketKeys.detail(id)`) → snapshot board + (if cached) detail → `setQueryData(applyPatchToBoard(board, id, patch))` → optimistic card title/priority/assignee update. `onSettled` invalidates `boardKeys.all` + `ticketKeys.detail(id)`.

---

## 5. Parallelization Strategy

Tasks are grouped into **7 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
 ┌─ Batch 0 (foundation) ─────────────────────────────────────────────────┐
 │  T1  deps install + Ticket type widen + ticketKeys + UpdateTicketDto    │
 │      [backend/package.json, frontend/package.json,                      │
 │       frontend/src/types/ticket.ts, frontend/src/api/queryKeys.ts]      │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (types + deps stable)
                          ▼
 ┌─ Batch 1 (BE utilities + users) ─┐   ┌─ Batch 2 (BE ticket detail/edit) ─┐
 │  T2  sanitizeHtml util + tests    │   │  T6  ticketService.getTicket +     │
 │      [utils/sanitizeHtml.ts,      │   │      updateTicket + tests          │
 │       utils/sanitizeHtml.test.ts] │   │      [services/ticketService.ts,   │
 │  T5  listUsers + GET /api/users + │   │       services/ticketService.test] │
 │      index.ts wiring + tests      │   │  T7  widen tickets.routes.ts +     │
 │      [services/userService.ts,    │   │      tickets.schema.ts + tests     │
 │       routes/users.routes.ts,     │   │      [routes/tickets.routes.ts,    │
 │       routes/users.schema.ts,     │   │       routes/tickets.schema.ts,    │
 │       routes/users.routes.test,   │   │       routes/tickets.routes.test]  │
 │       index.ts]                   │   │  T8  boardService assignee guard   │
 │  (T2 ‖ T5 disjoint files; T5      │   │      [services/boardService.ts]    │
 │   depends on T1 for isomorphic-   │   │  (T6 → T7 serialized WITHIN B2;    │
 │   dompurify install)              │   │   T7 imports updateTicket; T8 ‖ T7)│
 └────────────────────────┬──────────┘   └─────────────────┬─────────────────┘
                          │ (HTTP contracts stable)         │
                          ▼                                 ▼
 ┌─ Batch 3 (FE API + hooks) ──────────────────────────────────────────────┐
 │  T9   api/users.ts + api/tickets.ts (fetchTicket, updateTicket) + tests │
 │       [api/users.ts, api/users.test.ts, api/tickets.ts,                 │
 │        api/tickets.test.ts]                                             │
 │  T10  hooks/useUsers, hooks/useUpdateTicket + utils/boardPatch +        │
 │       utils/sanitizeHtml (FE) + tests                                   │
 │       [hooks/*, utils/boardPatch.ts, utils/sanitizeHtml.ts]             │
 │  (T9 → T10 serialized; T10 imports fetchTicket/updateTicket)            │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (hooks available)
                          ▼
 ┌─ Batch 4 (FE primitives) ───────────────────────────────────────────────┐
 │  T11  RichTextEditor.tsx (TipTap + RHF bridge) + tests                  │
 │       [components/RichTextEditor.tsx, *.test.tsx]                       │
 │  T12  PrioritySelect.tsx + UserSelect.tsx + tests                       │
 │       [components/PrioritySelect.tsx, components/UserSelect.tsx,        │
 │        *.test.tsx]                                                      │
 │  (T11 ‖ T12 disjoint files)                                            │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (primitives available)
                          ▼
 ┌─ Batch 5 (FE composition) ──────────────────────────────────────────────┐
 │  T13  TicketAttributeForm.tsx (RHF + zodResolver, composes primitives)  │
 │       [components/TicketAttributeForm.tsx, *.test.tsx]                  │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (form available)
                          ▼
 ┌─ Batch 6 (FE wiring) ───────────────────────────────────────────────────┐
 │  T14  CreateTicketModal + NewTicketButton rewire + TicketCard edit +    │
 │       BoardPage wiring + tests                                          │
 │       [components/CreateTicketModal.tsx, components/NewTicketButton.tsx,│
 │        components/TicketCard.tsx, pages/BoardPage.tsx, *.test.tsx]      │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (feature complete)
                          ▼
 ┌─ Batch 7 (terminal) ────────────────────────────────────────────────────┐
 │  T15  Integration gate: typecheck/lint/format/test/build + live smoke   │
 │       (no new feature files)                                            │
 └─────────────────────────────────────────────────────────────────────────┘
```

- **B0 hard barrier:** every later task imports the widened `Ticket` type, `ticketKeys`, or new deps. B0 merges first.
- **B0 → (B1 ‖ B2) soft barrier:** B1 and B2 can be parallel-developer-assigned once B0 is on `main`. B1 owns `users.*` + sanitizer util; B2 owns `tickets.*` + ticketService. Zero file overlap.
- **Within B1: T2 ‖ T5.** T2 (sanitizer util) and T5 (users route/service/wiring) are disjoint. T5 depends on B0 for the `isomorphic-dompurify` install.
- **Within B2: T6 → T7, then T8 ‖ T7.** T6 (service) before T7 (route/schema — imports `updateTicket`). T8 (boardService guard) is disjoint from T7 and can parallel.
- **(B1 ‖ B2) → B3 hard barrier:** FE API/hooks need both HTTP contracts stable (`GET /api/users`, `GET /api/tickets/:id`, `PATCH /api/tickets/:id`).
- **Within B3: T9 → T10.** T10 imports `fetchTicket`/`updateTicket` (T9).
- **B3 → B4 hard barrier:** primitives need hooks (`useUsers`) + types (`UpdateTicketDto`).
- **Within B4: T11 ‖ T12.** RichTextEditor and selects are disjoint.
- **B4 → B5 hard barrier:** form composes primitives.
- **B5 → B6 hard barrier:** wiring consumes the form.
- **B6 → B7 hard barrier:** verification runs against as-merged feature.

### Merge order rules

1. **B0 (T1) merges first.** Types + deps are the shared spine. `main` must have T1 before any other batch branches.
2. **B1 (T2 ‖ T5) merges second.** Disjoint files; either order. `main` must have both before B3 branches.
3. **B2 (T6 → T7, T8 ‖ T7) merges third.** T6 before T7; T8 anytime. Can run in parallel with B1 (different files).
4. **B3 (T9 → T10) merges fourth.** Depends on B1 + B2 contracts on `main`.
5. **B4 (T11 ‖ T12) merges fifth.** Disjoint files; either order.
6. **B5 (T13) merges sixth.** Composes T11 + T12.
7. **B6 (T14) merges seventh.** Wires T13 into pages.
8. **B7 (T15) merges last.** Verification record only.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 0 | `backend/package.json`, `frontend/package.json`, `frontend/src/types/ticket.ts`, `frontend/src/api/queryKeys.ts` | F12 (DONE) | — |
| **T2** | 1 | `backend/src/utils/sanitizeHtml.ts`, `backend/src/utils/sanitizeHtml.test.ts` | T1 | T5 |
| **T5** | 1 | `backend/src/services/userService.ts`, `backend/src/services/userService.test.ts`, `backend/src/routes/users.routes.ts`, `backend/src/routes/users.schema.ts`, `backend/src/routes/users.routes.test.ts`, `backend/src/index.ts` | T1 | T2 |
| **T6** | 2 | `backend/src/services/ticketService.ts`, `backend/src/services/ticketService.test.ts` | T1, T2 | T8 |
| **T7** | 2 | `backend/src/routes/tickets.routes.ts`, `backend/src/routes/tickets.schema.ts`, `backend/src/routes/tickets.routes.test.ts` | T6 | T8 |
| **T8** | 2 | `backend/src/services/boardService.ts` | T1 | T6, T7 |
| **T9** | 3 | `frontend/src/api/users.ts`, `frontend/src/api/users.test.ts`, `frontend/src/api/tickets.ts`, `frontend/src/api/tickets.test.ts` | T5, T7 (contracts) | — |
| **T10** | 3 | `frontend/src/hooks/useUsers.ts`, `frontend/src/hooks/useUsers.test.ts`, `frontend/src/hooks/useUpdateTicket.ts`, `frontend/src/hooks/useUpdateTicket.test.ts`, `frontend/src/utils/boardPatch.ts`, `frontend/src/utils/boardPatch.test.ts`, `frontend/src/utils/sanitizeHtml.ts`, `frontend/src/utils/sanitizeHtml.test.ts` | T9 | — |
| **T11** | 4 | `frontend/src/components/RichTextEditor.tsx`, `frontend/src/components/RichTextEditor.test.tsx` | T1 | T12 |
| **T12** | 4 | `frontend/src/components/PrioritySelect.tsx`, `frontend/src/components/PrioritySelect.test.tsx`, `frontend/src/components/UserSelect.tsx`, `frontend/src/components/UserSelect.test.tsx` | T10 (for `useUsers`) | T11 |
| **T13** | 5 | `frontend/src/components/TicketAttributeForm.tsx`, `frontend/src/components/TicketAttributeForm.test.tsx` | T11, T12 | — |
| **T14** | 6 | `frontend/src/components/CreateTicketModal.tsx`, `frontend/src/components/CreateTicketModal.test.tsx`, `frontend/src/components/NewTicketButton.tsx`, `frontend/src/components/TicketCard.tsx`, `frontend/src/components/TicketCard.test.tsx`, `frontend/src/pages/BoardPage.tsx` | T13 | — |
| **T15** | 7 | (verification record only) | T1–T14 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → (T2 ‖ T5) → (T6 → T7, T8) → (T9 → T10) → (T11 ‖ T12) → T13 → T14 → T15. ~3 days.
- **2 devs (max parallelism):**
    - **Dev-A (backend):** T1 → (T2 ‖ T5) → (T6 → T7, T8) → help T15.
    - **Dev-B (frontend):** waits for B0 + B1/B2 contracts, then (T9 → T10) → (T11 ‖ T12) → T13 → T14 → help T15.
    - Merge order: B0 → (B1 ‖ B2) → B3 → (B4 → B5 → B6) → B7.
- **3 devs:**
    - Dev-A: backend users (T2, T5).
    - Dev-B: backend ticket detail/edit (T6, T7, T8).
    - Dev-C: waits, then frontend track (T9 → T10 → T11 ‖ T12 → T13 → T14).
    - All converge on T15.

---

## 6. Tasks

### T1 — Install F13 deps + widen Ticket type + add ticketKeys

**Batch:** 0 · **Depends on:** F12 (DONE) · **Parallel with:** —

**Description:** Foundation for every later task. Install the WYSIWYG editor (TipTap v3), form lib (React Hook Form + zodResolver), sanitizer (BE `isomorphic-dompurify`, FE `dompurify` + `@types/dompurify`), and TipTap ProseMirror peer (`@tiptap/pm`). Then widen the FE `Ticket` type to include `description: string | null` and add `UpdateTicketDto`. Add `ticketKeys` to the query-keys module so T10 can build the detail-cache snapshot.

No DB migration. No schema regen (would re-trigger `drizzle-partial-index-enum-dollar1`). The `tickets` table already has every F13 column.

Create / Modify:
- `backend/package.json` — add `"isomorphic-dompurify": "^2.0.0"` (latest stable). Run `npm install -w backend`.
- `frontend/package.json` — add `"@tiptap/react": "^3.0.0"`, `"@tiptap/starter-kit": "^3.0.0"`, `"@tiptap/pm": "^3.0.0"`, `"react-hook-form": "^7.66.0"`, `"@hookform/resolvers": "^3.9.0"`, `"dompurify": "^3.2.0"`, `"@types/dompurify": "^3.0.0"` (dev). Run `npm install -w frontend`.
- `frontend/src/types/ticket.ts` — modify:
  ```typescript
  export interface Ticket {
      id: string
      ticketNumber: number
      projectId: string
      title: string
      description: string | null   // NEW — F13
      statusColumn: string
      position: number
      priority: Priority
      labels: string[]
      assignee: Assignee | null
      creatorId: string
      createdAt: string
      updatedAt: string
  }

  // NEW — F13
  export interface UpdateTicketDto {
      title?: string
      description?: string | null
      priority?: Priority
      assigneeId?: string | null
  }
  ```
- `frontend/src/api/queryKeys.ts` — add:
  ```typescript
  export const ticketKeys = {
      all: ['tickets'] as const,
      detail: (id: string) => [...ticketKeys.all, 'detail', id] as const,
  }
  ```

**Acceptance Criteria:**
- [ ] `npm install -w backend` and `npm install -w frontend` succeed; lockfiles update.
- [ ] `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `react-hook-form`, `@hookform/resolvers`, `dompurify`, `@types/dompurify`, `isomorphic-dompurify` all resolve (verify with `npm ls -w frontend @tiptap/react` etc.).
- [ ] `frontend/src/types/ticket.ts` exports `Ticket` with `description: string | null` and exports `UpdateTicketDto`.
- [ ] `frontend/src/api/queryKeys.ts` exports `ticketKeys.all` and `ticketKeys.detail(id)`.
- [ ] `rtk tsc` (FE + BE) passes with no new errors.
- [ ] No DB migration generated. Confirm `git status backend/src/db/migrations/` shows no new files.

**Dependencies:** F12 (DONE — `Ticket` type baseline).

---

### T2 — BE sanitizeHtml util + tests

**Batch:** 1 · **Depends on:** T1 · **Parallel with:** T5

**Description:** Server-side HTML sanitizer for the description field. Primary defense against stored XSS — strips scripts, event handlers, and any tag/attribute outside the allowlist. Used by T6 (`ticketService.updateTicket` and, retroactively, the create path if description is provided).

Use `isomorphic-dompurify` (jsdom-backed — cure53 README explicitly flags happy-dom unsafe). Define a single config and export one function. Table-driven test the config against XSS payloads + edge cases.

Create:
- `backend/src/utils/sanitizeHtml.ts`:
  ```typescript
  import DOMPurify from 'isomorphic-dompurify'

  const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'a', 'h3', 'h4']
  const ALLOWED_ATTR = ['href']

  /** Strip disallowed tags/attrs from a description HTML string. Returns '' for empty/null input. */
  export function sanitizeDescription(input: string | null | undefined): string {
      if (!input) return ''
      return DOMPurify.sanitize(input, {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          ALLOW_DATA_ATTR: false,
          FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
      })
  }
  ```
- `backend/src/utils/sanitizeHtml.test.ts` — table-driven:
  ```typescript
  const cases = [
      { name: 'plain text passthrough', input: 'hello', expected: 'hello' },
      { name: 'allowed tags kept', input: '<p>hi</p>', expected: '<p>hi</p>' },
      { name: 'script stripped', input: '<script>alert(1)</script>hi', expected: 'hi' },
      { name: 'onerror stripped', input: '<img src=x onerror=alert(1)>', expected: '' },
      { name: 'href kept on a', input: '<a href="https://x.com">x</a>', expected: '<a href="https://x.com">x</a>' },
      { name: 'javascript: href stripped', input: '<a href="javascript:alert(1)">x</a>', expected: '<a>x</a>' },
      { name: 'style tag stripped', input: '<style>*{}</style>hi', expected: 'hi' },
      { name: 'iframe stripped', input: '<iframe src=x></iframe>', expected: '' },
      { name: 'empty input', input: '', expected: '' },
      { name: 'null input', input: null, expected: '' },
      { name: 'undefined input', input: undefined, expected: '' },
  ]
  ```

**Acceptance Criteria:**
- [ ] `sanitizeDescription` strips `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`.
- [ ] Strips all `on*` event handlers and `javascript:` URLs.
- [ ] Keeps `<p>`, `<br>`, `<strong>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<code>`, `<pre>`, `<blockquote>`, `<a href>`, `<h3>`, `<h4>`.
- [ ] Returns `''` for null/undefined/empty input.
- [ ] All table-driven tests pass (`rtk vitest run backend/src/utils/sanitizeHtml.test.ts`).
- [ ] No `any` types. `verbatimModuleSyntax`-clean (`import DOMPurify from ...` is a value import).

**Dependencies:** T1 (`isomorphic-dompurify` installed).

---

### T5 — BE listUsers service + GET /api/users route + wiring

**Batch:** 1 · **Depends on:** T1 · **Parallel with:** T2

**Description:** Workspace-wide user list endpoint behind `authenticate`. F13 needs this for the assignee dropdown. Returns minimal PII — `{ id, fullName, avatarUrl }[]` only; no email, no role. Matches the no-`ProjectMembers`-table PRD model (all users see all projects).

`UserService` already exists with `findUserById`/`findUserByGoogleId`/`upsertByGoogleId` — add `listUsers()`. Mount a new `usersRouter` at `/api/users` in `index.ts` (alongside existing `/api/auth`, `/api/projects`, `/api/tickets` mounts at `index.ts:50-52`).

Create / Modify:
- `backend/src/services/userService.ts` — add:
  ```typescript
  export type UserOption = { id: string; fullName: string; avatarUrl: string | null }

  export async function listUsers(): Promise<UserOption[]> {
      const rows = await db.select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl }).from(users).orderBy(users.fullName)
      return rows
  }
  ```
- `backend/src/services/userService.test.ts` — append `listUsers` table-driven tests (empty table, single user, ordering, PII exclusion).
- `backend/src/routes/users.schema.ts` — placeholder (no params/query today; exists so future users routes have a home).
- `backend/src/routes/users.routes.ts`:
  ```typescript
  import { Router } from 'express'
  import { authenticate } from '../middleware/auth'
  import { success } from '../utils/envelope'
  import { listUsers } from '../services/userService'

  export const usersRouter = Router()

  usersRouter.get('/', authenticate, async (_req, res) => {
      const users = await listUsers()
      res.json(success(users))
  })
  ```
- `backend/src/routes/users.routes.test.ts` — supertest: 401 without token, 200 + `{ data: [{ id, fullName, avatarUrl }] }` with token, no `email`/`role` in response, ordering.
- `backend/src/index.ts` — add `app.use('/api/users', usersRouter)` next to the existing mounts.

**Acceptance Criteria:**
- [ ] `GET /api/users` without Bearer returns 401 `UNAUTHENTICATED`.
- [ ] `GET /api/users` with valid Bearer returns 200 `{ data: UserOption[] }`.
- [ ] Response items contain `id`, `fullName`, `avatarUrl` only — `email` and `role` absent.
- [ ] Response sorted by `fullName` ascending.
- [ ] Empty users table → 200 `{ data: [] }`.
- [ ] `usersRouter` mounted at `/api/users` (verified by supertest through the Express app).
- [ ] Coverage of `userService.listUsers` > 80%.
- [ ] No `any`; `import type` for `UserOption` where consumed as type only.

**Dependencies:** T1 (no new deps, but type additions stable). Owner Q2 (workspace-wide vs per-project).

---

### T6 — BE ticketService.getTicket + updateTicket

**Batch:** 2 · **Depends on:** T1, T2 · **Parallel with:** T8

**Description:** Two new service functions on `ticketService.ts`. `getTicket(id)` returns the full `TicketRow` (including `description`) for the F13 detail/edit endpoint and F16 modal later. `updateTicket({ ticketId, patch, actingUserId })` applies a partial patch (any subset of title/description/priority/assigneeId), sanitizes description on write, and returns `{ old, new }` so F18 can diff and write ActivityLogs (REQ-5.2/5.3) without re-querying. F13 itself does NOT write ActivityLogs — leaves a `TODO(F18)` seam.

Reuse the existing `db` singleton and Drizzle patterns. The `TicketRow` type is already `typeof tickets.$inferSelect` (`ticketService.ts:16`). Snapshot `old` before update, return both.

Modify `backend/src/services/ticketService.ts`:
```typescript
import { eq } from 'drizzle-orm'
import { tickets } from '../db/schema'
import { db } from '../db/client'
import { sanitizeDescription } from '../utils/sanitizeHtml'
import type { Priority } from '../db/schema'  // or wherever the enum type lives
import type { TicketRow } from './ticketService'  // self-reference; adjust to local file

export type TicketPatch = {
    title?: string
    description?: string | null
    priority?: Priority
    assigneeId?: string | null
}

export async function getTicket(ticketId: string): Promise<TicketRow | null> {
    const rows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
    return rows[0] ?? null
}

export async function updateTicket(args: {
    ticketId: string
    patch: TicketPatch
    actingUserId: string
}): Promise<{ old: TicketRow; new: TicketRow }> {
    const { ticketId, patch } = args
    const oldRows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
    const oldRow = oldRows[0]
    if (!oldRow) {
        throw new AppError('NOT_FOUND', 'Ticket not found')
    }

    const updateSet: Partial<TicketRow> = { updatedAt: new Date() }
    if (patch.title !== undefined) updateSet.title = patch.title
    if (patch.description !== undefined) {
        updateSet.description = patch.description === null ? null : sanitizeDescription(patch.description)
    }
    if (patch.priority !== undefined) updateSet.priority = patch.priority
    if (patch.assigneeId !== undefined) updateSet.assigneeId = patch.assigneeId

    const updated = await db.update(tickets).set(updateSet).where(eq(tickets.id, ticketId)).returning()
    const newRow = updated[0]
    if (!newRow) {
        throw new AppError('INTERNAL_ERROR', 'Update returned no row')
    }

    // TODO(F18): F18 will diff {old, new} and write ActivityLogs (REQ-5.2 priority/assignee → old→new;
    // REQ-5.3 description → generic CONTENT_UPDATED). F13 returns the diff shape; F18 hooks here.
    return { old: oldRow, new: newRow }
}
```

Also wire `actingUserId` for future audit (F18 may stamp `created_by`-style metadata; for now no behavior, but accept it in the signature so the route contract is stable).

Modify `backend/src/services/ticketService.test.ts` — append:
- `getTicket`: existing ticket → returns row with description; missing id → null.
- `updateTicket`: missing ticket → throws `NOT_FOUND`; title-only patch → only title + updatedAt change; description patch sanitizes (mock `sanitizeDescription` to verify call); priority patch; assigneeId null patch (unassign); assigneeId uuid patch; returns `{ old, new }` with old pre-patch and new post-patch.

Use `vi.hoisted` + Drizzle chain mock (matches existing `ticketService.test.ts` style).

**Acceptance Criteria:**
- [ ] `getTicket(existingId)` returns full `TicketRow` including `description`.
- [ ] `getTicket(missingId)` returns `null`.
- [ ] `updateTicket` on missing ticket throws `AppError('NOT_FOUND', ...)`.
- [ ] Title-only patch updates only `title` + `updatedAt`.
- [ ] Description patch routes through `sanitizeDescription` (mocked to verify called once with the input).
- [ ] `description: null` patch sets description to `null` (does not invoke sanitizer).
- [ ] Priority patch validates enum at the route layer; service accepts the typed `Priority`.
- [ ] `assigneeId: null` patch unassigns.
- [ ] Returns `{ old, new }` where `old` is the pre-update snapshot and `new` is the post-update row.
- [ ] `TODO(F18)` comment present at the return site documenting the ActivityLog seam.
- [ ] Coverage of new service code > 80%.
- [ ] No `any`; `import type` for `TicketRow`, `Priority`, `TicketPatch`.

**Dependencies:** T1 (types), T2 (`sanitizeDescription`). Owner Q5 (return `{ old, new }` for F18).

---

### T7 — BE widen tickets.routes.ts + tickets.schema.ts (GET detail + PATCH attributes)

**Batch:** 2 · **Depends on:** T6 · **Parallel with:** T8

**Description:** Wire the HTTP surface for F13. Add `GET /api/tickets/:ticketId` (detail, returns description) and widen the existing `PATCH /api/tickets/:ticketId` body from move-only to merged partial (move fields + attribute fields). The comment at `tickets.schema.ts:3` literally says "F13 widens the body later" — this is that widening.

F11 mounted `ticketsRouter` and the `PATCH /:ticketId` route. Keep the same handler signature; just expand the Zod schema and call `ticketService.updateTicket` (which now exists from T6) when attribute fields are present, and `ticketService.moveTicket` (existing) when move fields are present. Simplest: detect which subset is present and dispatch — OR merge into one `updateTicketBody` that accepts all optional and let the service apply both. Recommend the merged approach (Owner Q1).

Modify `backend/src/routes/tickets.schema.ts`:
```typescript
import { z } from 'zod'

export const ticketIdParam = z.object({ ticketId: z.uuid() })

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'])

// F11 move fields (existing) — kept as-is for the merged body.
const moveFields = {
    statusColumn: z.string().min(1).optional(),
    position: z.number().optional(),
}

// F13 attribute fields (new).
const attributeFields = {
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: priorityEnum.optional(),
    assigneeId: z.uuid().nullable().optional(),
}

// F13 widened body — any subset of move + attribute fields.
export const updateTicketBody = z.object({ ...moveFields, ...attributeFields }).refine(
    (body) => Object.keys(body).length > 0,
    { message: 'Body must include at least one field' },
)
```

Modify `backend/src/routes/tickets.routes.ts`:
```typescript
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { validateRequest } from '../middleware/validateRequest'
import { success } from '../utils/envelope'
import { ticketIdParam, updateTicketBody } from './tickets.schema'
import { getTicket, moveTicket, updateTicket } from '../services/ticketService'
import { AppError } from '../utils/appError'

export const ticketsRouter = Router()
// TODO(F17): per-column / membership-based permissions.

// F13 — ticket detail (returns description for edit form + F16 modal).
ticketsRouter.get('/:ticketId', authenticate, validateRequest({ params: ticketIdParam }), async (req, res) => {
    const { ticketId } = req.params
    const ticket = await getTicket(ticketId)
    if (!ticket) throw new AppError('NOT_FOUND', 'Ticket not found')
    res.json(success(ticket))
})

// F11 move + F13 attributes — merged PATCH.
ticketsRouter.patch('/:ticketId', authenticate, validateRequest({ params: ticketIdParam, body: updateTicketBody }), async (req, res) => {
    const { ticketId } = req.params
    const body = req.body

    const hasMoveFields = body.statusColumn !== undefined || body.position !== undefined
    const hasAttributeFields = body.title !== undefined || body.description !== undefined || body.priority !== undefined || body.assigneeId !== undefined

    if (hasAttributeFields) {
        const { new: updated } = await updateTicket({
            ticketId,
            patch: {
                title: body.title,
                description: body.description,
                priority: body.priority,
                assigneeId: body.assigneeId,
            },
            actingUserId: req.user.id,
        })
        // If both move + attribute fields present, also apply move on the updated row.
        if (hasMoveFields) {
            const moved = await moveTicket({ ticketId, statusColumn: body.statusColumn, position: body.position, actingUserId: req.user.id })
            res.json(success(moved))
            return
        }
        res.json(success(updated))
        return
    }

    // Move-only path (F11 behavior preserved).
    const moved = await moveTicket({ ticketId, statusColumn: body.statusColumn, position: body.position, actingUserId: req.user.id })
    res.json(success(moved))
})
```

Modify `backend/src/routes/tickets.routes.test.ts` — append supertest scenarios:
- `GET /:ticketId` 401 without token.
- `GET /:ticketId` 200 with description for existing ticket.
- `GET /:ticketId` 404 `NOT_FOUND` for missing id.
- `GET /:ticketId` 400 `VALIDATION_FAILED` for non-uuid param.
- `PATCH /:ticketId` title-only → 200, title updated.
- `PATCH /:ticketId` description with `<script>` → 200, response description is sanitized.
- `PATCH /:ticketId` priority `INVALID` → 400 `VALIDATION_FAILED`.
- `PATCH /:ticketId` priority `LOW` → 200.
- `PATCH /:ticketId` assigneeId `null` → 200, unassigned.
- `PATCH /:ticketId` assigneeId non-uuid → 400.
- `PATCH /:ticketId` empty body → 400 (refine fails).
- `PATCH /:ticketId` move-only (statusColumn + position) → 200, F11 behavior preserved.
- `PATCH /:ticketId` 404 for missing ticket.

**Acceptance Criteria:**
- [ ] `GET /api/tickets/:id` returns 200 `{ data: TicketRow }` including `description` for existing tickets.
- [ ] `GET /api/tickets/:id` returns 404 for missing id.
- [ ] `GET /api/tickets/:id` returns 401 without token, 400 for non-uuid param.
- [ ] `PATCH /api/tickets/:id` accepts title, description, priority, assigneeId (any subset).
- [ ] `PATCH` with description containing `<script>` returns sanitized description in response.
- [ ] `PATCH` with invalid priority returns 400 `VALIDATION_FAILED`.
- [ ] `PATCH` with empty body returns 400 (refine enforces non-empty).
- [ ] F11 move-only behavior preserved (existing F11 tests still pass).
- [ ] `tickets.schema.ts:3` comment updated or removed (no longer "later").
- [ ] Coverage of new route code > 80%.
- [ ] No `any`; `import type` for type-only imports.

**Dependencies:** T6 (`getTicket`, `updateTicket`). Owner Q1 (merged vs split route).

---

### T8 — BE boardService assignee FK-dangle guard

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** T6, T7

**Description:** Harden `boardService.buildAssignee` (`boardService.ts:87-93`) against FK-dangling assignee. Today it left-joins `users` on `assigneeId` and builds the assignee object unsafely — if the FK row is missing (today blocked by `ON DELETE no action`, but F25 workspace removal will trigger this), it produces `{ fullName: undefined }` and the board card renders broken.

F13 ships an app-layer guard: if the assignee row is missing, return `{ id: assigneeId, fullName: 'Unknown user', avatarUrl: null }`. Schema stays `ON DELETE no action`; F25 may relax to `SET NULL` later. Documented decision D11.

Modify `backend/src/services/boardService.ts:87-93` (the assignee build block):
```typescript
// Before (unsafe):
// const assignee = row.assigneeFullName !== null
//     ? { id: row.assigneeId, fullName: row.assigneeFullName, avatarUrl: row.assigneeAvatarUrl }
//     : null

// After (FK-dangle guard):
const assignee =
    row.assigneeId === null
        ? null
        : row.assigneeFullName === null
          ? { id: row.assigneeId, fullName: 'Unknown user', avatarUrl: null }  // F13 D11 — FK dangle
          : { id: row.assigneeId, fullName: row.assigneeFullName, avatarUrl: row.assigneeAvatarUrl }
```

(Adapt the exact field names to whatever the existing left-join select emits — confirm by reading `boardService.ts:48-149` before editing.)

Modify `backend/src/services/boardService.test.ts` — append:
- Assignee present → normal `{ id, fullName, avatarUrl }`.
- Assignee null (unassigned) → null.
- Assignee FK dangling (join returns assigneeId but null fullName/avatarUrl) → `{ id, fullName: 'Unknown user', avatarUrl: null }`.

Use the existing `vi.hoisted` + Drizzle chain mock pattern.

**Acceptance Criteria:**
- [ ] Normal assignee renders `{ id, fullName, avatarUrl }`.
- [ ] Unassigned ticket renders `assignee: null`.
- [ ] FK-dangling assignee (id present but joined row missing) renders `{ id, fullName: 'Unknown user', avatarUrl: null }` — never 500.
- [ ] `TicketCard` (FE) already renders `<AssigneeAvatar>` null-safely — verify "Unknown user" displays correctly without further FE changes.
- [ ] No new schema migration. `ON DELETE no action` preserved.
- [ ] Coverage of `buildAssignee` path > 80%.

**Dependencies:** T1 (no type changes needed, but baselines stable). Decision D11.

---

### T9 — FE API: users.ts + tickets.ts (fetchTicket, updateTicket)

**Batch:** 3 · **Depends on:** T5, T7 (HTTP contracts stable) · **Parallel with:** —

**Description:** Frontend API client functions for the F13 endpoints. Reuse `apiFetch<T>` (`frontend/src/api/client.ts:45-131`) which injects Bearer, unwraps `{ data }`, and throws `ApiClientError`. Add `listUsers` (T5 contract), `fetchTicket` (T7 contract), `updateTicket` (T7 contract).

Create / Modify:
- `frontend/src/api/users.ts`:
  ```typescript
  import { apiFetch } from './client'

  export interface UserOption {
      id: string
      fullName: string
      avatarUrl: string | null
  }

  export async function listUsers(): Promise<UserOption[]> {
      return apiFetch<UserOption[]>('/users')
  }
  ```
- `frontend/src/api/users.test.ts` — mock `apiFetch`, assert path + return.
- `frontend/src/api/tickets.ts` — append to existing file:
  ```typescript
  import { apiFetch } from './client'
  import type { Ticket, UpdateTicketDto } from '../types/ticket'

  export async function fetchTicket(ticketId: string): Promise<Ticket> {
      return apiFetch<Ticket>(`/tickets/${ticketId}`)
  }

  export async function updateTicket(ticketId: string, dto: UpdateTicketDto): Promise<Ticket> {
      return apiFetch<Ticket>(`/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify(dto) })
  }
  ```
- `frontend/src/api/tickets.test.ts` — append fetch/update tests (mock `apiFetch`, assert URL/method/body).

**Acceptance Criteria:**
- [ ] `listUsers()` calls `apiFetch<UserOption[]>('/users')` and returns the data array.
- [ ] `fetchTicket(id)` calls `apiFetch<Ticket>(\`/tickets/${id}\`)`.
- [ ] `updateTicket(id, dto)` calls `apiFetch` with method PATCH and serialized body.
- [ ] All three throw `ApiClientError` on non-2xx (verified via mock).
- [ ] `UserOption` type excludes `email`/`role`.
- [ ] No `any`; `import type` for `Ticket`, `UpdateTicketDto`.

**Dependencies:** T5 (`GET /api/users` contract), T7 (`GET`/`PATCH /api/tickets/:id` contracts).

---

### T10 — FE hooks: useUsers, useUpdateTicket + boardPatch util + FE sanitize util

**Batch:** 3 · **Depends on:** T9 · **Parallel with:** —

**Description:** React Query hooks for the user list and ticket update. `useUsers` is a simple `useQuery`. `useUpdateTicket` is an optimistic mutation following the F11/F12 precedent (`useMoveTicket`, `useCreateTicket`): `onMutate` cancels queries, snapshots board cache AND the new ticket detail cache, applies the patch via a pure `boardPatch` util; `onError` rolls back; `onSettled` invalidates `boardKeys.all` + `ticketKeys.detail(id)`.

Also add the FE-side `sanitizeHtml` util — re-sanitize description on render (`dompurify`, same config as BE) to defend against stale rows or non-F13 write paths.

Create:
- `frontend/src/utils/sanitizeHtml.ts`:
  ```typescript
  import DOMPurify from 'dompurify'

  const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'a', 'h3', 'h4']
  const ALLOWED_ATTR = ['href']

  export function sanitizeDescription(input: string | null | undefined): string {
      if (!input) return ''
      return DOMPurify.sanitize(input, {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          ALLOW_DATA_ATTR: false,
          FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
          FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
      })
  }
  ```
- `frontend/src/utils/sanitizeHtml.test.ts` — table-driven (mirror BE T2 cases).
- `frontend/src/utils/boardPatch.ts`:
  ```typescript
  import type { Board } from '../types'  // or wherever Board lives
  import type { Ticket } from '../types/ticket'

  /** Pure: apply an attribute patch to the board's ticket row. Description is NOT in BoardTicket, so
   *  only title/priority/assignee reflect on the card. Returns a new Board (immutable). */
  export function applyPatchToBoard(board: Board, ticketId: string, patch: Partial<Ticket>): Board {
      // walk columns → tickets, find by id, spread patch, return new board
      // ... (immutable update)
  }
  ```
- `frontend/src/utils/boardPatch.test.ts` — table-driven: patch title updates card title; patch description does NOT touch the card (BoardTicket has no description); patch priority updates; patch assignee updates; missing ticket id returns board unchanged.
- `frontend/src/hooks/useUsers.ts`:
  ```typescript
  import { useQuery } from '@tanstack/react-query'
  import { listUsers } from '../api/users'

  export function useUsers() {
      return useQuery({ queryKey: ['users'], queryFn: listUsers, staleTime: 60_000 })  // 60s — users change rarely
  }
  ```
- `frontend/src/hooks/useUsers.test.ts` — query renders, returns data, error handling.
- `frontend/src/hooks/useUpdateTicket.ts`:
  ```typescript
  import { useMutation, useQueryClient } from '@tanstack/react-query'
  import { updateTicket } from '../api/tickets'
  import { boardKeys } from '../api/queryKeys'
  import { ticketKeys } from '../api/queryKeys'
  import { applyPatchToBoard } from '../utils/boardPatch'
  import type { Board } from '../types'
  import type { Ticket, UpdateTicketDto } from '../types/ticket'

  export function useUpdateTicket() {
      const qc = useQueryClient()
      return useMutation({
          mutationFn: ({ ticketId, dto }: { ticketId: string; dto: UpdateTicketDto }) =>
              updateTicket(ticketId, dto),
          onMutate: async ({ ticketId, dto }) => {
              await qc.cancelQueries({ queryKey: boardKeys.all })
              await qc.cancelQueries({ queryKey: ticketKeys.detail(ticketId) })
              const prevBoard = qc.getQueryData<Board>(boardKeys.all)
              const prevTicket = qc.getQueryData<Ticket>(ticketKeys.detail(ticketId))
              if (prevBoard) {
                  qc.setQueryData<Board>(boardKeys.all, applyPatchToBoard(prevBoard, ticketId, dto))
              }
              if (prevTicket) {
                  qc.setQueryData<Ticket>(ticketKeys.detail(ticketId), { ...prevTicket, ...dto })
              }
              return { prevBoard, prevTicket }
          },
          onError: (_err, _vars, ctx) => {
              if (ctx?.prevBoard) qc.setQueryData(boardKeys.all, ctx.prevBoard)
              if (ctx?.prevTicket) qc.setQueryData(ticketKeys.detail(_vars.ticketId), ctx.prevTicket)
          },
          onSettled: (_data, _err, vars) => {
              qc.invalidateQueries({ queryKey: boardKeys.all })
              qc.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) })
          },
      })
  }
  ```
- `frontend/src/hooks/useUpdateTicket.test.ts` — optimistic update applies to board cache; rollback on error; invalidation on settle; description patch does not change card (BoardTicket shape).

**Acceptance Criteria:**
- [ ] `useUsers` returns `{ data, isLoading, error }`; query key `['users']`; staleTime 60s.
- [ ] `useUpdateTicket.onMutate` cancels `boardKeys.all` + `ticketKeys.detail(id)`.
- [ ] `useUpdateTicket.onMutate` snapshots previous board + detail cache into ctx.
- [ ] `useUpdateTicket.onMutate` calls `applyPatchToBoard` for board optimistic update.
- [ ] `useUpdateTicket.onError` restores both board and detail snapshots.
- [ ] `useUpdateTicket.onSettled` invalidates board + detail.
- [ ] `applyPatchToBoard` is pure (no side effects; returns new Board).
- [ ] `applyPatchToBoard` ignores description patches (not in `BoardTicket`).
- [ ] FE `sanitizeDescription` strips `<script>`, `on*` handlers, keeps allowlisted tags.
- [ ] Coverage of `applyPatchToBoard` + `sanitizeDescription` > 80%.
- [ ] No `any`; `import type` throughout.

**Dependencies:** T9 (api functions). T1 (`ticketKeys`).

---

### T11 — FE RichTextEditor.tsx (TipTap wrapper + RHF bridge)

**Batch:** 4 · **Depends on:** T1 · **Parallel with:** T12

**Description:** TipTap v3 wrapper component. TipTap's `useEditor` owns the editor state; React Hook Form is uncontrolled. Bridge them via RHF's `Controller` (or a manual `register`/`setValue` pattern): the editor calls `field.onChange(editor.getHTML())` on every `onUpdate`, and `field.value` initializes the editor content. Re-sanitize on render via `sanitizeDescription` from `frontend/src/utils/sanitizeHtml.ts` so even if the DB has stale unsanitized HTML, the rendered output is safe.

Toolbar: bold, italic, heading (h3/h4), bullet list, ordered list, code, blockquote, link. Use TipTap's StarterKit (bundles bold/italic/headings/lists/code/blockquote). Link is a separate extension — but for F13 MVP, restrict to StarterKit and skip link button (links still render if present in stored HTML; no insertion UI). Owner Q3 may add a link button later.

Create:
- `frontend/src/components/RichTextEditor.tsx`:
  ```typescript
  import { useEditor, EditorContent } from '@tiptap/react'
  import StarterKit from '@tiptap/starter-kit'
  import { useEffect } from 'react'
  import { sanitizeDescription } from '../utils/sanitizeHtml'

  interface RichTextEditorProps {
      value: string
      onChange: (html: string) => void
      placeholder?: string
  }

  export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
      const editor = useEditor({
          extensions: [StarterKit],
          content: value,
          onUpdate: ({ editor }) => {
              onChange(editor.getHTML())
          },
          editorProps: {
              attributes: { class: 'prose min-h-[120px] focus:outline-none' },
          },
      })

      // Sync external value changes (e.g. form reset) into the editor.
      useEffect(() => {
          if (editor && value !== editor.getHTML()) {
              editor.commands.setContent(value || '')
          }
      }, [value, editor])

      return (
          <div className="rounded border border-gray-300 p-2">
              <div className="mb-2 flex gap-2 text-sm">
                  <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className="rounded px-2 py-1 hover:bg-gray-100">B</button>
                  <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className="rounded px-2 py-1 hover:bg-gray-100 italic">I</button>
                  <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} className="rounded px-2 py-1 hover:bg-gray-100">H3</button>
                  <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className="rounded px-2 py-1 hover:bg-gray-100">• List</button>
                  <button type="button" onClick={() => editor?.chain().focus().toggleCode().run()} className="rounded px-2 py-1 hover:bg-gray-100 font-mono">{ '</>' }</button>
              </div>
              <EditorContent editor={editor} />
              {placeholder && !value && <p className="text-gray-400">{placeholder}</p>}
          </div>
      )
  }
  ```

Rendered HTML is re-sanitized in the read view (T13 detail rendering will wrap output in `dangerouslySetInnerHTML` AFTER calling `sanitizeDescription`). The editor itself only emits HTML via `getHTML()` — TipTap does not execute scripts on input.

- `frontend/src/components/RichTextEditor.test.tsx` — RTL:
  - Renders toolbar buttons (B, I, H3, List, Code) via `getByRole('button')`.
  - Typing in the editor calls `onChange` with HTML containing the typed text.
  - Initial `value` populates the editor.
  - External `value` change updates editor content (useEffect sync).

**Acceptance Criteria:**
- [ ] Toolbar buttons accessible via `getByRole('button')` (B, I, H3, List, Code).
- [ ] Typing fires `onChange` with HTML output (`<p>...</p>`).
- [ ] Initial `value` populates editor on mount.
- [ ] External `value` prop change syncs into editor (does not loop infinitely — guard on `value !== editor.getHTML()`).
- [ ] No `<script>` execution on input (TipTap parses, doesn't eval).
- [ ] No `any`; `import type` for TipTap types where needed.
- [ ] Prettier + ESLint clean.

**Dependencies:** T1 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`).

---

### T12 — FE PrioritySelect.tsx + UserSelect.tsx

**Batch:** 4 · **Depends on:** T10 (`useUsers`) · **Parallel with:** T11

**Description:** Two native-`<select>` dropdowns following the existing `ProjectPicker.tsx` pattern (native select + `aria-label` + Tailwind). No headless UI lib. `PrioritySelect` renders the five enum values using `PRIORITY_DISPLAY` (`types/ticket.ts:5-11`). `UserSelect` renders the workspace user list from `useUsers` plus an "Unassigned" option (empty value).

Create:
- `frontend/src/components/PrioritySelect.tsx`:
  ```typescript
  import type { Priority } from '../types/ticket'
  import { PRIORITY_DISPLAY } from '../types/ticket'

  const PRIORITIES = Object.keys(PRIORITY_DISPLAY) as Priority[]

  interface PrioritySelectProps {
      value: Priority
      onChange: (p: Priority) => void
  }

  export function PrioritySelect({ value, onChange }: PrioritySelectProps) {
      return (
          <label className="block">
              <span className="mb-1 block text-sm font-medium">Priority</span>
              <select
                  aria-label="Priority"
                  value={value}
                  onChange={(e) => onChange(e.target.value as Priority)}
                  className="w-full rounded border border-gray-300 p-2"
              >
                  {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{PRIORITY_DISPLAY[p]}</option>
                  ))}
              </select>
          </label>
      )
  }
  ```
- `frontend/src/components/PrioritySelect.test.tsx` — RTL: renders 5 options; `getByRole('combobox', { name: 'Priority' })`; selecting fires onChange with the enum value.
- `frontend/src/components/UserSelect.tsx`:
  ```typescript
  import { useUsers } from '../hooks/useUsers'

  interface UserSelectProps {
      value: string | null
      onChange: (userId: string | null) => void
  }

  export function UserSelect({ value, onChange }: UserSelectProps) {
      const { data: users, isLoading } = useUsers()
      return (
          <label className="block">
              <span className="mb-1 block text-sm font-medium">Assignee</span>
              <select
                  aria-label="Assignee"
                  value={value ?? ''}
                  onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
                  className="w-full rounded border border-gray-300 p-2"
                  disabled={isLoading}
              >
                  <option value="">Unassigned</option>
                  {users?.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                  ))}
              </select>
          </label>
      )
  }
  ```
- `frontend/src/components/UserSelect.test.tsx` — RTL: renders "Unassigned" + user options from mocked `useUsers`; `getByRole('combobox', { name: 'Assignee' })`; selecting Unassigned fires `onChange(null)`; selecting user fires `onChange(userId)`; loading state disables select.

**Acceptance Criteria:**
- [ ] `PrioritySelect` renders 5 options (LOW/MEDIUM/HIGH/URGENT/CRITICAL) with display labels.
- [ ] `PrioritySelect` accessible via `getByRole('combobox', { name: 'Priority' })`.
- [ ] `UserSelect` renders "Unassigned" option (empty value) + user options.
- [ ] `UserSelect` accessible via `getByRole('combobox', { name: 'Assignee' })`.
- [ ] Selecting "Unassigned" fires `onChange(null)`.
- [ ] Selecting a user fires `onChange(userId)`.
- [ ] Loading state disables the select.
- [ ] No `any`; `import type` for `Priority`.

**Dependencies:** T10 (`useUsers`). T1 (`PRIORITY_DISPLAY` exists).

---

### T13 — FE TicketAttributeForm.tsx (RHF + zodResolver, composes primitives)

**Batch:** 5 · **Depends on:** T11, T12 · **Parallel with:** —

**Description:** Reusable form for both create and edit. React Hook Form + `@hookform/resolvers/zodResolver` for validation. Composes `RichTextEditor`, `PrioritySelect`, `UserSelect` plus a title `<input>`. Mode prop drives submit label + which fields are required.

This is the primitive F16 will host inside its unified detail modal. Keep it framework-agnostic of where it's rendered — accept `defaultValues`, `onSubmit(values)`, `onCancel`, `mode`.

Create:
- `frontend/src/components/TicketAttributeForm.tsx`:
  ```typescript
  import { useForm } from 'react-hook-form'
  import { zodResolver } from '@hookform/resolvers/zod'
  import { z } from 'zod'
  import { RichTextEditor } from './RichTextEditor'
  import { PrioritySelect } from './PrioritySelect'
  import { UserSelect } from './UserSelect'
  import type { Priority, UpdateTicketDto } from '../types/ticket'

  const schema = z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(5000),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
      assigneeId: z.string().uuid().nullable(),
  })

  type FormValues = z.infer<typeof schema>

  interface TicketAttributeFormProps {
      mode: 'create' | 'edit'
      defaultValues: FormValues
      onSubmit: (values: UpdateTicketDto) => void | Promise<void>
      onCancel: () => void
  }

  export function TicketAttributeForm({ mode, defaultValues, onSubmit, onCancel }: TicketAttributeFormProps) {
      const { register, handleSubmit, watch, setValue, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
          resolver: zodResolver(schema),
          defaultValues,
      })

      return (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <label className="block">
                  <span className="mb-1 block text-sm font-medium">Title</span>
                  <input
                      {...register('title')}
                      aria-label="Title"
                      className="w-full rounded border border-gray-300 p-2"
                  />
                  {errors.title && <span className="text-red-600 text-sm">{errors.title.message}</span>}
              </label>

              <div>
                  <span className="mb-1 block text-sm font-medium">Description</span>
                  <RichTextEditor
                      value={watch('description') ?? ''}
                      onChange={(html) => setValue('description', html)}
                  />
                  {errors.description && <span className="text-red-600 text-sm">{errors.description.message}</span>}
              </div>

              <PrioritySelect
                  value={watch('priority')}
                  onChange={(p: Priority) => setValue('priority', p)}
              />

              <UserSelect
                  value={watch('assigneeId') ?? null}
                  onChange={(id) => setValue('assigneeId', id)}
              />

              <div className="flex gap-2">
                  <button type="submit" disabled={isSubmitting} className="rounded bg-blue-600 px-4 py-2 text-white">
                      {mode === 'create' ? 'Create ticket' : 'Save changes'}
                  </button>
                  <button type="button" onClick={onCancel} className="rounded border border-gray-300 px-4 py-2">Cancel</button>
              </div>
          </form>
      )
  }
  ```
  (RHF Controller wrapping for RichTextEditor is an alternative if `watch`/`setValue` causes re-render churn — pick whichever passes tests cleanly.)

- `frontend/src/components/TicketAttributeForm.test.tsx` — RTL:
  - Create mode: renders title input, description editor, priority select, user select, "Create ticket" button.
  - Empty title → validation error on submit.
  - Title > 200 chars → validation error.
  - Description > 5000 chars → validation error.
  - Valid submit → calls `onSubmit` with `{ title, description, priority, assigneeId }`.
  - Edit mode: pre-fills `defaultValues`; submit label "Save changes".
  - Cancel button calls `onCancel`.

**Acceptance Criteria:**
- [ ] Renders title input, RichTextEditor, PrioritySelect, UserSelect, submit + cancel buttons.
- [ ] Create mode submit label "Create ticket"; edit mode "Save changes".
- [ ] Empty title blocks submit + shows validation error (via `getByText`).
- [ ] Title > 200 chars blocks submit.
- [ ] Description > 5000 chars blocks submit.
- [ ] Valid submit calls `onSubmit` with the assembled `UpdateTicketDto`.
- [ ] Cancel button calls `onCancel`.
- [ ] Default values pre-fill in edit mode.
- [ ] Accessible: all controls reachable via `getByRole` / `getByLabelText`.
- [ ] No `any`; `import type` for `Priority`, `UpdateTicketDto`.

**Dependencies:** T11 (RichTextEditor), T12 (PrioritySelect, UserSelect).

---

### T14 — FE wiring: CreateTicketModal + NewTicketButton + TicketCard edit + BoardPage

**Batch:** 6 · **Depends on:** T13 · **Parallel with:** —

**Description:** Wire the form into the board UI. Three integration points:
1. **Create flow:** `NewTicketButton` (currently title-only expand) opens a new `CreateTicketModal` hosting `TicketAttributeForm mode="create"`. Reuses `useCreateTicket` (F12). Submit creates with all attributes.
2. **Edit flow:** `TicketCard` gets a click affordance — clicking the card opens `TicketAttributeForm mode="edit"` in a modal (or inline panel). Loads the ticket detail via `fetchTicket` (T9), patches via `useUpdateTicket` (T10).
3. **BoardPage:** wires the modal state + passes `useUpdateTicket`'s `mutate` down to the card (or uses a context).

F16 will replace this with a unified detail modal hosting the same `TicketAttributeForm` + checklist + labels + activity. Keep the seams clean.

Create / Modify:
- `frontend/src/components/CreateTicketModal.tsx` — modal wrapper hosting `TicketAttributeForm mode="create"`. Props: `{ open, onClose, slug }`. Uses `useCreateTicket(slug)` (F12).
- `frontend/src/components/CreateTicketModal.test.tsx` — open/close, submit calls create, error display.
- `frontend/src/components/NewTicketButton.tsx` — replace title-only expand with a button that opens `CreateTicketModal`. Manage open state locally.
- `frontend/src/components/TicketCard.tsx` — add `onClick` (whole card clickable) or an explicit "Edit" button → opens edit modal. Pass `onEdit(ticketId)` callback.
- `frontend/src/components/TicketCard.test.tsx` — click triggers edit callback.
- `frontend/src/pages/BoardPage.tsx` — wire `CreateTicketModal` (triggered from `NewTicketButton`), edit modal state, `useUpdateTicket`. Render description read-only is NOT on the card (F09 acceptance keeps description off the card) — only on edit modal.

**Acceptance Criteria:**
- [ ] "New ticket" button opens `CreateTicketModal` with empty defaults.
- [ ] Create modal submit calls `useCreateTicket.mutate` with full attribute DTO.
- [ ] New card appears on board with all attributes (title, priority, assignee).
- [ ] Clicking a `TicketCard` opens edit modal with the ticket's current values prefetched via `fetchTicket`.
- [ ] Edit modal submit calls `useUpdateTicket.mutate` — card optimistically updates title/priority/assignee.
- [ ] Description edit does NOT change the card (not in `BoardTicket`) but persists to DB.
- [ ] Cancel button closes modals without mutation.
- [ ] F12 title-only create behavior replaced (no orphan code paths).
- [ ] BoardPage renders without regressions; existing F11 drag-drop + F12 create still work.
- [ ] No `any`; `import type` throughout.

**Dependencies:** T13 (TicketAttributeForm), T10 (useUpdateTicket), F12 (useCreateTicket). Owner Q3 (modal vs inline for edit).

---

### T15 — Integration verification & sign-off

**Batch:** 7 · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Inherited F11 live-browser-smoke risk carries forward — F13's optimistic update + TipTap editor + DOMPurify sanitize path needs its own live smoke (not automatable headless — jsdom cannot drive pangea's pointer sensor or TipTap's contenteditable fully per F11 D6/T6 precedent).

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations (especially `no-explicit-any`).
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Note coverage deltas for new files (target >80% business logic, >70% components).
5. **Build:** `rtk next build` equivalent — FE production build succeeds (Vite build, not Next — use `npm run build -w frontend`).
6. **No DB migration:** confirm `git status backend/src/db/migrations/` shows no new files (F13 ships zero SQL — schema already in place).
7. **Live browser smoke (manual):**
   - Start backend + frontend locally.
   - Log in, open a project board.
   - Click "New ticket" → modal opens with title, description editor, priority, assignee.
   - Type a title, type rich-text description (bold, list, code), select priority HIGH, select an assignee, submit.
   - Card appears on board with correct priority badge + assignee avatar + title.
   - Click the card → edit modal opens with all values prefetched.
   - Change priority to URGENT, change assignee, edit description with `<script>alert(1)</script>` injected via devtools, save.
   - Reload the page → description does NOT execute script (sanitized); priority/assignee persisted.
   - Unassign ticket (UserSelect → "Unassigned") → card avatar disappears.
   - Verify `GET /api/users` returns only `{ id, fullName, avatarUrl }` (no email/role) via network tab.
8. **XSS verification:** in the dev console, attempt `updateTicket(id, { description: '<img src=x onerror=alert(1)>' })` via the API client — response description should be empty (img + onerror stripped).
9. **Record proof:** commit a short verification note (this file's integration record section) with commit SHAs, exit codes, and a screenshot path (or textual description of the live smoke).

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage on new files >80% (business) / >70% (components).
- [ ] `npm run build -w frontend` exit 0.
- [ ] No new files under `backend/src/db/migrations/`.
- [ ] Live smoke: create with all attributes succeeds; card renders correctly.
- [ ] Live smoke: edit modal prefetched via `GET /api/tickets/:id` including description.
- [ ] Live smoke: priority + assignee optimistic update on card.
- [ ] Live smoke: description XSS payload sanitized (no script execution on reload).
- [ ] Live smoke: unassign works (card avatar disappears).
- [ ] Live smoke: `GET /api/users` excludes email/role.
- [ ] F11 drag-drop still works (inherited smoke).
- [ ] F12 title-only create no longer reachable (replaced by modal).

**Dependencies:** all prior tasks merged.

---

## 7. Final F13 Acceptance Checklist

- [ ] Title required, non-empty (1–200 chars); validated BE + FE.
- [ ] Description WYSIWYG (TipTap) stored as sanitized HTML; ≤ 5000 chars.
- [ ] Assignee dropdown populated from `GET /api/users` (workspace-wide); nullable.
- [ ] Priority enum `LOW | MEDIUM | HIGH | URGENT | CRITICAL`; default `MEDIUM`.
- [ ] All edits persisted via `PATCH /api/tickets/:id`; validation enforces enum + length limits.
- [ ] Description stored as one format (HTML); rendering handles empty/null/blank safely.
- [ ] WYSIWYG editor chosen (TipTap v3); sanitize-on-write (BE `isomorphic-dompurify`) + re-sanitize-on-render (FE `dompurify`).
- [ ] Removed-from-workspace assignee renders "Unknown user" via `boardService` guard; no 500.
- [ ] Title length cap (200) + description size cap (5000) enforced at Zod edge.
- [ ] `GET /api/tickets/:id` returns description for edit form + F16 modal.
- [ ] `ticketService.updateTicket` returns `{ old, new }` for F18 ActivityLog hook.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass.

**Integration record (fill during T15):**
- Feature commit SHA: `________`
- `GET /api/users` sample response: `________`
- `GET /api/tickets/:id` sample response (with description): `________`
- `PATCH /api/tickets/:id` (attribute patch) sample response: `________`
- XSS sanitized description sample (input + output): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`
- Live browser smoke: create-with-all-attrs OK / edit-attr OK / unassign OK / XSS-safe OK

---

## 8. Schema deltas owned by this feature

**None.** F13 ships zero SQL. The `tickets` table already holds every F13 column since F09/F12 migrations:

| Column | Type | Status |
| --- | --- | --- |
| `title` | `text NOT NULL` | Existing (`schema.ts:104`) |
| `description` | `text nullable` | Existing (`schema.ts:105`) |
| `assigneeId` | `uuid nullable FK→users.id ON DELETE no action` | Existing (`schema.ts:108`) |
| `creatorId` | `uuid NOT NULL FK→users.id` | Existing (`schema.ts:109-111`) |
| `priority` | `priorityEnum NOT NULL default 'MEDIUM'` | Existing (`schema.ts:112`) |
| `priorityEnum` | `enum('LOW','MEDIUM','HIGH','URGENT','CRITICAL')` | Existing (`schema.ts:90`) |

**Explicitly do NOT regenerate migrations** — `drizzle-kit generate` would re-trigger the `drizzle-partial-index-enum-dollar1` memory (emits unapplyable `$1` SQL for the F06 enum partial index). F13 touches only application code.
