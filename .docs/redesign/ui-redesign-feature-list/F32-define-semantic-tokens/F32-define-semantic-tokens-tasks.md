# F32 — Define full semantic token set + @custom-variant dark: Plan + Task Breakdown

> **Feature:** F32 — Define full semantic token set + @custom-variant dark (Phase 0 — Foundations · Infrastructure)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F31 (done) · **PRD ref:** §3.1 (full token list + `@custom-variant dark`), §2.3 (undefined-token bug), §1.2/§1.6 (semantic-token + system-theme principles)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency feature: [F31](../F31-install-redesign-deps/F31-install-redesign-deps-tasks.md) (dep install — done; no code seam F32 consumes).

---

## 1. F32 Recap

**Goal:** Make every currently-broken Tailwind utility (`bg-card`, `text-muted-foreground`, `text-primary-foreground`, `bg-secondary`, `bg-muted/40`) actually emit color, in both light and dark — by declaring the full shadcn-style semantic token set in `frontend/src/index.css` and mapping it into Tailwind v4 via `@theme inline` + `@custom-variant dark`.

**Ships:** Components that are silently transparent today (TicketCard, RichTextEditor, TicketAttributeForm buttons, BoardColumn) render correctly in light; dark token values exist even though no toggle is wired yet (F34 wires the toggle). The live undefined-token bug (PRD §2.3) is resolved at the token layer.

**Acceptance (definition of done):**
1. `frontend/src/index.css` declares a `:root` (light) block and a `.dark` block with the full shadcn-style set: `--background/--foreground`, `--card/--card-foreground`, `--popover/--popover-foreground`, `--primary/--primary-foreground`, `--secondary/--secondary-foreground`, `--muted/--muted-foreground`, `--accent/--accent-foreground`, `--border`, `--input`, `--ring`, `--destructive/--destructive-foreground`, plus status tints `--success/--success-foreground`, `--warning/--warning-foreground`, `--danger/--danger-foreground`.
2. `@theme inline` maps every one of those CSS vars to the `--color-*` namespace so Tailwind v4 emits the corresponding `bg-*` / `text-*` / `border-*` / `ring-*` utilities (the `inline` keyword is what makes `bg-card` / `text-muted-foreground` resolve and what lets `.dark` overrides cascade).
3. `@custom-variant dark (&:where(.dark, .dark *));` is present (PRD §3.1's exact form).
4. The 5 existing light seed token **values** are preserved as their exact Tailwind-v4 **OKLCH** equivalents (same appearance, modern format): white `oklch(1 0 0)`, gray-900 `oklch(0.21 0.034 264.665)`, blue-600 `oklch(0.541 0.241 262.261)`, gray-500 `oklch(0.551 0.027 264.364)`, gray-200 `oklch(0.929 0.013 255.508)`. Primary stays **blue** (PRD §1.1 "one accent").
5. **Spike/verify (load-bearing):** build a smoke component using `bg-card text-muted-foreground border-border` and confirm computed color is non-transparent in light **and** with `.dark` on `<html>`. jsdom cannot assert computed color (no layout engine) — so the F32 spike is a **static source-presence test** + **`vite build` clean** + **manual DevTools `.dark` toggle smoke**. The real computed-color assertion is deferred to F46/F51 visual QA (or a future Playwright add — out of scope).

**Edge cases to resolve up front:**
- **Tailwind v4 `@theme inline` vs plain `@theme`** → **Decision: `@theme inline`.** Plain `@theme` copies the value at build time and emits `--color-*` globally to `:root` (Tailwind owns the var, so `.dark` overrides on `--background` never reach the utility). `@theme inline { --color-card: var(--card) }` inlines the `var(--card)` reference into the utility itself, so you own `--card` in `:root`/`.dark` and the cascade does the override. Confirmed by Tailwind v4 docs (theme/colors) and GH discussion #18560. PRD §3.1 mandates `@theme inline`. Getting this wrong silently re-breaks dark mode — the acceptance spike exists to catch it.
- **Keep the 5 existing light tokens as the seed** → **Decision: preserve the 5 VALUES (as OKLCH equivalents), restructure into the shadcn split.** `--color-background:#ffffff` → `:root { --background: oklch(1 0 0) }` + `@theme inline { --color-background: var(--background) }`, and likewise for the other four seeds. Blue primary preserved (PRD §1.1). Do NOT delete mid-sweep or F46 churns harder. **Load-bearing coupling:** because `@theme inline` does NOT emit `--color-*` globally, the existing `@layer base { body { background-color: var(--color-background); color: var(--color-foreground) } }` rule breaks — it MUST switch to `var(--background)` / `var(--foreground)`. Called out in T1.
- **Status tint tokens are new vs the PRD's §3.1 list** → **Correction: PRD §3.1 DOES name `--success`/`--warning`/`--danger`** ("status tints: `--success`, `--warning`, `--danger` (for health/priority badges)"). So the 3 background tints are **NOT an addition** — the spec's framing was wrong. What IS an addition: the `-foreground` pairs (`--success-foreground` etc.), which PRD omits but badges need for readable text. F32 adds those pairs. Values grounded in the existing-palette audit (greens, reds, ambers → their OKLCH equivalents). `--danger` is aliased to the destructive red (one red, not two).
- **Color model: OKLCH** → **Decision (owner-confirmed 2026-06-26): OKLCH.** Owner chose OKLCH over HEX. OKLCH is Tailwind v4's native default color space (shadcn v4 ships OKLCH since Mar 2025), perceptually uniform for consistent lightness steps, and `color-mix`/alpha modifiers work natively. Seed VALUES preserved as their **exact Tailwind-v4 OKLCH equivalents** (same appearance): white→`oklch(1 0 0)`, gray-900 #111827→`oklch(0.21 0.034 264.665)`, blue-600 #2563eb→`oklch(0.541 0.241 262.261)`, gray-500 #6b7280→`oklch(0.551 0.027 264.364)`, gray-200 #e5e7eb→`oklch(0.929 0.013 255.508)`. Blue primary hue preserved (PRD §1.1). Full light + dark OKLCH palette in T1.
- **`@custom-variant dark` form** → **Decision: `@custom-variant dark (&:where(.dark, .dark *));`** (PRD §3.1 + Tailwind v4 docs canonical). `:where()` has zero specificity and matches `.dark` itself + descendants. Deliberately deviates from shadcn's current starter (`&:is(.dark *)`) — `:is()` takes max specificity of args and matches descendants only (not `.dark` itself). PRD + Tailwind docs win; document the deviation.
- **Verification ceiling** → **Decision: build clean + static source-presence test + manual DevTools toggle.** jsdom cannot resolve `var()` or compute color (jsdom #2986/#3339); Playwright (real Chromium, can assert computed color) is **not installed**. Do NOT install Playwright in F32. Defer real computed-color assertion to F46/F51. (Cite research Q7.)
- **`color-scheme` CSS property** → **Decision: add `color-scheme: light` under `:root` and `color-scheme: dark` under `.dark`.** This CSS property (in F32's file) tells the UA to render native chrome (scrollbars, form controls) in the matching scheme. F33 adds the HTML `<meta name="color-scheme">` + no-flash script. No overlap (CSS prop vs HTML meta both contribute). Absent from shadcn default; needed to avoid the scrollbar flash PRD §2.3 notes.

---

## 2. Codebase Analysis Summary

- **State:** Partial. `frontend/src/index.css` exists (30 lines) with a plain `@theme` block of 5 light tokens and an `@layer base` body rule. **No** `:root`, **no** `.dark`, **no** `@custom-variant`, **no** `@theme inline`, **no** dark: utilities, **no** `prefers-color-scheme`, **no** `color-scheme` anywhere in `src/`. This is the canonical missing-token state F32 fixes.
- **Existing structure this feature builds on:**
  - `frontend/src/index.css:1` → `@import 'tailwindcss';` (must stay first).
  - `frontend/src/index.css:4-10` → plain `@theme` block (NOT inline), 5 hardcoded light hex tokens:
    ```
    @theme {
      --color-background: #ffffff;
      --color-foreground: #111827;
      --color-primary: #2563eb;
      --color-muted: #6b7280;
      --color-border: #e5e7eb;
    }
    ```
  - `frontend/src/index.css:3` → comment "Board-specific colors deferred to F09".
  - `frontend/src/index.css:12-29` → `@layer base { body { background-color: var(--color-background); color: var(--color-foreground) } }`. **LOAD-BEARING COUPLING:** after F32 restructures to `--background` + `@theme inline { --color-background: var(--background) }`, the `--color-*` namespace is no longer emitted globally, so this body rule MUST switch to `var(--background)` / `var(--foreground)` or body styling breaks.
  - `frontend/src/main.tsx:11` → `import './index.css'` (import confirmed; F32 edits the imported file).
  - `frontend/vite.config.ts:4,7` → `@tailwindcss/vite` plugin confirmed; **NO** `tailwind.config.js`/`tailwind.config.ts` (v4 CSS-first config). `tailwindcss@^4`, `@tailwindcss/vite@^4` in `frontend/package.json`.
  - `frontend/vite.config.ts:13-17` → Vitest configured, env `jsdom`, setupFiles `./src/test-setup.ts`.
- **5 seed token values to preserve (converted to OKLCH, same appearance):** white `#ffffff`→`oklch(1 0 0)`, gray-900 `#111827`→`oklch(0.21 0.034 264.665)`, blue-600 `#2563eb`→`oklch(0.541 0.241 262.261)`, gray-500 `#6b7280`→`oklch(0.551 0.027 264.364)`, gray-200 `#e5e7eb`→`oklch(0.929 0.013 255.508)`. **Primary is BLUE** — the app's accent (PRD §1.1 "one accent"). F32 must preserve blue primary, NOT adopt shadcn's neutral-black primary.
- **Truly broken utilities today** (no backing token → class never emitted → silently transparent): `bg-card`, `text-muted-foreground`, `text-primary-foreground`, `bg-secondary`. Representative cites: `frontend/src/components/TicketCard.tsx:31` (`bg-card`), `frontend/src/components/BoardColumn.tsx:30` (`text-muted-foreground`), `frontend/src/components/AssigneeAvatar.tsx:29` (`text-primary-foreground`), `frontend/src/components/BoardFilters.tsx:119` (`bg-secondary`). ~21 hits across TicketCard/RichTextEditor/AssigneeAvatar/BoardColumn/ChecklistEditor/BoardFilters. (`bg-muted/40`, `border-border`, `bg-background`, `text-foreground` already resolve via the seed set — `bg-muted/40` works via `color-mix` alpha.)
- **Prior art / partial work:** The 5 seed tokens in `index.css` are the partial work F32 completes. No `:root`/`.dark`/`@theme inline`/`@custom-variant` exists. PRD §2.3 cites the same broken utilities verbatim (`TicketCard.tsx:15,18`, `RichTextEditor.tsx`, `TicketAttributeForm.tsx:168,177`, `BoardColumn.tsx:22`).
- **File paths the plan references that do NOT exist yet** (will be created): `frontend/src/tokens.test.ts` (co-located static source-presence test). No other files created.
- **Existing status-color usage (grounds tint values):** `frontend/src/components/HealthBadge.tsx:28` (`bg-green-500`/`bg-red-500`); `frontend/src/components/PriorityBadge.tsx:5-11` (PRIORITY_TONE: LOW slate, MEDIUM blue, HIGH amber, URGENT orange, CRITICAL red); `frontend/src/components/ChecklistEditor.tsx:71` (`bg-green-500` progress); `frontend/src/components/LabelManager.tsx:125,146` (green-600/red-600); destructive `bg-red-600` in ConfirmDiscardDialog/OfflineBanner/ProjectColumnsManager; `text-red-600` validation text widely. Tint OKLCH values map these: green-600 `oklch(0.627 0.194 149.214)` / green-500 `oklch(0.723 0.191 149)`; red-600 `oklch(0.595 0.225 27.167)` / red-500 `oklch(0.637 0.237 25.333)`; amber-600 `oklch(0.666 0.179 58.318)` / amber-500 `oklch(0.795 0.164 70.08)`.
- **No Playwright/E2E harness** in `frontend/package.json` or config. Vitest + jsdom only. jsdom CANNOT assert computed color (no layout engine; `getComputedStyle().backgroundColor` returns `''`/transparent). → F32 verification ceiling is `vite build` clean + manual DevTools `.dark` toggle + a static source-presence Vitest test. Defer computed-color assertion to F46/F51 visual QA.
- **Project rules this plan satisfies:**
  - `js-development-rules.md` — Tailwind v4 stack pin (`@tailwindcss/vite`); Vercel deploy `npm run build` → `dist`; React 19+ / Node 24+.
  - `js-style-guide.md` — no inline styles (Tailwind classes), no magic numbers (define constants — the token vars ARE the constants), 2-space TS / 4-space JSX, ≤100 cols, trailing commas. (F32 commits no JSX; style rule binds only the test file.)
  - `js-testing-rules.md` — Vitest co-located `*.test.ts(x)`; the static source-presence test is co-located in `src/`. jsdom limit acknowledged — assert STRUCTURE not computed color.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; commit single-line `SLYK-TICKET: message`. Repo precedent: `SLYK-F30`, `SLYK-F31` → F32 uses `SLYK-F32:` prefix.
  - `persona.md` — frontend code → `./frontend/`; reply concise.
- **Hidden coupling to plan for:**
  - **`@layer base` var rename.** `index.css:12-29` references `var(--color-background)`/`var(--color-foreground)` — these stop being emitted globally once `@theme` becomes `@theme inline`. T1 MUST rename them to `var(--background)`/`var(--foreground)` or body styling breaks silently. This is the single most easily-missed break in F32.
  - **Alpha-modifier compatibility.** `bg-muted/40` works with OKLCH via Tailwind v4 `color-mix` — no special handling. No action needed.
  - **`@import 'tailwindcss'` must be first; `@custom-variant dark` conventionally right after** (shadcn starter order). CSS var resolution is lazy, so `@theme inline` may sit before or after `:root`/`.dark` — safe either way; T1 picks a canonical order.
  - **No component/source changes.** F32 owns only `index.css` + one test. The ~21 broken-utility call sites stay as-is (they start resolving once tokens exist); F46 owns the raw-color sweep.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Token mechanism | **`@theme inline` + `:root`/`.dark` raw CSS vars** | Plain `@theme` emits `--color-*` globally (Tailwind owns the var; `.dark` override on `--background` never reaches the utility). `@theme inline { --color-card: var(--card) }` inlines the `var(--card)` reference so you own `--card` in `:root`/`.dark` and the cascade does the override. PRD §3.1 mandates `@theme inline`; Tailwind v4 docs (theme/colors) + GH discussion #18560 confirm. |
| D2 | Dark variant | **`@custom-variant dark (&:where(.dark, .dark *));`** | PRD §3.1 verbatim + Tailwind v4 docs canonical. `:where()` has zero specificity; matches `.dark` itself + descendants. Deliberately deviates from shadcn's current starter (`&:is(.dark *)`) — `:is()` takes max specificity of args and matches descendants only (not `.dark` itself). PRD + Tailwind docs win; deviation documented. |
| D3 | Color model | **OKLCH** (owner-confirmed 2026-06-26) | Owner chose OKLCH over HEX. OKLCH is Tailwind v4's native default color space (shadcn v4 ships OKLCH since Mar 2025), perceptually uniform for consistent lightness steps, `color-mix`/alpha modifiers work natively. Seed VALUES preserved as their **exact Tailwind-v4 OKLCH equivalents** (same appearance): white→`oklch(1 0 0)`, gray-900 #111827→`oklch(0.21 0.034 264.665)`, blue-600 #2563eb→`oklch(0.541 0.241 262.261)`, gray-500 #6b7280→`oklch(0.551 0.027 264.364)`, gray-200 #e5e7eb→`oklch(0.929 0.013 255.508)`. Blue primary hue preserved (PRD §1.1). |
| D4 | Status tints | **`--success`/`--warning`/`--danger` + `-foreground` pairs** | PRD §3.1 names the 3 background tints ("status tints: `--success`, `--warning`, `--danger`"); F32 adds the `-foreground` pairs PRD omits (badges need readable text). Values grounded in audit (their OKLCH equivalents): success green-600 `oklch(0.627 0.194 149.214)` (light) / green-500 `oklch(0.723 0.191 149)` (dark), warning amber-600 `oklch(0.666 0.179 58.318)` (light) / amber-500 `oklch(0.795 0.164 70.08)` (dark), danger aliased to destructive (one red). |
| D5 | Verification path | **`vite build` clean + static source-presence Vitest test + manual DevTools `.dark` toggle smoke (documented)** | jsdom cannot resolve `var()`/compute color (jsdom #2986/#3339); Playwright (real Chromium) NOT installed and out of scope. Static test asserts token-name presence + `--color-*` mapping existence; build gate catches syntax; manual toggle proves non-transparency. Defer computed-color assertion to F46/F51. |
| D6 | `color-scheme` CSS property | **Add `color-scheme: light` under `:root`, `color-scheme: dark` under `.dark`** | CSS property in F32's file tells UA to render native chrome (scrollbars, form controls) in matching scheme — avoids the scrollbar flash PRD §2.3 notes. Absent from shadcn default; needed. F33 adds HTML `<meta color-scheme>` + no-flash script — no overlap (CSS prop vs HTML meta both contribute). |
| D7 | Scope boundaries | **Do NOT migrate components (F46); do NOT wire toggle (F34); do NOT add no-flash script/meta (F33); do NOT install Playwright; do NOT change primary hue** | Prevents scope creep. F32 owns only `index.css` + one co-located static test. The ~21 broken-utility call sites start resolving once tokens exist; F46 owns the raw-color sweep (~147 `gray-*` usages). |

> **Out of F32 scope (explicitly deferred):** component raw-color migration (F46 — owns the ~147 `gray-*` usages); theme toggle wiring / persistence (F34); no-flash script + `<meta color-scheme>` (F33); Playwright install + real computed-color E2E (out of redesign scope — F46/F51 visual QA covers it); primary hue change (never — PRD §1.1 blue accent is fixed); chart/sidebar token namespaces (shadcn has them — not used in Slykboard; skip).

> **Owner sign-off (resolved 2026-06-26):**
> 1. **Color model** → **OKLCH.** Owner confirmed. Seed values converted to exact Tailwind-v4 OKLCH equivalents (appearance preserved); blue primary hue unchanged.
> 2. **Dark palette values** → **decided (owner-delegated).** Coherent gray-900-base dark neutral matching the app's blue-gray identity: background = gray-900 `oklch(0.21 0.034 264.665)`; surfaces (card/popover/secondary/muted/accent) = gray-800 `oklch(0.278 0.033 256.848)`; muted-foreground = gray-400 `oklch(0.707 0.022 261.325)`; border/input = gray-700 `oklch(0.37 0.034 259.733)`; primary = blue-500 `oklch(0.623 0.214 259.815)` (brighter on dark); destructive/danger = red-500 `oklch(0.637 0.237 25.333)`; success = green-500 `oklch(0.723 0.191 149)`; warning = amber-500 `oklch(0.795 0.164 70.08)`. Foreground = gray-200 `oklch(0.929 0.013 255.508)`. Full block in T1.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      ├─ index.css              # MODIFIED — restructured:
      │                          #   @import 'tailwindcss';
      │                          #   @custom-variant dark (&:where(.dark, .dark *));
      │                          #   :root { ...light OKLCH tokens...; color-scheme: light; }
      │                          #   .dark { ...dark OKLCH tokens...; color-scheme: dark; }
      │                          #   @theme inline { --color-*: var(--*); ... }  (all mappings)
      │                          #   @layer base { body { var(--background)/var(--foreground) } }  (renamed)
      └─ tokens.test.ts         # NEW — co-located static source-presence test (Vitest + jsdom)
# NO component changes. NO source changes outside index.css + tokens.test.ts.
# ~21 broken-utility call sites stay as-is; they start resolving once tokens exist.
```

F32 is a single-file token-layer edit plus one co-located test. No module-resolution graph, runtime flow, or request lifecycle is altered: the broken utilities (`bg-card`, `text-muted-foreground`, `text-primary-foreground`, `bg-secondary`) begin resolving because their backing `--color-*` mappings now exist in `@theme inline`.

---

## 5. Parallelization Strategy

F32 is small. It decomposes into **2 sequential tasks** — there is **no safe parallelism within this feature** (T2 consumes the `index.css` T1 produces). This is a single-developer track. The batches below are presented honestly: Batch A (restructure tokens) gates Batch B (test + verify).

### Batch dependency diagram

```
   Batch A (rewrite tokens)     Batch B (test + verify)
   ──────────────────────       ──────────────────────
        T1 ─────────────────────────▶  T2
```

- **Batch A → Batch B** is a hard barrier: T2's static test reads the `index.css` T1 just rewrote, and T2's build/toggle verify runs against T1's tokens. T2 cannot start until T1's `index.css` is committed to the working branch.

### Merge order rules

1. **Batch A merges first.** T1 (rewrite `index.css` with full token set + `@theme inline` + `@custom-variant dark`) lands the single CSS file change. Must be on `main` before Batch B branches.
2. **Batch B merges second.** T2 (static source-presence test + build/toggle verify) adds `tokens.test.ts` and records proof in §7. T2 can rebase onto `main` containing T1.
3. **T3 (integration verification)** is the terminal gate — runs after T1 + T2 are merged, confirms the committed diff is exactly `index.css` + `tokens.test.ts` and re-runs the full gate.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/index.css` (M) | — | — |
| **T2** | B | `frontend/src/tokens.test.ts` (New) | T1 | — |
| **T3** | C | no files changed (verification gate); records proof in §7 | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3. (The only realistic track.)
- **2+ devs:** No beneficial split. F32 is a single-file edit + one test; strictly sequential. Assign one owner end-to-end.

---

## 6. Tasks

### T1 — Restructure `index.css`: full semantic token set (`:root` light + `.dark` dark, OKLCH) + `@theme inline` mapping + `@custom-variant dark`

**Batch:** A · **Depends on:** None · **Parallel with:** —

**Description:** Replace the plain 5-token `@theme` block with the full shadcn-style semantic token architecture: `@import` → `@custom-variant dark` → `:root` (light) → `.dark` (dark) → `@theme inline` (mapping) → `@layer base` (body, var-renamed). Use **OKLCH** throughout (D3, owner-confirmed). Preserve the 5 seed VALUES as their exact Tailwind-v4 OKLCH equivalents (same appearance). Primary stays **blue** `oklch(0.541 0.241 262.261)` (PRD §1.1). Add `color-scheme` to both blocks (D6).

The full concrete palette below is the load-bearing artifact — a dev can paste it. Light values = seed OKLCH equivalents + standard neutrals; dark values = a coherent gray-900-base dark neutral (owner-delegated decision, see §3).

Modify `frontend/src/index.css` to (replace the entire current 30-line contents with):

```css
@import 'tailwindcss';

/* Class-based dark mode — PRD §3.1 canonical form (:where() = zero specificity,
   matches .dark itself + descendants; deviates from shadcn starter's :is() which
   excludes .dark itself and inherits specificity — see D2). */
@custom-variant dark (&:where(.dark, .dark *));

/* ── Light tokens (OKLCH — D3. Seed VALUES preserved as Tailwind-v4 OKLCH equivalents) ── */
:root {
  --background: oklch(1 0 0);                      /* white (seed #ffffff) */
  --foreground: oklch(0.21 0.034 264.665);         /* gray-900 (seed #111827) */

  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.034 264.665);

  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.21 0.034 264.665);

  --primary: oklch(0.541 0.241 262.261);           /* blue-600 (seed #2563eb) — PRD §1.1 accent */
  --primary-foreground: oklch(1 0 0);

  --secondary: oklch(0.968 0.007 247.896);         /* gray-100 */
  --secondary-foreground: oklch(0.21 0.034 264.665);

  --muted: oklch(0.968 0.007 247.896);             /* gray-100 */
  --muted-foreground: oklch(0.551 0.027 264.364);  /* gray-500 (seed #6b7280) */

  --accent: oklch(0.968 0.007 247.896);            /* gray-100 */
  --accent-foreground: oklch(0.21 0.034 264.665);

  --destructive: oklch(0.595 0.225 27.167);        /* red-600 */
  --destructive-foreground: oklch(1 0 0);

  --border: oklch(0.929 0.013 255.508);            /* gray-200 (seed #e5e7eb) */
  --input: oklch(0.929 0.013 255.508);             /* gray-200 */
  --ring: oklch(0.541 0.241 262.261);              /* blue-600 */

  /* Status tints (PRD §3.1 names backgrounds; F32 adds -foreground pairs — D4).
     Values grounded in existing usage: HealthBadge/PriorityBadge/ChecklistEditor. */
  --success: oklch(0.627 0.194 149.214);           /* green-600 */
  --success-foreground: oklch(1 0 0);

  --warning: oklch(0.666 0.179 58.318);            /* amber-600 */
  --warning-foreground: oklch(1 0 0);

  --danger: oklch(0.595 0.225 27.167);             /* aliased to destructive (one red) — D4 */
  --danger-foreground: oklch(1 0 0);

  color-scheme: light;                             /* native UA chrome — D6 (scrollbars/controls) */
}

/* ── Dark tokens (new; toggle wired by F34, values exist now) — gray-900 base ── */
.dark {
  --background: oklch(0.21 0.034 264.665);         /* gray-900 (#111827) — dark base */
  --foreground: oklch(0.929 0.013 255.508);        /* gray-200 (#e5e7eb) */

  --card: oklch(0.278 0.033 256.848);              /* gray-800 (#1f2937) */
  --card-foreground: oklch(0.929 0.013 255.508);

  --popover: oklch(0.278 0.033 256.848);
  --popover-foreground: oklch(0.929 0.013 255.508);

  --primary: oklch(0.623 0.214 259.815);           /* blue-500 (#3b82f6) — brighter on dark */
  --primary-foreground: oklch(1 0 0);

  --secondary: oklch(0.278 0.033 256.848);         /* gray-800 */
  --secondary-foreground: oklch(0.929 0.013 255.508);

  --muted: oklch(0.278 0.033 256.848);             /* gray-800 */
  --muted-foreground: oklch(0.707 0.022 261.325);  /* gray-400 (#9ca3af) */

  --accent: oklch(0.278 0.033 256.848);            /* gray-800 */
  --accent-foreground: oklch(0.929 0.013 255.508);

  --destructive: oklch(0.637 0.237 25.333);        /* red-500 (#ef4444) — brighter on dark */
  --destructive-foreground: oklch(1 0 0);

  --border: oklch(0.37 0.034 259.733);             /* gray-700 (#374151) */
  --input: oklch(0.37 0.034 259.733);
  --ring: oklch(0.623 0.214 259.815);              /* blue-500 */

  --success: oklch(0.723 0.191 149);               /* green-500 (#22c55e) — brighter on dark */
  --success-foreground: oklch(0.27 0.05 150);      /* green-950 */

  --warning: oklch(0.795 0.164 70.08);             /* amber-500 (#f59e0b) */
  --warning-foreground: oklch(0.21 0.034 264.665); /* gray-900 */

  --danger: oklch(0.637 0.237 25.333);
  --danger-foreground: oklch(1 0 0);

  color-scheme: dark;                              /* native UA chrome — D6 */
}

/* ── Tailwind v4 mapping (inline keeps var() reference so .dark overrides cascade — D1) ── */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);

  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);

  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);

  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);

  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);

  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);

  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);

  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);

  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);

  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);

  --color-danger: var(--danger);
  --color-danger-foreground: var(--danger-foreground);
}

/* ── Base layer — body must reference the raw --background/--foreground vars,
   NOT --color-* (inline does not emit --color-* globally — load-bearing coupling, §2) ── */
@layer base {
  body {
    background-color: var(--background);
    color: var(--foreground);
  }
}

/* Board-specific colors deferred to F09 (existing comment preserved). */
```

**Key edits vs current `index.css`:**
1. `@import 'tailwindcss';` stays first (unchanged).
2. Add `@custom-variant dark (&:where(.dark, .dark *));` right after (D2).
3. Replace the plain `@theme { --color-*: #hex }` block with the `:root` (light) + `.dark` (dark) raw-var OKLCH blocks above. Seed values preserved (OKLCH form).
4. Add the `@theme inline { --color-*: var(--*) }` mapping block (D1) — every one of the 30 tokens mapped.
5. **Rename the `@layer base` body rule:** `var(--color-background)` → `var(--background)`, `var(--color-foreground)` → `var(--foreground)` (load-bearing — see §2 hidden coupling).
6. Add `color-scheme: light` / `color-scheme: dark` (D6).
7. Preserve the "Board-specific colors deferred to F09" comment.

**Acceptance Criteria:**
- [ ] `@import 'tailwindcss';` is line 1 (unchanged).
- [ ] `@custom-variant dark (&:where(.dark, .dark *));` present immediately after the import.
- [ ] `:root` block declares all 30 tokens (OKLCH values): `--background`, `--foreground`, `--card`/`--card-foreground`, `--popover`/`--popover-foreground`, `--primary`/`--primary-foreground`, `--secondary`/`--secondary-foreground`, `--muted`/`--muted-foreground`, `--accent`/`--accent-foreground`, `--destructive`/`--destructive-foreground`, `--border`, `--input`, `--ring`, `--success`/`--success-foreground`, `--warning`/`--warning-foreground`, `--danger`/`--danger-foreground`, plus `color-scheme: light`.
- [ ] `.dark` block declares the same 30 tokens with dark OKLCH values, plus `color-scheme: dark`.
- [ ] Seed VALUES preserved (OKLCH form) in `:root`: `--background: oklch(1 0 0)`, `--foreground: oklch(0.21 0.034 264.665)`, `--primary: oklch(0.541 0.241 262.261)`, `--muted-foreground: oklch(0.551 0.027 264.364)`, `--border: oklch(0.929 0.013 255.508)`.
- [ ] `@theme inline` block maps every `--color-*` to `var(--*)` (all 30 mappings present).
- [ ] `@layer base` body rule references `var(--background)` / `var(--foreground)` (NOT `--color-*`).
- [ ] `--danger` aliases `--destructive` (one red: `oklch(0.595 0.225 27.167)` light / `oklch(0.637 0.237 25.333)` dark).
- [ ] No `tailwind.config.js`/`.ts` created (v4 CSS-first config preserved).
- [ ] "Board-specific colors deferred to F09" comment preserved.

**Dependencies:** None.

---

### T2 — Add static source-presence test + verify build + manual DevTools `.dark` toggle smoke

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Prove the token architecture is structurally complete and compiles. jsdom cannot assert computed color (no layout engine — `getComputedStyle().backgroundColor` returns `''`), so the F32 test asserts **source presence**: every required token NAME exists in `:root`/`.dark`, every `--color-*` mapping exists in `@theme inline`, the `@custom-variant dark` directive is present, and the `@layer base` rule references the raw vars (not `--color-*`). Then run `vite build` + `tsc --noEmit` clean. Finally, document the manual DevTools `.dark` toggle smoke (the real non-transparency check — deferred computed-color assertion lives in F46/F51).

Create `frontend/src/tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read index.css as a string — jsdom cannot compute color (no layout engine),
// so we assert STRUCTURE / source presence only (D5). Real computed-color
// assertion is deferred to F46/F51 visual QA (or a future Playwright add).
const cssPath = resolve(__dirname, 'index.css')
const css = readFileSync(cssPath, 'utf8')

const ROOT_TOKENS = [
  '--background', '--foreground',
  '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
  '--success', '--success-foreground',
  '--warning', '--warning-foreground',
  '--danger', '--danger-foreground',
]

const COLOR_MAPPINGS = ROOT_TOKENS.map((t) => `--color-${t.replace(/^--/, '')}`)

describe('F32 semantic token architecture (index.css)', () => {
  it('imports tailwindcss first', () => {
    expect(css.match(/^@import\s+['"]tailwindcss['"]\s*;/m)).not.toBeNull()
  })

  it('declares the PRD §3.1 @custom-variant dark (zero-specificity :where form)', () => {
    expect(css).toContain('@custom-variant dark')
    expect(css).toContain(':where(.dark, .dark *)')
  })

  it('declares :root (light) with every required token + color-scheme: light', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/s)
    expect(rootBlock, ':root block not found').not.toBeNull()
    const body = rootBlock![1]
    for (const token of ROOT_TOKENS) {
      expect(body, `missing ${token} in :root`).toContain(token)
    }
    expect(body).toContain('color-scheme: light')
  })

  it('declares .dark with every required token + color-scheme: dark', () => {
    const darkBlock = css.match(/\.dark\s*\{([^}]*)\}/s)
    expect(darkBlock, '.dark block not found').not.toBeNull()
    const body = darkBlock![1]
    for (const token of ROOT_TOKENS) {
      expect(body, `missing ${token} in .dark`).toContain(token)
    }
    expect(body).toContain('color-scheme: dark')
  })

  it('uses @theme inline (NOT plain @theme) so .dark overrides cascade', () => {
    expect(css).toContain('@theme inline')
    // Plain "@theme {" (space, no inline) must NOT appear — it would break dark mode.
    expect(css.match(/@theme\s+\{/)).toBeNull()
  })

  it('maps every token to the --color-* namespace in @theme inline', () => {
    const inlineBlock = css.match(/@theme\s+inline\s*\{([^}]*)\}/s)
    expect(inlineBlock, '@theme inline block not found').not.toBeNull()
    const body = inlineBlock![1]
    for (const mapping of COLOR_MAPPINGS) {
      expect(body, `missing ${mapping} mapping`).toContain(mapping)
    }
  })

  it('preserves the 5 seed VALUES in :root (OKLCH equivalents)', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/s)![1]
    expect(rootBlock).toContain('--background: oklch(1 0 0)')
    expect(rootBlock).toContain('--foreground: oklch(0.21 0.034 264.665)')
    expect(rootBlock).toContain('--primary: oklch(0.541 0.241 262.261)')
    expect(rootBlock).toContain('--muted-foreground: oklch(0.551 0.027 264.364)')
    expect(rootBlock).toContain('--border: oklch(0.929 0.013 255.508)')
  })

  it('uses OKLCH values (D3) — no raw hex in :root/.dark token values', () => {
    const themed = (css.match(/:root\s*\{[^}]*\}/s)?.[0] ?? '') +
      (css.match(/\.dark\s*\{[^}]*\}/s)?.[0] ?? '')
    expect(themed).toContain('oklch(')
    // Token value lines should not be raw hex (#rrggbb). (Comments may mention hex for traceability.)
    const tokenValueLines = themed
      .split('\n')
      .filter((l) => l.includes(':') && /--[\w-]+:/.test(l) && !l.trim().startsWith('/*'))
    for (const line of tokenValueLines) {
      expect(line, `raw hex in token value: ${line.trim()}`).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    }
  })

  it('@layer base body rule references raw --background/--foreground (not --color-*)', () => {
    const baseBlock = css.match(/@layer\s+base\s*\{([^}]*)\}/s)
    expect(baseBlock, '@layer base block not found').not.toBeNull()
    const body = baseBlock![1]
    expect(body).toContain('background-color: var(--background)')
    expect(body).toContain('color: var(--foreground)')
    expect(body, '@layer base still references --color-* (would break — see §2)').not.toContain('--color-background')
    expect(body).not.toContain('--color-foreground')
  })
})
```

Steps:
1. Create `frontend/src/tokens.test.ts` with the test above (co-located per `js-testing-rules.md`).
2. Run the test:
   ```bash
   npm run test -w frontend -- tokens.test.ts    # exit 0
   ```
3. **Build gate:**
   ```bash
   npm run build -w frontend          # tsc -b && vite build — exit 0
   ```
4. **Typecheck gate:**
   ```bash
   npm run typecheck -w frontend      # tsc --noEmit — exit 0
   ```
5. **Full vitest regression** (confirm the new test + existing suite pass):
   ```bash
   npm run test -w frontend           # exit 0
   ```
6. **Manual DevTools `.dark` toggle smoke** (document the result — the real non-transparency check; deferred computed-color assertion lives in F46/F51):
   - `npm run dev -w frontend`, open the app.
   - Inspect a `bg-card` element (e.g. TicketCard) in DevTools → confirm computed `background-color` is non-transparent white in light.
   - Toggle `.dark` on `<html>` (DevTools → Elements → `<html>` → add class `dark`) → confirm the same element is now non-transparent dark.
   - Repeat for `text-muted-foreground` (BoardColumn), `text-primary-foreground` (AssigneeAvatar), `bg-secondary` (BoardFilters).
   - Record PASS/FAIL per utility in §7's integration record.

**Acceptance Criteria:**
- [ ] `frontend/src/tokens.test.ts` created (co-located in `src/`).
- [ ] `npm run test -w frontend -- tokens.test.ts` exits 0 (all structural assertions pass).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` (full suite) exits 0.
- [ ] Manual `.dark` toggle smoke: TicketCard (`bg-card`), BoardColumn (`text-muted-foreground`), AssigneeAvatar (`text-primary-foreground`), BoardFilters (`bg-secondary`) all render non-transparent in light AND dark. Result recorded in §7.

**Dependencies:** T1.

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Re-run the verification suite against the as-merged state, confirm no source files were committed beyond `index.css` + `tokens.test.ts`, confirm the 4 previously-broken utilities now have backing mappings, and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** two files:
   ```bash
   git diff --name-only main...HEAD
   # Expected:
   # frontend/src/index.css
   # frontend/src/tokens.test.ts
   ```
   Any other path (e.g. a component, a `tailwind.config.js`, a smoke component) → leaked; remove and re-commit before sign-off. No component changes are permitted (F46 owns them).
2. Re-run the full gate on the merged state:
   ```bash
   npm install                                        # clean install
   npm run build -w frontend                          # exit 0
   npm run typecheck -w frontend                      # exit 0
   npm run test -w frontend                           # exit 0
   ```
3. **Static resolution check** — confirm the 4 previously-broken utilities now have backing `--color-*` mappings in `@theme inline` (a grep over `index.css`, not a runtime computed-color assertion — jsdom can't do that, D5):
   ```bash
   for token in card muted-foreground primary-foreground secondary; do
     grep -q -- "--color-$token: var(--$token);" frontend/src/index.css \
       && echo "bg-/text-$token: RESOLVED" \
       || echo "bg-/text-$token: STILL BROKEN"
   done
   ```
   All four must print `RESOLVED`.
4. Confirm `@custom-variant dark (&:where(.dark, .dark *));` is present (PRD §3.1 verbatim form).
5. Confirm no `tailwind.config.js`/`.ts` was created (v4 CSS-first config preserved).
6. Capture commit SHA, exit codes, manual-toggle results, and token counts into §7.
7. Confirm **owner sign-off (D3: OKLCH + dark palette values)** is resolved (done 2026-06-26 — OKLCH chosen; dark palette owner-decided per §3).

**Acceptance Criteria:**
- [ ] Committed diff is exactly `frontend/src/index.css` + `frontend/src/tokens.test.ts` (no components, no config file).
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state.
- [ ] Static resolution check: `bg-card`, `text-muted-foreground`, `text-primary-foreground`, `bg-secondary` all print `RESOLVED`.
- [ ] `@custom-variant dark (&:where(.dark, .dark *));` present verbatim.
- [ ] No `tailwind.config.js`/`.ts` created.
- [ ] All F32 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] Owner sign-off on D3 (OKLCH + dark palette) recorded.

**Dependencies:** T1, T2.

---

## 7. Final F32 Acceptance Checklist

- [ ] `frontend/src/index.css` declares `:root` (light) and `.dark` blocks with the full shadcn-style set: `--background/--foreground`, `--card/--card-foreground`, `--popover/--popover-foreground`, `--primary/--primary-foreground`, `--secondary/--secondary-foreground`, `--muted/--muted-foreground`, `--accent/--accent-foreground`, `--border`, `--input`, `--ring`, `--destructive/--destructive-foreground`, plus `--success/--warning/--danger` (+ `-foreground` pairs).
- [ ] `@theme inline` maps every token to the `--color-*` namespace (utilities resolve).
- [ ] `@custom-variant dark (&:where(.dark, .dark *));` present (PRD §3.1 verbatim form).
- [ ] 5 seed VALUES preserved (OKLCH form): `oklch(1 0 0)`, `oklch(0.21 0.034 264.665)`, `oklch(0.541 0.241 262.261)`, `oklch(0.551 0.027 264.364)`, `oklch(0.929 0.013 255.508)`.
- [ ] Primary stays **blue** `oklch(0.541 0.241 262.261)` (light) / `oklch(0.623 0.214 259.815)` (dark) — PRD §1.1 accent preserved.
- [ ] `@layer base` body rule references `var(--background)`/`var(--foreground)` (not `--color-*`).
- [ ] `color-scheme: light` under `:root`, `color-scheme: dark` under `.dark`.
- [ ] `--danger` aliases `--destructive` (one red).
- [ ] `bg-card`, `text-muted-foreground`, `text-primary-foreground`, `bg-secondary` now resolve (static resolution check in T3).
- [ ] Smoke: TicketCard/BoardColumn/AssigneeAvatar/BoardFilters render non-transparent in light AND with `.dark` on `<html>` (manual toggle, recorded).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. new `tokens.test.ts`).
- [ ] Committed diff is exactly `frontend/src/index.css` + `frontend/src/tokens.test.ts`.
- [ ] No `tailwind.config.js`/`.ts` created (v4 CSS-first config preserved).
- [ ] No component changes leaked (F46 scope preserved).
- [ ] D3 owner sign-off (OKLCH + dark palette values) recorded.

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- Manual `.dark` toggle smoke — `bg-card` (TicketCard): `________` · `text-muted-foreground` (BoardColumn): `________` · `text-primary-foreground` (AssigneeAvatar): `________` · `bg-secondary` (BoardFilters): `________` (PASS/FAIL per utility, light + dark)
- Token count — `:root`: `30` · `.dark`: `30` · `@theme inline` mappings: `30`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- Static resolution check: `bg-card: RESOLVED` · `text-muted-foreground: RESOLVED` · `text-primary-foreground: RESOLVED` · `bg-secondary: RESOLVED`
- D3 owner sign-off (OKLCH + dark palette): `OKLCH chosen 2026-06-26; dark palette owner-decided (gray-900 base)`

---

## 8. Schema deltas owned by this feature

F32 owns **CSS-token deltas only — no DB migration** (per the redesign's standing no-migration stance). These match the feature file's "Schema deltas" attribution: CSS token additions + `@custom-variant dark` + `.dark` block.

| Delta | Detail | Mechanism |
| --- | --- | --- |
| Light semantic tokens (`:root`) | 30 CSS custom properties added (or restructured from the 5 seed tokens), **OKLCH** values (D3): `--background`, `--foreground`, `--card`/`--card-foreground`, `--popover`/`--popover-foreground`, `--primary`/`--primary-foreground`, `--secondary`/`--secondary-foreground`, `--muted`/`--muted-foreground`, `--accent`/`--accent-foreground`, `--destructive`/`--destructive-foreground`, `--border`, `--input`, `--ring`, `--success`/`--success-foreground`, `--warning`/`--warning-foreground`, `--danger`/`--danger-foreground` + `color-scheme: light` | `frontend/src/index.css` `:root { }` block |
| Dark semantic tokens (`.dark`) | Same 30 tokens with dark OKLCH values (gray-900 base) + `color-scheme: dark` (new — no dark block existed before) | `frontend/src/index.css` `.dark { }` block |
| Tailwind v4 token mapping | `@theme inline { --color-*: var(--*) }` for all 30 tokens (replaces the plain 5-token `@theme` block) | `frontend/src/index.css` `@theme inline { }` block |
| Class-based dark variant | `@custom-variant dark (&:where(.dark, .dark *));` (PRD §3.1 canonical `:where()` form) | `frontend/src/index.css` directive |
| `@layer base` var rename | body rule `var(--color-background)` → `var(--background)`, `var(--color-foreground)` → `var(--foreground)` (load-bearing — inline doesn't emit `--color-*` globally) | `frontend/src/index.css` `@layer base { }` block |
| Static source-presence test | `frontend/src/tokens.test.ts` (new co-located Vitest test asserting structural completeness + OKLCH-only values) | new file |

**No DB migration.** F32 touches only `frontend/src/index.css` (modified) and `frontend/src/tokens.test.ts` (new). This aligns with the redesign's "No DB migration" stance and the feature file's schema-delta attribution (CSS tokens, not ORM/SQL).
