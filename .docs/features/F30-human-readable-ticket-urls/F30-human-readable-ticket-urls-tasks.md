# F30 — Human-readable ticket URLs (SLYK-NNN): Plan + Task Breakdown

> **Feature:** F30 — Human-readable ticket URLs (SLYK-NNN) (Phase — URL/shareability)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F16 (DONE ✅) · **PRD ref:** REQ-3.1 (ID format `[SLUG]-[NNN]`)
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/`), plus dependency feature task docs: [F12](../F12-ticket-creation-sequential-ids/F12-ticket-creation-sequential-ids-tasks.md) (D1/D2/D6/D8), [F16](../F16-ticket-detail-modal/F16-ticket-detail-modal-tasks.md) (deep-link/modal), [F27](../F27-project-settings/F27-project-settings-tasks.md) (D1/D7 slug permanent — resolves slug-rename edge case)

---

## 1. F30 Recap

**Goal:** The ticket detail deep-link uses the human-readable ID `SLYK-NNN` instead of the raw UUID.

**Ships:** URL is `/projects/:slug/tickets/SLYK-4` (readable, shareable); the backend resolves the project + ticket number to the ticket.

**Acceptance (definition of done):**
- Ticket detail route param is the display ID (`SLYK-4`), not the UUID.
- Backend resolves a ticket by (project slug, ticket_number) — new lookup/route.
- Existing flows (card click, deep-link, browser back) keep working with the new URL shape.

**Edge cases to resolve up front:**
- **Parse `SLUG-NNN` from the route param; validate format; reject malformed → 404** → **Decision:** New shared parser util (`parseTicketDisplayId`) on FE + BE mirror, table-driven tested, format-checked via a SCREAMING_SNAKE regex constant (`TICKET_DISPLAY_ID_REGEX`). Route handler validates format with the parser; parse-fail returns 404 `NOT_FOUND` (per spec "reject malformed → 404"), not a Zod 400. See D5 for the spec-vs-rules tension resolution.
- **Slug in the ticket param vs the path `:slug`** → **Decision:** VALIDATE the embedded prefix matches the path `:slug` → 404 `NOT_FOUND` on mismatch. The path `:slug` is authoritative (shareability integrity — a deep-link must not resolve a ticket from a different project). Number is parsed from the param, but the embedded prefix is asserted to equal the path slug. See D3.
- **Slug rename (F27)** → **Decision:** MOOT. F27 made the project slug PERMANENT (`projectService.ts:100` "Slug is NOT editable"; `projects.schema.ts:36-45` PATCH has no slug field). Path `:slug` and the ticket's project slug cannot diverge. Simple `(slug, ticket_number)` lookup suffices; NO redirect-by-number needed. F27's own tasks.md:25 notes "F30 can revisit if needed" — F30 does NOT reopen slug-rename (see D7). Only existing lookup `getProjectBySlug` is reused.
- **Backwards-compat old `/tickets/<uuid>` deep-links** → **Decision:** 404. F16's UUID URLs were internal/not widely shared (deep-link shipped for board UX, not for external sharing). Simplest, no alias table, no migration. **FLAGGED as owner sign-off** — the alternative is a redirect-to-new (301/307) by detecting a UUID-shaped param and resolving via the existing `getTicket(uuid)`. See D4.
- **Malformed → 404 vs 400 (spec vs rules)** → **Decision:** Treat malformed-format AND well-formed-but-nonexistent both as 404 `NOT_FOUND`. The route handler validates format via the parser and returns 404 on parse-fail OR not-found. Do NOT use Zod 400 here. Rationale: spec explicitly says "reject malformed → 404"; a uniform 404 gives consistent UX (the user's mental model is "this ticket doesn't exist / this link is wrong"). Zod-at-edge (rules) still applies to OTHER validated inputs; for this resolver we intentionally use 404 for both classes. See D5.

---

## 2. Codebase Analysis Summary

- **State:** F16 DONE ✅ (deep-link as modal overlay over mounted board). The route seam `:ticketId` already accepts an arbitrary string today — it holds a RAW UUID. **GAPS:** no `(slug, ticket_number)` resolver on the backend; no `SLUG-NNN` parser anywhere; two DIVERGENT display-ID formatters (padded vs unpadded). No migration needed (the existing `(project_id, ticket_number)` unique index makes the resolver an indexed point lookup).
- **Existing structure this feature builds on:**
  - **Frontend routing `frontend/src/routes/index.tsx:62-68`:** board route `/projects/:slug` with child `path: 'tickets/:ticketId', element: <TicketDetailRoute />`. `:ticketId` is a generic param — F30 repurposes it to hold the display ID (`SLYK-4`). **Single route seam.**
  - **Card-click flow `frontend/src/pages/BoardPage.tsx:56-58`:** `handleEdit = (ticketId) => navigate(\`tickets/${ticketId}\`)`; passed as `onEdit` to `BoardColumn` (`:132`) + `UnsortedBucket` (`:123`). `TicketCard.tsx:34` `onClick={() => onEdit?.(ticket.id)}` — passes `ticket.id` (UUID). **F30 changes this to emit the display ID.**
  - **TicketDetailRoute `BoardPage.tsx:147-162`:** reads `useParams<{slug, ticketId}>`, renders `<TicketDetailModal slug ticketId ... />`, `onClose` navigates `/projects/${slug}`. **F30 inserts a resolve-ref→UUID step before rendering the modal.**
  - **Display-ID formatting — TWO DIVERGENT formatters:** (1) `frontend/src/utils/formatTicketId.ts:4-6` `formatTicketId(slug, ticketNumber) = \`${slug.toUpperCase()}-${ticketNumber}\`` (UNPADDED `SLYK-4`) — used only by `TicketDetailModal.tsx:96` for the modal title; (2) `TicketCard.tsx:20` inline PADDED `SLYK-004` (`\`${projectSlug}-${String(ticket.ticketNumber).padStart(3,'0')}\``) for aria-label + badge. **F30 unifies into ONE formatter with a `padded` flag** (D1).
  - **`TicketCard.tsx:13,20,34`:** display ID rendered at `:13` (badge/aria), computed inline at `:20`, `onEdit` at `:34` passes UUID. `BoardPage.test.tsx:119` asserts `SLYK-101` (padded).
  - **Backend lookup `backend/src/routes/tickets.routes.ts:24-36`:** `GET /api/tickets/:ticketId` → `getTicket(ticketId)` by UUID; `ticketIdParam = z.uuid()` (`tickets.schema.ts:3-5`). `getTicket` `ticketService.ts:262-309` — `eq(tickets.id, ticketId)`, joins creator+assignee, hydrates labels, returns null→404. **NO `(slug, ticket_number)` resolver exists.** `getTicket` does NOT filter `deletedAt` (soft-deleted returned; modal shows Deleted banner) — F30 resolver mirrors this (or filters — see D6).
  - **Project slug PERMANENT (F27):** `projectService.ts:100` "Slug is NOT editable"; `PATCH /:slug` only `name`+`columns` (`projects.schema.ts:36-45`, no slug). Slug format `backend/src/utils/slug.ts:2` `/^[A-Z][A-Z0-9]{1,15}$/` (2-16 uppercase), `normalizeSlug` `slug.ts:18-20`. `getProjectBySlug` `projectService.ts:95-98` exists. **Slug-rename edge case INERT for MVP** (D7).
  - **`ticketNumber` storage:** `backend/src/db/schema.ts:120` `ticketNumber: integer('ticket_number').notNull()`, unique per-project via `tickets_project_number_uq` (`schema.ts:147-150`) on `(projectId, ticketNumber)`. Allocated by `allocateTicketNumber` (`ticketService.ts:164-179`, `SELECT … FOR UPDATE` on `project_sequences` `schema.ts:99-104`). **`(project_id, ticket_number)` unique index EXISTS → resolver is indexed point lookup.**
  - **API client `frontend/src/api/tickets.ts`:** `fetchTicket(ticketId)` → `GET /tickets/:ticketId` (`:36-39`); `updateTicket`/`deleteTicket`/`moveTicket`/`fetchTicketActivity` all UUID-keyed. `timer.ts` also UUID-keyed (`/tickets/:ticketId/timer/*`). `queryKeys.ts:23-26` `ticketKeys.detail(id)` / `.activity(id)` keyed by passed string. **F30 reuses `detail(uuid)` after resolve — zero cache churn** (D2).
  - **F16 deep-link + back:** `TicketDetailRoute` renders modal over mounted board (Outlet `BoardPage.tsx:140`); unsaved guard `useBlocker(isDirty)` `TicketDetailModal.tsx:62-84` + `ConfirmDiscardDialog`; drift reconciliation `useQuery refetchInterval 30_000` queryKey `ticketKeys.detail(ticketId)` `TicketDetailModal.tsx:47-59`.
  - **Backend mount:** `projectsRouter` at `/api/projects` (`index.ts:50`); `POST /api/projects/:slug/tickets` at `projects.routes.ts:63-77` (**F12 nesting precedent** — F30's new GET resolver lives here too). `tickets.routes.ts:40,56,113,127,141,158,171` — ALL other ticket write routes `/api/tickets/:ticketId` UUID. **DO NOT BREAK these.**
  - **F03 error codes:** `NOT_FOUND` → 404, `VALIDATION_FAILED` → 400.
- **Prior art / partial work:** `formatTicketId` util exists (unpadded) but diverges from the inline padded formatter in `TicketCard`. The `(project_id, ticket_number)` unique index was built in F12 for sequence allocation — F30 reuses it for the resolver (no new index). `getProjectBySlug` exists. `POST /api/projects/:slug/tickets` establishes the `projectsRouter` nesting pattern F30 mirrors.
- **File paths the plan references that do NOT exist yet (will be created):** `frontend/src/utils/parseTicketDisplayId.ts` (new parser + `.test.ts`), `backend/src/utils/parseTicketDisplayId.ts` (BE mirror + `.test.ts`).
- **Files F30 modifies:** `frontend/src/utils/formatTicketId.ts` (unify padded/unpadded via `padded` flag), `frontend/src/components/TicketCard.tsx` (`:20` use helper, `:34` emit display ID), `frontend/src/pages/BoardPage.tsx` (`:56-58` handleEdit emit display ID, `:147-162` TicketDetailRoute resolve ref→UUID), `frontend/src/api/tickets.ts` (add `fetchTicketByRef`), `frontend/src/routes/index.tsx` (`:67` param semantics — name may stay `:ticketId`, treated as ref), `backend/src/services/ticketService.ts` (add `getTicketByNumber`), `backend/src/routes/projects.routes.ts` (add `GET /:slug/tickets/:displayId`), `backend/src/routes/projects.schema.ts` (param schema, tolerant of padding). `queryKeys.ts` unchanged (reuses `detail(uuid)` after resolve).
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (SLYK-F30 prefix; `feature/SLYK-F30-human-readable-ticket-urls` branch; single-line commits; rebase-merge only), `.claude/rules/js-development-rules.md` (Backend routes — RESTful `/api/projects/:id/board` precedent, proper HTTP methods — resolver=GET, consistent JSON envelope `{data}/{error:{code,message,details?}}`, Zod-at-edge validate inputs, parameterized queries only, authenticate middleware; Frontend — one component/file, co-located tests, explicit prop interfaces, functional+hooks; React Query server state), `.claude/rules/js-style-guide.md` (PascalCase components/types, camelCase hooks/vars, SCREAMING_SNAKE_CASE constants — `TICKET_DISPLAY_ID_REGEX`; no magic numbers — regex/padding/min-seq named constants; no `any`, no `console.log`, no inline styles; fns <50 lines, early returns, async/await), `.claude/rules/js-testing-rules.md` (Vitest co-located `*.test.ts(x)`, **table-driven PREFERRED** — SLUG-NNN parser is textbook table-driven, `vi.fn` mocks, RTL components; priority `getByRole > getByLabelText > getByText > getByTestId(last)`; coverage Business >80%/Components >70%).
- **Hidden coupling to plan for:**
  - **Padding divergence (F12 D2 padded `SLYK-001` vs F30 spec example unpadded `SLYK-4`):** F12 D2 mandated zero-pad display to 3 (`SLYK-001`); F30 spec example is unpadded (`SLYK-4`). **Resolution (D1):** URL canonical form = UNPADDED (`SLYK-4` — spec example, clean URL); display badge stays PADDED (`SLYK-004` — F12 D2/REQ-3.1); parser accepts BOTH (tolerant). ONE unified formatter `formatTicketId(slug, n, {padded})`.
  - **`BoardPage.tsx` is touched by T3 (wiring) AND potentially T4 (not-found handling):** sequenced within T3/T4 (single owner).
  - **Modal contract preservation:** `TicketDetailModal` props stay `{slug, ticketId:UUID, onClose, onSubmit}`. The resolve-ref→UUID happens in `TicketDetailRoute` BEFORE handing off — the modal, `fetchTicket(uuid)`, `ticketKeys.detail(uuid)`, mutations, `useBlocker(isDirty)`, drift-refetch all stay UUID-keyed. **Zero cache churn** (D2).
  - **`getTicket` soft-delete behavior:** `getTicket` (`ticketService.ts:262-309`) does NOT filter `deletedAt` — soft-deleted tickets are returned (modal shows Deleted banner). F30's `getTicketByNumber` mirrors `getTicket`'s behavior for consistency (returns the ticket regardless of soft-delete; the existing Deleted-banner UX handles display). **No new filter introduced** (avoids divergence between the two lookup paths).
  - **All `/api/tickets/:ticketId` WRITE routes (PUT/PATCH/DELETE/move/timer) stay UUID-keyed:** the FE resolves ref→UUID ONCE for the read path; mutations continue to use the UUID the modal already holds. F30 does NOT touch `tickets.routes.ts` write routes.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | URL canonical form + padding | **URL = unpadded `SLYK-4` (spec example, clean URL); display badge = padded `SLYK-004` (F12 D2/REQ-3.1); unify ONE formatter `formatTicketId(slug, n, {padded})`; parser accepts BOTH** | Spec example is unpadded (`SLYK-4` — features.md:570 "SLYK-4"). F12 D2 mandated padded display badge (`SLYK-001`). Parser tolerant of padding (accepts `SLYK-4`, `SLYK-04`, `SLYK-004`) → normalizes to int. Resolves the F12-D2-vs-F30-spec tension. Cites F12 D2 + spec example. |
| D2 | Resolver pattern (ref→UUID ONCE) | **FE resolves `SLYK-NNN`→UUID ONCE via new `GET /api/projects/:slug/tickets/:displayId`, then reuses UUID `fetchTicket`/mutations/cache; modal contract `{slug, ticketId:UUID}` UNCHANGED** | Preserves F16 invariants: unsaved-guard (`useBlocker(isDirty)`), drift-refetch (`ticketKeys.detail(uuid)`, 30s), deep-link, modal props. Zero cache churn (no new `(slug,number)` cache key — resolve then reuse `detail(uuid)`). Only 4 shallow seams change (route param, handleEdit, TicketDetailRoute resolve, BE resolver). Cites Analysis B. |
| D3 | Prefix validation (slug-in-param vs path) | **VALIDATE embedded prefix == path `:slug` → 404 `NOT_FOUND` on mismatch** | Shareability integrity — a deep-link `/projects/SLYK/tickets/PX-4` must NOT resolve (the param's project must match the path's project). Path `:slug` is authoritative. Rejects "derive-number-only" (lenient) which would silently resolve cross-project. |
| D4 | Backwards-compat old UUID deep-links | **404** (FLAGGED owner sign-off; alt = redirect-to-new) | F16's UUID URLs were internal/not widely shared (deep-link shipped for board UX). Simplest, no alias table, no migration. The alt (redirect) would detect UUID-shaped param, resolve via `getTicket(uuid)`, redirect to `/projects/:slug/tickets/SLYK-N` — needs the project slug from the ticket's project. Owner picks. |
| D5 | Malformed handling (404 vs 400) | **Parser format-check + not-found BOTH → 404 `NOT_FOUND`** (NOT Zod 400) | Spec explicitly: "reject malformed → 404". Uniform 404 = consistent UX ("this ticket doesn't exist / this link is wrong"). Resolves spec↔rules tension: Zod-at-edge (rules) still applies to OTHER validated inputs (e.g. POST bodies), but for this resolver the route handler uses the parser and returns 404 on parse-fail OR service-not-found. The spec's "reject malformed→404" overrides the generic VALIDATION_FAILED→400 convention for this specific read resolver. |
| D6 | Schema / migration owned by F30 | **NONE** | Uses the EXISTING `(project_id, ticket_number)` unique index (`schema.ts:147-150`, F12 D1). Resolver is an indexed point lookup. No new column, no migration. Model A (render-time display ID, no stored column) confirmed — F12 D8 deferred Model B to F27; F27 made slug permanent, so Model B's snapshot column is moot. |
| D7 | Slug-rename edge case | **MOOT — F27 made slug PERMANENT** | `projectService.ts:100` "Slug is NOT editable"; `projects.schema.ts:36-45` PATCH has no slug. Path `:slug` and the ticket's project slug cannot diverge → simple `(slug, ticket_number)` lookup suffices. NO redirect-by-number needed. F27 tasks.md:25 "F30 can revisit if needed" — F30 does NOT reopen slug-rename (recommend keeping permanent — §9d). |
| D8 | Shared parser util (FE + BE mirror) | **`parseTicketDisplayId.ts` on FE + BE mirror** — `TICKET_DISPLAY_ID_REGEX` SCREAMING_SNAKE constant, table-driven tests, >80% business-logic coverage | One source of truth for the `SLUG-NNN` format (regex + parse). FE used by `TicketCard`/`handleEdit`/`TicketDetailRoute`; BE used by the resolver route. Table-driven tests (js-testing-rules.md preferred pattern). Cites style-guide (SCREAMING_SNAKE constants, no magic regex) + testing-rules. |

> **Out of F30 scope (explicitly deferred):** slug-rename (D7 — F27 permanent; F30 does not reopen); Model B stored display-ID column (F12 D8 deferral — moot under permanent slug); backwards-compat redirect of old UUID URLs (D4 — 404 chosen; redirect is the flagged alt); parser for non-`SLYK` slug formats (slug regex `slug.ts:2` already constrains to 2-16 uppercase alphanumerics — parser reuses it).

> **Owner sign-off needed:** (a) backwards-compat of old `/tickets/<uuid>` deep-links — **404 [recommend]** vs redirect-to-new (D4); (b) URL canonical form — **unpadded `SLYK-4` [recommend]** vs padded `SLYK-004` (D1); (c) prefix-validation strictness — **validate-prefix-match→404 [recommend]** vs derive-number-only/lenient (D3); (d) whether F30 reopens slug-rename (F27 left door open) — **recommend NO, keep permanent** (D7). Full list in §9.

---

## 4. Architecture Overview (Target Tree)

```
/  (repo root)
├── backend/
│   └── src/
│       ├── utils/
│       │   ├── parseTicketDisplayId.ts        # NEW — TICKET_DISPLAY_ID_REGEX + parseTicketDisplayId(ref, expectedSlug?) → {slug, ticketNumber} | null (mirror of FE)
│       │   └── parseTicketDisplayId.test.ts   # NEW — table-driven parser tests (valid padded/unpadded, malformed, prefix mismatch, wrong slug)
│       ├── services/
│       │   └── ticketService.ts               # MODIFY — add getTicketByNumber(slug, ticketNumber): Promise<TicketDetail|null> (indexed point lookup via (projectId, ticketNumber) unique index; mirrors getTicket joins)
│       └── routes/
│           ├── projects.routes.ts             # MODIFY — add GET /:slug/tickets/:displayId (auth, parse via parseTicketDisplayId, 404 on parse-fail/not-found, envelope {data})
│           └── projects.schema.ts             # MODIFY — add displayIdParam schema (z.string() — format-checked in handler via parser, tolerant of padding)
└── frontend/
    └── src/
        ├── utils/
        │   ├── formatTicketId.ts              # MODIFY — unify padded/unpadded: formatTicketId(slug, ticketNumber, opts?: {padded?: boolean}) (padded default true for badge; unpadded for URL)
        │   ├── parseTicketDisplayId.ts        # NEW — TICKET_DISPLAY_ID_REGEX + parseTicketDisplayId(ref, expectedSlug?) → {slug, ticketNumber} | null
        │   └── parseTicketDisplayId.test.ts   # NEW — table-driven parser tests (mirror BE)
        ├── components/
        │   └── TicketCard.tsx                 # MODIFY — :20 use formatTicketId helper (remove inline padded divergence); :34 onEdit emits display-ID (unpadded URL form)
        ├── api/
        │   └── tickets.ts                     # MODIFY — add fetchTicketByRef(slug, ref) → GET /projects/:slug/tickets/:ref (returns TicketDetail w/ UUID); fetchTicket(uuid) unchanged
        ├── routes/
        │   └── index.tsx                      # MODIFY — :67 param semantics (name may stay :ticketId, treated as display-ref; or rename :ticketRef)
        └── pages/
            └── BoardPage.tsx                  # MODIFY — :56-58 handleEdit emits formatTicketId(slug, ticketNumber, {padded:false}); :147-162 TicketDetailRoute resolves ref→UUID via fetchTicketByRef then passes UUID to modal (modal contract UNCHANGED); not-found handling for malformed ref
```

**Request lifecycle (non-obvious flow):**
1. **Card click:** `TicketCard.tsx:34` `onClick → onEdit(formatTicketId(slug, ticket.ticketNumber, {padded:false}))` → `BoardPage.handleEdit(displayId)` → `navigate(\`tickets/${displayId}\`)` (URL now `SLYK-4`).
2. **Deep-link / refresh / back:** browser hits `/projects/SLYK/tickets/SLYK-4` → `TicketDetailRoute` reads `useParams<{slug, ticketId}>` (ticketId now holds `SLYK-4`) → calls `fetchTicketByRef(slug, 'SLYK-4')` → `GET /api/projects/SLYK/tickets/SLYK-4` → BE `parseTicketDisplayId('SLYK-4', expectedSlug='SLYK')` validates format + prefix match → `getTicketByNumber('SLYK', 4)` → indexed lookup via `(project_id, ticket_number)` unique index → returns ticket w/ UUID → FE receives TicketDetail (UUID included) → `TicketDetailRoute` passes `ticketId=uuid` to `<TicketDetailModal>` → modal reuses `fetchTicket(uuid)` / `ticketKeys.detail(uuid)` / mutations / `useBlocker` UNCHANGED.
3. **Malformed ref (`/tickets/abc` or `/tickets/PX-4` on SLYK path):** parser returns null → route handler 404 `NOT_FOUND` (D5) → FE `TicketDetailRoute` renders a "Ticket not found" state (or redirects to board). **Old UUID deep-link `/tickets/<uuid>`:** parser returns null (UUID is not `SLUG-NNN`) → 404 (D4).
4. **Drift-refetch / unsaved-guard:** UNCHANGED — modal operates on UUID; `useQuery refetchInterval 30_000` key `ticketKeys.detail(uuid)`; `useBlocker(isDirty)` unchanged.

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel.

`BoardPage.tsx` is touched by T3 (wiring) and T4 (not-found handling) — sequenced within those tasks (single owner per file per batch). The shared parser is authored once in T2 (FE) / T1 (BE mirror) — disjoint BE-vs-FE-utils.

### Batch dependency diagram

```
Batch 1 (disjoint — BE resolver vs FE parser/formatter, fully parallel)
  T1 BE getTicketByNumber + GET /api/projects/:slug/tickets/:displayId + BE parser + tests  ─┐
  T2 FE parseTicketDisplayId util + unify formatTicketId + TicketCard helper + tests          ─┘
                                                            (both new util files + mirror)

                              │  (Batch 1 merged — BE resolver contract exists; FE parser/formatter exist)
                              ▼
Batch 2 (FE wiring — depends on T1 api contract + T2 parser/formatter)
  T3 FE wiring: routes/index.tsx param, BoardPage handleEdit+TicketDetailRoute, api/tickets.ts fetchTicketByRef, TicketCard onEdit

                              │  (Batch 2 merged — URL uses display-ID end-to-end)
                              ▼
Batch 3 (backwards-compat + 404 handling — depends on T3 wiring)
  T4 404 handling in TicketDetailRoute/TicketDetailModal for malformed ref; old UUID → 404 documented

                              │
                              ▼
Batch 4 (terminal — verification)
  T5 tsc/vitest/lint/prettier/build + manual smoke (card click→URL SLYK-NNN, deep-link, back, malformed→404, old UUID→404)
```

- **Batch 1 → Batch 2** is a hard barrier: T3's FE wiring needs the BE resolver's API contract (`GET /api/projects/:slug/tickets/:displayId` shape — T1) AND the FE parser/formatter (T2) to emit/parse display IDs.
- **Batch 2 → Batch 3** is a hard barrier: T4's not-found handling layers on top of the wired `TicketDetailRoute` (T3) — same `BoardPage.tsx` file, sequenced.
- **Batch 3 → Batch 4** is a hard barrier: verification runs against the fully merged feature.

### Merge order rules
1. **Batch 1 merges first.** T1 (BE: resolver + parser + tests) and T2 (FE: parser + formatter + TicketCard helper + tests) are disjoint (BE tree vs FE utils) — merge in either order. What must be on main before Batch 2: the BE `GET /:slug/tickets/:displayId` route + `getTicketByNumber` + BE `parseTicketDisplayId`; the FE `parseTicketDisplayId` + unified `formatTicketId` + TicketCard using the helper.
2. **Batch 2 (T3) merges second.** FE wiring touches `routes/index.tsx`, `BoardPage.tsx`, `api/tickets.ts`, `TicketCard.tsx` (onEdit). Branches from Batch 1 merged state.
3. **Batch 3 (T4) merges third.** 404/not-found handling in `BoardPage.tsx` (TicketDetailRoute) + `TicketDetailModal` — same files as T3, sequenced after.
4. **Batch 4 (T5) merges last.** Verification gate.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/utils/parseTicketDisplayId.ts` (+test), `backend/src/services/ticketService.ts`, `backend/src/routes/projects.routes.ts`, `backend/src/routes/projects.schema.ts` | — | T2 |
| **T2** | 1 | `frontend/src/utils/parseTicketDisplayId.ts` (+test), `frontend/src/utils/formatTicketId.ts` (+test), `frontend/src/components/TicketCard.tsx` (helper only) | — | T1 |
| **T3** | 2 | `frontend/src/routes/index.tsx`, `frontend/src/pages/BoardPage.tsx`, `frontend/src/api/tickets.ts`, `frontend/src/components/TicketCard.tsx` (onEdit) | T1, T2 | — |
| **T4** | 3 | `frontend/src/pages/BoardPage.tsx` (TicketDetailRoute not-found), `frontend/src/pages/ProjectSettingsPage`/modal (if touched), docs of D4 | T3 | — |
| **T5** | 4 | (verification — no file changes) | all prior | — |

### Developer assignment tracks
- **Solo:** T1 ‖ T2 → T3 → T4 → T5.
- **2 devs:** Dev-A: T1 (BE) → T4. Dev-B: T2 (FE utils) → T3 (FE wiring). (Converge on T5.)
- **3 devs:** Dev-A: T1. Dev-B: T2. Dev-C: stubs/coordinates, then T3 → T4 → T5.

---

## 6. Tasks

### T1 — Backend resolver: getTicketByNumber + GET /:slug/tickets/:displayId + parser

**Batch:** 1 · **Depends on:** — · **Parallel with:** T2

**Description:** Add the `(slug, ticket_number)` resolver (acceptance bullet 2). New BE parser util (`parseTicketDisplayId`) shared with the route for format/prefix validation. New `getTicketByNumber` service — indexed point lookup via the existing `(project_id, ticket_number)` unique index (`schema.ts:147-150`). New `GET /api/projects/:slug/tickets/:displayId` route mounted on `projectsRouter` (F12 nesting precedent `projects.routes.ts:63-77`). Auth middleware. 404 on parse-fail OR not-found (D5). Consistent envelope `{data}`. Parameterized queries only.

Create / Modify:
- `backend/src/utils/parseTicketDisplayId.ts` (NEW) — `TICKET_DISPLAY_ID_REGEX` (SCREAMING_SNAKE constant) + `parseTicketDisplayId(ref: string, expectedSlug?: string): { slug: string; ticketNumber: number } | null`. Tolerant of padding (accepts `SLYK-4`, `SLYK-04`, `SLYK-004`). Format: `${SLUG_REGEX}-${DIGITS}` where `SLUG_REGEX` reuses `slug.ts:2` pattern (`/^[A-Z][A-Z0-9]{1,15}$/`). Returns null on format mismatch OR (if `expectedSlug` provided) prefix mismatch (D3). No magic numbers — `MIN_TICKET_NUMBER = 1` constant.
  ```ts
  import { SLUG_PATTERN } from '../utils/slug';   // reuse existing /^[A-Z][A-Z0-9]{1,15}$/
  export const TICKET_DISPLAY_ID_REGEX = new RegExp(`^(${SLUG_PATTERN.source})-(\\d+)$`);
  export const MIN_TICKET_NUMBER = 1;
  export function parseTicketDisplayId(
    ref: string,
    expectedSlug?: string,
  ): { slug: string; ticketNumber: number } | null {
    const match = TICKET_DISPLAY_ID_REGEX.exec(ref);
    if (!match) return null;
    const slug = match[1];
    const ticketNumber = Number.parseInt(match[2], 10);
    if (!Number.isFinite(ticketNumber) || ticketNumber < MIN_TICKET_NUMBER) return null;
    if (expectedSlug !== undefined && slug !== expectedSlug) return null;   // D3 prefix validation
    return { slug, ticketNumber };
  }
  ```
- `backend/src/utils/parseTicketDisplayId.test.ts` (NEW) — **table-driven** (js-testing-rules.md): valid unpadded (`SLYK-4`→`{SLYK,4}`), valid padded (`SLYK-004`→`{SLYK,4}`), valid multi-digit (`PX-101`), malformed (no dash `SLYK4`, letters in number `SLYK-abc`, empty, lowercase `slyk-4`), prefix mismatch (`PX-4` w/ expectedSlug `SLYK`→null), boundary (`SLYK-0`→null, `SLYK-1`→ok).
- `backend/src/services/ticketService.ts` (MODIFY) — add `getTicketByNumber(slug: string, ticketNumber: number): Promise<TicketDetail | null>`. Resolve project via existing `getProjectBySlug` (`projectService.ts:95-98`), then `tickets` lookup on `(projectId, ticketNumber)` (unique index), mirroring `getTicket` joins (creator + assignee + labels, `ticketService.ts:262-309`). Mirrors `getTicket`'s soft-delete behavior (does NOT filter `deletedAt` — consistency w/ the existing Deleted-banner UX). Returns null if project or ticket not found.
  ```ts
  export async function getTicketByNumber(
    slug: string,
    ticketNumber: number,
  ): Promise<TicketDetail | null> {
    const project = await getProjectBySlug(slug);          // existing
    if (!project) return null;
    const rows = await db.select({...}).from(tickets)
      .where(and(eq(tickets.projectId, project.id), eq(tickets.ticketNumber, ticketNumber)))
      .leftJoin(...).leftJoin(...);   // mirror getTicket joins
    // hydrate labels; return TicketDetail (incl. tickets.id UUID) or null
  }
  ```
  Returns the full ticket including `id` (UUID) — the FE needs the UUID to seed `fetchTicket(uuid)`/`ticketKeys.detail(uuid)` (D2).
- `backend/src/routes/projects.routes.ts` (MODIFY) — add `GET /:slug/tickets/:displayId` (mounted on `projectsRouter` → `/api/projects/:slug/tickets/:displayId`):
  ```ts
  router.get('/:slug/tickets/:displayId', authenticate, async (req, res) => {
    const { slug, displayId } = req.params;
    const parsed = parseTicketDisplayId(displayId, slug);   // format + prefix (D3)
    if (!parsed) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });  // D5
    }
    const ticket = await getTicketByNumber(parsed.slug, parsed.ticketNumber);
    if (!ticket) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }
    res.json({ data: ticket });   // consistent envelope
  });
  ```
- `backend/src/routes/projects.schema.ts` (MODIFY) — add `displayIdParam` schema (`z.string()` — format is checked in the handler via the parser, NOT Zod, per D5). Document that 404-not-400 is intentional for this resolver.

**Acceptance Criteria:**
- [ ] `parseTicketDisplayId` correctly parses valid `SLUG-NNN` (padded + unpadded), rejects malformed, validates prefix when `expectedSlug` given (table-driven tests >80% coverage).
- [ ] `getTicketByNumber(slug, n)` returns the ticket (with UUID) via indexed `(projectId, ticketNumber)` lookup; null when project or ticket absent.
- [ ] `getTicketByNumber` mirrors `getTicket` joins (creator + assignee + labels) + soft-delete behavior.
- [ ] `GET /api/projects/:slug/tickets/:displayId` behind `authenticate` middleware.
- [ ] Returns 404 `NOT_FOUND` for: malformed ref (`abc`), prefix mismatch (`/projects/SLYK/tickets/PX-4`), nonexistent number (`SLYK-9999`).
- [ ] Returns 200 `{data}` envelope for a valid existing ticket.
- [ ] All other `/api/tickets/:ticketId` write routes UNCHANGED (regression: PUT/PATCH/DELETE/move/timer still UUID-keyed and pass).
- [ ] Parameterized queries only (no string-concat SQL).
- [ ] `rtk vitest run -w backend` green; `rtk tsc` (BE) zero errors.

**Dependencies:** —

---

### T2 — FE parser util + unify formatTicketId + TicketCard helper

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1

**Description:** Author the FE display-ID parser (mirror of T1's BE parser), unify the two DIVERGENT formatters into ONE `formatTicketId(slug, n, {padded})`, and switch `TicketCard` to use the helper (remove the inline padded divergence at `TicketCard.tsx:20`). No routing/wiring here — pure utils + TicketCard badge/aria refactor.

Create / Modify:
- `frontend/src/utils/parseTicketDisplayId.ts` (NEW) — mirror of T1's BE parser: `TICKET_DISPLAY_ID_REGEX` + `parseTicketDisplayId(ref, expectedSlug?) → {slug, ticketNumber} | null`. Reuse the same SLUG pattern semantics. Used in T3 by `TicketDetailRoute` (parse the route param) and optionally by `handleEdit`/`TicketCard`.
- `frontend/src/utils/parseTicketDisplayId.test.ts` (NEW) — **table-driven**, same cases as the BE mirror (valid padded/unpadded/multi-digit, malformed, prefix mismatch, boundaries).
- `frontend/src/utils/formatTicketId.ts` (MODIFY) — unify padded/unpadded:
  ```ts
  export interface FormatTicketIdOptions { padded?: boolean }   // default true (badge)
  const TICKET_NUMBER_PAD_LENGTH = 3;   // F12 D2 — no magic numbers
  export function formatTicketId(
    slug: string,
    ticketNumber: number,
    opts: FormatTicketIdOptions = {},
  ): string {
    const { padded = true } = opts;
    const num = padded ? String(ticketNumber).padStart(TICKET_NUMBER_PAD_LENGTH, '0') : String(ticketNumber);
    return `${slug.toUpperCase()}-${num}`;
  }
  ```
  Default `padded:true` preserves the badge (`TicketCard` badge `SLYK-004`, F12 D2/REQ-3.1). `padded:false` for the URL canonical form (`SLYK-4`, D1).
- `frontend/src/utils/formatTicketId.test.ts` (MODIFY/ADD) — table-driven: padded (`formatTicketId('SLYK', 4)` → `SLYK-004`), unpadded (`formatTicketId('SLYK', 4, {padded:false})` → `SLYK-4`), case normalization (lowercase slug → upper), large numbers (`PX-101`/`PX-101`), padding boundary (`SLYK`, 1 → `SLYK-001` padded).
- `frontend/src/components/TicketCard.tsx` (MODIFY) — `:20` replace inline `` `${projectSlug}-${String(ticket.ticketNumber).padStart(3,'0')}` `` with `formatTicketId(projectSlug, ticket.ticketNumber)` (default padded — badge/aria UNCHANGED visually, just deduped). `:34` `onEdit` — NO change yet (T3 changes the emitted value to display-ID). **T2 only dedupes the badge formatter** (TicketCard badge stays padded).

**Acceptance Criteria:**
- [ ] `parseTicketDisplayId` correctly parses/rejects (table-driven tests, mirror of T1).
- [ ] `formatTicketId(slug, n)` default padded → `SLYK-004`; `{padded:false}` → `SLYK-4` (D1).
- [ ] No magic numbers (padding length named `TICKET_NUMBER_PAD_LENGTH`).
- [ ] `TicketCard.tsx:20` uses `formatTicketId` helper (inline divergence removed); badge still renders `SLYK-004`.
- [ ] `BoardPage.test.tsx:119` still asserts `SLYK-101` (padded) — green.
- [ ] `rtk vitest run -w frontend` green; `rtk tsc` (FE) zero errors.

**Dependencies:** —

---

### T3 — FE wiring: route param, handleEdit, TicketDetailRoute resolve→UUID, api client

**Batch:** 2 · **Depends on:** T1 (BE resolver API contract), T2 (FE parser/formatter) · **Parallel with:** —

**Description:** Wire the URL to use the display ID end-to-end (acceptance bullet 1 + 3). The cleanest pattern (Analysis B): `TicketDetailRoute` resolves `SLYK-NNN`→UUID ONCE via the new `fetchTicketByRef`, then hands the UUID to the modal — preserving the modal contract `{slug, ticketId:UUID}` and all F16 invariants (unsaved-guard, drift-refetch, deep-link). Card-click emits the display ID.

Modify:
- `frontend/src/routes/index.tsx:67` — param semantics. Option A: keep the name `:ticketId` (generic string), treat its value as a display-ref in `TicketDetailRoute`. Option B: rename to `:ticketRef` for clarity. **Recommend rename to `:ticketRef`** (readability — the param no longer holds a UUID). If renaming, update `useParams` keys in `TicketDetailRoute`.
  ```tsx
  // routes/index.tsx child route:
  { path: 'tickets/:ticketRef', element: <TicketDetailRoute /> }
  ```
- `frontend/src/pages/BoardPage.tsx:56-58` — `handleEdit` emits the UNPADDED display ID (URL canonical form, D1):
  ```tsx
  const handleEdit = (ticket: Ticket) => {
    const ref = formatTicketId(ticket.projectSlug ?? slug, ticket.ticketNumber, { padded: false });
    navigate(`tickets/${ref}`);   // URL: /projects/SLYK/tickets/SLYK-4
  };
  ```
  (Note: `handleEdit` currently receives `ticketId`; change the signature to take the `ticket` (or `ticketNumber` + slug) so it can format the ref. Update `BoardColumn`/`UnsortedBucket` `onEdit` props accordingly — they pass through to `TicketCard`.)
- `frontend/src/components/TicketCard.tsx:34` — `onEdit?.()` emits the display ID. With the `handleEdit` signature change, `TicketCard` calls `onEdit?.(ticket)` (or formats the ref itself via `formatTicketId(..., {padded:false})` and passes the string — pick one; recommend passing `ticket` and formatting in `handleEdit` to keep `TicketCard` dumb).
- `frontend/src/pages/BoardPage.tsx:147-162` — `TicketDetailRoute` resolves ref→UUID then renders the modal (contract UNCHANGED):
  ```tsx
  function TicketDetailRoute() {
    const { slug, ticketRef } = useParams<{ slug: string; ticketRef: string }>();
    const parsed = parseTicketDisplayId(ticketRef, slug);   // D3 prefix validation
    if (!parsed) return <NotFoundState onClose={() => navigate(`/projects/${slug}`)} />;  // T4 fills NotFoundState
    // Resolve ref → TicketDetail (UUID) ONCE:
    const { data, isLoading, isError } = useQuery({
      queryKey: ['ticket-ref', slug, parsed.ticketNumber],
      queryFn: () => fetchTicketByRef(slug, ticketRef),
      staleTime: Infinity,   // ref→uuid resolution is stable; not polled
    });
    if (isLoading) return <SpinnerOverlay />;
    if (isError || !data) return <NotFoundState onClose={...} />;
    // Hand UUID to modal — contract UNCHANGED:
    return <TicketDetailModal slug={slug} ticketId={data.id} onClose={...} onSubmit={...} />;
  }
  ```
  Modal reuses `fetchTicket(uuid)` / `ticketKeys.detail(uuid)` / mutations / `useBlocker(isDirty)` UNCHANGED (D2). The ref-resolution query is a SEPARATE queryKey (`['ticket-ref', slug, n]`, `staleTime: Infinity`) — zero churn on the existing detail cache.
- `frontend/src/api/tickets.ts` (MODIFY) — add `fetchTicketByRef(slug, ref)`:
  ```ts
  export async function fetchTicketByRef(slug: string, ref: string): Promise<TicketDetail> {
    return apiFetch<TicketDetail>(`${API_BASE_URL}/projects/${slug}/tickets/${ref}`);   // unwraps {data}, throws ApiClientError
  }
  ```
  `fetchTicket(uuid)` UNCHANGED (still used by the modal for drift-refetch).
- `frontend/src/components/BoardColumn.tsx` / `UnsortedBucket` — update `onEdit` prop signatures to match `handleEdit` (pass `ticket` through).

**Acceptance Criteria:**
- [ ] Card click → URL is `/projects/SLYK/tickets/SLYK-4` (display ID, unpadded).
- [ ] Deep-link `/projects/SLYK/tickets/SLYK-4` opens the correct ticket modal over the mounted board.
- [ ] Browser back from modal returns to `/projects/SLYK` (onClose unchanged).
- [ ] Modal contract UNCHANGED: `<TicketDetailModal slug ticketId={uuid} onClose onSubmit>`.
- [ ] Drift-refetch (`ticketKeys.detail(uuid)`, 30s) + unsaved-guard (`useBlocker(isDirty)`) still work (F16 invariants preserved).
- [ ] `fetchTicketByRef` calls `GET /api/projects/:slug/tickets/:ref`, unwraps `{data}`.
- [ ] All write mutations (update/delete/move/timer) still use the UUID the modal holds.
- [ ] `rtk vitest run -w frontend` green (update `BoardPage.test.tsx` assertions — card click now navigates to `SLYK-N` not a UUID); `rtk tsc` zero errors.

**Dependencies:** T1 (BE resolver + parser), T2 (FE parser/formatter).

---

### T4 — 404 / not-found handling + backwards-compat (D4/D5)

**Batch:** 3 · **Depends on:** T3 · **Parallel with:** —

**Description:** Implement the not-found UX for malformed refs (D5) and document the old-UUID-deep-link → 404 decision (D4). `TicketDetailRoute` (T3 stubbed `NotFoundState`) renders a "Ticket not found" state when the parser fails OR the resolver 404s. Old UUID deep-links (`/tickets/<uuid>`) hit the same parser-fail path → 404 (D4).

Modify:
- `frontend/src/pages/BoardPage.tsx` (TicketDetailRoute) — fill in `NotFoundState` (T3 stub): a modal-overlay or inline state with "Ticket not found" + a close action (`navigate(\`/projects/${slug}\`)`). Use `getByRole`-friendly markup (testing-rules.md). Handle BOTH the parser-fail (client-side, instant) AND the resolver 404 (network) cases:
  ```tsx
  if (!parsed) return <TicketNotFound onClose={() => navigate(`/projects/${slug}`)} />;   // malformed ref / old UUID
  // ... in the useQuery branch:
  if (isError || !data) return <TicketNotFound onClose={...} />;   // resolver 404 (nonexistent number)
  ```
- `frontend/src/components/TicketNotFound.tsx` (NEW or inline) — small presentational component: "This ticket doesn't exist or the link is incorrect." + Close button (`getByRole('button')`). If extracting, co-locate `TicketNotFound.test.tsx` (render + close action).
- **Document D4** (old UUID deep-links → 404) in a code comment on the parser-fail branch: `// Old /tickets/<uuid> deep-links (F16) hit this path → 404. Owner sign-off: 404 chosen over redirect-to-new (D4).`
- `frontend/src/pages/BoardPage.test.tsx` — add cases: malformed ref (`/tickets/abc`) → TicketNotFound; old UUID ref (`/tickets/<uuid>`) → TicketNotFound; well-formed-but-nonexistent (`/tickets/SLYK-9999`) → resolver 404 → TicketNotFound; prefix mismatch (`/projects/SLYK/tickets/PX-4`) → TicketNotFound.

**Acceptance Criteria:**
- [ ] Malformed route param (`/projects/SLYK/tickets/abc`) → TicketNotFound (parser fail, no network call).
- [ ] Old UUID deep-link (`/projects/SLYK/tickets/<uuid>`) → TicketNotFound (parser fail — UUID is not `SLUG-NNN`).
- [ ] Well-formed-but-nonexistent (`/projects/SLYK/tickets/SLYK-9999`) → resolver 404 → TicketNotFound.
- [ ] Prefix mismatch (`/projects/SLYK/tickets/PX-4`) → TicketNotFound (D3).
- [ ] Close action returns to `/projects/SLYK`.
- [ ] D4 decision documented in code.
- [ ] `rtk vitest run -w frontend` green; `rtk tsc` zero errors.

**Dependencies:** T3.

---

### T5 — Integration verification & sign-off

**Batch:** 4 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Manual smoke for the URL-shape flows.

Steps:
1. `rtk tsc` (BE + FE) — zero errors.
2. `rtk vitest run -w backend` + `rtk vitest run -w frontend` — all green (parser table-driven tests, resolver tests, wiring tests, not-found tests).
3. `rtk lint` + `rtk prettier --check` — zero violations.
4. `npm run build -w backend && npm run build -w frontend` — both succeed.
5. **Manual smoke (dev stack):**
   - Card click on a ticket → URL shows `/projects/SLYK/tickets/SLYK-4` (display ID, unpadded).
   - Deep-link paste `/projects/SLYK/tickets/SLYK-4` in a fresh tab → modal opens over mounted board with correct ticket.
   - Browser back from modal → returns to `/projects/SLYK` (no board refetch — F16 mounted-board invariant holds).
   - Malformed ref `/projects/SLYK/tickets/abc` → TicketNotFound (no crash).
   - Old UUID deep-link `/projects/SLYK/tickets/<uuid>` → TicketNotFound (D4).
   - Prefix mismatch `/projects/SLYK/tickets/PX-4` → TicketNotFound (D3).
   - Well-formed-but-nonexistent `/projects/SLYK/tickets/SLYK-9999` → TicketNotFound.
   - Drift-refetch (30s) still fires on an open modal (UUID-keyed `ticketKeys.detail`).
   - Unsaved-changes guard (`useBlocker`) still prompts on navigate-with-dirty-form.
   - Write flows (edit/save, move, delete, timer start/stop) still work (UUID-keyed mutations).
6. **Badge consistency:** TicketCard badge shows `SLYK-004` (padded, F12 D2); URL shows `SLYK-4` (unpadded, D1); modal title shows `SLYK-004` (padded, `formatTicketId` default).

**Acceptance Criteria:**
- [ ] All three feature Acceptance bullets satisfied (record observable proof):
  - [ ] Ticket detail route param is the display ID `SLYK-4` (step 5).
  - [ ] Backend resolves by `(slug, ticket_number)` — `GET /api/projects/:slug/tickets/:displayId` (step 5 + T1 tests).
  - [ ] Existing flows (card click, deep-link, browser back) work with the new URL shape (step 5).
- [ ] All 4 edge cases resolved (parse/validate, prefix-match, slug-rename MOOT, backwards-compat 404).
- [ ] No schema delta authored by F30 (D6) — confirm no new migration file.
- [ ] `rtk tsc`/`vitest`/`lint`/`prettier`/`build` exit codes `0`.

**Dependencies:** T1–T4.

---

## 7. Final F30 Acceptance Checklist

- [ ] Ticket detail route param is the display ID (`SLYK-4`), not the UUID — URL is `/projects/:slug/tickets/SLYK-4`.
- [ ] Backend resolves a ticket by `(project slug, ticket_number)` via new `GET /api/projects/:slug/tickets/:displayId` + `getTicketByNumber` (indexed `(projectId, ticketNumber)` lookup).
- [ ] Existing flows keep working: card click → new URL; deep-link paste → modal over mounted board; browser back → `/projects/:slug` (no board refetch).
- [ ] Malformed ref → 404 `NOT_FOUND` (D5); old UUID deep-link → 404 (D4); prefix mismatch → 404 (D3).
- [ ] Modal contract UNCHANGED (`{slug, ticketId:UUID}`); F16 invariants preserved (unsaved-guard `useBlocker`, drift-refetch 30s on `ticketKeys.detail(uuid)`, deep-link).
- [ ] Display badge padded `SLYK-004` (F12 D2/REQ-3.1); URL unpadded `SLYK-4` (D1); unified `formatTicketId(slug, n, {padded})`.
- [ ] Shared parser (`parseTicketDisplayId`) on FE + BE mirror, table-driven tested, >80% business-logic coverage.
- [ ] All `/api/tickets/:ticketId` write routes UNCHANGED (UUID-keyed).
- [ ] No schema delta authored by F30 (D6 — uses existing `(project_id, ticket_number)` unique index).
- [ ] SCREAMING_SNAKE constants (`TICKET_DISPLAY_ID_REGEX`, `MIN_TICKET_NUMBER`, `TICKET_NUMBER_PAD_LENGTH`); no `any`, no `console.log`, no inline styles; fns <50 lines.
- [ ] Single-line `SLYK-F30:` commits; branch `feature/SLYK-F30-human-readable-ticket-urls`; rebase-merge only.
- [ ] Lint + format + typecheck + tests pass on an empty change.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- Card-click URL observed: `________` (expect `/projects/SLYK/tickets/SLYK-4`)
- `GET /api/projects/SLYK/tickets/SLYK-4` response (excerpt w/ UUID): `________`
- Malformed-ref `/tickets/abc` response: `404 NOT_FOUND`
- Old-UUID `/tickets/<uuid>` response: `404 NOT_FOUND`
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F30 owns NONE (D6).** F30 reuses the EXISTING `(project_id, ticket_number)` unique index (`schema.ts:147-150`, built in F12 D1 for sequence allocation) for the resolver — an indexed point lookup. No new column, no new index, no migration. Model A (render-time display ID from `slug` + `ticket_number`, no stored column) is confirmed; F12 D8's deferred Model B (stored snapshot column) is moot under F27's permanent slug (D7). No DB schema change.

---

## 9. Cross-cutting decisions — OWNER SIGN-OFF NEEDED

1. **Backwards-compat of old `/tickets/<uuid>` deep-links** (D4) — **Recommend 404.** F16's UUID URLs were internal/not widely shared (deep-link shipped for board UX, not external sharing). 404 is simplest — no alias table, no migration, no detection of UUID-shape-vs-`SLUG-NNN`. **Alternative: redirect-to-new** — detect UUID-shaped param, resolve via existing `getTicket(uuid)`, redirect (301/307) to `/projects/:slug/tickets/SLYK-N`. The redirect needs the project slug from the ticket's project (one extra hop). Owner picks. (F30 plan defaults to 404; flag in §1.)
2. **URL canonical form** (D1) — **Recommend unpadded `SLYK-4`** (matches the spec example verbatim, features.md:570 "SLYK-4"; cleaner URL). **Alternative: padded `SLYK-004`** (consistent with the F12 D2 display badge). Parser accepts BOTH regardless, so this only affects what `handleEdit`/`formatTicketId(...,{padded:false})` emits. Owner picks.
3. **Prefix-validation strictness** (D3) — **Recommend validate-prefix-match→404** (a deep-link's embedded project prefix must equal the path `:slug`; shareability integrity). **Alternative: derive-number-only (lenient)** — silently resolve `/projects/SLYK/tickets/PX-4` to ticket 4 of project SLYK (ignoring the `PX-` prefix). Lenient risks cross-project confusion; strict is safer. Owner picks.
4. **Whether F30 reopens slug-rename** (D7) — **Recommend NO (keep slug permanent).** F27 made the slug non-editable (`projectService.ts:100`); F27 tasks.md:25 left the door open ("F30 can revisit if needed"). With a permanent slug, path `:slug` and the ticket's project slug cannot diverge → simple `(slug, ticket_number)` lookup suffices, NO redirect-by-number needed, NO Model B snapshot column. Reopening slug-rename would force redirect-by-number + a stored display-ID snapshot — significant scope. Owner confirms F30 does NOT reopen.

**Sources:**
- `basic-PRD.md` REQ-3.1 (ID format `[SLUG]-[NNN]`, example `PX-101`/`PX-102`); §8.3 schema (Tickets.id UUID PK + ticket_number Integer per-project + project_id FK); §7 User Journey 1 (tickets referenced by display ID `PX-104`).
- `.claude/rules/git-guidelines.md` (SLYK-F30 prefix; rebase-merge only; branch naming).
- `.claude/rules/js-development-rules.md` (Backend routes RESTful, proper HTTP methods — GET resolver, consistent JSON envelope, Zod-at-edge, parameterized queries, authenticate middleware; Frontend — one component/file, co-located tests, explicit prop interfaces, React Query server state).
- `.claude/rules/js-style-guide.md` (SCREAMING_SNAKE constants; no magic numbers; no `any`/`console.log`/inline styles; fns <50 lines; PascalCase types/camelCase vars).
- `.claude/rules/js-testing-rules.md` (Vitest co-located `*.test.ts(x)`; table-driven preferred; `vi.fn`; RTL `getByRole` priority; coverage Business >80%/Components >70%).
- Dependency task docs: F12 (D1 sequence `FOR UPDATE` + `(project_id,ticket_number)` unique index; D2 zero-pad display 3 `SLYK-001`; D6 `POST /api/projects/:slug/tickets` nesting precedent; D8 Model A render-time display ID, Model B deferred), F16 (deep-link nested route `/projects/:slug/tickets/:ticketId` as modal overlay over mounted board; unsaved guard `useBlocker(isDirty)` + `ConfirmDiscardDialog`; drift `useQuery refetchInterval 30_000`; modal contract `{slug, ticketId, onClose, onSubmit}`), F27 (D1/D7 slug PERMANENT — resolves slug-rename edge case; tasks.md:25 "F30 can revisit if needed").
- Grounding: `frontend/src/routes/index.tsx:62-68`; `frontend/src/pages/BoardPage.tsx:56-58,123,132,140,147-162`; `frontend/src/components/TicketCard.tsx:13,20,34`; `frontend/src/pages/BoardPage.test.tsx:119`; `frontend/src/utils/formatTicketId.ts:4-6`; `frontend/src/pages/ProjectSettingsPage` (F27); `frontend/src/api/tickets.ts:36-39`; `frontend/src/api/timer.ts` (UUID-keyed); `frontend/src/types/project.ts`; `frontend/src/hooks/useUpdateProject.ts`; `backend/src/db/schema.ts:99-104,120,147-150`; `backend/src/services/ticketService.ts:95-98,100,164-179,262-309`; `backend/src/routes/tickets.routes.ts:24-36,40,56,113,127,141,158,171`; `backend/src/routes/tickets.schema.ts:3-5`; `backend/src/routes/projects.routes.ts:50,63-77`; `backend/src/routes/projects.schema.ts:36-45`; `backend/src/utils/slug.ts:2,18-20`; `backend/src/index.ts:50`.
- F03 error codes: `NOT_FOUND` → 404, `VALIDATION_FAILED` → 400.
- Memory: `confirm-modals-for-destructive-actions` (no destructive action in F30 — N/A but noted; the resolver is read-only).
