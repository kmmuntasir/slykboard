# F46 — Raw-color → semantic-token sweep: Plan + Task Breakdown

> **Feature:** F46 — Raw-color → semantic-token sweep (Phase 3 — Token migration sweep, correctness + polish)
> **Feature index:** [`../ui-redesign-features.md`](../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F32 (tokens), F35 (Card/Badge/Avatar primitives) — both done · **PRD ref:** §2.3, §4 (T4.1/T4.2)
> **Sources:** [`../ui-redesign-features.md`](../ui-redesign-features.md), the project rules discovered for this repo (`js-style-guide.md`, `js-testing-rules.md`, `js-development-rules.md`, `git-guidelines.md`), plus dependency feature task docs: F32 (tokens), F35 (Card/Badge/Avatar primitives).

---

## 1. F46 Recap

**Goal:** Remove every `gray-*`, `bg-white`, and hardcoded hex from component/page markup so light/dark mode "just works" via semantic tokens.

**Ships:** Components render correctly in dark mode with zero raw-color leaks in markup. Worst offenders (`ReportsPage`, `TimeLog`, `SettingsPage`, `LabelManager`, `ActivityFeed`, `LabelMultiSelect`, `BoardFilters`, plus 6 `bg-white` and ~44 hex references) migrated onto F32 tokens. `PriorityBadge`/`AssigneeAvatar` migrated onto F35 `Badge`/`Avatar` primitives where sensible.

**Acceptance (definition of done):**
- `rg "gray-|bg-white|#[0-9a-fA-F]{6}" frontend/src/components frontend/src/pages` returns **zero hits in component markup** (constants/types/test assertions of intentional data behavior excluded — see D6/D7/D8).
- `PriorityBadge` / `AssigneeAvatar` migrated onto `Badge` / `Avatar` primitives where sensible (§4 T4.2).
- Light + dark visual pass on Board, Reports, Projects, Settings, ProjectSettings, Login, ticket modal, confirm dialogs, empty/error/loading states.
- Tests for every touched file are green; new markup does not leak raw-color assertions.

**Edge cases to resolve up front:**
- **Test-update cascade (load-bearing)** → **Decision:** This feature fixes the tests for *every file it touches* — not just the 4 PRD-named files (`TopNav`, `ProjectPicker`, `Modal`, `TicketAttributeForm`). F50 exists to catch the residual, but F46 owns its own fallout. See D9.
- **Hardcoded hex in constants/types (label colors etc.)** → **Decision:** Intentional data. Do **not** blindly tokenize. Route label default hex (`#6B7280`) through a comment marking it as data; runtime-hex `style={{ backgroundColor: label.color }}` in `LabelChip` stays (data-derived, F14 T7). See D7, D8.
- **`bg-white` on `OfflineBanner`** → **Decision:** §6 says keep alert red; do not tokenize the alert away. Currently `bg-red-600 text-white`. Migrate to `bg-destructive text-destructive-foreground` to keep it theme-correct, but **never** mute it to a neutral token. See D6.

---

## 2. Codebase Analysis Summary

- **State:** Partial — F32 (tokens in `frontend/src/index.css`) and F35 (UI primitives `Badge`/`Avatar`/`Card`/`Button` in `frontend/src/components/ui/`) are already merged. The token palette is complete and dual-mode (light `:root` + dark `.dark`). This feature is purely a sweep — zero new tokens, zero new primitives; it only re-points existing raw classes at existing tokens.

- **Existing structure this feature builds on:**
  - Tokens: `frontend/src/index.css` — `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--input`, `--card`, `--popover`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--success`, `--warning`, `--danger`, plus their `-foreground` variants, wired to Tailwind via `--color-*` aliases (lines 96-131). Dark overrides at `.dark` (lines 53-89).
  - Primitives: `frontend/src/components/ui/` — `Badge.tsx`, `Avatar.tsx`, `Card.tsx`, `Button.tsx`, `Tooltip.tsx`, `Field.tsx`, `TextInput.tsx`, `SelectInput.tsx`, `Textarea.tsx`, `Dropdown.tsx`, `cn.ts`.
  - Components to migrate: `PriorityBadge.tsx`, `AssigneeAvatar.tsx`, `LabelChip.tsx` (data hex — leave), `LabelManager.tsx`, `LabelMultiSelect.tsx`, `BoardFilters.tsx`, `TimeLog.tsx`, `ActivityFeed.tsx`, `ActivityItem.tsx`, `ChecklistEditor.tsx`, `TimerControls.tsx`, `TicketDetailModal.tsx`, `TicketAttributeForm.tsx`, `TicketModalSkeleton.tsx`, `ManualEntryForm.tsx`, `DeleteTicketConfirm.tsx`, `ConfirmDiscardDialog.tsx`, `UserSelect.tsx`, `PrioritySelect.tsx`, `OfflineBanner.tsx` (alert exception).
  - Pages to migrate: `ReportsPage.tsx`, `SettingsPage.tsx`.

- **Prior art / partial work:** F31-F45 already migrated several components onto tokens/primitives during the structural redesign. The residual raw-color hits are the stragglers — concentrated in table-heavy pages (`ReportsPage`, `SettingsPage`) and lists (`TimeLog`, `ActivityFeed`). No half-built token code remains.

- **File paths the plan references that do NOT exist yet:** None. This feature modifies only existing files.

- **Live audit — raw-color hit counts (post F31-F45, current `main`):**

  **Total: 116 hits** = **100 in component/page source** + **16 in co-located test files** (test cascade, see D9).

  Per-file source counts (non-test):
  | Count | File |
  |------:|------|
  | 27 | `frontend/src/pages/ReportsPage.tsx` |
  | 17 | `frontend/src/components/TimeLog.tsx` |
  | 14 | `frontend/src/pages/SettingsPage.tsx` |
  | 7 | `frontend/src/components/LabelManager.tsx` |
  | 5 | `frontend/src/components/LabelMultiSelect.tsx` |
  | 5 | `frontend/src/components/ActivityFeed.tsx` |
  | 4 | `frontend/src/components/BoardFilters.tsx` |
  | 3 | `frontend/src/components/TicketDetailModal.tsx` |
  | 3 | `frontend/src/components/ChecklistEditor.tsx` |
  | 3 | `frontend/src/components/ActivityItem.tsx` |
  | 2 | `frontend/src/components/TimerControls.tsx` |
  | 2 | `frontend/src/components/TicketAttributeForm.tsx` |
  | 2 | `frontend/src/components/ManualEntryForm.tsx` |
  | 2 | `frontend/src/components/DeleteTicketConfirm.tsx` |
  | 1 | `frontend/src/components/UserSelect.tsx` |
  | 1 | `frontend/src/components/TicketModalSkeleton.tsx` |
  | 1 | `frontend/src/components/PrioritySelect.tsx` |
  | 1 | `frontend/src/components/ConfirmDiscardDialog.tsx` |

  Test cascade (16 hits across 6 files): `LabelManager.test.tsx` (6), `LabelChip.test.tsx` (4), `LabelMultiSelect.test.tsx` (2), `BoardFilters.test.tsx` (2), `Badge.test.tsx` (1, **intentional data-behavior assertion — leave**), `TicketCard.test.tsx` (1).

- **Project rules this plan must satisfy:**
  - `js-style-guide.md` — no inline styles (Tailwind classes), PascalCase components, explicit prop types.
  - `js-testing-rules.md` — co-located `*.test.tsx`, table-driven preferred, testing-library priority order.
  - `js-development-rules.md` — Zustand/React Query, one component per file.
  - `git-guidelines.md` — `SLYK-F46:` commit prefix, single-line commit, no merge/squash.

- **Hidden coupling to plan for:**
  - `LabelChip` and `Badge` both render label colors via runtime `style` from DB-stored hex — this is **data, not styling** and must survive the sweep untouched (D7, D8).
  - `LabelManager.test.tsx` asserts the `DEFAULT_COLOR` hex flows through the create/edit DTO — that hex is data, the test stays.
  - `PriorityBadge` and `AssigneeAvatar` are consumed across `TicketCard`, `TicketDetailModal`, `ReportsPage`, `SettingsPage`, `TimeLog`, `ActivityItem` — migrating them onto `Badge`/`Avatar` is a downstream-visible change (acceptance: same prop surface or backward-compatible shim).
  - `OfflineBanner` is the one place red is semantically load-bearing (alert). It must map to `bg-destructive`, never `bg-muted`.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Sweep scope | **`frontend/src/components` + `frontend/src/pages` markup only** | PRD §2.3/§4 scope. Excludes `constants/`, `types/`, `*.test.*` source-of-truth (tests fixed as cascade, not swept). Prevents repo-wide creep — that risk is already bounded by the `rg` acceptance path. |
| D2 | `gray-50` mapping | **`bg-muted`** (thead backgrounds, table headers) | Maps to `--muted` (gray-100 light / gray-800 dark). Surfaces like `bg-gray-50` table headers become `bg-muted`. |
| D3 | `gray-100` / `divide-gray-100` mapping | **`bg-muted` / `divide-border`** | `--muted` ≡ gray-100 seed; dividers (`divide-gray-100`) → `divide-border` for theme-correct hairlines. |
| D4 | `gray-200` / `border-gray-200` mapping | **`border-border`** | `--border` ≡ gray-200 (seed). All `border-gray-200`, `border-gray-300` → `border-border`. |
| D5 | `gray-400` / `gray-500` / `gray-600` / `gray-700` / `gray-800` / `gray-900` text mapping | **`text-muted-foreground`** (gray-400/500/600 secondary) · **`text-foreground`** (gray-700/800/900 primary) | Two-tier: secondary/muted text → `--muted-foreground` (gray-500 light / gray-400 dark); primary text → `--foreground`. `text-gray-800`/`text-gray-900` → `text-foreground`; `text-gray-400`/`500`/`600` → `text-muted-foreground`. |
| D6 | `bg-white` mapping | **`bg-card`** (modal/panel surfaces: `TicketModalSkeleton`, `LabelMultiSelect` dropdown) · **`bg-background`** (full-page surfaces) · **`bg-destructive`** (`OfflineBanner` ONLY) | `bg-white` → `bg-card` for elevated surfaces (modal skeletons, dropdowns), `bg-background` for page roots. `OfflineBanner` keeps its alert semantics via `bg-destructive text-destructive-foreground` per §6 — never neutralized. |
| D7 | `LabelManager` `DEFAULT_COLOR = '#6B7280'` hex | **Leave as data with a clarifying comment** | This hex is written to the DB as a label's default color — it is *data*, not styling. Tokenizing it would corrupt stored label values. Add `// data: default label color persisted to DB — not a style token (F46 D7)`. |
| D8 | `LabelChip` runtime `style={{ backgroundColor: label.color }}` | **Leave untouched** | Data-derived hex from DB-stored label color (F14 T7). Tailwind JIT cannot theme runtime values; this is correct as-is. |
| D9 | Test-update cascade | **F46 fixes tests for every file it touches** | Spec §327: F50 catches residual, but F46 owns its own fallout. Touch a file → fix its `*.test.tsx`. `Badge.test.tsx` `#abcdef` assertion stays — it tests arbitrary-hex pass-through (data behavior), not styling. |
| D10 | `PriorityBadge` migration | **Wrap/replace with F35 `Badge`** via a `variant` mapping (CRITICAL→destructive, HIGH→warning, MED→secondary, LOW→muted) | PRD §4 T4.2. Keeps `PriorityBadge` as the public API (consumers unchanged) but delegates rendering to `Badge`. Preserves backward compatibility. |
| D11 | `AssigneeAvatar` migration | **Delegate to F35 `Avatar`** | PRD §4 T4.2. `AssigneeAvatar` stays as the public component; internals compose `Avatar` so dark-mode ring/fallback tokens apply. |

> **Out of F46 scope (explicitly deferred):**
> - Repo-wide sweep beyond `frontend/src/{components,pages}` — backend, scripts, configs untouched.
> - Theming runtime DB-stored label colors (LabelChip data hex) — F14 domain, not F46.
> - Building new tokens or primitives — F32/F35 own those; F46 only consumes.
> - The residual test-update cascade beyond F46-touched files — owned by F50.

> **Owner sign-off needed:** None — all decisions are mechanical mappings grounded in existing tokens/primitives. Flag if any consumer breaks from D10/D11 (PriorityBadge/AssigneeAvatar API change).

---

## 4. Architecture Overview (Target Tree)

```
frontend/src/
├── index.css                              # UNCHANGED — tokens already in place (F32)
├── components/
│   ├── ui/
│   │   ├── Badge.tsx                      # UNCHANGED — primitive F46 consumes
│   │   └── Avatar.tsx                     # UNCHANGED — primitive F46 consumes
│   ├── PriorityBadge.tsx                  # MODIFY — delegate to Badge (D10)
│   ├── AssigneeAvatar.tsx                 # MODIFY — delegate to Avatar (D11)
│   ├── LabelChip.tsx                      # UNCHANGED — runtime data hex (D8)
│   ├── LabelManager.tsx                   # MODIFY — tokenize borders; keep DEFAULT_COLOR data (D7)
│   ├── LabelMultiSelect.tsx               # MODIFY — gray-* → tokens, bg-white → bg-card
│   ├── BoardFilters.tsx                   # MODIFY — gray-* → tokens
│   ├── TimeLog.tsx                        # MODIFY — 17 hits → tokens
│   ├── ActivityFeed.tsx                   # MODIFY — tokens
│   ├── ActivityItem.tsx                   # MODIFY — tokens, bg-gray-200 avatar → Avatar/bg-muted
│   ├── ChecklistEditor.tsx                # MODIFY — tokens incl. progress bar bg-gray-200
│   ├── TimerControls.tsx                  # MODIFY — tokens
│   ├── TicketDetailModal.tsx              # MODIFY — tokens
│   ├── TicketAttributeForm.tsx            # MODIFY — tokens (F44 layout stays)
│   ├── TicketModalSkeleton.tsx            # MODIFY — bg-white → bg-card
│   ├── ManualEntryForm.tsx                # MODIFY — tokens
│   ├── DeleteTicketConfirm.tsx            # MODIFY — tokens
│   ├── ConfirmDiscardDialog.tsx           # MODIFY — tokens
│   ├── UserSelect.tsx                     # MODIFY — tokens
│   ├── PrioritySelect.tsx                 # MODIFY — tokens
│   ├── OfflineBanner.tsx                  # MODIFY — bg-red-600 → bg-destructive (alert preserved, D6)
│   └── *.test.tsx                         # MODIFY — cascade fixes per D9 (Badge.test #abcdef STAYS)
└── pages/
    ├── ReportsPage.tsx                    # MODIFY — 27 hits → tokens (worst offender)
    └── SettingsPage.tsx                   # MODIFY — 14 hits → tokens
```

**Data flow note:** No data/state flow changes. This is a className-only sweep plus two component-internal refactors (`PriorityBadge`, `AssigneeAvatar`) that preserve their public prop API. DB-stored label hex passes through `LabelChip`/`Badge` via runtime `style` unchanged.

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
Batch A (primitives)        Batch B (leaf components)      Batch C (pages)        Batch D (verify)
  T1 PriorityBadge ──┐        T3 TimeLog                    T7 ReportsPage          T9 Integration
  T2 AssigneeAvatar ─┘        T4 ActivityFeed+Item           T8 SettingsPage         T10 DoD gate
                              T5 Lists+Filters
                              T6 Modals+Forms+Misc
```

- **Batch A → Batch B/C** is a soft barrier: `PriorityBadge`/`AssigneeAvatar` are consumed by `TimeLog`, `ActivityItem`, `ReportsPage`, `SettingsPage`. Their public API is preserved (D10/D11), so B/C can branch in parallel with A as long as they consume the existing API — only the *internal* rendering changes. Merge A first to de-risk.
- **Batch B ↔ Batch C** is a non-barrier: disjoint file sets (components vs pages). Fully parallel.
- **Batch D** gates on everything: runs the `rg` acceptance, visual pass, full test suite.

### Merge order rules

1. **Batch A merges first** (T1, T2 — either order). PriorityBadge/AssigneeAvatar on `main` before downstream consumers verify against them.
2. **Batch B and Batch C merge in parallel** (any order within each). No file overlap. Each PR must independently pass its own co-located tests.
3. **Batch D merges last** — integration verification on the fully-merged feature.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `PriorityBadge.tsx` + test | F35 Badge | T2 |
| **T2** | A | `AssigneeAvatar.tsx` + test | F35 Avatar | T1 |
| **T3** | B | `TimeLog.tsx` + test | T1 (PriorityBadge consumer) | T4, T5, T6 |
| **T4** | B | `ActivityFeed.tsx`, `ActivityItem.tsx` + tests | T2 (Avatar consumer) | T3, T5, T6 |
| **T5** | B | `LabelManager.tsx`, `LabelMultiSelect.tsx`, `BoardFilters.tsx`, `ChecklistEditor.tsx`, `TimerControls.tsx`, `UserSelect.tsx`, `PrioritySelect.tsx` + tests | T1 (where applicable) | T3, T4, T6 |
| **T6** | B | `TicketDetailModal.tsx`, `TicketAttributeForm.tsx`, `TicketModalSkeleton.tsx`, `ManualEntryForm.tsx`, `DeleteTicketConfirm.tsx`, `ConfirmDiscardDialog.tsx`, `OfflineBanner.tsx` + tests | T1, T2 | T3, T4, T5 |
| **T7** | C | `ReportsPage.tsx` | T1, T2 | T8, all B |
| **T8** | C | `SettingsPage.tsx` | T1, T2 | T7, all B |
| **T9** | D | Integration: full `rg`, full test suite, lint/typecheck | T1-T8 | — |
| **T10** | D | DoD sign-off + visual pass | T9 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → (T3 ‖ T4 ‖ T5 ‖ T6 ‖ T7 ‖ T8) → T9 → T10.
- **2 devs:** Dev-A: T1, T2, T3, T4, T7. Dev-B: T5, T6, T8, T9 (start T9 after A finishes T7).
- **3 devs:** Dev-A: T1, T2, T7, T8. Dev-B: T3, T4. Dev-C: T5, T6. T9/T10 pooled.

---

## 6. Tasks

### T1 — Migrate `PriorityBadge` onto F35 `Badge`

**Batch:** A · **Depends on:** F35 Badge · **Parallel with:** T2

**Description:** Refactor `PriorityBadge.tsx` so it delegates rendering to the F35 `Badge` primitive while preserving its public prop API. Map priority levels to Badge variants per D10: `CRITICAL` → `destructive`, `HIGH` → `warning` (or `secondary` if Badge has no `warning` variant — check `Badge.tsx`), `MEDIUM` → `secondary`, `LOW` → `muted`. Drop any `gray-*`/`bg-*` raw classes. Keep the component's exported signature identical so `TicketCard`, `TicketDetailModal`, `ReportsPage`, `TimeLog`, `ActivityItem` compile unchanged.

Modify:
- `frontend/src/components/PriorityBadge.tsx` — replace raw-color spans with `<Badge variant={...}>`. Preserve props (`priority`, `size?`, etc.).
- `frontend/src/components/PriorityBadge.test.tsx` — update assertions if rendered class names change; assert variant mapping per priority.

**Acceptance Criteria:**
- [ ] `PriorityBadge.tsx` renders via `Badge`, zero `gray-*`/`bg-white`/hex in its source.
- [ ] Priority → variant mapping documented inline (D10).
- [ ] Public prop API unchanged; all consumers compile without edits.
- [ ] `PriorityBadge.test.tsx` green.

**Dependencies:** F35 (Badge.tsx exists).

---

### T2 — Migrate `AssigneeAvatar` onto F35 `Avatar`

**Batch:** A · **Depends on:** F35 Avatar · **Parallel with:** T1

**Description:** Refactor `AssigneeAvatar.tsx` to compose the F35 `Avatar` primitive internally, so dark-mode ring/fallback/background tokens apply. Preserve the public prop API (`user`, `size?`, etc.). Replace any `gray-*` avatar background with `Avatar`'s token-backed fallback. Consumers (`TicketCard`, `TimeLog`, `ActivityItem`, `ReportsPage`, `SettingsPage`) stay untouched.

Modify:
- `frontend/src/components/AssigneeAvatar.tsx` — delegate to `Avatar`; remove raw-color classes.
- `frontend/src/components/AssigneeAvatar.test.tsx` — update assertions for new structure; keep covering initials/image/fallback behavior.

**Acceptance Criteria:**
- [ ] `AssigneeAvatar.tsx` composes `Avatar`, zero raw colors in source.
- [ ] Public prop API unchanged.
- [ ] Initials/image/fallback paths still covered by tests.
- [ ] `AssigneeAvatar.test.tsx` green.

**Dependencies:** F35 (Avatar.tsx exists).

---

### T3 — Tokenize `TimeLog` (17 hits — worst component offender)

**Batch:** B · **Depends on:** T1 (PriorityBadge consumer) · **Parallel with:** T4, T5, T6

**Description:** Sweep all 17 raw-color hits in `TimeLog.tsx` to tokens per the mapping table (D2-D6):
- `text-gray-700` (header, value spans) → `text-foreground`
- `text-gray-500`/`text-gray-600` (meta, captions) → `text-muted-foreground`
- `text-gray-400` (Start/Logged/End labels) → `text-muted-foreground`
- `bg-gray-200` (duration pill) → `bg-muted`
- `border-gray-200` / `divide-gray-100` → `border-border` / `divide-border`

Modify:
- `frontend/src/components/TimeLog.tsx` — className sweep.
- `frontend/src/components/TimeLog.test.tsx` — fix any class-based assertions (prefer role/text queries per testing rules).

**Acceptance Criteria:**
- [ ] Zero `gray-*`/`bg-white`/hex in `TimeLog.tsx`.
- [ ] `TimeLog.test.tsx` green; assertions use testing-library priority order.
- [ ] Loading/empty/list states render in dark mode.

**Dependencies:** T1.

---

### T4 — Tokenize `ActivityFeed` + `ActivityItem`

**Batch:** B · **Depends on:** T2 (Avatar consumer) · **Parallel with:** T3, T5, T6

**Description:** Sweep `ActivityFeed.tsx` (5 hits) and `ActivityItem.tsx` (3 hits):
- `text-gray-700`/`800` → `text-foreground`; `text-gray-500` → `text-muted-foreground`
- `border-gray-200` / `divide-gray-100` → `border-border` / `divide-border`
- `bg-gray-200 text-gray-600` avatar circle → either F35 `Avatar` fallback or `bg-muted text-muted-foreground`

Modify:
- `frontend/src/components/ActivityFeed.tsx`, `frontend/src/components/ActivityItem.tsx`.
- Co-located tests if present.

**Acceptance Criteria:**
- [ ] Zero raw colors in both files.
- [ ] Avatar fallback legible in dark mode.
- [ ] Tests green.

**Dependencies:** T2.

---

### T5 — Tokenize lists, filters, and select components

**Batch:** B · **Depends on:** T1 (where applicable) · **Parallel with:** T3, T4, T6

**Description:** Sweep the cluster of list/filter/select components (all share `border-gray-300`/`border-gray-200`/`text-gray-*` patterns):
- `LabelManager.tsx` (7 hits): tokenize all `border-gray-300`. **Keep `DEFAULT_COLOR = '#6B7280'`** — add comment `// data: default label color persisted to DB — not a style token (F46 D7)`.
- `LabelMultiSelect.tsx` (5 hits): `border-gray-300` → `border-border`; dropdown `bg-white` → `bg-card` (elevated surface, D6); `text-gray-400`/`500` → `text-muted-foreground`.
- `BoardFilters.tsx` (4 hits): `border-gray-300` → `border-border`.
- `ChecklistEditor.tsx` (3 hits): `text-gray-500` → `text-muted-foreground`; progress bar `bg-gray-200` → `bg-muted`.
- `TimerControls.tsx` (2 hits): `text-gray-700` → `text-foreground`; `text-gray-500` → `text-muted-foreground`.
- `UserSelect.tsx` (1 hit), `PrioritySelect.tsx` (1 hit): `border-gray-300` → `border-border`.

Modify:
- All listed component files + their co-located `*.test.tsx` (cascade per D9). `LabelManager.test.tsx` (6 hits) — keep `DEFAULT_COLOR` hex assertions (data flow), only fix class-based assertions. `LabelMultiSelect.test.tsx` (2) and `BoardFilters.test.tsx` (2) — fix class assertions.

**Acceptance Criteria:**
- [ ] Zero raw colors in all 7 component source files.
- [ ] `LabelManager` `DEFAULT_COLOR` hex preserved with D7 comment.
- [ ] All co-located tests green; data-flow hex assertions preserved.
- [ ] `LabelMultiSelect` dropdown renders correctly in dark mode (`bg-card`).

**Dependencies:** T1.

---

### T6 — Tokenize modals, forms, and misc components

**Batch:** B · **Depends on:** T1, T2 · **Parallel with:** T3, T4, T5

**Description:** Sweep modal/form/misc components:
- `TicketDetailModal.tsx` (3 hits): `text-gray-900` → `text-foreground`; `text-gray-600` → `text-muted-foreground`; `border-gray-200` → `border-border`.
- `TicketAttributeForm.tsx` (2 hits): `border-gray-300` → `border-border`; `bg-gray-50 ... border-gray-200` textarea → `bg-muted border-border`. Preserve F44 two-column layout.
- `TicketModalSkeleton.tsx` (1 hit): `bg-white` → `bg-card` (modal surface, D6).
- `ManualEntryForm.tsx` (2 hits): `border-gray-200` → `border-border`.
- `DeleteTicketConfirm.tsx` (2 hits): `text-gray-600` → `text-muted-foreground`.
- `ConfirmDiscardDialog.tsx` (1 hit): `text-gray-600` → `text-muted-foreground`.
- `OfflineBanner.tsx` (1 hit): `bg-red-600 text-white` → `bg-destructive text-destructive-foreground` (alert semantics preserved, D6). **Do not neutralize to `bg-muted`.**

Modify:
- All listed component files + co-located tests.
- `OfflineBanner.test.tsx` — update class assertions; verify it still reads as an alert (destructive token).

**Acceptance Criteria:**
- [ ] Zero raw colors in all 7 component source files.
- [ ] `OfflineBanner` still visually reads as an alert in both themes (destructive red).
- [ ] `TicketAttributeForm` two-column layout (F44) intact.
- [ ] All co-located tests green.

**Dependencies:** T1, T2.

---

### T7 — Tokenize `ReportsPage` (27 hits — worst page offender)

**Batch:** C · **Depends on:** T1, T2 · **Parallel with:** T8, all Batch B

**Description:** Sweep all 27 raw-color hits in `ReportsPage.tsx` — the largest single concentration. Patterns:
- Table header: `bg-gray-50 ... text-gray-500` → `bg-muted text-muted-foreground`
- Table body: `divide-gray-100` → `divide-border`; hover rows → keep `hover:` but on token bg
- Value text: `text-gray-700`/`800` → `text-foreground`
- Captions: `text-gray-500` (Loading, empty state) → `text-muted-foreground`
- Borders: `border-gray-200` (segmented control, table outline, export buttons) → `border-border`

Modify:
- `frontend/src/pages/ReportsPage.tsx` — full className sweep.
- Co-located test if present (cascade D9).

**Acceptance Criteria:**
- [ ] Zero `gray-*`/`bg-white`/hex in `ReportsPage.tsx`.
- [ ] Table, segmented control, export buttons, empty/loading states render in dark mode.
- [ ] Tests green.

**Dependencies:** T1, T2.

---

### T8 — Tokenize `SettingsPage` (14 hits)

**Batch:** C · **Depends on:** T1, T2 · **Parallel with:** T7, all Batch B

**Description:** Sweep all 14 raw-color hits in `SettingsPage.tsx`. Same patterns as T7 (table-heavy):
- `bg-gray-50 text-gray-500` header → `bg-muted text-muted-foreground`
- `divide-gray-100` → `divide-border`
- `text-gray-700`/`800` → `text-foreground`; `text-gray-500`/`600` → `text-muted-foreground`; `text-gray-400` "(you)" → `text-muted-foreground`
- Role badge `bg-gray-100 text-gray-700` → use F35 `Badge` or `bg-muted text-foreground`
- `bg-gray-600 hover:...` (destructive-ish button) → verify intent; if destructive action, `bg-destructive hover:bg-destructive/90`; else `bg-primary`
- `border-gray-200` (table, action buttons) → `border-border`

Modify:
- `frontend/src/pages/SettingsPage.tsx` — full className sweep.
- Co-located test if present (cascade D9).

**Acceptance Criteria:**
- [ ] Zero raw colors in `SettingsPage.tsx`.
- [ ] Confirm-modal (destructive actions per project memory) still reads as destructive.
- [ ] Tests green.

**Dependencies:** T1, T2.

---

### T9 — Integration: full `rg`, test suite, lint, typecheck

**Batch:** D · **Depends on:** T1-T8 · **Parallel with:** —

**Description:** The first half of the definition-of-done gate. Run every tool against the as-merged feature and fix gaps.

Steps:
1. Run `rg "gray-|bg-white|#[0-9a-fA-F]{6}" frontend/src/components frontend/src/pages` — must return **zero markup hits**. Expected residual (allowed): `LabelChip.tsx` runtime data hex (D8), `LabelManager.tsx` `DEFAULT_COLOR` data hex (D7), `OfflineBanner.tsx` now `bg-destructive` (no hex), test-file data assertions (D9). Document any remaining hit.
2. Run `rtk vitest` (or `npm test`) — all green. Triage any snapshot/assertion failures from the cascade.
3. Run `rtk tsc` / typecheck — zero errors.
4. Run `rtk lint` — zero errors.
5. Verify `PriorityBadge`/`AssigneeAvatar` consumers compile and render: `TicketCard`, `TicketDetailModal`, `ReportsPage`, `SettingsPage`, `TimeLog`, `ActivityItem`.

**Acceptance Criteria:**
- [ ] `rg` returns zero markup hits (data/test exceptions documented).
- [ ] All tests green.
- [ ] Typecheck + lint clean.
- [ ] No consumer breakage from D10/D11.

**Dependencies:** T1-T8.

---

### T10 — DoD sign-off + light/dark visual pass

**Batch:** D (terminal) · **Depends on:** T9 · **Parallel with:** —

**Description:** Final definition-of-done gate. Manual visual verification across both themes on every F46-affected surface, then commit.

Steps:
1. Boot the app (`npm run dev` in `frontend/`), toggle light/dark.
2. Visual pass on: Board, Reports, Projects, Settings, ProjectSettings, Login, ticket modal, confirm dialogs (delete ticket, confirm discard, role-change/promote/demote per project memory), empty/error/loading states.
3. Confirm `OfflineBanner` (force offline) still reads as a red alert in both themes.
4. Confirm `LabelChip` colored chips render with their DB-stored hex in both themes (data, not themed).
5. Commit all F46 changes as a single `SLYK-F46:` commit on `main` per git guidelines.

**Acceptance Criteria:**
- [ ] Every F46 Acceptance bullet from §1 satisfied; record commit SHA.
- [ ] Light + dark visual pass on all listed surfaces — no contrast inversions, no invisible text, no white-on-white.
- [ ] `OfflineBanner` alert semantics preserved.
- [ ] `LabelChip` data hex renders in both themes.
- [ ] Single `SLYK-F46:` commit, rebase-and-merge only (no squash, no merge commit).

**Dependencies:** T9.

---

## 7. Final F46 Acceptance Checklist

- [ ] `rg "gray-|bg-white|#[0-9a-fA-F]{6}" frontend/src/components frontend/src/pages` returns zero markup hits (D7/D8/D9 exceptions documented).
- [ ] `PriorityBadge` migrated onto `Badge` (D10); `AssigneeAvatar` migrated onto `Avatar` (D11).
- [ ] Light + dark visual pass on Board, Reports, Projects, Settings, ProjectSettings, Login, ticket modal, confirm dialogs, empty/error/loading states.
- [ ] `OfflineBanner` keeps alert semantics (`bg-destructive`, never neutralized).
- [ ] `LabelChip`/`LabelManager` data hex preserved (D7, D8).
- [ ] Lint + format pass on an empty change.
- [ ] Typecheck + tests pass.

**Integration record (fill during T10):**
- Feature commit SHA: `________`
- `rg` residual hits (documented exceptions): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

None. F46 is a frontend className + component-internal refactor. No database, migration, or schema changes.
