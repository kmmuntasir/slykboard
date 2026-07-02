# Task Breakdown — DEL-03
**Plan:** `DEL-03-unified-description-limit-plan.md`
**Generated:** 2026-07-03

---

## Parallelization Strategy

Tasks are grouped into batches by dependency order. Run batches sequentially;
within a batch, conflict-free tasks run in parallel.

### Batch / Dependency Diagram
```
Batch 1: [T1] ──┐
                ├──> Batch 2: [T3] ──┐
          [T2] ──┤                   ├──> (done)
                ├──> Batch 2: [T4] ──┤
                └──> Batch 2: [T5] ──┘
```

### Merge-order rules
1. Land Task 1 and Task 2 first (parallel, different packages — no conflict).
2. Then land Task 3, Task 4, Task 5 in any order (parallel — disjoint files: backend tests / `DescriptionField.tsx` / frontend test files). No file overlaps among Batch 2.
3. Task 2 deliberately leaves `TicketAttributeForm.test.tsx` red until Task 5 lands — acceptable since they are separate commits on the same branch; ensure Task 5 is merged before considering the branch green.

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `backend/src/routes/tickets.schema.ts`, `backend/src/routes/projects.schema.ts` | None | T2 |
| T2 | 1 | `frontend/src/hooks/useTicketForm.ts` | None | T1 |
| T3 | 2 | `backend/src/routes/tickets.routes.test.ts`, `backend/src/routes/projects.routes.test.ts` | T1 | T4, T5 |
| T4 | 2 | `frontend/src/components/ticket-fields/DescriptionField.tsx` | T2 | T3, T5 |
| T5 | 2 | `frontend/src/components/TicketAttributeForm.test.tsx`, `frontend/src/hooks/useTicketForm.test.ts` | T2 | T3, T4 |

### Suggested developer tracks
- **Track A (backend):** T1 → T3
- **Track B (frontend schema/UI):** T2 → T4
- **Track C (frontend tests):** T2 → T5

---

## Tasks

### T1 — Backend: unify description limit constant + apply at both enforcement sites
**Description:** Add `export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;` (SCREAMING_SNAKE_CASE, numeric separator) near the top of `tickets.schema.ts`. At `tickets.schema.ts:31`, replace `.max(5000)` with `.max(TICKET_DESCRIPTION_MAX_LENGTH)` in the `attributeFields` description field (keep `.nullable().optional()`, do NOT add a custom error message — backend convention is bare `.max()`). In `projects.schema.ts`, import `TICKET_DESCRIPTION_MAX_LENGTH` from `./tickets.schema` and replace `.max(5000)` at `projects.schema.ts:60` with `.max(TICKET_DESCRIPTION_MAX_LENGTH)` (keep `.optional()`). MUST NOT touch `tickets.schema.ts:68` (`manualEntryBody` time-entry `.max(500)`) — out of scope.

**Source refs:** `tickets.schema.ts:31`, `projects.schema.ts:60`

**Acceptance criteria:**
- [ ] `TICKET_DESCRIPTION_MAX_LENGTH = 10_000` exported from `tickets.schema.ts`.
- [ ] Both edit (PATCH) and create (POST) description fields use the named constant.
- [ ] `manualEntryBody` time-entry description (`tickets.schema.ts:68`) unchanged at 500.
- [ ] `.nullable().optional()` / `.optional()` semantics preserved; description not made required.
- [ ] `cd backend && npm test` green (existing tests pass).

**Dependencies:** None
**Commit:** `DEL-03: Raise ticket description limit to 10000 on backend create and edit`

---

### T2 — Frontend: unify description limit constant + apply in shared schema
**Description:** Add `export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;` near the schema (after imports, before/above the schema). At `useTicketForm.ts:18`, change to `description: z.string().max(TICKET_DESCRIPTION_MAX_LENGTH, \`Description must be ${TICKET_DESCRIPTION_MAX_LENGTH} chars or fewer\`)`. Keep the existing "…chars or fewer" phrasing (matches title field family at `useTicketForm.ts:17`). Do NOT change anything else in the schema. This schema is shared by BOTH create and edit, so this single change unifies the frontend ceiling. The constant is duplicated once per package by design (no cross-stack shared file).

**Source refs:** `useTicketForm.ts:18` (and `:17` title family for phrasing)

**Acceptance criteria:**
- [ ] `TICKET_DESCRIPTION_MAX_LENGTH = 10_000` exported from `useTicketForm.ts`.
- [ ] Description field uses the constant in `.max()` with the templated message.
- [ ] Resulting validation message reads "Description must be 10000 chars or fewer".
- [ ] `frontend/src/hooks/useTicketForm.test.ts` does not yet exist — the existing `TicketAttributeForm.test.tsx:177` test currently asserts the OLD 5000 message and will FAIL after this change; it is updated in Task 5 (do not fix it here — Task 2 commit is schema-only). Acceptance for Task 2: `cd frontend && npm test` may show the one expected failure in `TicketAttributeForm.test.tsx`; all OTHER frontend tests pass.

**Dependencies:** None
**Commit:** `DEL-03: Raise ticket description limit to 10000 in shared form schema`

---

### T3 — Backend tests: close PATCH + POST description length-bound gap
**Description:** There is currently NO backend length-bound test for ticket description on either path. Add two edge tests using the existing over-length patterns as templates (`tickets.routes.test.ts:690` checklist-text `.repeat(201)` pattern; `comments.routes.test.ts:290` `'x'.repeat(5001)` → 400 + `VALIDATION_FAILED` pattern).

- In `tickets.routes.test.ts`: add an `it(...)` that sends a PATCH with `description: 'x'.repeat(10001)` and asserts HTTP 400 + `VALIDATION_FAILED` (and that the handler/route function is not invoked, matching the existing pattern). Table-driven per AGENTS.md where natural — also assert a 10000-char value is accepted (boundary pass).
- In `projects.routes.test.ts`: add a create-ticket edge test sending `description: 'x'.repeat(10001)` in the create-ticket body, asserting 400 + `VALIDATION_FAILED`; optionally a 10000-char accepted case.
- Mirror the exact mock/setup the neighboring tests use.

**Source refs:** `tickets.routes.test.ts:690`, `comments.routes.test.ts:290`

**Acceptance criteria:**
- [ ] New PATCH edge test: 10001 chars → 400 + `VALIDATION_FAILED`; 10000 chars accepted.
- [ ] New POST edge test: 10001 chars → 400 + `VALIDATION_FAILED`.
- [ ] `cd backend && npm test` green.

**Dependencies:** T1
**Commit:** `DEL-03: Add ticket description length edge tests for backend create and edit`

---

### T4 — Frontend: live character counter in description editor
**Description:** Render a character counter as a sibling inside the `<Field>` children, after `<RichTextEditor>`, in the EDITABLE branch only (NOT in the read-only/archived `dangerouslySetInnerHTML` branch). Use the already-watched value: `${(descriptionValue ?? '').length} / ${TICKET_DESCRIPTION_MAX_LENGTH}`. Import `TICKET_DESCRIPTION_MAX_LENGTH` from `../../hooks/useTicketForm`. Styling: muted/secondary Tailwind text consistent with existing field helper text; turn red/amber when `length > TICKET_DESCRIPTION_MAX_LENGTH` (visual cue only — Zod already blocks submit at that point). Keep minimal. Counter appears in both create and edit flows automatically (both consume `<DescriptionField>`). Do not add a counter to the read-only branch.

**Source refs:** `DescriptionField.tsx` (~line 27 `watch('description')`)

**Acceptance criteria:**
- [ ] `N / 10000` counter rendered in the editable branch in both create and edit flows.
- [ ] Read-only/archived branch renders no counter.
- [ ] Counter turns red/amber when length exceeds 10000.
- [ ] `cd frontend && npm test` green (no existing test depends on this markup; if any structural assertion breaks, update minimally).

**Dependencies:** T2
**Commit:** `DEL-03: Add live character counter to ticket description editor`

---

### T5 — Frontend tests: update length-bound test + add schema unit test
**Description:**
- In `TicketAttributeForm.test.tsx` at ~line 177/189/195: change the fixture from `'a'.repeat(5001)` to `'a'.repeat(10001)` and the asserted message from `'Description must be 5000 chars or fewer'` to `'Description must be 10000 chars or fewer'`. Update the `it(...)` name accordingly. The RichTextEditor mock (`TicketAttributeForm.test.tsx:4-5`) means the test exercises the schema directly — no editor change needed.
- Create `frontend/src/hooks/useTicketForm.test.ts` (net-new, co-located): table-driven unit test asserting the exported schema rejects a 10001-char description and accepts a 10000-char description — directly locking the "unified limit" claim at the schema level, independent of the component test. Import `TICKET_DESCRIPTION_MAX_LENGTH` and reference it in the test (no magic numbers per AGENTS.md).

**Source refs:** `TicketAttributeForm.test.tsx:177,189,195`; `useTicketForm.ts:18`

**Acceptance criteria:**
- [ ] Updated `TicketAttributeForm.test.tsx` passes with 10001/10000 boundary and new message.
- [ ] New `useTicketForm.test.ts` passes: 10001 rejected, 10000 accepted, using the constant.
- [ ] `cd frontend && npm test` fully green (this task resolves the expected failure introduced in Task 2).

**Dependencies:** T2
**Commit:** `DEL-03: Update and add ticket description length tests in frontend`
