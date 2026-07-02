# Implementation Plan — DEL-03
**Ticket:** `.context/pm-cycles/pm-cycle-2026-07-03-00-00-00/deliverables/DEL-03-unified-description-limit-plan.md`
**Type:** Enhancement
**Title:** Unified ticket description limit
**Generated:** 2026-07-03

---

## Summary
Unify the ticket `description` length limit to a single 10,000-character ceiling, applied identically on create and edit, on both frontend and backend, with a live character counter in the editor UI. Today both paths already enforce 5000 (the ticket's "create caps at 500" premise is false — that 500 belongs to the unrelated time-entry description field). We raise 5000 → 10000 in the three Zod schemas, introduce one shared constant per package to prevent future divergence, add a `N/10000` counter to the description editor, and add co-located Vitest tests covering both edges.

## Confirmed Baseline (verified, supersedes ticket prose)
- `backend/src/routes/tickets.schema.ts:31` — PATCH/edit `attributeFields`: `description: z.string().max(5000).nullable().optional()` → **5000**.
- `backend/src/routes/projects.schema.ts:60` — POST/create `createTicketBody`: `description: z.string().max(5000).optional()` → **5000**.
- `frontend/src/hooks/useTicketForm.ts:18` — shared schema (used by BOTH create and edit): `description: z.string().max(5000, 'Description must be 5000 chars or fewer')` → **5000**.
- `backend/src/db/schema.ts:165` — column is `text('description')`, no DB length constraint → **no migration needed**.
- The `max(500)` at `backend/src/routes/tickets.schema.ts:68` is the **time-entry** `manualEntryBody` description, NOT the ticket description — OUT OF SCOPE, must not change.
- No other ticket-description write path exists (no clone/import/bulk/CSV/webhook). No DTO-level or OpenAPI length constraint. No i18n system (messages are inline literals).
- Existing test locking current cap: `frontend/src/components/TicketAttributeForm.test.tsx:177` (`'a'.repeat(5001)` + asserts message `'Description must be 5000 chars or fewer'`).
- Backend has NO length-bound test for ticket description on either path (gap to close).

## KEY DESIGN DECISION — How "character count" is measured
The description is rich-text HTML (TipTap `RichTextEditor` emits `editor.getHTML()`, stored as-is). Decision: **measure on the raw stored description string (the HTML string), identically on client and server.** Enforce `max(10000)` on the raw HTML string at all three Zod schemas; the UI character counter counts the same raw editor content length. Rationale: simplest, fully consistent definition — the same value flows through frontend form state, the API payload, and the DB column, so client and server never disagree. This deliberately counts HTML tags toward the limit (acceptable: the acceptance criteria require the limit "apply regardless of how much formatting is used" and "be measured consistently on the stored description content"; measuring the stored content is the consistent definition). Do NOT strip tags / compute plain-text length (that would create client/server divergence and added complexity). Note: DEL-01 (rich text editor) is already on this branch and is NOT a dependency — changes here are self-contained to the schema constant + counter UI.

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Route schema (backend) | `backend/src/routes/tickets.schema.ts` | Edit/PATCH `attributeFields` description `.max(5000)` at line 31; also hosts new shared constant. |
| Route schema (backend) | `backend/src/routes/projects.schema.ts` | Create/POST `createTicketBody` description `.max(5000)` at line 60; import shared constant. |
| Schema (frontend) | `frontend/src/hooks/useTicketForm.ts` | Shared create+edit schema description `.max(5000)` at line 18; also hosts new shared constant. |
| Frontend component | `frontend/src/components/ticket-fields/DescriptionField.tsx` | Render `<RichTextEditor>`; already calls `watch('description')` at ~line 25; add character counter. |
| Tests | `frontend/src/components/TicketAttributeForm.test.tsx` | Update existing description-length test (line 177) from 5001 → 10001. |
| Tests | `backend/src/routes/tickets.routes.test.ts` | New PATCH edge test for 10001-char rejection. |
| Tests | `backend/src/routes/projects.routes.test.ts` | New POST/create edge test for 10001-char rejection. |

## Proposed Implementation

### Backend Changes

#### Change 1 — Introduce unified constant and apply at enforcement sites
- **File:** `backend/src/routes/tickets.schema.ts`
- **What:** Add `export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;` (SCREAMING_SNAKE_CASE per AGENTS.md; `10_000` numeric separator) near the top of the file. At line 31, replace `.max(5000)` with `.max(TICKET_DESCRIPTION_MAX_LENGTH)`. Do NOT add custom error messages (matches existing backend convention of bare `.max()`; backend returns generic `VALIDATION_FAILED`).
- **Why:** Single named constant prevents future divergence across create/edit paths; no magic numbers per AGENTS.md.
- **Code reference:** `backend/src/routes/tickets.schema.ts:31`

#### Change 1b — Apply constant at create path
- **File:** `backend/src/routes/projects.schema.ts`
- **What:** Import `TICKET_DESCRIPTION_MAX_LENGTH` from `./tickets.schema` and replace `.max(5000)` at line 60 with `.max(TICKET_DESCRIPTION_MAX_LENGTH)`.
- **Why:** Create path must use the same unified ceiling as edit path.
- **Code reference:** `backend/src/routes/projects.schema.ts:60`

### Frontend Changes

#### Change 2 — Introduce unified constant and apply in shared schema
- **File:** `frontend/src/hooks/useTicketForm.ts`
- **What:** Add `export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;` near the schema. At line 18, change to `description: z.string().max(TICKET_DESCRIPTION_MAX_LENGTH, \`Description must be ${TICKET_DESCRIPTION_MAX_LENGTH} chars or fewer\`)`. Keep the existing "…chars or fewer" phrasing (matches the title-field family at line 17). Message becomes "Description must be 10000 chars or fewer". Note: frontend and backend are separate packages/builds, so the constant is duplicated once per package (no shared cross-stack file — there is no precedent for one).
- **Why:** Single named constant per package; consistent message phrasing.
- **Code reference:** `frontend/src/hooks/useTicketForm.ts:18`

#### Change 3 — Character counter UI
- **File:** `frontend/src/components/ticket-fields/DescriptionField.tsx`
- **What:** Render a counter as a sibling inside the `<Field>` children, after `<RichTextEditor>`. Use the already-watched value: `${(descriptionValue ?? '').length} / ${TICKET_DESCRIPTION_MAX_LENGTH}`. Import `TICKET_DESCRIPTION_MAX_LENGTH` from `../../hooks/useTicketForm` (adjust relative path as needed). Styling: muted/secondary text; optionally turn red/amber when length exceeds the limit (the form is already blocked by Zod at that point, so this is a visual cue only). Keep it minimal and consistent with existing field helper text. The counter appears in both create and edit flows (both consume `<DescriptionField>`). For the read-only archived view branch in the same file, no counter is needed (counter is for the editing path only).
- **Why:** Provides live feedback so the user sees how close they are to the limit before submit is blocked.
- **Code reference:** `frontend/src/components/ticket-fields/DescriptionField.tsx:25`

#### Change 4 — Update + add tests (Vitest, co-located)
- **File:** `frontend/src/components/TicketAttributeForm.test.tsx`
- **What:** At line 177, change fixture from `'a'.repeat(5001)` to `'a'.repeat(10001)` and expected message to `'Description must be 10000 chars or fewer'`. The test mocks `RichTextEditor` as a textarea, so it tests the schema directly (no editor change needed). Optionally also assert a 10000-char value passes submit.
- **Why:** Lock the new ceiling at the boundary.
- **Code reference:** `frontend/src/components/TicketAttributeForm.test.tsx:177`

- **File:** `backend/src/routes/tickets.routes.test.ts`
- **What:** Add an edge test mirroring the existing checklist-text pattern at ~line 690 — send a PATCH with `description: 'x'.repeat(10001)`, assert `400` + `VALIDATION_FAILED` + handler not called. Pattern template exists at `backend/src/routes/comments.routes.test.ts:290`.
- **Why:** Close backend gap (no length-bound test for PATCH description exists today).
- **Code reference:** `backend/src/routes/tickets.routes.test.ts:690`

- **File:** `backend/src/routes/projects.routes.test.ts`
- **What:** Add a create-ticket edge test sending `description: 'x'.repeat(10001)` in the create-ticket body, assert `400` + `VALIDATION_FAILED`.
- **Why:** Close backend gap for the create path.
- **Code reference:** `backend/src/routes/projects.routes.test.ts`

- **File:** `frontend/src/hooks/useTicketForm.test.ts` *(optional, recommended)*
- **What:** Add a tiny unit test asserting `ticketFormSchema` rejects 10001 chars and accepts 10000, to directly lock the "unified limit" claim independent of the component test.
- **Why:** Direct schema-level coverage of the unified constant.

## Edge Cases & Risks
- Exactly 10000 chars: must be accepted on both paths (boundary). Exactly 10001: rejected. Cover both in tests.
- Empty/undefined/null description: unchanged (`.optional()` / `.nullable().optional()` semantics preserved) — do not make description required.
- HTML content: tags count toward the 10000 raw-string limit by design (see Design Decision).
- Multi-byte / emoji characters: JS string `.length` counts UTF-16 code units; consistent on client and server (both run JS Zod), so no divergence. Acceptable per "measured on stored content."
- Read-only archived ticket view: no counter; the limit is an input/edit constraint only.
- Out-of-scope fields that reuse "description" but must NOT change: time-entry description (`backend/src/routes/tickets.schema.ts:68`, `ManualEntryForm.tsx`), comment body (`comments.schema.ts`, `CommentForm.tsx`).

## Testing
- Run frontend Vitest: `cd frontend && npm test -- --run` (or project-equivalent). Expect updated `TicketAttributeForm.test.tsx` + new `useTicketForm.test.ts` green.
- Run backend Vitest: `cd backend && npm test -- --run`. Expect new PATCH + POST edge tests green.
- Manual smoke: open create ticket modal, type/paste >10000 chars → counter goes red, submit blocked, message shown; type ≤10000 → submits. Repeat in edit/detail modal. Confirm both flows identical.

## Acceptance Criteria
- [ ] Ticket description limit is a single unified 10,000-character ceiling.
- [ ] The limit is enforced identically on create and edit, on both frontend (Zod in `useTicketForm`) and backend (Zod in `createTicketBody` and `updateTicketBody`/`attributeFields`).
- [ ] The limit is measured consistently on the raw stored description content (the HTML string) — same value on client and server.
- [ ] A live character counter (`N / 10000`) is shown in the description editor in both create and edit flows; at/over the limit the user gets clear feedback (counter state + Zod error message) and submit is blocked.
- [ ] The validation ceiling is defined via a single named constant per package (`TICKET_DESCRIPTION_MAX_LENGTH = 10_000`), imported at all enforcement sites (no scattered magic numbers).
- [ ] Co-located Vitest tests cover the boundary (10000 accepted, 10001 rejected) on frontend schema, backend PATCH, and backend POST.
- [ ] No DB migration; no changes to other fields (time-entry description, comments, title) or other endpoints.

## Out of Scope
- Any field other than ticket `description` (title, comments, time-entry description, checklist text).
- Comments editor / counter.
- Any data migration, trimming, or backfill of existing descriptions.
- Tag-stripping / plain-text-length measurement (raw HTML string length by design).
- i18n of the error message (no i18n system exists).
- Correcting the inaccurate `.context/.../state.md` "create caps at 500" note (optional doc hygiene; not a code change for this ticket).

## Open Questions *(optional)*
- None blocking. (Optional, defer: whether to later centralize ALL inline Zod limits into a shared `limits.ts` per package — out of scope for DEL-03; this ticket only unifies the description constant.)

## Conventions to follow (from AGENTS.md)
- Backend layering Route→Controller→Service→Repository; Zod validation at the route edge (no change to controllers/services/repos needed — the `max()` bump is purely edge-schema).
- Constants SCREAMING_SNAKE_CASE; no magic numbers (hence the named constant).
- Single-line commits: `DEL-03: <msg>` (ticket prefix from branch name).
- Vitest tests co-located next to source as `*.test.ts`; table-driven preferred.
