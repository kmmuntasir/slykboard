# F35 — Shared UI primitives (Button/Field/TextInput/Textarea/SelectInput/Avatar/Badge/Card): Plan + Task Breakdown

> **Feature:** F35 — Shared UI primitives (Button/Field/TextInput/Textarea/SelectInput/Avatar/Badge/Card) (Phase 0 — Foundations · Infrastructure)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F32 (done) · **PRD ref:** §3.4 (full primitive spec), §5.3 (drift this kills), §2.5 (ManualEntryForm focus gap), §1.2/§1.5 (semantic-token + reuse principles)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency feature: [F32](../F32-define-semantic-tokens/F32-define-semantic-tokens-tasks.md) (token set — done; primitives consume its semantic tokens).

---

## 1. F35 Recap

**Goal:** Collapse the structural drift (3 button sizes, missing focus rings, reinvented label/input markup) into one primitive layer so later features stop re-creating it.

**Ships:** `frontend/src/components/ui/` (does **not** exist today) populated with `Button`, `Field`, `TextInput`, `Textarea`, `SelectInput`, `Avatar`, `Badge`, `Card` — importable via `@/components/ui/...`. No page uses them yet; they are ready for `F37`+.

**Acceptance (definition of done):**
1. `Button` — variants `primary|secondary|ghost|destructive|outline`; sizes `sm|md|lg`; one padding spec per size; uses `bg-primary text-primary-foreground` etc. (F32 tokens).
2. `Field` — `<label>` + label `<span>` + child + `role="alert"` error `<p>`; owns `mb-1 block text-sm font-medium` label and `mt-1 text-sm text-destructive` error.
3. `TextInput`/`Textarea` — shared `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary` (focus ring on every field — fixes the §2.5 ManualEntryForm gap).
4. `SelectInput` — styled native `<select>` wrapper (themeable, dark-able).
5. `Avatar` — consolidates `AssigneeAvatar` + TopNav initials/img logic; `size` prop.
6. `Badge` — unifies `PriorityBadge` + label/status badges.
7. `Card` — `bg-card border border-border rounded-lg`.
8. Co-located `*.test.tsx` per primitive (RTL `getByRole`); renders with tokens in light + dark.

**Edge cases to resolve up front:**
- **No `any` / style-guide rules** → **Decision: explicit prop interfaces, PascalCase files, 4-space JSX / 2-space TS, ≤100 cols, trailing commas, no inline styles (Tailwind only).** (`js-style-guide.md` binds.)
- **Button ref-forwarding + rest-spread** (F35-spec; PRD-silent) → **Decision: `forwardRef<HTMLButtonElement>` + spread `...rest`; `type` defaults to `'button'`.** Modal/forms rely on native button attributes (`form`, `type`, `disabled`).
- **Avatar fallback chain** (PRD-silent) → **Decision: `src` img → initials (per-word algo, `AssigneeAvatar`'s — "Ada Lovelace"→"AL") → lucide `User` generic icon. `size` prop (sm/md/lg → h-6/h-8/h-10). Single source of truth.** (PRD §3.3 sanctions `User` icon.)
- **`cn()` helper absent** (PRD-silent; required for variant+size+className merge) → **Decision: add `clsx` + `tailwind-merge` deps; create `frontend/src/components/ui/cn.ts`. shadcn convention. Adds 2 deps — owner sign-off surfaced.**
- **Button variant→token map** (PRD §3.4 names variants/sizes only, no classes/padding) → **Decision: synthesize per D2 below.**
- **Avatar fallback chain PRD-silent** → flagged as synthesis decision (D6) with documented default.
- **LabelChip runtime-hex `style`** → **Decision: stays separate (F46). Badge accepts optional `style` passthrough for the future; LabelChip migration is NOT F35.**

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for `components/ui/`. **`frontend/src/components/ui/` DOES NOT EXIST.** `components/` is flat (~50 .tsx + co-located tests): `AssigneeAvatar`, `PriorityBadge`, `LabelChip`, `ManualEntryForm`, `TopNav`, `TicketCard`, `Modal`, `TicketAttributeForm`, `HealthBadge`, `BoardColumn`, `ChecklistEditor`, `ErrorBoundary`, `Toaster`, etc. F35 creates the `ui/` subdirectory and 8 primitives + `cn.ts` inside it.

- **Drift components F35 collapses (PRD §5.3):**
  - **`AssigneeAvatar.tsx:8-34`** — fallback chain: null → `bg-muted` circle with `–` (aria-label "Unassigned"); initials = first-char-per-word `.slice(0,2).toUpperCase()`; `avatarUrl` → `<img class="h-6 w-6 rounded-full">`; else → `bg-primary text-primary-foreground` 24px circle.
  - **`PriorityBadge.tsx:4-10`** — `PRIORITY_TONE` map: LOW `bg-slate-100 text-slate-700`, MEDIUM `bg-blue-100 text-blue-700`, HIGH `bg-amber-100 text-amber-700`, URGENT `bg-orange-100 text-orange-700`, CRITICAL `bg-red-100 text-red-700`; wrapper `inline-flex rounded px-1.5 py-0.5 text-xs font-medium`. (**Raw Tailwind colors — violates §1.2 token mandate; Badge (D7) replaces these with semantic tokens.**)
  - **`LabelChip.tsx:12-32`** — **runtime-hex** `style={{ backgroundColor, color }}` (WCAG luminance via `readableTextColor`); **CANNOT migrate to a token-only Badge** (dynamic color) — stays separate; F46 decision. Badge exposes optional `style` passthrough for the future.
  - **`TopNav.tsx:16-19, 91-101`** — **DIFFERENT initials algo** (`slice(0,2)`) + `bg-muted text-background` 32px circle + `<img h-8 w-8>`. Two divergent avatar impls (size 6 vs 8, `bg-primary` vs `bg-muted`, two initials algos) — exactly the drift F35 `Avatar` (D6) collapses.

- **Button drift:** **59 `<button` hits**, ~8 distinct padding patterns (`px-2 py-1`, `px-3 py-1`, `px-3 py-1.5`, `px-4 py-2`, `px-6 py-3`, `px-2.5 py-1`, `px-4 py-1`); divergent bg (`bg-primary`/`bg-red-600`/`bg-green-600`/`bg-blue-600`/`bg-muted`/`bg-background`); divergent text (`text-primary-foreground`/`text-white`/`text-background`/`text-gray-700`); `disabled:opacity-50` vs `40`. F35 `Button` (D2 — sm/md/lg, one padding per size, variant+className merge) replaces all (migration is F46).

- **ManualEntryForm focus gap (PRD §2.5):** `ManualEntryForm.tsx:66, 75` — `border-gray-200 px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary` (**NOT tokens; `focus:` not `focus-visible:`**). F35 `TextInput`/`Textarea` (D4) `focus-visible:ring-2 ring-ring` fixes it.

- **Field/label drift:** `<label>` inconsistent — `PrioritySelect.tsx:13` `<label className="block">`; `TicketAttributeForm.tsx:86` wrapping `<label>` + `<span className="mb-1 block text-sm font-medium">`; `ManualEntryForm.tsx:60-67` bare `<input aria-label>` (**NO `<label>`**). Error `role="alert"` PRESENT in `TicketAttributeForm` (`:96,117,129,141`)/Retry/ErrorFallback/LoginPage but **MISSING** in `ManualEntryForm` (`:86` just `<p className="mt-1 text-sm text-red-600">`). F35 `Field` (D3) unifies markup + the a11y gap.

- **`cn()` helper DOES NOT EXIST** — no `clsx`, no `tailwind-merge`, no `class-variance-authority`, no `utils/cn.ts`. **F35 variant primitives (`Button`, `Badge`) need a `cn()` to merge variant+size+className deterministically (`tailwind-merge` resolves conflicts like duplicate `px-*`). Must add `clsx` + `tailwind-merge` deps + create the helper (D1). shadcn `cn` is the convention.

- **F32 tokens all present + resolve:** `frontend/src/index.css:95-132` `@theme inline` maps every utility F35 needs — `bg-primary`/`text-primary-foreground` (`:105-6`), `bg-secondary`/`-foreground` (`:108-9`), `bg-destructive`/`text-destructive`/`-foreground` (`:117-8`), `bg-muted`/`text-muted-foreground` (`:111-2`), `bg-accent`/`-foreground` (`:114-5`), `bg-card` (`:99`), `bg-background`/`text-foreground` (`:96-7`), `border-border` (`:120`), `border-input` (`:121`), `ring-ring` (`:122`), `bg-success`/`bg-warning`/`bg-danger` (`:124,127,130`). `--danger` aliases `--destructive` (one red). **No `bg-info`/`bg-critical`** — F35 Badge variants map to semantic backgrounds that exist. **Alpha modifiers native** (`bg-primary/90` via `color-mix`). **Dark mode auto-flips** via `@theme inline` + `:root`/`.dark` → **F35 primitives write ZERO `dark:` color classes.**

- **Test conventions (verified):** Vitest 3 + jsdom 25 + RTL 16; config in `vite.config.ts` (env `jsdom`, `globals: true`, setupFiles `['./src/test-setup.ts']`, alias `@` → `./src`). RTL + jsdom + `getByRole`/`getByLabelText`/`getByText` priority; co-located `*.test.tsx`; jest-dom matchers (`toBeInTheDocument()`). Example: `TicketCard.test.tsx:31-38`. (dnd components use a `renderInDnd` helper; **F35 primitives use plain `render()`.**) **jsdom can't assert computed color → assert STRUCTURE/role/className** (like F32's tokens.test).

- **`@/` alias resolves** (`@/`→`src/` via `vite.config.ts` + `tsconfig.json:11-13`). Build gate: `dev`/`build` (`tsc -b && vite build`)/`typecheck` (`tsc --noEmit`)/`test` (`vitest run`). `tsc -b` uses project references → new `src/` files auto-picked.

- **File paths the plan references that do NOT exist yet** (will be created): `frontend/src/components/ui/cn.ts`, `frontend/src/components/ui/cn.test.ts`, `frontend/src/components/ui/Button.tsx`, `frontend/src/components/ui/Button.test.tsx`, `frontend/src/components/ui/Field.tsx`, `frontend/src/components/ui/Field.test.tsx`, `frontend/src/components/ui/TextInput.tsx`, `frontend/src/components/ui/Textarea.tsx`, `frontend/src/components/ui/TextInput.test.tsx`, `frontend/src/components/ui/SelectInput.tsx`, `frontend/src/components/ui/SelectInput.test.tsx`, `frontend/src/components/ui/Avatar.tsx`, `frontend/src/components/ui/Avatar.test.tsx`, `frontend/src/components/ui/Badge.tsx`, `frontend/src/components/ui/Badge.test.tsx`, `frontend/src/components/ui/Card.tsx`, `frontend/src/components/ui/Card.test.tsx`. (`frontend/package.json` modified for dep adds.)

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; co-locate tests; explicit prop interfaces; functional + hooks. Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files; **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; **no inline styles (Tailwind only)**; no `console.log`; naming.
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `getByRole` priority; `vi.fn()` mocks; table-driven preferred; **components >70% coverage**.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc` (omit ticket if unidentifiable); single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F34:` → F35 uses `SLYK-F35:` prefix.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations.

- **Hidden coupling to plan for:**
  - **`cn()` is shared by Button/Badge/TextInput/etc.** (variant+size+className merge) → **must land FIRST (T1)**; every variant primitive imports it. Primitives cannot compile until `cn.ts` exists.
  - **LabelChip runtime-hex `style`** can't migrate to a token-only Badge → **stays separate (F46)**; Badge exposes optional `style` passthrough for the future but LabelChip migration is out of scope.
  - **F36/F37+ consume the primitives later** — F35 ships them but wires nothing live (no migration; F46 owns that).
  - **F32 tokens closed** — F35 MUST NOT edit `index.css`; primitives use only the 25 `--color-*` utilities that already resolve (verified above). **No raw oklch/hex inside primitives.**
  - **No `bg-info`/`bg-critical`** → Badge variants map only to semantic backgrounds that exist (D7).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | `cn()` helper | **Add `clsx` + `tailwind-merge` deps; create `frontend/src/components/ui/cn.ts`** exporting `cn(...inputs) => twMerge(clsx(inputs))` (owner-confirmed 2026-06-26) | Required for variant+size+className merge (tailwind-merge dedupes conflicts like duplicate `px-*`). shadcn convention. PRD-silent → synthesis decides. **Adds 2 deps — owner-confirmed 2026-06-26.** |
| D2 | Button variants → token map | **`primary`=`bg-primary text-primary-foreground hover:bg-primary/90`; `secondary`=`bg-secondary text-secondary-foreground hover:bg-secondary/80`; `destructive`=`bg-destructive text-destructive-foreground hover:bg-destructive/90`; `ghost`=`hover:bg-accent hover:text-accent-foreground`; `outline`=`border border-border bg-background hover:bg-accent hover:text-accent-foreground`. Sizes: `sm`=`px-3 py-1.5 text-sm`; `md`=`px-4 py-2 text-sm`; `lg`=`px-5 py-2.5 text-base`. Base: `rounded-md font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none transition-colors`. `forwardRef<HTMLButtonElement>` + rest-spread; `type` defaults `'button'`.** | PRD §3.4 names variants + sizes (no classes/padding) → synthesis. §1.2 token mandate (no raw colors). One padding per size (kills the §2.5 3-button-size drift). |
| D3 | Field structure | **`<label>` (wrapping, optional `htmlFor`) + `<span className="mb-1 block text-sm font-medium">` + child + `<p role="alert" className="mt-1 text-sm text-destructive">` (only when error present).** | PRD §3.4 verbatim classes. Closes the ManualEntryForm `role="alert"` a11y gap (§2.5). |
| D4 | TextInput/Textarea | **PRD-exact class string** `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary` + `forwardRef<HTMLInputElement>`/`<HTMLTextAreaElement>` + rest-spread; Textarea adds `rows`/resize. | PRD §3.4 verbatim. Fixes ManualEntryForm `focus:` → `focus-visible:ring-2 ring-ring` gap. |
| D5 | SelectInput | **Native `<select>` wrapper reusing the TextInput-family classes** (`border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary`) + `forwardRef` + rest-spread. Dark-able via tokens. | PRD §3.4 native wrapper (themeable/dark-able). Consistent focus ring with TextInput family. |
| D6 | Avatar fallback chain | **`src` img → initials (per-word, e.g. "Ada Lovelace"→"AL") → lucide `User` icon fallback; `size` prop sm/md/lg (h-6/h-8/h-10); `rounded-full`; `bg-primary text-primary-foreground` for initials fallback. Consolidates `AssigneeAvatar` + `TopNav` into one source of truth.** | F35-spec mandate. PRD §3.3 sanctions `User` icon. Two divergent impls today (AssigneeAvatar vs TopNav) — Avatar is the single resolution. Per-word initials = `AssigneeAvatar`'s algo (more readable than `TopNav`'s `slice(0,2)`). |
| D7 | Badge variants | **`default`=`bg-primary text-primary-foreground`; `secondary`=`bg-secondary text-secondary-foreground`; `outline`=`border border-border text-foreground`; `destructive`/`danger`=`bg-destructive text-destructive-foreground`; `success`=`bg-success text-success-foreground`; `warning`=`bg-warning text-warning-foreground`. Shape: `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`. Optional `style` passthrough.** | PRD §3.4 (unifies PriorityBadge + label/status). F32 token set (only backgrounds that exist — no `bg-info`/`bg-critical`). `danger` aliases `destructive` (`--danger`==`--destructive`). **LabelChip (runtime-hex `style`) stays separate — F46.** |
| D8 | Card | **`bg-card border border-border rounded-lg` + children + className + optional `padding` prop (default none — surface only; consumers add `p-*`).** | PRD §3.4 verbatim classes. Surface-only keeps it composable (consumers control padding). |
| D9 | Tests | **Co-located `*.test.tsx` per primitive; RTL `getByRole` (`button`, `alert`, `combobox`) + `getByLabelText`; table-driven for Button variant×size; assert token classes present (jsdom can't compute color → assert className strings, like F32); >70% coverage.** | `js-testing-rules.md` (`getByRole` priority, table-driven, components >70%). jsdom color limitation acknowledged. |
| D10 | Scope | **Only `components/ui/` (8 primitives + `cn.ts`) + co-located tests + `clsx`/`tailwind-merge` dep adds. No migration (F46), no Radix (F36), no `index.css` edit, no live wiring, no raw colors.** | F35-spec. Prevents scope creep. |

> **Out of F35 scope (explicitly deferred):** migration of existing components to the new primitives (`AssigneeAvatar`, `PriorityBadge`, `LabelChip`, `TopNav`, `ManualEntryForm`, 59 `<button>` sites) — **F46** owns that. Radix-based primitives (Dropdown, Dialog, Tooltip) — **F36**. Any `index.css` edit — **F32 closed**. Live wiring into pages — **F37+**. Theme toggle — **F40**. LabelChip runtime-hex migration — **F46** (Badge exposes optional `style` passthrough for the future but does not absorb LabelChip now).

> **Owner sign-off (resolved 2026-06-26):** **D1 — `cn()` → add deps `clsx` + `tailwind-merge` + create `components/ui/cn.ts`.** Owner confirmed (yes). Inline-join alternative rejected (can't dedupe Tailwind conflicts). **D2 variant→token map** and **D6 Avatar fallback chain** remain synthesis decisions (PRD-silent); documented defaults above stand. No further sign-off blocking F35.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   ├─ package.json                    # MODIFIED — add deps: clsx, tailwind-merge
   └─ src/
      └─ components/
         └─ ui/                       # NEW dir (does not exist today)
            ├─ cn.ts                  # NEW — cn(...inputs) => twMerge(clsx(inputs)); shared helper (D1)
            ├─ cn.test.ts             # NEW — merge + conflict-dedupe (cn('px-2','px-4') → 'px-4')
            ├─ Button.tsx             # NEW — variants×sizes via cn(), forwardRef, rest-spread (D2)
            ├─ Button.test.tsx        # NEW — table-driven variant×size matrix
            ├─ Field.tsx              # NEW — label + span + child + role="alert" error (D3)
            ├─ Field.test.tsx         # NEW — getByRole('alert'), label association
            ├─ TextInput.tsx          # NEW — PRD-exact focus-ring classes, forwardRef (D4)
            ├─ Textarea.tsx           # NEW — sibling to TextInput, adds rows/resize (D4)
            ├─ TextInput.test.tsx     # NEW — focus-ring classes, ref forwarding, rest-spread
            ├─ SelectInput.tsx        # NEW — native <select> wrapper, input-family classes (D5)
            ├─ SelectInput.test.tsx   # NEW — getByRole('combobox'), options, token classes
            ├─ Avatar.tsx             # NEW — img→initials→User icon; size prop (D6)
            ├─ Avatar.test.tsx        # NEW — img src, initials, generic fallback, size
            ├─ Badge.tsx              # NEW — variant map via cn(), optional style passthrough (D7)
            ├─ Badge.test.tsx         # NEW — table-driven variants → className assertions
            ├─ Card.tsx               # NEW — bg-card border rounded-lg + children (D8)
            └─ Card.test.tsx          # NEW — renders children, token classes present
# NO index.css changes (F32 closed). NO migration (F46). NO Radix (F36). NO live wiring.
```

**Data flow:** every variant primitive (`Button`, `Badge`) imports `cn` from `./cn` and merges `cn(base, variants[variant], sizes[size], className)`. Non-variant primitives (`Field`, `TextInput`, `Textarea`, `SelectInput`, `Avatar`, `Card`) use `cn(base, className)` for consumer override. All primitives consume **only** F32 semantic-token utilities (no raw colors, no `dark:` color classes) — theme flips automatically via `@theme inline` + `:root`/`.dark`.

---

## 5. Parallelization Strategy

F35 is the **first feature with real parallelism**. **T1 (`cn.ts` + test) is the prerequisite** — every variant primitive imports it. After T1 lands, **Batch B primitives touch DISJOINT files** (one file+test per primitive) → safe to parallelize across devs.

### Batch dependency diagram

```
   Batch A (helper)          Batch B (primitives — DISJOINT files, parallel-safe)        Batch C (integration)
   ───────────────           ─────────────────────────────────────────────────────       ─────────────────────
       T1 ─────────────┬──────▶  T2 (Button)    ┐
   (cn.ts + cn.test)   ├──────▶  T3 (Field)     │
                       ├──────▶  T4 (TextInput+ │
                       │         Textarea)      ├──▶  T9 (verify + sign-off:
                       ├──────▶  T5 (Select)    │      exactly 17 files,
                       ├──────▶  T6 (Avatar)    │      gate green,
                       ├──────▶  T7 (Badge)     │      no migration/CSS/Radix)
                       └──────▶  T8 (Card)      ┘
```

- **Batch A → Batch B** is a hard barrier: every variant primitive's `import { cn } from './cn'` resolves only after T1 lands. Batch B branches off `main` containing T1.
- **Batch B → Batch C** is a hard barrier: T9 verifies the merged diff (exactly 17 files) and re-runs the full gate against all primitives together.

### Merge order rules

1. **Batch A merges first.** T1 (`cn.ts` + `cn.test.ts`) lands the shared helper. Must be on `main` before any Batch B primitive branches.
2. **Batch B merges in any order (after T1).** Each primitive is a file+test pair in `components/ui/` — disjoint, no merge conflicts. T2 (Button) is the most load-bearing (D2 synthesis); land it first if sequencing serially. T4 (TextInput+Textarea) pairs sibling inputs under one dev.
3. **Batch C (integration verification) merges last.** T9 confirms the committed diff is exactly `cn.ts` + 8 primitives + tests (~17 files) + `package.json` dep adds, re-runs the full gate, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/ui/cn.ts` (New), `cn.test.ts` (New), `frontend/package.json` (M — deps) | — | — |
| **T2** | B | `Button.tsx` + `Button.test.tsx` (New) | T1 | T3, T4, T5, T6, T7, T8 |
| **T3** | B | `Field.tsx` + `Field.test.tsx` (New) | T1 | T2, T4, T5, T6, T7, T8 |
| **T4** | B | `TextInput.tsx` + `Textarea.tsx` + `TextInput.test.tsx` (New) | T1 | T2, T3, T5, T6, T7, T8 |
| **T5** | B | `SelectInput.tsx` + `SelectInput.test.tsx` (New) | T1 | T2, T3, T4, T6, T7, T8 |
| **T6** | B | `Avatar.tsx` + `Avatar.test.tsx` (New) | T1 | T2, T3, T4, T5, T7, T8 |
| **T7** | B | `Badge.tsx` + `Badge.test.tsx` (New) | T1 | T2, T3, T4, T5, T6, T8 |
| **T8** | B | `Card.tsx` + `Card.test.tsx` (New) | T1 | T2, T3, T4, T5, T6, T7 |
| **T9** | C | no files changed (verification gate); records proof in §7 | T1-T8 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (sequential; ~17 files, each small).
- **2 devs:** Dev-A: T1 → T2 (Button) → T4 (inputs) → T6 (Avatar) → T9. Dev-B (after T1 lands): T3 (Field) → T5 (Select) → T7 (Badge) → T8 (Card). T9 merges last (single owner).
- **3 devs:** Dev-A: T1 solo. After T1 lands: Dev-A: T2 + T4 + T6; Dev-B: T3 + T5; Dev-C: T7 + T8. T9 by one owner after all merge. (For headless orchestration one author is fine, but the human-parallel structure is the point.)

---

## 6. Tasks

### T1 — `cn.ts` helper (+ test) + `clsx`/`tailwind-merge` deps

**Batch:** A · **Depends on:** None · **Parallel with:** —

**Description:** Create the shared className-merge helper every variant primitive imports. Add `clsx` (conditional class assembly) + `tailwind-merge` (Tailwind conflict dedupe — e.g. `px-2` + `px-4` → `px-4`). Create `frontend/src/components/ui/cn.ts` exporting `cn(...inputs) => twMerge(clsx(inputs))` (shadcn convention). Co-locate `cn.test.ts` asserting merge + conflict-dedupe.

**Owner sign-off:** D1 — adding 2 deps. Confirm before install.

Install deps (run from repo root; `-w frontend` scopes to the frontend workspace):

```bash
npm install -w frontend clsx tailwind-merge
```

Create `frontend/src/components/ui/cn.ts`:

```typescript
// F35 — Shared className-merge helper.
// Variant primitives (Button, Badge) merge base + variant + size + className;
// tailwind-merge dedupes Tailwind conflicts (e.g. 'px-2' + 'px-4' → 'px-4').
// shadcn convention.
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs))
}
```

Create `frontend/src/components/ui/cn.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
    const mergeCases = [
        { name: 'concatenates classes', input: ['a', 'b'], expected: 'a b' },
        { name: 'skips falsy', input: ['a', false, null, undefined, 'b'], expected: 'a b' },
        { name: 'handles object form', input: ['a', { b: true, c: false }], expected: 'a b' },
    ]
    mergeCases.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(cn(...(input as ClassValue[]))).toBe(expected)
        })
    })

    const dedupeCases = [
        { name: 'dedupes conflicting px-*', input: ['px-2', 'px-4'], expected: 'px-4' },
        { name: 'dedupes conflicting bg-*', input: ['bg-primary', 'bg-secondary'], expected: 'bg-secondary' },
        { name: 'keeps non-conflicting', input: ['px-2', 'py-1'], expected: 'px-2 py-1' },
    ]
    dedupeCases.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(cn(...input)).toBe(expected)
        })
    })
})
```

**Acceptance Criteria:**
- [ ] `npm install -w frontend clsx tailwind-merge` succeeds; both appear in `frontend/package.json` `dependencies`; **zero new peer-dependency warnings** (verify install output).
- [ ] `frontend/src/components/ui/cn.ts` created exporting `cn(...inputs: ClassValue[]): string` = `twMerge(clsx(inputs))`.
- [ ] `frontend/src/components/ui/cn.test.ts` created (co-located); covers merge (concat, falsy skip, object form) + conflict-dedupe (`px-2`+`px-4`→`px-4`, `bg-*` conflict).
- [ ] No `any` (style guide); `ClassValue` type imported.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- cn.test.ts` exits 0.

**Dependencies:** None.

---

### T2 — `Button.tsx` + `Button.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T3, T4, T5, T6, T7, T8

**Description:** Author the Button primitive per D2. Variants `primary|secondary|ghost|destructive|outline`; sizes `sm|md|lg` (one padding per size). Uses `cn()` to merge base + variant + size + className. `forwardRef<HTMLButtonElement>` + rest-spread (`type`, `disabled`, `form`, etc. — Modal/forms rely on native attrs); `type` defaults to `'button'`. All classes are F32 semantic-token utilities (no raw colors, no `dark:` color classes).

Create `frontend/src/components/ui/Button.tsx`:

```typescript
// F35 — Button primitive.
// Collapses the 59-<button> drift (3 sizes, divergent bg/text, missing focus rings)
// into one variant+size layer. forwardRef + rest-spread so Modal/forms can pass
// native button attrs (type, disabled, form). Tokens from F32 (no raw colors).
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'destructive'
    | 'outline'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: ButtonSize
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    outline: 'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
}

const BASE_CLASSES =
    'inline-flex items-center justify-center rounded-md font-medium ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ' +
    'transition-colors'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', type = 'button', className, ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
            {...rest}
        />
    )
})
```

Create `frontend/src/components/ui/Button.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Button, type ButtonVariant, type ButtonSize } from './Button'

describe('Button', () => {
    const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive', 'outline']
    const sizes: ButtonSize[] = ['sm', 'md', 'lg']

    // Table-driven variant × size matrix — assert token classes present.
    for (const variant of variants) {
        for (const size of sizes) {
            it(`renders variant=${variant} size=${size} as role=button`, () => {
                render(<Button variant={variant} size={size}>Click</Button>)
                const btn = screen.getByRole('button', { name: 'Click' })
                expect(btn).toBeInTheDocument()
                // Spot-check a token per variant (jsdom can't compute color).
                if (variant === 'primary') expect(btn.className).toContain('bg-primary')
                if (variant === 'destructive') expect(btn.className).toContain('bg-destructive')
                // Spot-check padding per size (one padding per size — kills §2.5 drift).
                if (size === 'sm') expect(btn.className).toContain('px-3 py-1.5')
                if (size === 'lg') expect(btn.className).toContain('px-5 py-2.5')
            })
        }
    }

    it('defaults to variant=primary size=md', () => {
        render(<Button>X</Button>)
        const btn = screen.getByRole('button')
        expect(btn.className).toContain('bg-primary')
        expect(btn.className).toContain('px-4 py-2')
    })

    it('defaults type to button', () => {
        render(<Button>X</Button>)
        expect(screen.getByRole('button').getAttribute('type')).toBe('button')
    })

    it('forwards type/disabled/form rest props', () => {
        render(
            <Button type="submit" disabled form="my-form">
                X
            </Button>,
        )
        const btn = screen.getByRole('button')
        expect(btn.getAttribute('type')).toBe('submit')
        expect(btn).toBeDisabled()
        expect(btn.getAttribute('form')).toBe('my-form')
    })

    it('forwards ref', () => {
        const ref = createRef<HTMLButtonElement>()
        render(<Button ref={ref}>X</Button>)
        expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    })

    it('merges className (consumer override via tailwind-merge)', () => {
        render(<Button className="px-10">X</Button>)
        // tailwind-merge: consumer px-10 wins over size default px-4.
        expect(screen.getByRole('button').className).toContain('px-10')
        expect(screen.getByRole('button').className).not.toContain('px-4')
    })
})
```

**Acceptance Criteria:**
- [ ] `Button.tsx` created with `ButtonProps` (extends `ButtonHTMLAttributes`, `variant?`, `size?`); `Button` is `forwardRef<HTMLButtonElement>`.
- [ ] Variants `primary|secondary|ghost|destructive|outline`; sizes `sm|md|lg`; one padding per size (D2).
- [ ] All classes are F32 token utilities (no raw colors, no `dark:` color classes).
- [ ] `type` defaults to `'button'`; rest props (`type`, `disabled`, `form`) spread.
- [ ] `cn()` merges base + variant + size + className; tailwind-merge dedupes (`px-4` vs consumer `px-10`).
- [ ] `Button.test.tsx` co-located; table-driven variant×size matrix via `getByRole('button')`; className assertions; ref forwarding; rest-spread; className override.
- [ ] No `any`; explicit `ButtonProps`/`ButtonVariant`/`ButtonSize` interfaces.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Button.test.tsx` exits 0.

**Dependencies:** T1.

---

### T3 — `Field.tsx` + `Field.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T2, T4, T5, T6, T7, T8

**Description:** Author the Field primitive per D3 — unifies the label/error markup drift (PRD §3.4 exact classes). `<label>` (wrapping, optional `htmlFor`) + `<span className="mb-1 block text-sm font-medium">` label + child input + `<p role="alert" className="mt-1 text-sm text-destructive">` error (only when error present). Closes the ManualEntryForm `role="alert"` a11y gap (§2.5).

Create `frontend/src/components/ui/Field.tsx`:

```typescript
// F35 — Field primitive.
// Unifies label/error markup drift (TicketAttributeForm vs ManualEntryForm).
// <label> + <span> label + child input + <p role="alert"> error (only when present).
// Closes the §2.5 ManualEntryForm role="alert" a11y gap.
import { createElement, type ReactNode } from 'react'
import { cn } from './cn'

export interface FieldProps {
    /** Label text (rendered inside a <span>). */
    label: string
    /** Optional id to associate the label with a control via htmlFor. */
    htmlFor?: string
    /** The control (TextInput, SelectInput, etc.). */
    children: ReactNode
    /** Error message; when present, rendered as <p role="alert">. */
    error?: string
    /** Optional className for the wrapping <label>. */
    className?: string
}

export function Field({ label, htmlFor, children, error, className }: FieldProps) {
    return (
        <label htmlFor={htmlFor} className={cn('block', className)}>
            <span className="mb-1 block text-sm font-medium">{label}</span>
            {children}
            {error ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                    {error}
                </p>
            ) : null}
        </label>
    )
}
```

Create `frontend/src/components/ui/Field.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field'

describe('Field', () => {
    it('renders the label text', () => {
        render(
            <Field label="Title">
                <input />
            </Field>,
        )
        expect(screen.getByText('Title')).toBeInTheDocument()
    })

    it('renders role=alert when error is present', () => {
        render(
            <Field label="Title" error="Required">
                <input />
            </Field>,
        )
        expect(screen.getByRole('alert')).toHaveTextContent('Required')
    })

    it('does NOT render role=alert when error is absent', () => {
        render(
            <Field label="Title">
                <input />
            </Field>,
        )
        expect(screen.queryByRole('alert')).toBeNull()
    })

    it('associates label with control via htmlFor', () => {
        render(
            <Field label="Title" htmlFor="title-input">
                <input id="title-input" />
            </Field>,
        )
        const label = screen.getByText('Title').closest('label')
        expect(label?.getAttribute('for')).toBe('title-input')
    })

    it('renders children', () => {
        render(
            <Field label="Title">
                <input data-testid="child-input" />
            </Field>,
        )
        expect(screen.getByTestId('child-input')).toBeInTheDocument()
    })
})
```

**Acceptance Criteria:**
- [ ] `Field.tsx` created with `FieldProps` (`label`, `htmlFor?`, `children`, `error?`, `className?`).
- [ ] Renders `<label>` + `<span className="mb-1 block text-sm font-medium">` + child + `<p role="alert" className="mt-1 text-sm text-destructive">` (only when `error`).
- [ ] `Field.test.tsx` co-located; `getByRole('alert')` when error present; absent when no error; label association via `htmlFor`; children render.
- [ ] No `any`; explicit `FieldProps`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Field.test.tsx` exits 0.

**Dependencies:** T1.

---

### T4 — `TextInput.tsx` + `Textarea.tsx` + `TextInput.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T2, T3, T5, T6, T7, T8

**Description:** Author the two text-input primitives per D4 — PRD §3.4 verbatim class string with `focus-visible:ring-2 ring-ring` (fixes the ManualEntryForm `focus:` gap). Both `forwardRef` + rest-spread. Textarea adds `rows`/resize. Pairs sibling inputs under one dev (shared class string + shared test approach).

Create `frontend/src/components/ui/TextInput.tsx`:

```typescript
// F35 — TextInput primitive.
// PRD §3.4 verbatim focus-ring classes. Fixes ManualEntryForm focus: → focus-visible:ring-2 gap (§2.5).
// forwardRef + rest-spread so Field/forms can wire native attrs.
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from './cn'

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>

const BASE_CLASSES =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary'

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
    function TextInput({ className, ...rest }, ref) {
        return <input ref={ref} className={cn(BASE_CLASSES, className)} {...rest} />
    },
)
```

Create `frontend/src/components/ui/Textarea.tsx`:

```typescript
// F35 — Textarea primitive.
// Sibling to TextInput (shared focus-ring classes). Adds resize + rows defaults.
// PRD §3.4 verbatim focus-ring classes.
import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

const BASE_CLASSES =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary resize-y'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    function Textarea({ className, ...rest }, ref) {
        return <textarea ref={ref} className={cn(BASE_CLASSES, className)} {...rest} />
    },
)
```

Create `frontend/src/components/ui/TextInput.test.tsx` (covers both siblings):

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { TextInput } from './TextInput'
import { Textarea } from './Textarea'

describe('TextInput', () => {
    it('renders as textbox with focus-ring token classes', () => {
        render(<TextInput placeholder="Title" />)
        const input = screen.getByRole('textbox')
        expect(input.className).toContain('border-input')
        expect(input.className).toContain('focus-visible:ring-2')
        expect(input.className).toContain('focus-visible:ring-ring')
        expect(input.className).toContain('focus-visible:border-primary')
    })

    it('forwards ref', () => {
        const ref = createRef<HTMLInputElement>()
        render(<TextInput ref={ref} />)
        expect(ref.current).toBeInstanceOf(HTMLInputElement)
    })

    it('spreads rest props (placeholder, type)', () => {
        render(<TextInput placeholder="Email" type="email" />)
        const input = screen.getByRole('textbox') as HTMLInputElement
        expect(input.placeholder).toBe('Email')
        expect(input.type).toBe('email')
    })
})

describe('Textarea', () => {
    it('renders as textbox with focus-ring token classes', () => {
        render(<Textarea placeholder="Notes" />)
        const ta = screen.getByRole('textbox')
        expect(ta.className).toContain('border-input')
        expect(ta.className).toContain('focus-visible:ring-2')
        expect(ta.className).toContain('resize-y')
    })

    it('forwards rows rest prop', () => {
        render(<Textarea rows={5} />)
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).rows).toBe(5)
    })
})
```

**Acceptance Criteria:**
- [ ] `TextInput.tsx` + `Textarea.tsx` created with exact PRD §3.4 class string (`border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary`).
- [ ] Both `forwardRef` (`HTMLInputElement` / `HTMLTextAreaElement`) + rest-spread.
- [ ] Textarea adds `resize-y`.
- [ ] `TextInput.test.tsx` co-located (covers both siblings); focus-ring classes present; ref forwarding; rest props (`placeholder`, `type`, `rows`) spread.
- [ ] No `any`; explicit `TextInputProps`/`TextareaProps`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- TextInput.test.tsx` exits 0.

**Dependencies:** T1.

---

### T5 — `SelectInput.tsx` + `SelectInput.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T2, T3, T4, T6, T7, T8

**Description:** Author the SelectInput primitive per D5 — native `<select>` wrapper reusing the TextInput-family focus-ring classes (themeable/dark-able via tokens). `forwardRef` + rest-spread. Options passed as children (`<option>`) — keeps the native API intact (forms rely on it).

Create `frontend/src/components/ui/SelectInput.tsx`:

```typescript
// F35 — SelectInput primitive.
// Native <select> wrapper (themeable, dark-able via tokens). Reuses TextInput-family
// focus-ring classes for visual consistency. forwardRef + rest-spread.
// Options passed as <option> children — keeps native form API intact.
import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'

export type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement>

const BASE_CLASSES =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary'

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(
    function SelectInput({ className, children, ...rest }, ref) {
        return (
            <select ref={ref} className={cn(BASE_CLASSES, className)} {...rest}>
                {children}
            </select>
        )
    },
)
```

Create `frontend/src/components/ui/SelectInput.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { SelectInput } from './SelectInput'

describe('SelectInput', () => {
    it('renders as combobox with focus-ring token classes', () => {
        render(
            <SelectInput>
                <option value="a">A</option>
            </SelectInput>,
        )
        const select = screen.getByRole('combobox')
        expect(select.className).toContain('border-input')
        expect(select.className).toContain('focus-visible:ring-2')
        expect(select.className).toContain('focus-visible:ring-ring')
    })

    it('renders option children', () => {
        render(
            <SelectInput>
                <option value="a">Alpha</option>
                <option value="b">Bravo</option>
            </SelectInput>,
        )
        const select = screen.getByRole('combobox') as HTMLSelectElement
        expect(select.options.length).toBe(2)
        expect(select.options[0].text).toBe('Alpha')
    })

    it('forwards ref', () => {
        const ref = createRef<HTMLSelectElement>()
        render(
            <SelectInput ref={ref}>
                <option>x</option>
            </SelectInput>,
        )
        expect(ref.current).toBeInstanceOf(HTMLSelectElement)
    })
})
```

**Acceptance Criteria:**
- [ ] `SelectInput.tsx` created wrapping native `<select>` with input-family focus-ring classes.
- [ ] `forwardRef<HTMLSelectElement>` + rest-spread; children (options) rendered.
- [ ] `SelectInput.test.tsx` co-located; `getByRole('combobox')` (native select role); options render; ref forwarding; token classes present.
- [ ] No `any`; explicit `SelectInputProps`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- SelectInput.test.tsx` exits 0.

**Dependencies:** T1.

---

### T6 — `Avatar.tsx` + `Avatar.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T2, T3, T4, T5, T7, T8

**Description:** Author the Avatar primitive per D6 — consolidates `AssigneeAvatar` + `TopNav` initials/img logic into one source of truth. Fallback chain: `src` img → initials (per-word algo, "Ada Lovelace"→"AL") → lucide `User` icon. `size` prop sm/md/lg (h-6/h-8/h-10). `rounded-full`; `bg-primary text-primary-foreground` for initials fallback. Single resolution of the two divergent impls.

Create `frontend/src/components/ui/Avatar.tsx`:

```typescript
// F35 — Avatar primitive.
// Consolidates AssigneeAvatar + TopNav initials/img logic into one source of truth.
// Fallback chain: src img → initials (per-word, "Ada Lovelace"→"AL") → lucide User icon.
// size prop sm/md/lg (h-6/h-8/h-10). bg-primary text-primary-foreground for initials.
import { User } from 'lucide-react'
import { cn } from './cn'

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps {
    /** Image URL; if provided and loads, renders as <img>. */
    src?: string | null
    /** Display name; used for initials fallback + alt text. */
    name?: string | null
    /** Size token. */
    size?: AvatarSize
    /** Optional className override. */
    className?: string
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
    sm: 'h-6 w-6 text-xs',
    md: 'h-8 w-8 text-sm',
    lg: 'h-10 w-10 text-base',
}

const ICON_SIZE: Record<AvatarSize, number> = {
    sm: 14,
    md: 16,
    lg: 20,
}

/** Per-word initials: "Ada Lovelace" → "AL", "munna" → "M". Caps, slice(0,2). */
function getInitials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase()
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
    const sizeClass = SIZE_CLASSES[size]
    const ringClass = 'rounded-full inline-flex items-center justify-center overflow-hidden'

    if (src) {
        return (
            <img
                src={src}
                alt={name ?? 'avatar'}
                className={cn(sizeClass, ringClass, className)}
            />
        )
    }

    if (name) {
        return (
            <span
                className={cn(
                    sizeClass,
                    ringClass,
                    'bg-primary text-primary-foreground font-medium',
                    className,
                )}
                aria-label={name}
            >
                {getInitials(name)}
            </span>
        )
    }

    // Generic fallback (no src, no name).
    return (
        <span
            className={cn(
                sizeClass,
                ringClass,
                'bg-muted text-muted-foreground',
                className,
            )}
            aria-label="Unassigned"
        >
            <User size={ICON_SIZE[size]} aria-hidden="true" />
        </span>
    )
}
```

Create `frontend/src/components/ui/Avatar.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from './Avatar'

describe('Avatar', () => {
    it('renders img when src is provided', () => {
        render(<Avatar src="https://example.com/a.png" name="Ada" />)
        const img = screen.getByRole('img', { name: 'Ada' })
        expect(img.getAttribute('src')).toBe('https://example.com/a.png')
    })

    const initialsCases = [
        { name: 'two words', input: 'Ada Lovelace', expected: 'AL' },
        { name: 'one word', input: 'munna', expected: 'M' },
        { name: 'three words takes first two', input: 'Ada Blue Lovelace', expected: 'AB' },
    ]
    initialsCases.forEach(({ name: caseName, input, expected }) => {
        it(`initials fallback: ${caseName} ("${input}" → "${expected}")`, () => {
            render(<Avatar name={input} />)
            expect(screen.getByLabelText(input)).toHaveTextContent(expected)
        })
    })

    it('renders generic User icon fallback when no src/name', () => {
        render(<Avatar />)
        // No img, no initials span — just the aria-label="Unassigned" wrapper.
        expect(screen.getByLabelText('Unassigned')).toBeInTheDocument()
    })

    it('applies size class', () => {
        const { rerender } = render(<Avatar name="Ada" size="sm" />)
        expect(screen.getByLabelText('Ada').className).toContain('h-6 w-6')
        rerender(<Avatar name="Ada" size="lg" />)
        expect(screen.getByLabelText('Ada').className).toContain('h-10 w-10')
    })
})
```

**Acceptance Criteria:**
- [ ] `Avatar.tsx` created with `AvatarProps` (`src?`, `name?`, `size?`, `className?`); `AvatarSize = 'sm' | 'md' | 'lg'`.
- [ ] Fallback chain: `src` img → initials (per-word, "Ada Lovelace"→"AL") → lucide `User` icon (D6).
- [ ] Size sm/md/lg → h-6/h-8/h-10; `rounded-full`; `bg-primary text-primary-foreground` for initials; `bg-muted text-muted-foreground` for generic.
- [ ] `Avatar.test.tsx` co-located; img src renders; initials table-driven; generic fallback (no name/src); size class.
- [ ] No `any`; explicit `AvatarProps`/`AvatarSize`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Avatar.test.tsx` exits 0.

**Dependencies:** T1 (and `lucide-react` — verify already present in `frontend/package.json`; it powers `TopNav`/icons today, so it's an existing dep — confirm during T1 install).

---

### T7 — `Badge.tsx` + `Badge.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T2, T3, T4, T5, T6, T8

**Description:** Author the Badge primitive per D7 — variant map via `cn()`. Variants `default|secondary|outline|destructive|danger|success|warning` mapped to F32 semantic tokens (no `bg-info`/`bg-critical` — those don't exist). `danger` aliases `destructive` (`--danger`==`--destructive`). Optional `style` passthrough (for LabelChip's future — F46; LabelChip itself stays separate). Shape `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`.

Create `frontend/src/components/ui/Badge.tsx`:

```typescript
// F35 — Badge primitive.
// Unifies PriorityBadge + label/status badges. Variant map → F32 semantic tokens.
// No bg-info/bg-critical (those don't exist); danger aliases destructive (--danger==--destructive).
// Optional style passthrough for LabelChip's future (F46); LabelChip itself stays separate.
import { type CSSProperties, type ReactNode } from 'react'
import { cn } from './cn'

export type BadgeVariant =
    | 'default'
    | 'secondary'
    | 'outline'
    | 'destructive'
    | 'danger'
    | 'success'
    | 'warning'

export interface BadgeProps {
    children: ReactNode
    variant?: BadgeVariant
    /** Optional style passthrough (for LabelChip's runtime-hex future — F46). */
    style?: CSSProperties
    className?: string
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border text-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
    // danger aliases destructive (--danger aliases --destructive in F32).
    danger: 'bg-destructive text-destructive-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
}

const BASE_CLASSES = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'

export function Badge({ children, variant = 'default', style, className }: BadgeProps) {
    return (
        <span className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], className)} style={style}>
            {children}
        </span>
    )
}
```

Create `frontend/src/components/ui/Badge.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, type BadgeVariant } from './Badge'

describe('Badge', () => {
    const variants: BadgeVariant[] = [
        'default',
        'secondary',
        'outline',
        'destructive',
        'danger',
        'success',
        'warning',
    ]

    // Table-driven variants → className assertions (jsdom can't compute color).
    const expectedToken: Record<BadgeVariant, string> = {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border-border',
        destructive: 'bg-destructive',
        danger: 'bg-destructive', // aliases destructive
        success: 'bg-success',
        warning: 'bg-warning',
    }

    for (const variant of variants) {
        it(`variant=${variant} applies token ${expectedToken[variant]}`, () => {
            render(<Badge variant={variant}>x</Badge>)
            // Badge is a <span> with no implicit role; query by text.
            const badge = screen.getByText('x')
            expect(badge.className).toContain(expectedToken[variant])
            expect(badge.className).toContain('rounded-full')
        })
    }

    it('defaults to variant=default', () => {
        render(<Badge>x</Badge>)
        expect(screen.getByText('x').className).toContain('bg-primary')
    })

    it('applies style passthrough', () => {
        render(
            <Badge style={{ backgroundColor: '#abcdef' }}>x</Badge>,
        )
        expect((screen.getByText('x') as HTMLElement).style.backgroundColor).toBe('rgb(171, 205, 239)')
    })
})
```

> **Note on `style` usage:** Badge accepts an optional `style` passthrough to support LabelChip's runtime-hex future (F46). This is the **one** exception to "no inline styles" — the style guide rule targets primitive styling, not dynamic consumer data (LabelChip's color is data, not presentation choice). LabelChip itself is NOT migrated in F35 (F46 owns it).

**Acceptance Criteria:**
- [ ] `Badge.tsx` created with `BadgeProps` (`children`, `variant?`, `style?`, `className?`); `BadgeVariant` union.
- [ ] Variants `default|secondary|outline|destructive|danger|success|warning`; `danger` aliases `destructive`.
- [ ] All classes are F32 token utilities (no `bg-info`/`bg-critical`; no raw colors).
- [ ] Shape `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`; optional `style` passthrough.
- [ ] `Badge.test.tsx` co-located; table-driven variants → className assertions; default variant; style passthrough.
- [ ] No `any`; explicit `BadgeProps`/`BadgeVariant`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Badge.test.tsx` exits 0.

**Dependencies:** T1.

---

### T8 — `Card.tsx` + `Card.test.tsx`

**Batch:** B · **Depends on:** T1 (`cn`) · **Parallel with:** T2, T3, T4, T5, T6, T7

**Description:** Author the Card primitive per D8 — `bg-card border border-border rounded-lg` surface + children + className. Surface-only (no default padding — consumers add `p-*`). The simplest primitive.

Create `frontend/src/components/ui/Card.tsx`:

```typescript
// F35 — Card primitive.
// Surface-only: bg-card border border-border rounded-lg. No default padding
// (consumers add p-*). Token-driven (auto theme-flip via F32).
import { type ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps {
    children: ReactNode
    className?: string
}

export function Card({ children, className }: CardProps) {
    return (
        <div className={cn('bg-card border border-border rounded-lg', className)}>
            {children}
        </div>
    )
}
```

Create `frontend/src/components/ui/Card.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
    it('renders children', () => {
        render(
            <Card>
                <span>content</span>
            </Card>,
        )
        expect(screen.getByText('content')).toBeInTheDocument()
    })

    it('applies token surface classes', () => {
        render(<Card>x</Card>)
        const card = screen.getByText('x').parentElement
        expect(card?.className).toContain('bg-card')
        expect(card?.className).toContain('border-border')
        expect(card?.className).toContain('rounded-lg')
    })

    it('merges consumer className', () => {
        render(<Card className="p-4">x</Card>)
        expect(screen.getByText('x').parentElement?.className).toContain('p-4')
    })
})
```

**Acceptance Criteria:**
- [ ] `Card.tsx` created with `CardProps` (`children`, `className?`).
- [ ] Renders `bg-card border border-border rounded-lg` + children; surface-only (no default padding).
- [ ] `Card.test.tsx` co-located; renders children; token classes present; className merge.
- [ ] No `any`; explicit `CardProps`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Card.test.tsx` exits 0.

**Dependencies:** T1.

---

### T9 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1-T8 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the `components/ui/` files (`cn.ts` + 8 primitives + tests; ~17 files) plus `package.json` dep adds, re-run the full gate green, confirm no `index.css`/migration/Radix/live-wiring leakage, confirm `@/components/ui/*` importable, and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the F35 files:
   ```bash
   git diff --name-only main...HEAD | sort
   # Expected (~17 files + package.json/package-lock):
   # frontend/package.json
   # frontend/package-lock.json   (or pnpm-lock.yaml / yarn.lock — whichever the repo uses)
   # frontend/src/components/ui/Avatar.test.tsx
   # frontend/src/components/ui/Avatar.tsx
   # frontend/src/components/ui/Badge.test.tsx
   # frontend/src/components/ui/Badge.tsx
   # frontend/src/components/ui/Button.test.tsx
   # frontend/src/components/ui/Button.tsx
   # frontend/src/components/ui/Card.test.tsx
   # frontend/src/components/ui/Card.tsx
   # frontend/src/components/ui/Field.test.tsx
   # frontend/src/components/ui/Field.tsx
   # frontend/src/components/ui/SelectInput.test.tsx
   # frontend/src/components/ui/SelectInput.tsx
   # frontend/src/components/ui/TextInput.test.tsx
   # frontend/src/components/ui/TextInput.tsx
   # frontend/src/components/ui/Textarea.tsx
   # frontend/src/components/ui/cn.test.ts
   # frontend/src/components/ui/cn.ts
   ```
   Any other path (an `index.css` edit, a migration, a Radix import, a migrated `AssigneeAvatar.tsx`, a live-wired page) → leaked; remove and re-commit. F35 owns no CSS, no migration, no Radix, no live wiring (F32/F46/F36/F37+ scopes preserved).
2. Re-run the full gate on the merged state:
   ```bash
   npm install                            # clean install (picks up clsx + tailwind-merge)
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. all *.test.tsx in ui/ + full regression)
   ```
3. Confirm `frontend/src/index.css` is **unchanged** vs main (F32 closed — F35 touches zero CSS):
   ```bash
   git diff --quiet main...HEAD -- frontend/src/index.css \
     && echo "index.css: UNCHANGED (F32 preserved)" \
     || echo "index.css: CHANGED (out of scope — revert)"
   ```
   Must print UNCHANGED.
4. Confirm no migration / Radix / live-wiring leakage:
   ```bash
   git diff --name-only main...HEAD | grep -Ei '(drizzle|prisma|migrations|radix|@radix)' \
     && echo "LEAKED migration/Radix" || echo "no migration/Radix leakage"
   # Confirm none of the existing components were migrated (F46 owns that):
   git diff --name-only main...HEAD | grep -Ei '(AssigneeAvatar|PriorityBadge|LabelChip|TopNav|ManualEntryForm)\.tsx$' \
     && echo "LEAKED F46 migration" || echo "no migration (F46 preserved)"
   ```
   Both must print the clean messages.
5. Confirm `cn()` is imported by the variant primitives (Button, Badge):
   ```bash
   grep -l "from './cn'" frontend/src/components/ui/Button.tsx frontend/src/components/ui/Badge.tsx | wc -l
   ```
   Must print `2`.
6. Confirm every primitive uses ONLY F32 semantic-token utilities (no raw Tailwind colors, no `dark:` color classes):
   ```bash
   # No raw slate/blue/red/amber/orange/green hex-named Tailwind colors inside ui/.
   grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' frontend/src/components/ui/ \
     && echo "RAW COLOR FOUND (BUG — must use tokens)" || echo "token-only: OK"
   # No dark: color classes inside ui/ (tokens auto-flip via F32).
   grep -REn 'dark:(bg|text|border)-' frontend/src/components/ui/ \
     && echo "dark: color class FOUND (BUG — tokens carry theme)" || echo "no dark: color classes: OK"
   ```
   Both must print the OK messages.
7. Confirm `@/components/ui/*` is importable (build already proved this; explicit smoke):
   ```bash
   node -e "console.log(require('./frontend/src/components/ui/Button.tsx'))" 2>/dev/null \
     || echo "ESM/TS — verify via 'npm run build -w frontend' (already run in step 2)"
   ```
   The build in step 2 is the authoritative importability proof (TS + Vite resolve `@/` → `src/`).
8. Capture commit SHA, dep versions, exit codes, and primitive count into §7. Confirm owner sign-off on D1 (cn adds deps), D2 (variant map), D6 (Avatar chain).

**Acceptance Criteria:**
- [ ] Committed diff is exactly `cn.ts` + 8 primitives + co-located tests (~17 files) + `frontend/package.json` (+ lockfile) — no HTML/CSS/migration/Radix/live-wiring/F46 leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. all `ui/*.test.tsx` + full regression).
- [ ] `frontend/src/index.css` unchanged vs main (F32 preserved).
- [ ] No migration/Radix leakage (F36/F46/F37+ scopes preserved).
- [ ] No migrated `AssigneeAvatar`/`PriorityBadge`/`LabelChip`/`TopNav`/`ManualEntryForm` (F46 preserved).
- [ ] `cn()` imported by Button + Badge (variant primitives).
- [ ] No raw Tailwind colors inside `ui/` (token-only — §1.2).
- [ ] No `dark:` color classes inside `ui/` (tokens auto-flip — F32).
- [ ] `@/components/ui/*` importable (build proves TS+Vite resolve `@/`).
- [ ] All F35 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] Owner sign-off on D1 (deps), D2 (variant map), D6 (Avatar chain) recorded.

**Dependencies:** T1, T2, T3, T4, T5, T6, T7, T8.

---

## 7. Final F35 Acceptance Checklist

- [ ] `frontend/src/components/ui/` created (new dir) with `cn.ts` + 8 primitives (`Button`, `Field`, `TextInput`, `Textarea`, `SelectInput`, `Avatar`, `Badge`, `Card`).
- [ ] `Button` — variants `primary|secondary|ghost|destructive|outline`; sizes `sm|md|lg`; one padding per size; `forwardRef` + rest-spread; `type` defaults `'button'`; F32 tokens (D2).
- [ ] `Field` — `<label>` + `<span className="mb-1 block text-sm font-medium">` + child + `<p role="alert" className="mt-1 text-sm text-destructive">` (only when error) (D3).
- [ ] `TextInput`/`Textarea` — PRD-exact `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary` (D4).
- [ ] `SelectInput` — native `<select>` wrapper, input-family focus-ring classes (D5).
- [ ] `Avatar` — img → initials (per-word) → lucide `User`; size sm/md/lg (h-6/h-8/h-10); `bg-primary text-primary-foreground` initials (D6).
- [ ] `Badge` — variants `default|secondary|outline|destructive|danger|success|warning`; F32 tokens; optional `style` passthrough (D7).
- [ ] `Card` — `bg-card border border-border rounded-lg` surface-only (D8).
- [ ] Co-located `*.test.tsx` per primitive; RTL `getByRole`/`getByLabelText`; table-driven where applicable (Button variant×size, Avatar initials, Badge variants).
- [ ] `cn.ts` shared helper (`twMerge(clsx(inputs))`) imported by Button + Badge; `clsx` + `tailwind-merge` deps added (D1).
- [ ] Every primitive uses ONLY F32 semantic-token utilities (no raw colors, no `dark:` color classes — §1.2).
- [ ] No `any` (style guide); explicit prop interfaces; PascalCase files; 4-space JSX / 2-space TS; ≤100 cols; trailing commas.
- [ ] `frontend/src/index.css` unchanged (F32 preserved).
- [ ] No migration (F46 preserved); no Radix (F36 preserved); no live wiring (F37+ preserved).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. all `ui/*.test.tsx` + full regression).
- [ ] Committed diff is exactly `cn.ts` + 8 primitives + co-located tests (~17 files) + `package.json` (+ lockfile).

**Integration record (fill during T9):**
- Feature commit SHA: `________`
- Diff = exactly ~17 files in `components/ui/` + `package.json` (+ lockfile); no HTML/CSS/migration/Radix/live-wiring leakage: `PASS/FAIL`
- `cn()` imported by Button + Badge: `2/2`
- Deps added (`clsx`, `tailwind-merge`) versions: `clsx ____ · tailwind-merge ____`
- Zero new peer-dependency warnings on install: `PASS/FAIL`
- `Button.test.tsx` result: `__/__ pass` (variant×size matrix + defaults + rest-spread + ref + className override)
- `Field.test.tsx` result: `__/__ pass` (role=alert present/absent + label assoc + children)
- `TextInput.test.tsx` result: `__/__ pass` (TextInput + Textarea focus-ring + ref + rest)
- `SelectInput.test.tsx` result: `__/__ pass` (combobox role + options + ref)
- `Avatar.test.tsx` result: `__/__ pass` (img + initials table-driven + generic fallback + size)
- `Badge.test.tsx` result: `__/__ pass` (variant table-driven + default + style passthrough)
- `Card.test.tsx` result: `__/__ pass` (children + token classes + className merge)
- `cn.test.ts` result: `__/__ pass` (merge + conflict-dedupe)
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- No raw colors inside `ui/`: `token-only: OK`
- No `dark:` color classes inside `ui/`: `OK`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- D1 owner sign-off (cn adds deps `clsx` + `tailwind-merge`): `recorded (date: ________)`
- D2 owner sign-off (Button variant→token map): `recorded / adjusted (date: ________)`
- D6 owner sign-off (Avatar fallback chain): `recorded / adjusted (date: ________)`
- F32 token re-use confirmed: `all primitives use only the 25 --color-* mappings from index.css:95-132`

---

## 8. Schema deltas owned by this feature

F35 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance) and **no CSS token additions** (F32 owns and has closed those — `index.css:95-132` is frozen). F35 touches only the new `frontend/src/components/ui/` directory (8 primitives + `cn.ts` + co-located tests) and adds two JS dependencies to `frontend/package.json` (a dep delta, not a schema delta).

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| Shared className-merge helper | `cn(...inputs) => twMerge(clsx(inputs))` — imported by variant primitives (Button, Badge) | new `frontend/src/components/ui/cn.ts` |
| 8 UI primitives | `Button` (D2), `Field` (D3), `TextInput`+`Textarea` (D4), `SelectInput` (D5), `Avatar` (D6), `Badge` (D7), `Card` (D8) — all token-only | new `frontend/src/components/ui/{Button,Field,TextInput,Textarea,SelectInput,Avatar,Badge,Card}.tsx` |
| Co-located tests | RTL `getByRole`/`getByLabelText`; table-driven variant×size / initials / badge matrices; className assertions (jsdom can't compute color) | new `frontend/src/components/ui/*.test.tsx` (8 primitive tests + `cn.test.ts`) |
| Dependency additions (dep delta, NOT schema) | `clsx` + `tailwind-merge` added to `frontend/package.json` `dependencies` (D1) | `npm install -w frontend clsx tailwind-merge` |
