# Task Breakdown — SLYK-11 (Ticket Details Modal Tabbed Layout)

**Source plan:** `docs/deliverables/SLYK-11-plan.md`
**Scope:** Frontend-only. Restructure `TicketDetailModal` body into three accessible tabs (Details / Time Tracking / Activity). No backend, schema, migration, or API changes.
**Generated:** 2026-06-30

---

## Verified codebase facts (Phase 1 analyst evidence)

The plan's line references drifted ~15–25 lines low. These **verified** line numbers are the source of truth for every task below:

| File / Block | Verified lines |
|---|---|
| `frontend/package.json` — `@radix-ui/react-dropdown-menu` `^2`, `@radix-ui/react-tooltip` `^1.2.10` | `:17-18` |
| `@radix-ui/react-tabs` | **NOT present** (genuinely required to add) |
| `frontend/src/components/ui/` primitives | `Avatar`, `Badge`, `Button`, `Card`, `Dropdown`, `Field`, `SelectInput`, `Textarea`, `TextInput`, `Tooltip`, `cn.ts` — **no `Tabs.tsx`** |
| `cn.ts` signature | `cn(...inputs) = twMerge(clsx(inputs))` — `cn.ts:7` |
| `Button.tsx` — `VARIANT_CLASSES` map | `:18-24` |
| `Button.tsx` — `forwardRef` Button + `cn` merge | `:38-49` (focus-visible ring at `:27-28`) |
| `Dropdown.tsx` — compound Radix wrapper (template for Tabs) | full file `:1-111`; import shape `Dropdown.tsx:6` |
| `tokens.test.ts` — raw hex banned, semantic tokens valid | `:95-105`; `bg-accent`, `text-muted-foreground`, `border-border`, `ring-ring`, `text-accent-foreground` all backed by `ROOT_TOKENS` (`:23-52`) |
| Existing tab primitive | **NONE** (zero matches for `tablist` / `role="tab"` / `aria-selected` / `Tabs`) |
| `TicketDetailModal.tsx` — session `useState` (`confirmOpen`/`isDirty`/`deleteConfirmOpen`) | `:40-42` |
| `TicketDetailModal.tsx` — `useBlocker(isDirty)` | `:63` |
| `TicketDetailModal.tsx` — `requestClose` | `:69-72` |
| `TicketDetailModal.tsx` — `modalTitle` | `:97` |
| `TicketDetailModal.tsx` — resolved `else` body (open `<>` … close `</>`) | `:124` → `:230` |
| `TicketDetailModal.tsx` — soft-delete banner | `:125-134` |
| `TicketDetailModal.tsx` — metadata header (SLYK-10) | `:136-160` |
| `TicketDetailModal.tsx` — `TimerControls` / `TimeLog` / `ManualEntryForm` (each gated `!ticket.deletedAt`) | `:169` / `:172` / `:175` |
| `TicketDetailModal.tsx` — `TicketAttributeForm` usage | `:174-191` (`defaultValues` `:178-184`, `onDirtyChange={setIsDirty}` `:185`, `onCancel={requestClose}` `:190`) |
| `TicketDetailModal.tsx` — admin delete entry (`isAdmin && !ticket.deletedAt`) | `:193-201` |
| `TicketDetailModal.tsx` — `ActivityFeed` | `:203` |
| `TicketDetailModal.tsx` — `Modal title` / `blockBackdropClose={isDirty}` | `:213` / `:215` |
| `TicketAttributeForm.tsx` — RHF `useForm` (`defaultValues` seeded once) | `:61-69` |
| `TicketAttributeForm.tsx` — `onDirtyChange` effect | `:72-74` |
| `TicketAttributeForm.tsx` — sticky Save/Cancel footer (`-mx-6 -mb-6`) | `:191-202` |
| Modal mount contract | Route-driven via `BoardPage.tsx` `<Outlet/>` (`:146`) + `TicketDetailRoute` (`:156-194`) — **stable, do not touch** |
| Comments (SLYK-13) | **Greenfield** — no component/api/types exist |

**Critical risk (HIGH):** RHF form state lives *inside* `TicketAttributeForm`. If the Details tab panel unmounts on a tab switch, `isDirty` resets → the unsaved-changes guard trio (`useBlocker` `:63`, `requestClose` `:69-72`, `blockBackdropClose` `:215`) silently breaks and in-progress edits are lost. **Mitigation = keep all three panels mounted via Radix `forceMount` + hide inactive panels with the `hidden` attribute.** This is the single most important implementation detail (T3).

---

## Parallelization Strategy

### Task set

| # | Batch | Title | Target File(s) | Dependencies | Can Parallel With |
|---|-------|-------|----------------|--------------|-------------------|
| **T1** | 1 | Add `@radix-ui/react-tabs` dependency + install | `frontend/package.json`, `frontend/package-lock.json` | — | T2 (authoring only; T2 tests run after T1 lands) |
| **T2** | 1 | Create `Tabs.tsx` primitive + co-located `Tabs.test.tsx` | `frontend/src/components/ui/Tabs.tsx`, `frontend/src/components/ui/Tabs.test.tsx` | T1 (for running tests; authoring independent) | T1 |
| **T3** | 2 | Restructure `TicketDetailModal` into 3 tabs (activeTab state, forceMount panels, Comments placeholder, soft-delete gating) | `frontend/src/components/TicketDetailModal.tsx` | T1, T2 | — (sole Batch 2 task; owns the file exclusively) |
| **T4** | 3 | Extend `TicketDetailModal.test.tsx` (content-per-tab, RHF-preservation regression guard, refetch persistence, soft-delete, dirty-across-tabs) | `frontend/src/components/TicketDetailModal.test.tsx` | T3 | T5 |
| **T5** | 3 | Manual accessibility verification checklist + AC mapping + dual-theme QA | `docs/deliverables/SLYK-11-plan-tasks.md` (docs only) | T3 (best after T4) | T4 |

### Visual batch dependency diagram

```
                       SLYK-11  (frontend-only, tabbed modal)

 ┌─────────────────────────── BATCH 1 (foundation, parallel) ────────────────────────────┐
 │                                                                                        │
 │   ┌──────────────────────────────────┐    ┌──────────────────────────────────────┐    │
 │   │  T1  add @radix-ui/react-tabs    │    │  T2  Tabs.tsx primitive               │    │
 │   │      frontend/package.json       │    │      + Tabs.test.tsx                  │    │
 │   └────────────────┬─────────────────┘    └─────────────────┬────────────────────┘    │
 │                    │  (import resolves)                      │                          │
 └────────────────────┼────────────────────────────────────────┼──────────────────────────┘
                      │                                          │
                      └──────────────────┬───────────────────────┘
                                         │ (primitive + dep must exist first)
 ┌────────────────────────────────────────┼──── BATCH 2 (restructure) ───────────────────┐
 │                                        ▼                                               │
 │   ┌────────────────────────────────────────────────────────────────────────────────┐  │
 │   │  T3  Restructure TicketDetailModal.tsx                                          │  │
 │   │      • activeTab session state (:40-42 sibling)                                 │  │
 │   │      • <Tabs value/onValueChange> wrapping resolved body (:124-230)            │  │
 │   │      • 3 TabsContent panels (forceMount + hidden)                               │  │
 │   │      • Comments placeholder (SLYK-13 slot) in Details                           │  │
 │   │      • soft-delete gating (disable Time Tracking trigger + per-block gates)    │  │
 │   └────────────────────────────────────┬───────────────────────────────────────────┘  │
 └─────────────────────────────────────────┼────────────────────────────────────────────┘
                                           │ (modal must be tabbed first)
 ┌─────────────────────────────────────────┼──── BATCH 3 (verification, parallel) ──────┐
 │                                         ▼                                             │
 │   ┌──────────────────────────────────────────────┐   ┌────────────────────────────┐  │
 │   │  T4  Component tests                         │   │  T5  Manual a11y checklist  │  │
 │   │      TicketDetailModal.test.tsx              │   │      (runbook + AC mapping  │  │
 │   │      (content-per-tab, RHF preservation,     │   │       + dual-theme QA)      │  │
 │   │       refetch persistence, soft-delete,      │   │      docs/deliverables/     │  │
 │   │       dirty-across-tabs)                     │   │      SLYK-11-plan-tasks.md  │  │
 │   └──────────────────────────────────────────────┘   └────────────────────────────┘  │
 │            ▲   different files / concerns  ▲                                         │
 │            └────────── parallel ───────────┘                                         │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

### Linear DAG (critical path)

```
[T1] dep  ─┐
            ├─▶ [T3] modal restructure ─▶ [T4] component tests  ─┐
[T2] Tabs ─┘                                  └─▶ [T5] a11y gate ─┴─▶ MERGE-READY
```

**Critical path:** `T1 → T3 → T4` (T4 is the automated merge gate; T5 is the manual QA gate).

### Merge-order rules

1. **T1 merges first** — the root; nothing in B2/B3 compiles without the primitive + dependency. (If T1 and T2 land on separate PRs, T1 must precede T2's PR so the import resolves on CI.)
2. **T2 may merge alongside or after T1** — it touches disjoint files (`ui/Tabs.tsx` / `ui/Tabs.test.tsx` vs `package.json`), so there is no ordering constraint between T1 and T2. Each merges independently via **rebase-and-merge** (repo policy: rebase only, no squash, no merge commits).
3. **T3 merges after T1 + T2** — it is the sole consumer of the primitive and owns `TicketDetailModal.tsx` exclusively; no parallel task touches that file.
4. **T4 may merge as soon as T3 is in** (does not depend on T2 directly). Recommended to land T4 **before** T5 so the automated safety net is green when the manual checklist is executed.
5. **T5 is the final sign-off** — its *execution* (not just authoring) is the merge gate; the branch is not merge-ready until the checklist passes in both light and dark themes. T5 produces no code, so it never conflicts; it can be authored in parallel with T4 and executed last.
6. **Conflict surface:** only `TicketDetailModal.tsx` is a shared-edit risk, and T3 owns it exclusively. `package.json` is touched only by T1. No two tasks edit the same file, so every parallel pair is conflict-free by construction.
7. **No local merges** — all integration is via PR rebase on GitHub (project merge policy). The DAG above describes logical dependency, not local merge commands.

### Developer assignment tracks

**Track A — Single developer (smallest risk; recommended default).** Serial critical path. Best when one dev owns the whole UX.

```
Dev 1:  T1 ─▶ T3 ─▶ T4 ─▶ T5 (execute)
        dep   modal  tests  QA gate
        (T2 slotted anywhere after T1 — quick primitive-test pass)
```

**Track B — Two developers (recommended for speed; clean split).** Dev 1 owns the critical path; Dev 2 peels off the two conflict-free side tasks.

```
Dev 1 (critical path):  T1 ──────────────▶ T3 ──▶ T4 ──▶ T5(execute)
Dev 2 (side tasks):            T2 ─────┘           ▲
                               (after T1)          └ T5(author) can start once T3 lands,
                                                    executed after T4 is green.
```
- Dev 2's T2 is unblocked the moment T1 merges — pure parallelism.
- Dev 2 can also **author** T5's runbook as soon as T3 lands (it's docs), then both devs converge to execute it. Ceiling: ~30–40% time saved vs Track A.

**Track C — Three developers (only if primitive risk is high or a11y is a hard external deadline).** Splits the verification load so manual a11y QA is not on the critical path's dev.

```
Dev 1 (critical path):  T1 ──▶ T3 ──▶ T4
Dev 2:                       T2 ────┘   (parallel with T3)
Dev 3:                                 T5 (author + execute) — starts at T3-merge,
                                                          gates merge after T4 green
```
- Track C only pays off if T1/T3 is the bottleneck and a11y sign-off is an external gate (e.g. compliance review). Otherwise Track C's coordination overhead exceeds the gain — prefer Track B.

> **T2 vs T3 ordering under Track B/C:** because they are file-disjoint and both depend only on T1, neither blocks the other. If forced to sequence, land **T3 before T2** so the visible feature is testable end-to-end sooner (T2 is pure primitive coverage and can be polished in parallel without blocking anything).

---

## BATCH 1 — Foundation (dependency-free, parallel)

### T1 — Add `@radix-ui/react-tabs` dependency

**Title:** Add `@radix-ui/react-tabs` to `frontend/package.json` and install it

**Description:**
The project standardizes on Radix for accessibility-heavy primitives. `frontend/package.json:17-18` already declares `@radix-ui/react-dropdown-menu` (`^2`) and `@radix-ui/react-tooltip` (`^1.2.10`) — consumed by `frontend/src/components/ui/Dropdown.tsx` (the established Radix-wrapper shape; see the import at `Dropdown.tsx:6`). There is **no** `@radix-ui/react-tabs` entry today. This task adds it so T2 can build the `Tabs` primitive on top.

Radix Tabs is chosen over hand-rolling because it provides correct ARIA, roving tabindex, arrow-key/Home/End navigation, and focus management for free — matching the existing Radix convention (the plan's recommended dependency decision; fallback hand-rolled tablist on `hooks/useModalA11y.ts` is rejected as more code + more a11y risk for no benefit).

**Exact change:**
1. Edit `frontend/package.json`. In the `dependencies` object, add one line, alphabetically ordered among the `@radix-ui/*` entries (between `@radix-ui/react-dropdown-menu` and `@radix-ui/react-tooltip`):
   ```json
   "@radix-ui/react-tabs": "^1.1.12",
   ```
   (Pin to the latest stable `^1.x`; verify the resolved version after install. Use a caret range to match the existing `^2` / `^1.2.10` style.)
2. From `frontend/`, run `npm install` (the repo uses npm per `AGENTS.md` deploy instructions). The install must update `package-lock.json`.
3. Do **not** touch any other dependency, devDependency, or script. Do **not** bump React/Vite/Vitest. This is a single additive change.

**Acceptance Criteria:**
- [ ] `frontend/package.json` `dependencies` contains `"@radix-ui/react-tabs": "^1.x"` (latest stable `1.x`).
- [ ] The new line is alphabetically ordered with the other `@radix-ui/*` entries.
- [ ] `frontend/package-lock.json` is updated to reflect the new transitive tree.
- [ ] No other dependency, devDependency, script, or field in `package.json` is changed.
- [ ] `cd frontend && npm install` exits 0 with no peer-dependency warnings related to React 19 (confirm the resolved version supports React 19).
- [ ] `cd frontend && npm run typecheck` still exits 0.
- [ ] `cd frontend && npm test` still passes (no regression).

**Subtasks:**
1. Check the latest stable `@radix-ui/react-tabs` version on npm and confirm React 19 peer compatibility.
2. Add the dependency line to `frontend/package.json`.
3. Run `npm install` from `frontend/`.
4. Run `npm run typecheck && npm test` from `frontend/` and confirm green.

**Dependencies:** None. (Soft prerequisite for *running* T2's tests, but T2 can be authored in parallel.)

---

### T2 — Create `Tabs.tsx` primitive + co-located `Tabs.test.tsx`

**Title:** Create `frontend/src/components/ui/Tabs.tsx` (Radix Tabs wrapper) and `Tabs.test.tsx`

**Description:**
There is currently **no tab primitive** anywhere in the repo (zero matches for `tablist` / `role="tab"` / `aria-selected` / `Tabs` in `frontend/src`). The established home for reusable primitives is `frontend/src/components/ui/` (`Avatar`, `Badge`, `Button`, `Card`, `Dropdown`, `Field`, `SelectInput`, `TextInput`, `Textarea`, `Tooltip`, `cn.ts`). This task adds the `Tabs` primitive that `TicketDetailModal.tsx` will consume in T3.

The primitive wraps `@radix-ui/react-tabs` (added in T1) and mirrors the **exact conventions** of `Button.tsx` and `Dropdown.tsx`:

- **File:** `frontend/src/components/ui/Tabs.tsx` (NEW), co-located with `frontend/src/components/ui/Tabs.test.tsx` (NEW).
- **Header comment** in the F-series style — see `Button.tsx:1-5` / `Dropdown.tsx:1-6` (one-line "F-tag — Purpose." + short rationale). State: "Radix Tabs wrapper. A11y (roving tabindex, arrow-key/Home/End, aria-selected/aria-controls/aria-labelledby) from Radix."
- **Import shape:** `import * as TabsPrimitive from '@radix-ui/react-tabs';` — mirror `Dropdown.tsx:6`.
- **Class merging:** every exported component merges classes through `cn` from `./cn` (`cn.ts:7`) — see `Button.tsx:6` import, `Button.tsx:46` usage.
- **`forwardRef` + rest-spread, never swallow `className`:** mirror `Button.tsx:38-49` and `Dropdown.tsx`'s pattern. Use `ElementRef<typeof TabsPrimitive.X>` for the ref type and `ComponentPropsWithoutRef<typeof TabsPrimitive.X>` for the props type.
- **Named composable exports** (flat named exports — match `Dropdown`'s flat style, not a `Tabs.Root` dot-namespace): `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.
  - `Tabs` → thin forwarder over `TabsPrimitive.Root`. Forwards `value`, `defaultValue`, `onValueChange`, `orientation`, `dir`, `activationMode`, `className`, plus `...rest`. (The modal uses **controlled** mode — `value` + `onValueChange`.)
  - `TabsList` → `TabsPrimitive.List` with base classes using semantic tokens: a flex row + bottom border, e.g. `cn('inline-flex items-center gap-1 border-b border-border', className)`.
  - `TabsTrigger` → `TabsPrimitive.Trigger`. The critical styling surface. Base classes must mirror `Button.tsx:25-29`'s focus-visible ring and disabled handling, semantic tokens only:
    - focus: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (identical to `Button.tsx:27-28`).
    - selected state via Radix `data-[state=active]:` selectors (Radix Tabs sets `data-state="active|inactive"`): e.g. `data-[state=active]:bg-accent data-[state=active]:text-accent-foreground`; inactive baseline `text-muted-foreground`.
    - disabled: `disabled:pointer-events-none disabled:opacity-50` (mirror `Button.tsx:28-29`).
    - interactivity: `transition-colors px-3 py-2 text-sm font-medium rounded-md cursor-pointer`.
  - `TabsContent` → `TabsPrimitive.Content`. Must forward **`forceMount`** (used in T3 to keep the Details panel mounted so RHF form state survives tab switches — the highest-risk detail in the plan). Base className: `cn('mt-4 focus-visible:outline-none', className)`. When `forceMount` is set, Radix adds `data-state="active|inactive"`; instruct consumers to hide inactive via conditional `hidden`, but the primitive itself only forwards props.
- **Semantic-token discipline (testable):** use **only** Tailwind utility tokens — `bg-accent`, `text-accent-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`, `bg-background`, `bg-primary`, `text-primary-foreground`. **No raw hex** (`#rrggbb`) anywhere in the file. Rationale: `tokens.test.ts:95-105` enforces "no raw hex"; Button/Dropdown ban raw hex in component classNames too. (If a needed color isn't in that set, stop and flag it — do not introduce a new token in this task.)
- **Accessibility contract (provided by Radix — the test file verifies it):**
  - `role="tablist"` on `TabsList`, `role="tab"` on `TabsTrigger`, `role="tabpanel"` on `TabsContent`.
  - `aria-selected` on the active trigger; `aria-controls` (trigger → panel `id`); `aria-labelledby` (panel → trigger `id`).
  - Arrow Right/Left move focus between triggers; Home/End jump to first/last; focus moves with selection (Radix default `activationMode="automatic"`).
  - The primitive must **not** override these. The tests confirm they are present after wrapping.

**Radix Tabs API (exact props to forward):**
- `Root` — `value?`, `defaultValue?`, `onValueChange?(value: string)`, `orientation?` (`'horizontal'|'vertical'`, default horizontal), `dir?` (`'ltr'|'rtl'`), `activationMode?` (`'automatic'|'manual'`, default automatic), `asChild?`, `className`, standard div attrs.
- `Trigger` — `value: string` (required), `disabled?`, `asChild?`, `className`.
- `Content` — `value: string` (required), `forceMount?`, `asChild?`, `className`.
- Docs: https://www.radix-ui.com/primitives/docs/components/tabs

**Co-located test file — `frontend/src/components/ui/Tabs.test.tsx`:** Vitest + Testing Library (already devDependencies at `package.json:33-37`). Co-location convention: `*.test.tsx` next to source. Priority query order (`AGENTS.md`): `getByRole` > `getByLabelText` > `getByText` > `getByTestId` (last resort) — **use `getByRole` exclusively for tab elements**. Table-driven tests preferred. One behavior per `it`. Minimum coverage:

1. **Role rendering** — one `role="tablist"`, N `role="tab"`, N `role="tabpanel"`.
2. **`aria-selected`** — active trigger `"true"`, others `"false"`. Table-driven across default-value and controlled-value cases.
3. **`aria-controls` / `aria-labelledby` pairing** — each trigger's `aria-controls` == its panel's `id`; each panel's `aria-labelledby` == its trigger's `id`. Assert bijective pairing across all tabs (loop, table-driven).
4. **Arrow-key navigation** — focus on first trigger, `ArrowRight` → second; `ArrowLeft` → back; from last, `ArrowRight` wraps to first. `fireEvent.keyDown(trigger, { key: 'ArrowRight' })` + `toHaveFocus`.
5. **Home / End** — `Home` jumps to first; `End` to last.
6. **Controlled `onValueChange`** — render `<Tabs value="a" onValueChange={spy}>…`; click the `b` trigger; assert `spy` called with `"b"`. Assert the active panel still reflects the controlled `value="a"` until the parent updates (genuinely controlled, not self-managing).
7. **`forceMount` DOM persistence** — render `<TabsContent value="b" forceMount>`; switch active value away from `"b"`; assert the `"b"` panel **remains in the DOM** (`queryByRole('tabpanel')` still present). **This is the regression guard for the RHF-state-preservation requirement** — if it fails, T3's form-state plan breaks.

Use a small shared fixture (e.g. a `renderTabs` helper for a 3-tab setup labelled Details / Time Tracking / Activity) so the keyboard and aria tests share structure. Avoid `data-testid` — rely on roles.

**Acceptance Criteria:**
- [ ] `frontend/src/components/ui/Tabs.tsx` exists and exports four named components: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.
- [ ] Every exported component uses `forwardRef` with `ElementRef<typeof TabsPrimitive.X>` ref type and `ComponentPropsWithoutRef<typeof TabsPrimitive.X>` props type (mirror `Dropdown.tsx:17-19`).
- [ ] Every exported component merges `className` through `cn` from `./cn` (`cn.ts:7`) and spreads `...rest` — never swallows `className` (mirror `Button.tsx:46-48`).
- [ ] `TabsTrigger` carries `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (identical to `Button.tsx:27-28`).
- [ ] `TabsTrigger` selected state uses `data-[state=active]:bg-accent data-[state=active]:text-accent-foreground`; inactive baseline `text-muted-foreground`; list border `border-border`.
- [ ] `TabsContent` forwards `forceMount`.
- [ ] **No raw hex** (`#rrggbb`) anywhere in `Tabs.tsx` — only semantic tokens.
- [ ] `Tabs` forwards `value`, `defaultValue`, `onValueChange`, `orientation`, `dir`, `activationMode`.
- [ ] File header matches the F-series comment shape (`Button.tsx:1-5` / `Dropdown.tsx:1-6`).
- [ ] `Tabs.test.tsx` is co-located next to `Tabs.tsx` and covers all 7 behaviors above (roles, aria-selected, aria-controls/aria-labelledby pairing, ArrowRight/ArrowLeft, Home/End, controlled `onValueChange`, `forceMount` persistence).
- [ ] `Tabs.test.tsx` uses `getByRole`/`getAllByRole` for tab elements (no `data-testid`); keyboard tests use `fireEvent.keyDown`.
- [ ] `cd frontend && npm test -- src/components/ui/Tabs.test.tsx` passes (all green).
- [ ] `cd frontend && npm run typecheck` passes.

**Subtasks:**
1. Read `frontend/src/components/ui/Dropdown.tsx` (full) and `Button.tsx` (full) to internalize the exact `forwardRef` + `cn` + `ElementRef`/`ComponentPropsWithoutRef` shape.
2. Read `frontend/src/components/ui/cn.ts` to confirm the `cn` signature.
3. Skim the Radix Tabs docs for the prop names above.
4. Write `Tabs.tsx` (header → import → `Tabs` → `TabsList` → `TabsTrigger` → `TabsContent`, mirroring `Dropdown.tsx`'s sectioned layout with `// --- Root ---`-style separators).
5. Write `Tabs.test.tsx` with a shared `renderTabs` helper and table-driven loops for the aria-pairing and keyboard behaviors.
6. Run `npm test -- src/components/ui/Tabs.test.tsx` and `npm run typecheck`; fix until green.

**Dependencies:** T1 (for running tests; authoring independent).

---

## BATCH 2 — Restructure (sole task, owns the file)

### T3 — Restructure `TicketDetailModal` resolved body into three tabs

**Title:** Restructure `TicketDetailModal.tsx` resolved `else` body into Details / Time Tracking / Activity tabs using the SLYK-11 Tabs primitive (`forceMount` + `hidden` to preserve RHF state), with Comments placeholder and soft-delete gating preserved.

**Description:**
Convert the linear stacked body inside `TicketDetailModal.tsx`'s resolved branch (the `else` body opening at `:124` and closing at `:230`) into a controlled 3-tab layout built on the Tabs primitive from Batch 1 (T2 = `frontend/src/components/ui/Tabs.tsx`, T1 = `@radix-ui/react-tabs` dependency). This is pure JSX relocation of existing, self-contained, `ticketId`/`slug`-prop-backed children into three `TabsContent` panels under one `TabsList`. **No child component is modified.** No new hooks/stores/API/types. Frontend-only.

**State addition (modal top level):**
Add a fifth piece of session state alongside the existing three at `TicketDetailModal.tsx:40-42` (`confirmOpen`, `isDirty`, `deleteConfirmOpen`):
```ts
const [activeTab, setActiveTab] = useState<"details" | "time" | "activity">("details");
```
A plain `useState` satisfies the persistence requirement (survives in-session re-renders, resets on close) because the modal mounts/unmounts on route match. **Do NOT introduce Zustand `persist`** — no precedent and not required. The unsaved-changes guard trio — `useBlocker(isDirty)` at `:63`, `requestClose` at `:69-72`, and `Modal`'s `blockBackdropClose={isDirty}` at `:215` — must continue to function unchanged; the guard state lives at the modal level and is unaffected by this restructure.

**Body wrapping & block distribution (per plan mapping table, verified line refs):**
Wrap the current `else` body in `<Tabs value={activeTab} onValueChange={setActiveTab}>` with one `TabsList` above three `TabsContent` panels:
- **Details** (`value="details"`) — soft-delete banner (`:125-134`), SLYK-10 metadata header (`:136-160`), `TicketAttributeForm` block (`:174-191`, with `mode="edit"`, `readOnly={!!ticket.deletedAt}`, `defaultValues` `:178-184`, `onDirtyChange={setIsDirty}` `:185`, `onCancel={requestClose}` `:190`), admin delete entry (`:193-201`, `isAdmin && !ticket.deletedAt`), and the NEW Comments placeholder below the form (see below).
- **Time Tracking** (`value="time"`) — `TimerControls` (`:169`), `TimeLog` (`:172`), `ManualEntryForm` (`:175`), all gated `!ticket.deletedAt`.
- **Activity** (`value="activity"`) — `ActivityFeed` (`:203`).

**The modal title (`modalTitle`, `:97`, rendered via `Modal`'s `title` prop) is NOT a tab — it stays in the `Modal` header. Only the body is tabbed.**

**CRITICAL — RHF state preservation across tab switches (single highest-risk detail):**
React Hook Form state lives *inside* `TicketAttributeForm` (`useForm` at `TicketAttributeForm.tsx:61-69`, dirty reporting via the `onDirtyChange` effect at `:72-74`). If the Details `TabsContent` unmounts when the user switches to Time Tracking, RHF resets → `isDirty` flips false → the unsaved-changes guard trio silently breaks and in-progress edits are lost.

**Mitigation (mandatory):** keep **all three** panels mounted using Radix Tabs `forceMount`, and toggle visibility via the `hidden` attribute on inactive panels. Concretely, each `TabsContent` gets `forceMount`, and its root applies `hidden` when `activeTab !== <that tab's value>`. This guarantees `TicketAttributeForm` never unmounts while the modal is open, so RHF state, `isDirty`, and the dirty-guard behave identically to today. **Do NOT lift RHF state out of the child** — explicitly rejected as out-of-scope. The Time Tracking and Activity panels are cheap to keep mounted (they are `useQuery`-backed and dedupe).

**Sticky footer compatibility (do not move the footer):**
The Save/Cancel footer lives **inside** `TicketAttributeForm` (`TicketAttributeForm.tsx:191-202`) using `-mx-6 -mb-6` to span the modal body. Because the form stays inside the Details panel and the panel stays mounted via `forceMount`, the sticky footer continues to span the modal body exactly as today. **DO NOT move the footer out of the form.** After restructuring, verify visually that the negative margins still align with the new container now that a `TabsList` sits above; **only if** the Tabs primitive adds panel padding that breaks alignment, adjust the form's `-mx-6 -mb-6` offsets to match the new container padding. Adjust offsets in place, do not relocate the footer.

**Comments placeholder (NEW, in Details tab, below `TicketAttributeForm`):**
SLYK-13 (Comments) is not yet implemented (confirmed absent from `frontend/src`). Reserve the slot as a clearly-marked placeholder so SLYK-13 is a drop-in:
```tsx
{/* SLYK-13: Comments section — not yet implemented. Replace this placeholder when SLYK-13 lands. */}
<section aria-label="Comments" className="mt-6 border-t border-border pt-4">
  <h3 className="text-sm font-medium text-muted-foreground">Comments</h3>
  <p className="mt-2 text-sm text-muted-foreground italic">
    Comments are not available yet.
  </p>
</section>
```

**Soft-deleted ticket gating (preserve, do not remove):**
- `!ticket.deletedAt` gating on `TimerControls`/`TimeLog`/`ManualEntryForm` must be preserved at the per-block level as defense-in-depth.
- Add an outer gate at the tablist: render the **Time Tracking tab trigger** `disabled` (preferred over hidden — visible but non-interactive, matches the plan's stated assumption) when `ticket.deletedAt` is set. Confirm disabled-vs-hidden with owner if unspecified; default = disabled.
- The form stays read-only (`readOnly={!!ticket.deletedAt}`) as today; the admin delete entry stays gated `isAdmin && !ticket.deletedAt`.

**Out of scope (do NOT touch):**
- `BoardPage` / `TicketDetailRoute` — the route-driven modal mount is stable and correct; do not modify.
- `TicketAttributeForm`, `TimerControls`, `TimeLog`, `ManualEntryForm`, `ActivityFeed` — relocate only, no edits.
- Implementing Comments (SLYK-13) — placeholder only.
- Fixing timer live-update bugs (SLYK-12) — reported in the plan, not addressed here.
- The SLYK-10 metadata header extraction — keep inline.
- Persisting `activeTab` across close/reopen — reset-on-close is acceptable.

**Acceptance Criteria:**
- [ ] Modal presents three clearly labeled tabs — **Details**, **Time Tracking**, **Activity** — with correct content in each.
- [ ] Time tracking (`TimerControls`, `TimeLog`, `ManualEntryForm`) lives **entirely** in tab 2; `ActivityFeed` lives **entirely** in tab 3.
- [ ] SLYK-10 metadata header and `TicketAttributeForm` appear in tab 1, with a clearly-marked Comments placeholder below the form (SLYK-13 not yet implemented).
- [ ] `activeTab` `useState` added at modal top level (alongside the `:40-42` session state); Tabs is controlled via `value`/`onValueChange`.
- [ ] The modal title (`modalTitle`, `:97`) is **not** a tab — it stays in the `Modal` header; only the body is tabbed.
- [ ] All three `TabsContent` panels use `forceMount`; inactive panels are hidden via the `hidden` attribute (no unmount) — preserves RHF form state.
- [ ] Switching to Time Tracking and back to Details **preserves** form input values and keeps `isDirty` true (no RHF unmount-reset regression) — verified table-driven across title, description, priority, assignee.
- [ ] The unsaved-changes guard trio works from any active tab: dirty Details + active Time Tracking tab → close attempt shows `ConfirmDiscardDialog` (`useBlocker` `:63`, `requestClose` `:69-72`, `blockBackdropClose` `:215` all still fire).
- [ ] The `TicketAttributeForm` Save/Cancel footer (`:191-202`, `-mx-6 -mb-6`) remains **inside** the form and still spans the modal body with the tablist present above; offsets adjusted only if panel padding breaks alignment.
- [ ] Tab navigation is keyboard-accessible with correct ARIA (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`) and arrow-key / Home / End support (delivered by the T2 primitive + Radix).
- [ ] Active tab persists across re-renders while the modal is open (e.g. a 30s board background refetch) and resets to Details after close + reopen.
- [ ] Soft-deleted tickets: Time Tracking tab trigger is disabled (default) or hidden; per-block `!ticket.deletedAt` gates remain as defense-in-depth; form stays read-only.
- [ ] No timer live-update bugs are introduced or fixed (that is SLYK-12's scope).
- [ ] No changes to `BoardPage` / `TicketDetailRoute` / any relocated child component; no new hooks, stores, API clients, or types.

**Subtasks:**
1. Add `activeTab` `useState<"details" | "time" | "activity">("details")` at the modal top level alongside the existing `:40-42` session state; import the Tabs primitive from `./ui/Tabs`.
2. In the resolved `else` body (`:124`–`:230`), wrap the current fragment in `<Tabs value={activeTab} onValueChange={setActiveTab}>`.
3. Add a `TabsList` (tablist row) at the top of the tabbed region, above the three panels.
4. Create `TabsContent value="details"` (with `forceMount`, `hidden={activeTab !== "details"}`) and move in: soft-delete banner (`:125-134`), metadata header (`:136-160`), `TicketAttributeForm` block (`:174-191`, props unchanged), admin delete entry (`:193-201`), and the NEW Comments placeholder below the form.
5. Create `TabsContent value="time"` (with `forceMount`, `hidden={activeTab !== "time"}`) and move in: `TimerControls` (`:169`), `TimeLog` (`:172`), `ManualEntryForm` (`:175`) — preserve all `!ticket.deletedAt` gates.
6. Create `TabsContent value="activity"` (with `forceMount`, `hidden={activeTab !== "activity"}`) and move in: `ActivityFeed` (`:203`).
7. Set the **Time Tracking** `TabsTrigger` `disabled={!!ticket.deletedAt}` (default to disabled; flag for owner confirmation if unspecified).
8. Verify the `TicketAttributeForm` footer still spans the modal body with the tablist above; adjust `-mx-6 -mb-6` offsets **only** if the Tabs container padding breaks alignment — footer stays inside the form.
9. Run `npm test` (Vitest) for the modal + Tabs tests; run `rtk tsc` to confirm no type regressions.

**Dependencies:** T1, T2 (the primitive + dependency must exist). Sole Batch 2 task; owns `TicketDetailModal.tsx` exclusively.

---

## BATCH 3 — Verification (parallel)

### T4 — Extend `TicketDetailModal.test.tsx` with tabbed-modal coverage

**Title:** Add tabbed-modal component tests (content-per-tab, RHF preservation regression guard, refetch persistence, soft-delete, dirty-across-tabs) to `frontend/src/components/TicketDetailModal.test.tsx`

**Description:**
The existing co-located test file already covers the pre-tab modal (header, form, dirty-guard, delete). SLYK-11 adds a tabbed body, and the **highest-risk regression is RHF form-state loss on tab switch** (plan §"Edge Cases & Risks" — HIGH). This task extends the file with focused, table-driven coverage of the new behavior **without** rewriting the pre-existing tests. One behavior per `it`; prefer accessible queries — `getByRole('tab', { name: /details|time tracking|activity/i })` — over test ids. Do **not** modify `TicketAttributeForm.test.tsx` or any source file.

The mock harness already provides everything needed (`renderModal`, `makeTicket`, the `aria-label`-based leaf-editor mocks, admin-gate mock, `fetchTicket` mock). Reuse it; do not add new module-level mocks unless a subtask says so.

**Prettier:** 4-space TSX indent, `printWidth: 100`, single quotes, trailing commas — match the existing file exactly.

**Acceptance Criteria:**
- [ ] `npm test -- TicketDetailModal` passes with zero failures (all pre-existing tests **and** the new ones).
- [ ] **Only** `frontend/src/components/TicketDetailModal.test.tsx` is modified — no source changes, no edits to `TicketAttributeForm.test.tsx`, `Tabs.tsx`, or `Tabs.test.tsx`.
- [ ] Every new tab query uses `getByRole('tab', { name: /details|time tracking|activity/i })` (or `findByRole` for async); no `data-testid` added to source to satisfy these tests.
- [ ] **(a)** A single test asserts all three tabs render and that the correct child content lands in each panel: **Details** = metadata header + `TicketAttributeForm` + Comments placeholder + admin delete entry; **Time Tracking** = `TimerControls` + `TimeLog` + `ManualEntryForm`; **Activity** = `ActivityFeed`.
- [ ] **(b)** A **table-driven** test (`it.each` per field) proves switching **Time Tracking → Details** preserves the edited value and keeps `isDirty` true — covering **title, description, priority, assignee** (the RHF unmount-reset regression guard).
- [ ] **(c)** A test proves the active tab persists across a query refetch re-render while the modal is open (active tab unchanged after a `refetch`/`refetchOnWindowFocus`-style re-render).
- [ ] **(d)** A soft-deleted-ticket test (`makeTicket({ deletedAt: '...' })`) asserts: the Time Tracking tab trigger is disabled (or hidden, per T3's choice) and the form is read-only / per-block gates honored.
- [ ] **(e)** A test asserts: dirty Details + active Time Tracking tab → a close attempt surfaces the `ConfirmDiscardDialog` (unsaved-changes guard fires from a non-Details tab).
- [ ] `npx prettier --check frontend/src/components/TicketDetailModal.test.tsx` passes.
- [ ] `npx tsc --noEmit` (frontend) passes — any new imports resolve.

**Subtasks:**

*4a — Imports / helpers.* Add a tiny local helper to switch tabs by accessible name:
```ts
async function switchTab(name: RegExp) {
    const tab = await screen.findByRole('tab', { name });
    fireEvent.click(tab);
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
}
```
(T3 uses Radix Tabs, so the trigger is a real `<button role="tab">`; `fireEvent.click` + `aria-selected` is the correct contract.)

*4b — Test (a): content lands in the correct tab.* Render the default ticket, then for each tab activate it and assert the right children are scoped **inside that tab's `tabpanel`**:
```ts
it('renders all three tabs with the correct content in each panel', async () => {
    renderModal();
    await screen.findByRole('heading', { name: 'SLYK-101' });

    // Details (default active): header + form + Comments placeholder + (admin) delete.
    const details = screen.getByRole('tabpanel', { name: /details/i });
    expect(within(details).getByLabelText(/title/i)).toBeInTheDocument();
    expect(within(details).getByText(/comments/i)).toBeInTheDocument(); // SLYK-13 placeholder

    // Time Tracking: TimerControls + TimeLog + ManualEntryForm.
    await switchTab(/time tracking/i);
    const time = screen.getByRole('tabpanel', { name: /time tracking/i });
    expect(within(time).getByText(/timer|start|stop/i)).toBeInTheDocument();
    expect(within(time).getByText(/time log|manual/i)).toBeInTheDocument();

    // Activity: ActivityFeed.
    await switchTab(/activity/i);
    const activity = screen.getByRole('tabpanel', { name: /activity/i });
    expect(within(activity).getByRole('feed')).toBeInTheDocument(); // ActivityFeed exposes role="feed"
});
```
> Adjust the inner assertions to the actual visible text/role of each child as T3 rendered them; the intent is "child X is in panel Y, not in the others." Do not assert cross-panel leakage.

*4c — Test (b): RHF state survives tab switch (the regression guard).* Table-driven across the four editable fields. Because the UserSelect mock only ships an `Unassigned` option, the assignee row overrides the fixture so the field has a value to change **away from**:
```ts
const fieldCases = [
    {
        name: 'title',
        edit: () => fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Render board v2' } }),
        expected: 'Render board v2',
        overrides: {},
    },
    {
        name: 'description',
        edit: () => fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '<p>updated</p>' } }),
        expected: '<p>updated</p>',
        overrides: {},
    },
    {
        name: 'priority',
        edit: () => fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: 'URGENT' } }),
        expected: 'URGENT',
        overrides: {},
    },
    {
        name: 'assignee',
        edit: () => fireEvent.change(screen.getByLabelText(/assignee/i), { target: { value: '' } }),
        expected: '',
        overrides: { assignee: { id: 'u1', fullName: 'Ada Lovelace' }, assigneeId: 'u1' },
    },
] as const;

it.each(fieldCases)(
    'preserves edited $name and keeps isDirty after Time Tracking -> Details switch',
    async ({ edit, expected, overrides }) => {
        renderModal({ ticket: makeTicket(overrides) });
        await screen.findByRole('heading', { name: 'SLYK-101' });
        edit();
        await switchTab(/time tracking/i);
        await switchTab(/details/i);
        const field = screen.getByLabelText(/title|description|priority|assignee/i);
        expect((field as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value).toBe(expected);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        await waitFor(() => expect(screen.getByText(/discard|unsaved/i)).toBeInTheDocument());
    },
);
```
> **This is the single most important test in the file.** If T3 ships without `forceMount`+`hidden`, this test fails — exactly the guardrail we want. If `getByLabelText(/title|description|priority|assignee/i)` is ambiguous in a single test, scope each row's assertion to the specific label per-case.

*4d — Test (c): active tab survives a refetch re-render.* The modal already refetches every 30s / on window focus. Drive a manual refetch and assert the active tab is unchanged:
```ts
it('keeps the active tab across a background refetch while the modal is open', async () => {
    renderModal();
    await screen.findByRole('heading', { name: 'SLYK-101' });
    await switchTab(/activity/i);
    expect(screen.getByRole('tab', { name: /activity/i })).toHaveAttribute('aria-selected', 'true');

    vi.mocked(fetchTicket).mockResolvedValue(makeTicket({ title: 'Render board (refreshed)' }));
    act(() => { window.dispatchEvent(new Event('focus')); });

    await waitFor(() =>
        expect(screen.getByRole('tab', { name: /activity/i })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(screen.getByRole('tabpanel', { name: /activity/i })).toBeInTheDocument();
});
```

*4e — Test (d): soft-deleted ticket.* T3's documented choice is to disable (or hide) the Time Tracking trigger and keep the form read-only when `ticket.deletedAt` is set. Assert that contract:
```ts
it('disables the Time Tracking tab and renders the form read-only for a soft-deleted ticket', async () => {
    renderModal({ ticket: makeTicket({ deletedAt: '2026-06-29T00:00:00.000Z' }) });
    await screen.findByRole('heading', { name: 'SLYK-101' });

    const timeTab = screen.getByRole('tab', { name: /time tracking/i });
    // T3 picks disabled OR hidden — assert the one it shipped.
    expect(timeTab).toHaveAttribute('aria-disabled', 'true'); // disabled
    // OR, if hidden: expect(timeTab).not.toBeInTheDocument();

    const title = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(title).toBeDisabled();

    await switchTab(/activity/i);
    expect(screen.getByRole('tabpanel', { name: /activity/i })).toBeInTheDocument();
});
```
> Coordinate the disabled-vs-hidden branch with T3's documented decision; the test should encode whichever T3 shipped so a later flip fails loudly.

*4f — Test (e): dirty guard fires from a non-Details tab.* The guard (`useBlocker`, `requestClose`) must work regardless of which tab is active, because the form stays mounted:
```ts
it('shows the confirm-discard dialog on close when Details is dirty but Time Tracking is active', async () => {
    renderModal();
    await screen.findByRole('heading', { name: 'SLYK-101' });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Edited' } });
    await switchTab(/time tracking/i);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.getByText(/discard|unsaved/i)).toBeInTheDocument());
});
```

*4g — Do not modify the existing tests.* Leave the pre-tab `it` blocks (header, "Created by …" + avatar, dirty-close on Details, admin delete) untouched. They should stay green under T3 because the Details panel still mounts the same children by default. If any go red, that is a T3 regression, not a T4 fix — report it, do not paper over it here.

**Out of scope (this task):**
- No `Tabs.test.tsx` coverage (that is T2's job).
- No `TicketAttributeForm.test.tsx` changes.
- No source edits to `TicketDetailModal.tsx`, `Tabs.tsx`, or any child component.
- No assertion on visual layout, sticky-footer negative margins, or theme (those are T5, manual).

**Dependencies:** T3 (modal restructure merged). Transitive on T2 (primitive).

---

### T5 — Manual accessibility verification checklist + AC mapping + dual-theme QA

**Title:** Author and execute the manual accessibility verification runbook for SLYK-11 (documentation + QA gate)

**Description:**
SLYK-11's keyboard/ARIA correctness is delivered by the Radix primitive, but the ticket's acceptance criteria require **manual** confirmation that the open modal is keyboard-only navigable, screen-reader-correct, and axe/lighthouse-clean, and that session persistence behaves (survives a board refetch while open; resets to Details on close+reopen). This task produces a **runbook checklist** (a human QA gate), not code. It is written into this plan-tasks doc (append below) so a reviewer/PM can execute it against the merged branch without reading the plan.

The checklist is **pass/fail per item** with a "how to verify" micro-instruction. Anything that fails is reported back and re-opens T3 (or T2 if the primitive itself is wrong) — this task makes no code changes.

**Acceptance Criteria:**
- [ ] A "Manual Accessibility Verification — SLYK-11" section exists in `docs/deliverables/SLYK-11-plan-tasks.md` (appended below).
- [ ] The section covers, with a runnable step for each:
  - [ ] **Keyboard-only tablist navigation:** Tab into the modal → focus reaches the tablist → Tab/Shift+Tab enters/leaves the list → **arrow keys** move between triggers → **Home/End** jump to first/last → activation switches the panel (auto or Enter/Space per Radix default).
  - [ ] **Screen-reader roles/labels:** under VoiceOver/NVDA the tablist announces `role="tablist"`, each trigger `role="tab"` with its accessible name (Details / Time Tracking / Activity) and `aria-selected`, each panel `role="tabpanel"` with `aria-labelledby` pointing at its trigger; the active panel is the one exposed.
  - [ ] **axe / Lighthouse:** running axe (browser extension or `@axe-core/playwright` if available) **and** Lighthouse a11y audit on the open modal reports **zero** tablist-related violations (no "aria-selected/controls/labelledby" issues, no keyboard-trap, no focus-order issue).
  - [ ] **Session persistence — survives refetch:** open the modal, switch to Activity/Time Tracking, leave the modal open past a 30s board refetch (and trigger a window-focus refetch); the active tab is unchanged.
  - [ ] **Session persistence — resets on close/reopen:** close the modal (after being on Activity) and reopen the same or a different ticket; the active tab is **Details** (reset-on-close confirmed).
  - [ ] **Dirty-guard is tab-agnostic:** with unsaved Details edits and the Time Tracking tab active, closing the modal shows the confirm-discard dialog (manual counterpart to T4's test (e)).
- [ ] Every checklist item maps to a specific plan Acceptance Criterion (plan §"Acceptance Criteria") — the AC mapping table below is included.
- [ ] Checklist executed against the merged T1–T4 branch in **both** light and dark themes; pass/fail recorded per item.
- [ ] No source files are modified by this task (documentation + manual execution only).

**Subtasks:**
- **5a** — Draft the checklist section (the Acceptance Criteria above, reformatted as a runbook with "Step → Expected → Pass/Fail" columns) and append it to this doc. *(Done — see below.)*
- **5b** — Add the **AC mapping table** (checklist item → plan Acceptance Criterion → evidence location). *(Done — see below.)*
- **5c** — Execute the checklist against the merged T1–T4 branch in **both** light and dark themes; record pass/fail per item. On any fail, file a concise failure note with `path:line`/repro and re-open T3 (or T2) — do not edit code here.

**Dependencies:** T3 (implementation present) and, for a meaningful run, T4 (automated safety net green). Blocks final merge sign-off.

---

## Manual Accessibility Verification — SLYK-11 (runbook)

Execute against the merged T1–T4 branch. Run the **entire** checklist in **both light and dark** themes. Record pass/fail per item; on any fail, re-open T3 (or T2 if the primitive itself is wrong).

| # | Step (how to verify) | Expected | Pass/Fail |
|---|----------------------|----------|-----------|
| A1 | Open any ticket modal; `Tab` from the board until focus enters the modal. | Focus lands on the first tab trigger (**Details**), not deep inside the form. | ☐ |
| A2 | Press `Tab` / `Shift+Tab` with focus on the tablist. | `Tab` moves focus **into** the active panel; `Shift+Tab` moves back to the tablist. No focus trap. | ☐ |
| A3 | With focus on a trigger, press `ArrowRight` / `ArrowLeft`. | Focus moves between the three triggers; wrap around at the ends (Radix default). | ☐ |
| A4 | Press `Home` / `End`. | `Home` jumps focus to **Details**; `End` jumps to **Activity**. | ☐ |
| A5 | Activate a trigger (auto on focus, or Enter/Space). | The corresponding panel becomes visible and `aria-selected` updates on the active trigger. | ☐ |
| S1 | Under VoiceOver/NVDA, navigate to the tablist. | Announces `tablist`; each trigger announces `tab`, its name (Details / Time Tracking / Activity), and selected state. | ☐ |
| S2 | Screen-reader-navigate into the active panel. | Announces `tabpanel` labelled by its trigger (`aria-labelledby`); inactive panels are not exposed. | ☐ |
| X1 | Run the **axe** browser extension on the open modal. | Zero tablist-related violations (no aria-selected/controls/labelledby, no keyboard-trap, no focus-order). | ☐ |
| X2 | Run **Lighthouse** a11y audit on the open modal route. | Zero tablist-related violations; score does not regress vs. pre-SLYK-11. | ☐ |
| P1 | Open modal, switch to **Activity**, leave modal open > 30s (trigger a window-focus refetch). | Active tab stays **Activity** (survives the re-render). | ☐ |
| P2 | Close the modal (after being on Activity), reopen the same or a different ticket. | Active tab resets to **Details**. | ☐ |
| D1 | On the **Details** tab, edit a field (dirty); switch to **Time Tracking**; close the modal. | Confirm-discard dialog appears (dirty-guard is tab-agnostic). | ☐ |
| T-L | Repeat A1–A5, S1–S2, X1 in **light** theme. | All pass. | ☐ |
| T-D | Repeat A1–A5, S1–S2, X1 in **dark** theme. | All pass. | ☐ |

### AC mapping table

| Checklist item | Plan Acceptance Criterion (SLYK-11-plan.md §"Acceptance Criteria") | Evidence |
|----------------|---------------------------------------------------------------------|----------|
| A1–A5, S1–S2, X1–X2 | "Tab navigation is keyboard-accessible with correct ARIA (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`) and arrow-key/Home/End support." | Manual runbook above; automated backing in `Tabs.test.tsx` (T2) + `TicketDetailModal.test.tsx` (T4). |
| P1 | "The active tab persists while the modal is open (survives re-renders) and resets on close." (survives half) | Runbook P1; T4 test (c). |
| P2 | "The active tab persists … and resets on close." (resets half) | Runbook P2; T4 test (c). |
| D1 | "The existing footer/save behavior continues to work within the Details tab; unsaved-changes guard still fires from any tab." | Runbook D1; T4 test (e). |
| A1–A5 + T-L/T-D | "The modal presents three clearly labeled tabs — Details, Time Tracking, Activity — with the correct content in each." | Visual confirmation in both themes. |
| — | "Switching tabs does **not** lose in-progress form edits (RHF state preserved)." | T4 test (b) — automated regression guard. |
| — | "Soft-deleted tickets keep timer/time-log/manual-entry gated out and the form read-only." | T4 test (d). |
| — | "No timer live-update bugs are introduced or fixed (that is SLYK-12's scope)." | Out of scope; manual spot-check only. |

---

## Out of scope (whole breakdown)

- Implementing the Comments section (SLYK-13) — placeholder only.
- Fixing timer live-update bugs (SLYK-12) — reported in the plan, not fixed.
- Any backend, schema, migration, API, or type changes.
- Extracting the SLYK-10 metadata header into its own component.
- Persisting the active tab across modal close/reopen (reset-on-close is acceptable).
- Lifting `TicketAttributeForm`'s RHF state out of the child component.
