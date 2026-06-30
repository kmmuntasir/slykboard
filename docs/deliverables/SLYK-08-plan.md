# Implementation Plan — SLYK-08

**Ticket:** `docs/deliverables/SLYK-08.md`
**Type:** Bug
**Title:** Labels Field Empty in Ticket Modal
**Generated:** 2026-06-30

---

## Summary

In the ticket modal (create + detail), the Labels field renders empty and shows
"No labels defined," and the user cannot add any label. The ticket requires an
end-to-end diagnosis (it explicitly says "Reproduce and diagnose the root cause at
runtime") and a fix at whichever layer is responsible, so that a project with
labels lists them and allows add/remove, a project without labels shows an
accurate, actionable empty state, and switching projects reflects the right
labels without a reload.

Isolated `analyst` investigation of the entire label-fetch path — frontend modal
→ `LabelMultiSelect` → `useLabels` → `listLabels` (api client) →
`GET /api/projects/:slug/labels` → `labelService.listLabels` → Drizzle `labels`
table, plus the TanStack Query key/cache/invalidation layer — found **every static
layer to be correct**: the backend query is properly project-scoped
(`labelService.ts:39-41`), label creation binds to the correct `project.id`
(`labelService.ts:59`), the query key is project-scoped with no collision
(`queryKeys.ts:23-28`), create-in-Project-Settings invalidates the exact key the
modal reads (`useLabelMutations.ts:17`), `requireProjectMember` admits a normal
Member for the GET (`requireProjectMember.ts:63-65`), and the `slug` prop is
provably defined whenever the modal is open (`BoardPage.tsx:218` guard).

The one genuine **structural defect** is in `LabelMultiSelect`: it reads
`const { data: labels = [], isLoading } = useLabels(projectSlug)` and branches
purely on `labels.length === 0` — it never inspects `isError`/`error`. So a fetch
that errors (4xx/5xx/network) is visually indistinguishable from a project that
genuinely has zero labels. That masks the real trigger and is the layer to harden.
The concrete runtime trigger must be confirmed with a Network-tab inspection
(this ticket's mandated Step 1), because it cannot be pinned statically.

## Root Cause

No single failing line could be proven statically — the code path is internally
coherent end-to-end. The defect that **allows** the bug to present is a masked
failure state:

- `frontend/src/components/LabelMultiSelect.tsx:18` —
  `const { data: labels = [], isLoading } = useLabels(projectSlug);` discards
  `isError`/`error`.
- `frontend/src/components/LabelMultiSelect.tsx:67` (analyst-cited) /
  `:79` (probe-cited) — empty branch is `{labels.length === 0 && (<div>No labels
  defined</div>)}`, with **no error branch**. A failed `GET
  /api/projects/:slug/labels` therefore renders identically to "project has no
  labels."

This is why the field "appears empty" regardless of the actual cause. The actual
trigger is one of the ranked hypotheses below and must be confirmed at runtime
(ticket Step 1) before committing the trigger-specific fix.

### Ranked runtime hypotheses (to be confirmed by diagnosis)

1. **Genuinely-empty label catalog (rule out FIRST).** `listLabels` returns
   `200 {"data":[]}` when the project has no rows (`labelService.ts:14-22`). If
   so, this is a data state, not a code bug — corroborating tell: the board's
   "Filter by label" dropdown (`BoardFilters.tsx:57-60`, same key/fetch) would
   ALSO be empty. *Action: create a label in Project Settings → Labels and
   confirm it appears in the modal; if it does, the fix is UX only (accurate,
   actionable empty state).*
2. **Silent fetch error masked by the empty state.** Any non-2xx from
   `GET /api/projects/:slug/labels` collapses into "No labels defined" because of
   the structural defect above. If the Network tab shows 4xx/5xx, this is the
   primary code-level fix (surface the error; fix the underlying status).
3. **Environment / build drift.** Wrong `VITE_API_BASE_URL` or a stale dev build
   — low probability (would break board/ticket fetches too), but confirm the
   running frontend matches this branch.
4. **Transient auth-token gap.** If `useAuthStore.getState().user` is null at
   first paint, the Authorization header is omitted and the request 401s — but
   the refresh cycle self-heals, so this would not stay empty. Very low
   probability.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Component (FE) | `frontend/src/components/LabelMultiSelect.tsx` | Owns the popover; renders the "No labels defined" branch and consumes `useLabels` without inspecting error. **Primary fix site.** |
| Hook (FE) | `frontend/src/hooks/useLabels.ts` | Returns the query; consider surfacing `isError`/`error` (already available on the `useQuery` result, just not consumed). |
| API client (FE) | `frontend/src/api/labels.ts` | `listLabels(projectSlug)` → `GET /projects/:slug/labels`. Correct; verify at runtime. |
| Query keys (FE) | `frontend/src/api/queryKeys.ts` | `labelKeys.forProject(slug)` = `['labels','project',slug]`. Correct (no collision). |
| Mutations (FE) | `frontend/src/hooks/useLabelMutations.ts` | Create invalidates the modal's key (`:17`). Correct; verify post-create modal refresh at runtime. |
| Route (BE) | `backend/src/routes/labels.routes.ts` | `GET /:slug/labels` behind `requireProjectMember` only. Correct. |
| Service (BE) | `backend/src/services/labelService.ts` | `listLabels` project-scoped via `projects.slug` join; `createLabel` binds correct `project.id`. Correct. |
| Schema (BE) | `backend/src/db/schema.ts:199-217` | `labels` table, `projectId` FK, `labels_project_name_unq`. Matches migration. |

## Proposed Implementation

### Step 0 — Runtime diagnosis (ticket-mandated, before any code change)

1. Open the board for a project known to have labels, open DevTools → Network.
2. Open the ticket modal; inspect the response to `GET /api/projects/<slug>/labels`.
3. Branch:
   - `200 {"data":[...]}` with rows but field still empty → **not** empty-data; the
     defect is client-side rendering of the rows (re-examine `LabelMultiSelect`
     option mapping). [lowest probability per static analysis]
   - `200 {"data":[]}` → **empty catalog** (Hypothesis 1). Confirm the board
     filter dropdown is also empty. Fix = UX only (Step FE-1, FE-2).
   - `4xx/5xx` or no request / network error → **masked fetch failure**
     (Hypothesis 2). Capture the status + body; the status determines the
     backend-side fix (e.g. membership, route, env). Fix = FE-1 (surface error)
     **plus** the backend fix keyed to the observed status.

Record the outcome in the PR description.

### Frontend Changes

**FE-1 — Surface the error state in `LabelMultiSelect`** *(the structural defect; always applied)*

- **File:** `frontend/src/components/LabelMultiSelect.tsx`
- **What:** Consume `isError`/`error` from `useLabels`; add a dedicated branch
  that renders a clear error message (e.g. "Couldn't load labels — retry") with a
  retry affordance (`refetch` from the hook), distinct from the genuine empty
  state. Keep the trigger disabled while `isLoading || isError`.
- **Why:** Today an error is indistinguishable from "no labels," which is exactly
  why this bug is hard to diagnose and presents as "always empty." Hardening here
  makes the real trigger visible and resolves the "no label can be added"
  symptom for the error case.
- **Code reference:** builds on the existing `const { data: labels = [], isLoading } =
  useLabels(projectSlug)` (`LabelMultiSelect.tsx:18`) and the existing empty
  branch (`:67`/`:79`).

**FE-2 — Accurate, actionable empty state** *(acceptance criterion: project with no labels)*

- **File:** `frontend/src/components/LabelMultiSelect.tsx`
- **What:** When `labels.length === 0 && !isError`, render an empty state that
  guides the user to create labels in Project Settings → Labels (e.g. a short
  hint + link/button to `/projects/<slug>/settings` for admins; a plain hint for
  members), instead of the bare "No labels defined."
- **Why:** Satisfies the acceptance criterion "empty state is accurate and guides
  the user." Keeps SLYK-14's form-field label primitive untouched (this changes
  the dropdown body content only, not the field caption).
- **Code reference:** replaces the existing `labels.length === 0` branch.

**FE-3 — Verify project-switch correctness** *(acceptance criterion: switching projects)*

- **File:** none (verification only).
- **What:** Confirm `labelKeys.forProject(slug)` is keyed by slug (it is,
  `queryKeys.ts:23-28`) so switching projects fetches the new project's labels.
  If Step 0 surfaces any slug-related drift, address there; otherwise no code.
- **Why:** Closes the "Switching projects shows that project's labels" acceptance
  criterion. No expected code change — cache analysis (`useLabelMutations.ts:17`
  + `useLabels.ts`) already shows correct per-slug keying.

**FE-4 — Verify post-create modal refresh** *(acceptance criterion: labels created in Project Settings appear without reload)*

- **File:** none (verification only) unless Step 0 finds a gap.
- **What:** Create a label in Project Settings → Labels, then immediately open the
  ticket modal for the same project; the new label must appear (invalidation at
  `useLabelMutations.ts:17` targets the exact key). If it does not, the trigger-
  specific fix goes in `useLabelMutations.ts`/`useLabels.ts` — but cache analysis
  found no gap, so no change is expected.

### Backend Changes

**BE-1 — Only if Step 0 diagnoses a backend status**

- **File:** the layer corresponding to the observed error status (most likely none).
- **What:** If the Network tab shows a backend 4xx/5xx for `GET /:slug/labels`,
  fix the responsible layer (e.g. membership gate, route registration, service
  query). If Step 0 shows `200 {"data":[]}` or a populated `200`, **no backend
  change** — the backend is statically confirmed correct (project-scoped join at
  `labelService.ts:39-41`, correct create binding at `labelService.ts:59`).
- **Why:** Avoid changing a backend that all four isolated investigations
  exonerated; defer to runtime evidence.

> **SLYK-14 boundary:** the separate "duplicate Labels caption" rendering bug is
> owned by SLYK-14. This plan must NOT touch the shared form-field label/caption
> primitive — only the `LabelMultiSelect` dropdown body and error/empty states.

## Edge Cases & Risks

- **Masked-error regression:** if FE-1 is skipped, any future fetch failure will
  again look like "empty labels." FE-1 is the durable part of this fix regardless
  of the runtime trigger.
- **RBAC:** members can read labels (`requireProjectMember`) but only admins can
  create (`requireProjectAdmin` on POST). FE-2's "create labels" affordance must
  be role-aware (hide/disable for non-admins) to avoid a dead action.
- **Empty-state vs loading vs error race:** ensure the new branches are mutually
  exclusive (`isLoading` → skeleton/spinner; `isError` → error+retry; empty →
  guidance; else list).
- **Cross-project stale read:** not present (slug-keyed cache), but verify during
  FE-3 so a future refactor doesn't introduce it.
- **Scope creep into SLYK-14:** the form-field caption primitive is out of scope;
  any caption duplication is SLYK-14's to fix.
- **Migration concerns:** none — no schema change; only one labels migration
  exists (`0000`), table and unique index already match `schema.ts`.

## Testing

*Vitest + Testing Library on the frontend; table-driven, one behavior per test,
co-located `*.test.tsx`.*

- **Unit tests (`LabelMultiSelect.test.tsx`):**
  - renders list of labels when `useLabels` resolves with rows;
  - renders actionable empty state (and **not** "No labels defined" as the only
    message) when resolved `[]`;
  - renders the **error** branch (distinct from empty) and offers retry when
    `useLabels` is in error — the regression guard for this ticket;
  - trigger is disabled while `isLoading` and while `isError`;
  - role-aware: members do not see an admin-only "create labels" affordance.
- **Hook tests (`useLabels.test.ts` / via existing harness):** confirm query key
  is `['labels','project', <slug>]` and that different slugs produce independent
  cache entries (guards the project-switch acceptance criterion).
- **Integration (critical flows only):** after a label is created via
  `useCreateLabel`, the next `useLabels(slug)` read reflects it (invalidation at
  `useLabelMutations.ts:17`). Stub the data-access layer per project rules; do not
  hit a live DB in unit tests.
- **Manual verification:** run the ticket's reproduce steps — open the modal for a
  project with labels (field lists them, add/remove works), for a project without
  labels (accurate empty state), switch projects (correct labels), and create a
  label in Project Settings → Labels then reopen the modal (appears without
  reload). Confirm against the Step-0 Network-tab finding.

## Acceptance Criteria

- [ ] Step 0 runtime diagnosis performed; the observed `GET
      /api/projects/:slug/labels` response (status + body) is recorded in the PR.
- [ ] For a project that has labels, the ticket modal Labels field lists all of
      them and allows add/remove.
- [ ] For a project with no labels, the empty state is accurate and guides the
      user (e.g. to create labels in Project Settings), distinct from an error
      state.
- [ ] A failed labels fetch is shown as an error (with retry), NOT silently as
      "No labels defined" (the durable structural fix — FE-1).
- [ ] Switching projects shows that project's labels in the modal.
- [ ] Labels created in Project Settings → Labels appear in the ticket modal for
      the same project without a reload.
- [ ] SLYK-14's form-field caption primitive is untouched.

## Open Questions

- What does Step 0's Network-tab inspection actually show? The concrete trigger
  (empty catalog vs. masked fetch error vs. env drift) determines whether a
  backend change (BE-1) is needed at all. Default assumption: empty catalog or a
  masked client-side error, given all four static investigations exonerated the
  backend.
- Should non-admin members get a read-only hint vs. a disabled "create labels"
  affordance in the empty state? (Product/UX call — default: hint only for
  members, affordance for admins.)

## Out of Scope

- The duplicate "Labels" caption rendering bug (owned by **SLYK-14**).
- Any change to the shared form-field label/caption primitive.
- Schema/migration changes (none needed).
- New label capabilities (colors, ordering, etc.) beyond making the existing
  list work.
