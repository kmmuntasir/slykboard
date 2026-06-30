# Task Breakdown — SLYK-08 (Labels Field Empty in Ticket Modal)

**Source plan:** `docs/deliverables/SLYK-08-plan.md`
**Ticket:** `docs/deliverables/SLYK-08.md`
**Generated:** 2026-06-30

> Breakdown produced from the plan plus three isolated `analyst` investigations of
> the label-fetch path (frontend modal → `LabelMultiSelect` → `useLabels` →
> `listLabels` → `GET /api/projects/:slug/labels` → `labelService` → Drizzle) and
> three batch-drafting investigations. All file/line references were verified
> against current source.

---

## Verified Context (informs every task)

- **Root defect (confirmed in source):** `frontend/src/components/LabelMultiSelect.tsx:18`
  destructures only `const { data: labels = [], isLoading } = useLabels(projectSlug);`
  — it discards `isError` / `error` / `refetch`. Its single empty branch
  (`LabelMultiSelect.tsx:66-68`, inner text on `:67` — `"No labels defined"`)
  fires for **both** "project has no labels" and "fetch failed," making the two
  states visually identical. *(Note: the plan cited the empty branch at `:67`/`:79`
  — `:79` is stale; the actual branch is at `:66-68`.)*
- **Hook needs no change:** `frontend/src/hooks/useLabels.ts` returns the **full**
  `UseQueryResult`, so `isError` / `refetch` are already available to the consumer.
- **Reusable primitives exist (do NOT hand-roll):**
  - `frontend/src/components/Retry.tsx` — `role="alert"`, props `message?`,
    `onRetry: () => void`. Canonical usage in `TicketDetailModal.tsx:100-105`:
    `<Retry message="…" onRetry={() => void refetch()} />`. Used also by
    `RouteErrorBoundary.tsx:7`.
  - `frontend/src/components/EmptyState.tsx` — props `icon?`, `title` (req),
    `description?`, `action?: { label, onClick } | ReactNode`. Covered by
    `EmptyState.test.tsx`.
  - `frontend/src/components/Skeleton.tsx` — `Skeleton`, `SkeletonLine`,
    `SkeletonBlock`, `SkeletonCard` (composed in `TicketModalSkeleton.tsx`,
    `BoardSkeleton.tsx`).
- **Role gate:** `useCurrentProjectMembership(slug).isProjectAdmin`
  (`hooks/useProjectMembers.ts:82-99`) + `useRequirePlatformAdmin()`
  (`hooks/useRequirePlatformAdmin.ts`). Combine as
  `const canManage = isPlatformAdmin || isProjectAdmin;` — established pattern at
  `ProjectSettingsPage.tsx:57-58, 87, 128, 158-161`. Project admin member type:
  `MemberRole = 'PROJECT_ADMIN' | 'MEMBER'` (`types/member.ts:7`).
- **Cache/invalidation is correct (FE-3/FE-4 are verify-only):**
  `labelKeys.forProject(slug)` = `['labels','project', slug]`
  (`api/queryKeys.ts:22-27`); `useCreateLabel(projectSlug).onSettled` invalidates
  that exact key (`useLabelMutations.ts:17`, cited `~:22`).
- **Slug plumbing is correct end-to-end:** `CreateTicketModal.tsx:40` and
  `TicketDetailModal.tsx:172` both pass `projectSlug={slug}` into the shared
  `TicketAttributeForm`, which renders `<LabelMultiSelect projectSlug={projectSlug} …/>`
  (`TicketAttributeForm.tsx:156-159`). Not a wrong-slug/empty-prop bug.
- **Backend statically exonerated:** `labelService.listLabels` is project-scoped
  via `projects.slug` join (`labelService.ts:25-33` — plan's `:39-41` cite is stale;
  code is correct). `createLabel` binds `projectId: project[0].id`
  (`labelService.ts:55` inside `.values({...})` at `:52` — plan's `:59` cite is off
  by ~4 lines; code is correct). `requireProjectMember` admits Members for the GET.
  → **BE-1 only applies if Step 0 finds a live backend 4xx/5xx.**
- **Test harness seams exist:**
  - `LabelMultiSelect.test.tsx` mocks `useLabels` via
    `mockUseLabels(overrides: Partial<UseQueryResult<Label[]>>)` — add `isError`
    + `refetch: vi.fn()` here to drive error/loading/empty cases.
  - `useLabels.test.ts` has the canonical `newQueryClient()` / `createWrapper()`
    fixture (`:39-50`, `retry:false, gcTime:0`) — copy verbatim into any
    query-backed test; each test file re-declares it locally (no shared helper).
- **SLYK-14 boundary:** the duplicate "Labels" caption / form-field label primitive
  is owned by SLYK-14. **Do not touch** the `<span …>Labels</span>` field caption.
  `LabelMultiSelect` changes only its dropdown **body** + error/empty states.
- **Shared type:** `frontend/src/types/label.ts:3-6` — `interface Label { id; name; color }`.
- **Out-of-scope smell (flag, don't fix):** `BoardFilters.tsx:57-60` duplicates the
  labels query inline instead of reusing `useLabels(slug)` — same key, no functional
  bug, but a divergence. Tracked as NOTE-1, not implemented in SLYK-08.

---

## Parallelization Strategy

### Batches & merge-order rules

- **Batch 1 — Foundation (parallel, zero-conflict).** Step 0 runtime diagnosis
  (no code) + two pure-add test/groundwork tasks on independent files. All run in
  parallel; none block each other. **Must merge before Batch 2** (FE-1/FE-2 branch
  selection depends on Step 0's outcome, and the staged error-test scaffold feeds
  the FE-1 implementation).
- **Batch 2 — Implementation (sequential within file, parallel otherwise).** FE-1 + FE-2
  are merged into **one task** (B2-1) because they edit the same component's
  mutually-exclusive branches; the test update (B2-2) follows it (same component).
  BE-1 (B2-3) is **conditional** — only activates if Step 0 diagnoses a backend
  status, and is otherwise parallelizable with the FE work.
- **Batch 3 — Verification (parallel, read-only).** FE-3 (project-switch) and FE-4
  (post-create refresh) run in parallel; both verify-only, no code expected.
  **Must merge after Batch 2.**
- **Batch 4 — Acceptance gate.** Single consolidated pass against the ticket's AC.
  Runs after Batch 3.
- **NOTE-1** is a follow-up flag — independent of everything; record only.

### Visual batch diagram

```
   ┌─────────────────────────── BATCH 1 (parallel, foundation) ───────────────────────────┐
   │  B1-1  Step 0 runtime diagnosis (no code)                                              │
   │  B1-2  per-slug query-key independence test (useLabels.test.ts)                        │
   │  B1-3  stage FE-1 error-state regression tests, skipped (LabelMultiSelect.test.tsx)    │
   └────────────────────────────────────┬──────────────────────────────────────────────────┘
                                        │ (Step-0 outcome selects the fix branch)
                                        ▼
   ┌─────────────────────────── BATCH 2 (implementation) ──────────────────────────────────┐
   │  B2-1  FE-1 + FE-2: surface error branch + actionable empty state (LabelMultiSelect)   │
   │        └► B2-2  extend LabelMultiSelect.test.tsx (same component → sequential)         │
   │                                                                                         │
   │  B2-3  BE-1 backend fix  ── CONDITIONAL, only if B1-1 finds a backend 4xx/5xx ──       │
   │        (parallel with FE work when active; usually N/A)                                 │
   └────────────────────────────────────┬──────────────────────────────────────────────────┘
                                        │
                ┌───────────────────────┴───────────────────────┐
                ▼                                               ▼
   ┌──── BATCH 3 (verify-only, parallel) ────┐     ┌────────────────────────────┐
   │  B3-1 (FE-3) verify project-switch      │     │  B3-2 (FE-4) verify         │
   │           correctness                    │     │           post-create refresh│
   └────────────────────┬─────────────────────┘     └─────────────┬──────────────┘
                        └──────────────┬───────────────────────────┘
                                       ▼
                       ┌──── BATCH 4 (acceptance gate) ────┐
                       │  B4-1  consolidated AC / verify pass │
                       └─────────────────────────────────────┘

   NOTE-1  flag BoardFilters inline query — independent, any time (do NOT fix)
```

### Summary table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| B1-1 | 1 | — (manual diagnosis) | None | B1-2, B1-3 |
| B1-2 | 1 | `frontend/src/hooks/useLabels.test.ts` | None | B1-1, B1-3 |
| B1-3 | 1 | `frontend/src/components/LabelMultiSelect.test.tsx` | None | B1-1, B1-2 |
| B2-1 | 2 | `frontend/src/components/LabelMultiSelect.tsx` | B1-1 (outcome), B1-3 (scaffold) | B2-3 (if active) |
| B2-2 | 2 | `frontend/src/components/LabelMultiSelect.test.tsx` | B2-1 | B2-3 (if active) |
| B2-3 | 2 | `backend/src/{routes,services,middleware}/…` *(conditional)* | B1-1 (only if backend status) | B2-1, B2-2 |
| B3-1 | 3 | — (verify-only) | B2-1, B2-2 | B3-2 |
| B3-2 | 3 | — (verify-only) | B2-1, B2-2 | B3-1 |
| B4-1 | 4 | — (manual + test suite) | B3-1, B3-2, B1-1 | NOTE-1 |
| NOTE-1 | n/a | `frontend/src/components/BoardFilters.tsx` (reference only) | None | all |

### Suggested developer tracks

- **Track A — Frontend fix:** B1-1 → B2-1 → B2-2 → B3-1/B3-2 → B4-1
- **Track B — Test groundwork (parallel to A):** B1-2 + B1-3 (merge into A before B2-1)
- **Track C — Backend (conditional):** B1-1 → (only if backend status) B2-3 → B4-1

---

# BATCH 1 — Foundation (parallel, zero-conflict)

## B1-1 — Step 0: Runtime diagnosis of `GET /api/projects/:slug/labels`

**Description.** The ticket **mandates** runtime diagnosis before any code change
(plan §"Step 0"). Do **not** edit any source. For a project known to have labels
*and* one known to have none:

1. Open the board for that project; open DevTools → Network; filter `labels`.
2. Open the ticket modal (create **and** detail). Inspect the response to
   `GET /api/projects/<slug>/labels`.
3. Cross-check the board's "Filter by label" dropdown (`BoardFilters.tsx:57-60`,
   same `labelKeys.forProject(slug)` key): if it's also empty while the DB has
   rows → rendering-side; if the filter is populated but the modal is empty →
   modal-local defect.
4. Create a label in Project Settings → Labels and reopen the modal
   (invalidation at `useLabelMutations.ts:17`); note whether it appears without reload.
5. Classify the outcome per the plan's ranked hypotheses:
   - `200 {"data":[...]}` rows but field empty → modal-local rendering defect (lowest probability).
   - `200 {"data":[]}` → empty catalog (UX-only fix).
   - `4xx/5xx` or network error → masked fetch failure (capture status + body) → BE-1 activates.

**Deliverable:** a short findings note (PR description, or
`docs/deliverables/SLYK-08-step0.md` scratch) recording the observed status + body,
the filter-dropdown cross-check, the post-create modal-refresh behavior, and which
plan branch (FE-1 only / FE-1+FE-2 / FE-1+BE-1) the evidence selects.

**Acceptance Criteria**
- [ ] Network-tab capture of `GET /api/projects/:slug/labels` recorded (status + body shape; mask identifiers).
- [ ] Filter-by-label dropdown state cross-checked and noted.
- [ ] Post-create modal-refresh behavior noted (appears-without-reload: yes/no).
- [ ] Outcome classified into exactly one plan branch; dependent follow-up task(s) named.
- [ ] No source files modified.

**Dependencies:** None. Unblocks B2-1's branch selection and (conditionally) B2-3.

---

## B1-2 — Add per-slug query-key independence test (FE-3/FE-4 green guard)

**Description.** Pure-add test that locks the "switching projects shows that
project's labels" acceptance criterion **before** any code change, using the
existing `useLabels.test.ts` harness (`newQueryClient`/`createWrapper`, `:39-50`).
Cache analysis says `labelKeys.forProject(slug)` = `['labels','project',slug]`
(`queryKeys.ts:22-27`) and create-invalidates-modal-key (`useLabelMutations.ts:17`)
are already correct, so this test passes today and guards against regression.
Table-driven per AGENTS.md testing rules.
- Assert the query key equals `['labels','project', <slug>]` for a given slug.
- Assert two different slugs produce independent cache entries (prime `slugA`,
  mount `useLabels(slugB)`, assert `slugB` does not read `slugA`'s data without fetching).

**Acceptance Criteria**
- [ ] Tests added to `frontend/src/hooks/useLabels.test.ts` (no new test file).
- [ ] All assertions pass against current code (`npm test -- useLabels.test`).
- [ ] No production source touched; no live DB (stub the api client per project rules).
- [ ] One behavior per `it`; table-driven for the multi-slug case.

**Dependencies:** None.

---

## B1-3 — Pre-stage the FE-1 error-state regression tests (skipped scaffold)

**Description.** Pure-add test groundwork in `frontend/src/components/LabelMultiSelect.test.tsx`
that pre-writes the **regression guard for this ticket's structural defect** (FE-1:
error masked as "No labels defined"), so B2-1 can flip the cases to passing without
writing scaffolding. Use the existing `mockUseLabels(overrides)` seam and add a
`mockUseLabelsError` factory. Commit the cases as `it.skip`/`it.todo` with full
assertion intent in the title, so the suite stays green today (the error branch
does not exist yet). Cases to stage:
- when `useLabels` returns `isError: true` (+ `refetch` spy), popover shows a
  distinct error message, **not** "No labels defined";
- error branch exposes a retry affordance wired to `refetch`;
- trigger `disabled` while `isLoading` (already green) **and** while `isError` (new, staged skipped).

**Acceptance Criteria**
- [ ] No production source touched.
- [ ] Suite stays green (`npm test -- LabelMultiSelect.test`): staged error cases
      are `it.skip`/`it.todo`, not failing `it`.
- [ ] Each staged case has a clear imperative title and inlined/documented assertions,
      ready to flip to `it` in B2-1.
- [ ] A `mockUseLabelsError` factory added alongside `mockUseLabels` for B2-2 reuse.

**Dependencies:** None. (B2-1 will consume these staged cases.)

---

# BATCH 2 — Implementation

## B2-1 — Surface error state + actionable empty state in `LabelMultiSelect` (FE-1 + FE-2)

> FE-1 and FE-2 are merged into one task: they edit the same component's
> mutually-exclusive branches, so splitting them would create merge churn.

**Files:** `frontend/src/components/LabelMultiSelect.tsx` (primary).

**Description.**
- **Destructure (FE-1):** change `LabelMultiSelect.tsx:18` to
  `const { data: labels = [], isLoading, isError, refetch } = useLabels(projectSlug);`
  (add `isError` + `refetch`; keep `data`/`isLoading`).
- **Trigger button:** set `disabled={isLoading || isError}` (currently disabled only on `isLoading`).
- **Make the popover body branches mutually exclusive** in this precedence:
  1. `isLoading` → keep/extend the skeleton/disabled body (no list yet).
  2. `isError` → `<Retry message="Couldn't load labels" onRetry={() => void refetch()} />`
     (mirror `TicketDetailModal.tsx:100-105`; note the `void refetch()` cast idiom).
  3. `labels.length === 0 && !isError` → `<EmptyState>` with role-aware content:
     - **admins** (`canManage = isPlatformAdmin || isProjectAdmin`, sourced from
       `useRequirePlatformAdmin()` + `useCurrentProjectMembership(projectSlug)` per
       `ProjectSettingsPage.tsx:57-58, 87`): `title` + `description` +
       `action={{ label: 'Create labels', onClick: () => navigate(`/projects/${projectSlug}/settings`) }}`
       (use `useNavigate` from `react-router`).
     - **members:** `title` + plain `description` hint only, **no** action.
  4. else → existing labels list (`labels.map(...)`).
- **Replace** the bare `No labels defined` block at `:66-68`.
- **MUST NOT** touch the SLYK-14 form-field caption primitive (the
  `<span …>Labels</span>` field label at `:35` stays as-is; this task changes
  only the dropdown **body** + error/empty states).

**Acceptance Criteria**
- [ ] `isError` and `refetch` consumed from `useLabels`; `data`/`isLoading` retained.
- [ ] A failed fetch renders `<Retry>` with message "Couldn't load labels" and a working retry, distinct from the empty state.
- [ ] Trigger `disabled` while `isLoading` **and** while `isError`.
- [ ] Genuine empty (`labels.length === 0 && !isError`) renders `<EmptyState>` — not "No labels defined".
- [ ] Admins see a "Create labels" CTA navigating to `/projects/<slug>/settings`; members see a hint-only empty state (no CTA).
- [ ] Branches are mutually exclusive (load / error / empty / list).
- [ ] No edits to the shared form-field caption/label primitive (SLYK-14 boundary preserved).
- [ ] `tsc` clean; no `any`.

**Dependencies:** B1-1 (Step-0 outcome confirms whether the error branch is live or only a hardening guard), B1-3 (staged error-test scaffold).

---

## B2-2 — Extend `LabelMultiSelect.test.tsx` for error/empty/role branches

**Files:** `frontend/src/components/LabelMultiSelect.test.tsx`.

**Description.** Extend the existing table-driven harness. Expose `isError` +
`refetch: vi.fn()` on the mock partial shape (reuse the `mockUseLabelsError`
factory from B1-3). Cover, one behavior per `it`:
- **Success list** — rows render when resolved with data (preserve existing).
- **Actionable empty** — `data: []`, `isError:false` → `<EmptyState>` renders; assert `"No labels defined"` is **not** present.
- **Error branch** — `isError:true` → `<Retry>` renders with "Couldn't load labels"; clicking Retry calls `refetch` (assert the spy fired once).
- **Trigger disabled** — in both `isLoading:true` (existing) and `isError:true` (new).
- **Role-aware empty** — mock `useRequirePlatformAdmin`/`useCurrentProjectMembership`:
  - admin (`isPlatformAdmin || isProjectAdmin`) → "Create labels" CTA present and navigates on click.
  - member (both false) → no "Create labels" CTA; hint text present.
- Flip the B1-3 `it.skip`/`it.todo` cases to live `it` now that B2-1 lands the branches.

**Acceptance Criteria**
- [ ] Mock helper exposes `isError` and `refetch: vi.fn()`.
- [ ] Test: success list renders rows.
- [ ] Test: empty `data:[]` renders actionable `EmptyState`, not "No labels defined".
- [ ] Test: `isError:true` renders `Retry`; Retry click invokes `refetch`.
- [ ] Test: trigger disabled in both `isLoading:true` and `isError:true`.
- [ ] Test: admin sees CTA; member does not.
- [ ] `npm test -- LabelMultiSelect` passes; no live DB/network in unit tests.

**Dependencies:** B2-1 (tests assert B2-1's new branches); B1-3 (reuse `mockUseLabelsError`).

---

## B2-3 — BE-1 backend fix (CONDITIONAL — only if Step 0 finds a backend status)

> If B1-1 records `200 {"data":[]}` or a populated `200`, **skip this task
> entirely** and mark it **N/A** with a one-line justification. Only activate if
> the Network tab shows a backend 4xx/5xx on `GET /api/projects/:slug/labels`.

**Files (candidate, only if activated):**
- `backend/src/routes/labels.routes.ts` (route registration / membership gate)
- `backend/src/services/labelService.ts` (`listLabels` query — note plan's `:39-41`
  cite is stale; actual `:25-33`)
- `backend/src/middleware/requireProjectMember.ts` (`:63-65`)

**Description.** The backend is statically exonerated (project-scoped join at
`labelService.ts:25-33`, correct create binding at `:55`, Member-admitting gate at
`requireProjectMember.ts:63-65`). Only if a backend 4xx/5xx is observed, fix the
layer responsible for that status (e.g. membership gate, route registration, or
service query), add/extend the matching service test, and record the status → fix
mapping in the PR. No schema/migration change (none needed).

**Acceptance Criteria (only if activated)**
- [ ] B1-1 recorded a concrete backend 4xx/5xx status + body in the PR.
- [ ] Fix targets the layer responsible for that status (cite `path:line`).
- [ ] Reproduces green post-fix: `GET /:slug/labels` returns `200` for a valid project member.
- [ ] No schema/migration change.
- [ ] If B1-1 shows `200`, this task is marked **N/A** with a one-line justification.

**Dependencies:** B1-1 (Step 0 diagnosis — sole trigger). Independent of B2-1/B2-2 otherwise.

---

# BATCH 3 — Verification (parallel, read-only)

## B3-1 — FE-3: Verify project-switch correctness

**Target file:** none (reads `frontend/src/api/queryKeys.ts:22-27`, `frontend/src/hooks/useLabels.ts`).

**Procedure:**
1. Confirm `labelKeys.forProject(slug)` returns `['labels','project', slug]`
   (`queryKeys.ts:22-27`) — slug is a key segment → two projects occupy independent cache entries.
2. Manual: open board for project A (modal lists A's labels), switch to project B
   (modal re-fetches via `useLabels(projectSlug)` and lists B's labels) — no reload, no stale A labels.
3. Confirm `useLabels` passes the slug straight through to the key (no module-level shared cache).

**Acceptance Criteria**
- [ ] `labelKeys.forProject` confirmed slug-keyed.
- [ ] Manual project-switch shows correct per-project labels with no reload.
- [ ] No code change made (escalate only if a non-slug key / stale cross-project data is observed).

**Dependencies:** B2-1, B2-2 merged; B1-1 recorded. Can parallel with B3-2.

---

## B3-2 — FE-4: Verify post-create modal refresh

**Target file:** none (reads `frontend/src/hooks/useLabelMutations.ts:17`).

**Procedure:**
1. Confirm `useCreateLabel(projectSlug).onSettled` invalidates
   `labelKeys.forProject(projectSlug)` (`useLabelMutations.ts:17`) — the exact key `LabelMultiSelect` reads.
2. Manual: create a label in Project Settings → Labels for project X, then
   immediately open the ticket modal for X → the new label appears in the popover without a page reload.

**Acceptance Criteria**
- [ ] Invalidation confirmed to target the exact modal key.
- [ ] Manual post-create shows the new label in the modal without reload.
- [ ] No code change made (escalate only if the new label fails to appear post-create).

**Dependencies:** B2-1, B2-2 merged. Can parallel with B3-1.

---

# BATCH 4 — Acceptance gate

## B4-1 — Consolidated acceptance / verification pass

**Target file:** none (manual + the `LabelMultiSelect.test.tsx` regression suite from B2-2).

**Consolidates the ticket's Acceptance Criteria:**
1. **Has-labels project:** modal Labels field lists all of them; add/remove works (toggles persist into `value`).
2. **No-labels project:** accurate, actionable empty state (guides to Project Settings → Labels), visually/textually **distinct** from the error state.
3. **Failed fetch:** rendered as error + retry, **not** the bare "No labels defined" — the durable FE-1 regression guard (covered by the B2-2 error-branch unit test).
4. **Project switch:** correct per-project labels (closes B3-1/FE-3).
5. **Post-create:** label appears in the modal without reload (closes B3-2/FE-4).
6. **SLYK-14 boundary:** the shared form-field caption primitive is **untouched** — `LabelMultiSelect` only changed its dropdown body + empty/error branches; `git diff` must contain no edits to the caption/label-primitive files.
7. **Step 0 recorded:** the observed `GET /api/projects/:slug/labels` status + body is in the PR description (from B1-1).

**Acceptance Criteria**
- [ ] All seven items above ticked.
- [ ] Full `LabelMultiSelect.test.tsx` + `useLabels.test.ts` suites pass.
- [ ] Ticket closeable.

**Dependencies:** B3-1, B3-2, B2-1, B2-2, B1-1.

---

# NOTE-1 — Out-of-scope follow-up flag (do NOT fix in SLYK-08)

**Finding:** `frontend/src/components/BoardFilters.tsx:57-60` duplicates the labels
query **inline** instead of reusing `useLabels(slug)`:
```ts
const { data: labels = [] } = useQuery<Label[]>({
    queryKey: labelKeys.forProject(slug),
    queryFn: () => listLabels(slug),
});
```
- **Functionally fine:** same key (`labelKeys.forProject(slug)`) → same cache entry → no duplicate fetch, no stale-read risk.
- **Smell:** diverges from the `useLabels` hook abstraction; any future hook-level change (e.g. `enabled`, error surfacing, `staleTime`) won't propagate here, and it also drops `isError`/`refetch` (a parallel latent gap to SLYK-08's).

**Action:** record as a follow-up ticket; note in the PR's "Out of scope" section. **Do not implement in SLYK-08.**

**Dependencies:** None (independent; record any time).
