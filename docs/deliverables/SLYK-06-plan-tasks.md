# Task Breakdown — SLYK-06

**Ticket:** `docs/deliverables/SLYK-06.md` (Bug)
**Title:** Theme Contrast Fixes (inactive nav, project-picker icon, ticket card)
**Plan:** `docs/deliverables/SLYK-06-plan.md`
**Generated:** 2026-06-30

> Frontend-only Tailwind theme-contrast fix. Root cause: a **surface token** (`text-muted` → `--muted`, gray-100/gray-800) is misused as a text color across nav/picker/error states, and the ticket card's `bg-card` is indistinguishable from the page background (light: `--card === --background`, both white). Fix = swap every bare `text-muted` → `text-muted-foreground` (the canonical deemphasized-text token, ~55 usages already), and give `TicketCard` a distinct surface via `border-border` + elevation ring (keeps the global `--card` token intact — no ripple risk).

## Codebase Analysis Summary (Phase 1, via `analyst` delegations)

- **Every plan citation verified exact.** All 11 in-scope files exist; all cited line numbers contain the cited className tokens.
- **Complete defect inventory:** exactly **15** bare `text-muted` occurrences across **10 files** (no unlisted offenders), plus **1** `bg-card` surface site (`TicketCard.tsx:32`). Out-of-scope `bg-card` consumers (`ui/Card.tsx`, `RichTextEditor.tsx`, `TicketModalSkeleton.tsx`, `LabelMultiSelect.tsx`, popovers) are confirmed correct for their contexts and explicitly excluded.
- **Token definitions verified** (`frontend/src/index.css`): `--muted` (surface) ≠ `--muted-foreground` (text) in both `:root` (L25/L26) and `.dark` (L78/L79); `@theme inline` exposes both (L111-112). No token-def edit needed — fix is at the utility-class layer.
- **`cn()` utility** at `@/components/ui/cn` (`twMerge(clsx(...))`); swap survives `twMerge` untouched since `text-muted` is a literal class segment.
- **Existing tests** (`TopNav.test.tsx`, `ProjectPicker.test.tsx`, `TicketCard.test.tsx`, `tokens.test.ts`) exist and are substantial, but **none currently assert** the `text-muted`/`text-muted-foreground` classNames or the `TicketCard` `bg-card` surface — so the swap is low-risk for existing assertions, and guard tests are net-new.
- **`frontend/package.json` has no `lint` script** (scripts: `dev`, `build`, `typecheck`, `test`, `test:watch`, `preview`). Type-safety is enforced by `npm run build` (`tsc -b && vite build`) and `npm run typecheck` (`tsc --noEmit`). The verification gate uses these instead of `npm run lint`.
- Minor cosmetic offset (immaterial to the fix): plan cited Board/Reports NavLink at `:225` and Project Settings at `:258`; actual lines are `:228` and `:255`. The fix is in the shared `navLinkClass` builder at L207, so these offsets don't matter.

---

## Parallelization Strategy

Three batches by dependency order. All tasks within a batch touch **disjoint files** and run in parallel with zero merge conflicts.

- **Batch 1 (implement, parallel ×4):** the four implementation tasks touch disjoint files → fully parallel.
- **Batch 2 (test, parallel ×2):** test tasks depend on Batch 1's className changes being in place; T5 and T6 touch different test files → parallel with each other.
- **Batch 3 (verify, solo):** terminal gate; runs only after all of T1–T6 land.
- **Merge-order rules:** all of Batch 1 must merge before Batch 2 starts; all of Batch 2 must merge before Batch 3 (T7) runs. Repo uses **rebase-and-merge** (no squash, no merge commits) per AGENTS.md.

### Visual Batch Dependency Diagram

```
                         SLYK-06  (docs/deliverables/SLYK-06-plan.md)
                                        │
   ┌────────────────────────────────────┴─────────────────────────────────────┐
   │                              BATCH 1  (implement)                         │
   │                         — all 4 touch disjoint files —                    │
   │                                                                           │
   │   T1 TopNav.tsx        T2 ProjectPicker.tsx      T3 TicketCard.tsx        │
   │   text-muted →          text-muted →             bg-card surface fix      │
   │   text-muted-foreground text-muted-foreground    (border-border + ring,   │
   │   (navLinkClass :207)   (:76,89,90,97,           keeps bg-card; :32)      │
   │                          119,159)                                       │
   │                                                                           │
   │              T4 Secondary-offenders sweep (8 files, same swap)            │
   │              Loading · Retry · ErrorFallback · TicketNotFound ·           │
   │              TicketDetailModal · NotFoundPage · ForbiddenPage ·           │
   │              ProjectsPage                                                 │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │  (merge barrier: all of T1–T4 done)
                                        ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                              BATCH 2  (test)                              │
   │                                                                          │
   │   T5 Component className assertions        T6 Regression grep test       │
   │   (TopNav / ProjectPicker / TicketCard      (loop swapped files;         │
   │    assert text-muted-foreground present,    assert no bare text-muted    │
   │    not text-muted; TicketCard new surface)  in in-scope set)             │
   └────────────────────────────────────┬─────────────────────────────────────┘
                                        │  (merge barrier: T5, T6 done)
                                        ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                          BATCH 3  (verify + gate)                        │
   │                                                                          │
   │   T7 Final Verification & Build Gate                                     │
   │   npm run build  ·  npm run typecheck  ·  npm test                       │
   │   grep: zero bare text-muted in 10 in-scope files                        │
   │   (npm run lint skipped — no lint script in frontend/package.json)       │
   └────────────────────────────────────┬─────────────────────────────────────┘
                                        ▼
                          PR → rebase-and-merge → develop
```

Legend: `→` hard dependency / merge barrier. Within each batch, sibling tasks are file-disjoint and run concurrently.

### Summary Table

| #   | Batch    | Target File(s)                                                                                                                          | Dependencies           | Can Parallel With                |
|-----|----------|-----------------------------------------------------------------------------------------------------------------------------------------|------------------------|----------------------------------|
| T1  | Batch 1  | `frontend/src/components/TopNav.tsx` (`:207`)                                                                                           | None                   | T2, T3, T4 (disjoint files)      |
| T2  | Batch 1  | `frontend/src/components/ProjectPicker.tsx` (`:76,89,90,97,119,159`)                                                                    | None                   | T1, T3, T4 (disjoint files)      |
| T3  | Batch 1  | `frontend/src/components/TicketCard.tsx` (`:32`)                                                                                        | None                   | T1, T2, T4 (disjoint files)      |
| T4  | Batch 1  | `Loading.tsx:6` · `Retry.tsx:9` · `ErrorFallback.tsx:10` · `TicketNotFound.tsx:17` · `TicketDetailModal.tsx:112` · `NotFoundPage.tsx:10` · `ForbiddenPage.tsx:10` · `ProjectsPage.tsx:123` | None | T1, T2, T3 (disjoint files) |
| T5  | Batch 2  | `TopNav.test.tsx` · `ProjectPicker.test.tsx` · `TicketCard.test.tsx` (co-located)                                                       | T1, T2, T3             | T6 (different test files)        |
| T6  | Batch 2  | new `frontend/src/tokens-usage.test.ts`                                                                                                 | T1, T2, T3, T4         | T5 (different test files)        |
| T7  | Batch 3  | none (gate only; reads whole `frontend/src`)                                                                                            | T1, T2, T3, T4, T5, T6 | nothing — terminal gate          |

### Suggested Developer Assignment Tracks

**2-developer split (fastest wall-clock; balanced ~3 tasks each):**

- **Dev A — Nav & Picker track:** T1 ‖ T2 (Batch 1) → T5 (Batch 2; needs T3 from Dev B → sync point) → T7 (Batch 3; owns green-build sign-off).
- **Dev B — Card & Sweep track:** T3 ‖ T4 (Batch 1) → T6 (Batch 2; guards the sweep) → review/support T7.

**Sync points:** Dev A's T5 depends on Dev B's T3 (TicketCard). Dev B's T6 depends on all of T1–T4. After Batch 1 merges, both Batch 2 tests are unblocked and independent of each other. T7 runs once T5+T6 land.

**Alternative — 1-develop serial (recommended for a single-theme-token bug):** T1 → T2 → T3 → T4 (or one combined commit since all are the same swap) → T5 + T6 → T7. ~1 short session; cleanest as a single PR under the repo's rebase-and-merge policy.

---

# Batch 1 — Implementation (parallel, no dependencies)

## T1 — Fix inactive nav text token in `TopNav.navLinkClass`

**Description**

`frontend/src/components/TopNav.tsx` builds all sidebar nav-link classNames via one shared `navLinkClass` builder. Its **inactive** branch paints the base color with the surface token `text-muted` instead of the canonical deemphasized-text token `text-muted-foreground`, making the Board / Reports / Project Settings items near-invisible (the token resolves to gray-100 light / gray-800 dark — a background color). The `hover:text-foreground` hover target is already correct and **must** be preserved.

- **File:** `frontend/src/components/TopNav.tsx:207`
- **Exact change (old → new):**
  - OLD: `'text-muted hover:text-foreground'`
  - NEW: `'text-muted-foreground hover:text-foreground'`
- Keep the active branch `'text-primary'` (same `cn(...)` return) untouched.
- The same `navLinkClass` is applied to Board/Reports (`TopNav.tsx:228`) and Project Settings (`TopNav.tsx:255`); **no per-call edits needed** — one fix covers all three items.
- Reference pattern already in this file: `TopNav.tsx:379` uses `text-muted-foreground ... hover:bg-accent hover:text-foreground`.
- Compose via `cn()` (`@/components/ui/cn`).

**Acceptance Criteria**
- [ ] `TopNav.tsx:207` inactive branch reads `text-muted-foreground hover:text-foreground` (base color swapped; hover target unchanged).
- [ ] Active branch still emits `text-primary`.
- [ ] No bare `text-muted` remains anywhere in `TopNav.tsx` (grep `/\btext-muted\b(?![-\w])/` returns 0 in this file).
- [ ] Board, Reports, and Project Settings NavLinks inherit the fix via `navLinkClass` (no per-call edits).

**Dependencies:** None

---

## T2 — Fix project-picker trigger icons / helper text in `ProjectPicker`

**Description**

`frontend/src/components/ProjectPicker.tsx` paints the FolderKanban trigger icon, the ChevronDown caret, the in-dropdown FolderKanban, and two helper-text lines with the surface token `text-muted`, so the selected-project icon vanishes in both modes. Swap all six in this file to `text-muted-foreground`. The trigger body text already uses `text-foreground` (`ProjectPicker.tsx:104-109`) — leave it as-is.

- **File:** `frontend/src/components/ProjectPicker.tsx` — six sites
- **Exact changes (each: `text-muted` → `text-muted-foreground`):**
  - **L76** — "Loading…" label: `"truncate text-muted"` → `"truncate text-muted-foreground"`
  - **L89** — FolderKanban trigger icon (listing branch): `className="h-4 w-4 shrink-0 text-muted"`
  - **L90** — "No projects yet" label: `"truncate text-muted"`
  - **L97** — FolderKanban trigger icon (selected branch)
  - **L119** — ChevronDown caret: `className="h-3.5 w-3.5 shrink-0 text-muted"`
  - **L159** — FolderKanban inside dropdown option row
- Compose via `cn()` (`@/components/ui/cn`). No new utilities needed. L141 ("No projects yet — create one") already correctly uses `text-muted-foreground` — leave it.

**Acceptance Criteria**
- [ ] All six sites listed above now use `text-muted-foreground`.
- [ ] No bare `text-muted` remains in `ProjectPicker.tsx` (grep returns 0).
- [ ] Trigger body text (`L104-109`) still uses `text-foreground` (untouched).
- [ ] L141 `text-muted-foreground` (already correct) untouched.

**Dependencies:** None

---

## T3 — Differentiate ticket card surface from board background

**Description**

`frontend/src/components/TicketCard.tsx:32` root uses `bg-card`, whose `--card` token equals `--background` in light mode (both pure white), so the card has zero fill separation from the page; in dark it sits on a near-identical translucent `bg-muted/40` column (`BoardColumn.tsx:24`). Per the plan's **recommended** option (keeps the global `--card` token intact — no ripple risk to `Card.tsx`, popovers, skeletons), add an explicit semantic border + a subtle elevation ring while keeping `bg-card`.

- **File:** `frontend/src/components/TicketCard.tsx:32`
- **Exact change (old → new):**
  - OLD: `'cursor-pointer space-y-2 rounded border bg-card p-2 text-sm shadow-sm'`
  - NEW: `'cursor-pointer space-y-2 rounded border border-border bg-card p-2 text-sm shadow-sm ring-1 ring-black/5 dark:ring-white/5'`
- Rationale: `border-border` replaces the default bare `border` color with the semantic border token; `ring-1 ring-black/5 dark:ring-white/5` provides a subtle elevation that reads clearly on white (light) and on the gray-800 translucent column (dark). Keeps `bg-card` and `shadow-sm`.
- **Do NOT touch** the global `--card` / `--background` tokens in `frontend/src/index.css` (out of scope — would regress every `Card`/popover/skeleton).
- Compose via `cn()` (`@/components/ui/cn`).

**Acceptance Criteria**
- [ ] `TicketCard.tsx:32` root className includes `border-border` and `ring-1 ring-black/5 dark:ring-white/5`, and still includes `bg-card`, `shadow-sm`.
- [ ] `frontend/src/index.css` token values unchanged (no `--card` / `--background` edits).
- [ ] Card visually distinct from the board/column background in both light and dark.
- [ ] No other `bg-card` consumer (`ui/Card.tsx`, `RichTextEditor.tsx`, `TicketModalSkeleton.tsx`, `LabelMultiSelect.tsx`, popovers) touched.

**Dependencies:** None

---

## T4 — Secondary offenders sweep (8 files, single-line swap each)

**Description**

Eight secondary surfaces reuse the same surface-token-as-text defect (`text-muted`) in loading/error/empty/not-found states. Each is a single-line, single-token swap to the canonical deemphasized-text token. No behavior change; identical edit per file (`text-muted` → `text-muted-foreground`).

- **Files & lines — exact change each (`text-muted` → `text-muted-foreground`):**
  - `frontend/src/components/Loading.tsx:6`
  - `frontend/src/components/Retry.tsx:9`
  - `frontend/src/components/ErrorFallback.tsx:10`
  - `frontend/src/components/TicketNotFound.tsx:17`
  - `frontend/src/components/TicketDetailModal.tsx:112`
  - `frontend/src/pages/NotFoundPage.tsx:10`
  - `frontend/src/pages/ForbiddenPage.tsx:10`
  - `frontend/src/pages/ProjectsPage.tsx:123`
- Compose via `cn()` where the line uses it (`@/components/ui/cn`); otherwise inline class-string swap.

**Acceptance Criteria**
- [ ] All eight listed sites now use `text-muted-foreground`.
- [ ] No bare `text-muted` remains in any of the eight files (grep `/\btext-muted\b(?![-\w])/` returns 0 across this set).
- [ ] No other tokens/classes touched in these eight lines.

**Dependencies:** None

---

# Batch 2 — Tests (parallel; depend on Batch 1)

## T5 — Add token/contrast className assertions to TopNav, ProjectPicker, and TicketCard tests

**Description**

Extend the three existing co-located test files with className-substring assertions proving Batch 1 swapped `text-muted` → `text-muted-foreground` and gave `TicketCard` a distinct surface. Follow the project selector hierarchy (`getByRole` > `getByLabelText` > `getByText` > `getByTestId` last resort) and assert via `.className` + `expect(...).toContain(substring)` — the established pattern in `TopNav.test.tsx` for its `text-destructive` / `max-w-5xl` checks.

Files to edit:
- `frontend/src/components/TopNav.test.tsx`
- `frontend/src/components/ProjectPicker.test.tsx`
- `frontend/src/components/TicketCard.test.tsx`

Add these table-driven / behavior tests:

1. **`TopNav.test.tsx`** — inactive NavLinks use `text-muted-foreground` (not bare `text-muted`); active uses `text-primary`.
   - Render via the existing `renderTopNavWithProject(...)` helper. For the **inactive** assertion, pick a NavLink whose target route is NOT the current route (e.g. Reports when rendered on `/projects/demo`). Query `getByRole('link', { name: 'Reports' })` and assert `className` `toContain('text-muted-foreground')` and **not** match `/\btext-muted\b(?![-\w])/` (the negative lookahead permits `text-muted-foreground`).
   - For the **active** assertion, render with `initialEntries={['/projects/<slug>/reports']}` so the Reports NavLink resolves active, then `expect(activeLink.className).toContain('text-primary')`.
   - Add a table-driven case looping `{ name: 'Board' }, { name: 'Reports' }, { name: 'Project Settings' }` (Project Settings only when admin+project renders it) asserting the inactive link className contains `text-muted-foreground` and does not contain the bare surface token.

2. **`ProjectPicker.test.tsx`** — trigger FolderKanban + ChevronDown icons contain `text-muted-foreground`.
   - Render the picker in **loaded** state (closed trigger is fine — icons render on the closed trigger). The trigger is `getByLabelText('Select project')`. Query the two icons inside it: `trigger.querySelector('svg.lucide-folder-kanban')` and `trigger.querySelector('svg.lucide-chevron-down')` (lucide icons carry `lucide-*` classes in this codebase). Assert each `.className` `toContain('text-muted-foreground')` and not match `/\btext-muted\b(?![-\w])/`.

3. **`TicketCard.test.tsx`** — root card className includes the new separation tokens.
   - Render via `renderInDnd(<TicketCard ... />)`. Select the clickable card root via `getByRole('button', { name: /<heading>/ })` (the card is the click surface emitting `onEdit`).
   - Assert the card root `className`:
     - `toContain('border-border')` (semantic border, per T3 recommended option), **AND**
     - `toContain('ring-')` (the elevation ring), **AND**
     - still `toContain('bg-card')` (T3 keeps `bg-card`).
   - **Tolerance note:** if T3 ships the `bg-popover` alternative instead, assert `toContain('bg-popover')`. Coordinate with T3 — assert the plan's **separation intent** (distinct from plain `bg-card` alone) rather than coupling to an undecided detail.

**Acceptance Criteria**
- [ ] `TopNav.test.tsx` asserts inactive NavLink `className` `toContain('text-muted-foreground')` for Board/Reports (and Project Settings when shown) and active NavLink `toContain('text-primary')`.
- [ ] `TopNav.test.tsx` asserts no bare `text-muted` (regex `/\btext-muted\b(?![-\w])/`) remains on the NavLinks.
- [ ] `ProjectPicker.test.tsx` asserts the trigger FolderKanban and ChevronDown icons `className` `toContain('text-muted-foreground')`.
- [ ] `TicketCard.test.tsx` asserts the card root `className` includes the new separation (`border-border` + `ring-`, or `bg-popover`) distinct from plain `bg-card`.
- [ ] All assertions use `.className` + `toContain` / regex; selectors follow getByRole > getByLabelText > getByText > getByTestId.
- [ ] `rtk vitest` passes for the three files (no new failures).

**Dependencies:** T1, T2, T3

---

## T6 — Regression grep test: no bare `text-muted` in the in-scope file set

**Description**

Add a table-driven regression test that reads each in-scope source file and asserts no bare `text-muted` surface token remains, proving the Batch 1 sweep is complete and preventing regressions. Follow the existing `tokens.test.ts` pattern (read file via `node:fs.readFileSync`, assert on the string) — the codebase's established source-assertion convention since jsdom cannot compute colors.

Create **`frontend/src/tokens-usage.test.ts`** (new file, sibling of `tokens.test.ts`) — separate file because it tests *utility-class usage*, not token definitions, keeping `tokens.test.ts` focused on `index.css` structure.

The 11 in-scope files (Batch 1's complete swapped set — 10 with bare `text-muted` + `TicketCard.tsx` for the surface fix):

```
frontend/src/components/TopNav.tsx
frontend/src/components/ProjectPicker.tsx
frontend/src/components/TicketCard.tsx
frontend/src/components/Loading.tsx
frontend/src/components/Retry.tsx
frontend/src/components/ErrorFallback.tsx
frontend/src/components/TicketNotFound.tsx
frontend/src/components/TicketDetailModal.tsx
frontend/src/pages/NotFoundPage.tsx
frontend/src/pages/ForbiddenPage.tsx
frontend/src/pages/ProjectsPage.tsx
```

Structure (table-driven per AGENTS.md JS Testing Rules):

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'components/TopNav.tsx',
  'components/ProjectPicker.tsx',
  'components/TicketCard.tsx',
  'components/Loading.tsx',
  'components/Retry.tsx',
  'components/ErrorFallback.tsx',
  'components/TicketNotFound.tsx',
  'components/TicketDetailModal.tsx',
  'pages/NotFoundPage.tsx',
  'pages/ForbiddenPage.tsx',
  'pages/ProjectsPage.tsx',
] as const;

// Bare `text-muted` token, but NOT text-muted-foreground / text-muted-foreground/...
// Matches 'text-muted ' (space), 'text-muted"' (quote), 'text-muted`' (template tail).
const BARE_TEXT_MUTED = /\btext-muted\b(?![-\w])/;

describe('SLYK-06 — no bare text-muted (surface-as-text) in scope', () => {
  it.each(FILES.map((f) => ({ f })))('no bare text-muted in $f', ({ f }) => {
    const src = readFileSync(resolve(__dirname, f), 'utf8');
    expect(src, `bare text-muted found in ${f}`).not.toMatch(BARE_TEXT_MUTED);
  });
});
```

The negative-lookahead `/\btext-muted\b(?![-\w])/` is the critical detail — it permits the correct `text-muted-foreground` token while failing the bare surface token in all three delimiter contexts (`text-muted `, `text-muted"`, `` text-muted` ``).

**Acceptance Criteria**
- [ ] `frontend/src/tokens-usage.test.ts` exists, table-driven via `it.each`, one row per in-scope file.
- [ ] Regex correctly excludes `text-muted-foreground` (negative lookahead) and catches bare `text-muted` in space/quote/backtick delimiters.
- [ ] File list matches Batch 1's swapped set exactly (authoritative against T1–T4 output).
- [ ] `rtk vitest frontend/src/tokens-usage.test.ts` passes.
- [ ] Manually verified the test would **fail** if any bare `text-muted` is reintroduced (sanity: temporarily revert one swap → test fails → restore).

**Dependencies:** T1, T2, T3, T4

---

# Batch 3 — Final Verification & Build Gate (solo)

## T7 — SLYK-06 Final Verification & Build Gate

**Description**

Run after **all** Batch 1 implementation tasks (T1–T4) and Batch 2 test tasks (T5, T6) are complete and committed. This task makes **no code changes**. It is a pure verification gate that (a) confirms the frontend builds, type-checks, and the full test suite passes; (b) confirms via grep that the surface-as-text defect (bare `text-muted` with no `-foreground` suffix) is fully eradicated from the in-scope file set; and (c) signs off the ticket's acceptance criteria for merge. Output a PASS/FAIL report; on FAIL, file the specific failing task back to its owner.

**Scope note on `lint`:** `frontend/package.json` defines **no `lint`** script (scripts: `dev`, `build`, `typecheck`, `test`, `test:watch`, `preview`). Type-safety is enforced by `npm run build` (`tsc -b && vite build`) and the standalone `npm run typecheck` (`tsc --noEmit`). The gate uses these instead of `npm run lint`; if a `lint` script is later added, include it here.

**Acceptance Criteria**
- [ ] **Build:** `cd frontend && npm run build` (`tsc -b && vite build`) exits 0 — no TS or Vite errors.
- [ ] **Type gate:** `cd frontend && npm run typecheck` (`tsc --noEmit`) exits 0.
- [ ] **Tests:** `cd frontend && npm test` (`vitest run`) exits 0 — all unit/component tests pass, including the new Batch 2 tests (T5 className assertions; T6 regression grep test).
- [ ] **Defect-eradication grep:** `rg 'text-muted\b' frontend/src` and eyeball that every hit is `text-muted-foreground` — **zero** bare `text-muted` matches in the in-scope file set:
      `components/TopNav.tsx`, `components/ProjectPicker.tsx`, `components/ErrorFallback.tsx`, `components/Retry.tsx`, `components/Loading.tsx`, `components/TicketNotFound.tsx`, `components/TicketDetailModal.tsx`, `pages/NotFoundPage.tsx`, `pages/ForbiddenPage.tsx`, `pages/ProjectsPage.tsx`.
      (The 11th in-scope file `components/TicketCard.tsx` is the `bg-card` surface fix — no `text-muted` to grep; instead verify its new separation class — `border-border` + `ring-`, or `bg-popover` — is present at `TicketCard.tsx:32`.)
- [ ] **No regressions:** `TicketCard.tsx:32` surface change has not altered other `bg-card` consumers (`ui/Card.tsx`, popovers, skeletons) — visual diff check.
- [ ] **Acceptance-criteria sign-off:** confirm against `SLYK-06.md` ACs — nav legible both modes + hover escalation; picker icon visible both modes; card distinct from board both modes. Manual light/dark QA note recorded in the ticket.
- [ ] **Report:** a PASS/FAIL summary with command + exit codes recorded in the PR description or `docs/deliverables/SLYK-06-verify.md`.

**Dependencies:** T1, T2, T3, T4, T5, T6
**Blocks:** PR merge to `develop` (rebase-and-merge per repo policy).
**Can run in parallel with:** nothing — T7 is the terminal gate and runs solo.
