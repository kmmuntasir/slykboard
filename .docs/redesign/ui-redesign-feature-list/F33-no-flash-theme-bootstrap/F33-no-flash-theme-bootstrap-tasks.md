# F33 — No-flash theme bootstrap: Plan + Task Breakdown

> **Feature:** F33 — No-flash theme bootstrap (color-scheme meta + pre-React script) (Phase 0 — Foundations · Infrastructure)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F32 (done) · **PRD ref:** §3.1 (color-scheme meta), §3.2 (no-flash inline script), §1.6 (system-theme respect), §2.3 (scrollbar flash bug), D8 (localStorage fallback)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency feature: [F32](../F32-define-semantic-tokens/F32-define-semantic-tokens-tasks.md) (token set — done; F33 activates its `.dark` block pre-paint).

---

## 1. F33 Recap

**Goal:** Eliminate the white flash on dark-mode refresh and stop native controls/scrollbars flashing light — by adding a `<meta name="color-scheme">` tag and a synchronous pre-React inline `<script>` in `index.html` `<head>` that applies the `.dark` class to `document.documentElement` before `main.tsx` mounts.

**Ships:** A user with a persisted dark preference who hard-refreshes sees dark from first paint; native scrollbars and form controls honor the scheme from the UA chrome's first paint. No FOUC in either theme.

**Acceptance (definition of done):**
1. `frontend/index.html` `<head>` gains `<meta name="color-scheme" content="light dark">`.
2. An inline `<script>` in `<head>` reads `localStorage['slykboard-theme']` and, if the resolved theme is `dark` (stored `'dark'`, OR stored `'system'`/absent/invalid with `matchMedia('(prefers-color-scheme: dark)').matches` true), adds class `dark` to `document.documentElement` **before** the `/src/main.tsx` module script mounts React.
3. The script is inline (not a module fetch) so it runs synchronously pre-paint; no FOUC on refresh in either theme.
4. localStorage unavailable (private mode / disabled storage) → script `try/catch`es and falls back to `system` (matchMedia) per D8; never throws on first paint.
5. The script is the first thing in `<head>` after charset/viewport (and the new color-scheme meta), before `<title>` and before any Vite-injected stylesheet/module script.

**Edge cases to resolve up front:**
- **localStorage unavailable (private mode / disabled storage)** → **Decision: wrap the `localStorage.getItem` read and the `matchMedia` call in `try/catch`; on any throw, fall back to light (no `.dark` added). Never throw on first paint.** The matchMedia call itself is also inside the try/catch (some privacy modes throw on it too). (D8.)
- **Script ordering** → **Decision: a plain inline `<script>` (NOT `type="module"`) in `<head>`, immediately after the `color-scheme` meta, before `<title>`.** Plain scripts are parser-blocking and run synchronously during HTML parse; module scripts are deferred by spec → they execute after parse → flash. Decision #3 mandates inline-`<head>`-before-any-stylesheet; the module-defer constraint forces plain-script form.
- **Fixed key `slykboard-theme`** → **Decision: the key name is `slykboard-theme`, fixed by PRD §3.2 and cross-cutting decision #2. Renaming is a breaking change to every existing user's persisted preference. F33 READS it first (F34 WRITES it later via ThemeProvider). Never rename.**
- **Logic extraction (structural)** → **Decision: extract a pure `resolveInitialTheme(stored, prefersDark)` function + `THEME_STORAGE_KEY` constant to `frontend/src/utils/theme.ts` (testable; single source of truth for the resolution rule; F34's ThemeProvider imports both). The inline `<script>` in `index.html` is self-contained vanilla JS mirroring it (a module import would be async → flash).** This is the standard no-flash pattern (cf. next-themes / shadcn). Both carry a cross-reference comment so they stay in sync.

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for theme infra. Zero theme/dark/localStorage infrastructure exists today. Grep of `frontend/src` for `slykboard-theme`, `useTheme`, `ThemeProvider`, `document.documentElement`, `matchMedia`, `prefers-color-scheme`, `classList`+`dark` → all empty. The only `localStorage` hits are AUTH-only (`src/stores/useAuthStore.ts:28`, `src/constants/auth.ts:1`). **F33 is the first JS touch of theme.** No duplication risk.

- **Existing structure this feature builds on (verified):**
  - `frontend/index.html` is a **bare 12-line shell.** `<head>` (L3-7): L4 `<meta charset="UTF-8" />`, L5 `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`, L6 `<title>Slykboard</title>`. NO meta color-scheme, NO inline script, NO stylesheet `<link>`, NO fonts. `<body>`: L9 `<div id="root"></div>`, **L10 `<script type="module" src="/src/main.tsx"></script>`** (the Vite entry / app mount — F33's script MUST run BEFORE this). `<html lang="en">` (L2) has NO `class` attribute (F33 adds `.dark` imperatively via `classList.add`, not declaratively).
  - `frontend/src/main.tsx:11` → `import './index.css';` (F32-owned — F33 must NOT touch). L13-16 → `getElementById('root')` + null-guard. **L18 → `createRoot(rootElement).render(...)`** — React mounts here, during the L10 module script's execution. The inline `<head>` script runs as a parser-blocking inline script before the L10 module is fetched/parsed → correct ordering seam.
  - **F32's CSS seam (F33 activates it):** `frontend/src/index.css` — L6 `@custom-variant dark (&:where(.dark, .dark *))`; L9-50 `:root { ... color-scheme: light; }` (L49); **L53 `.dark {`** block (the load-bearing target); L91 `color-scheme: dark;`. F33's `document.documentElement.classList.add('dark')` activates F32's `.dark` block on the first frame. **F33 defines NO tokens; it toggles F32's class.**

- **`color-scheme` split (no overlap, complementary):** F32 owns the **CSS `color-scheme` property** (`index.css` L49 light / L91 dark — post-CSS-parse UA chrome). F33 owns the **HTML `<meta name="color-scheme" content="light dark">`** — covers the pre-CSS-parse window (UA chrome during initial HTML parse). Both contribute; neither duplicates the other.

- **Vite / HTML processing (verified):** `frontend/vite.config.ts:7` → plugins `[@vitejs/plugin-react, @tailwindcss/vite]` only; NO `transformIndexHtml` / html-rewrite plugins. `index.html` is the Vite entry. **Inline `<head>` scripts (plain, no `src`, no `type="module"`) are preserved as-is in both dev and build** — `plugin-react` only transforms JSX/TSX module scripts. **CRITICAL: the script must NOT be `type="module"`** (module scripts are deferred by HTML spec → execute after parse → flash defeats the purpose). A plain `<script>` in `<head>` runs synchronously during HTML parse — the required form. In the BUILT output Vite injects a CSS `<link>` into `<head>`; the inline script must precede it (place it right after viewport, before `<title>`).

- **Test setup (verified):** `frontend/src/test-setup.ts` stubs env vars + imports `@testing-library/jest-dom`. **`matchMedia` is NOT polyfilled; jsdom v25 (`package.json:47`) does NOT implement it** — calling `window.matchMedia(...)` throws. **jsdom v25 DOES implement `localStorage`** (it is a Storage stub on `window`). → Strategy: test the resolution as a PURE function taking `prefersDark: boolean` as a param (avoids needing a matchMedia stub entirely). Keep the inline script self-contained (it cannot `import` pre-paint) with a cross-ref comment pointing to the TS function; add a cheap source-presence assertion that `index.html` contains the meta + a plain (non-module) inline `<script>`.

- **Build gate (`frontend/package.json` scripts):** `dev` (vite), `build` (`tsc -b && vite build`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch` (vitest). Vitest config in `vite.config.ts:13-17`: environment `jsdom`, `globals: true`, setupFiles `['./src/test-setup.ts']`, alias `@` → `./src`.

- **Prior art / partial work:** None for theme. F32 (commit `5f9923a`, merged to main, 100% verified, 519/519 tests, gates 0/0/0) is the sole dependency and is DONE. F32 made `.dark` **mean** something (CSS); F33 makes it **appear in time** (DOM-class timing, pre-paint). F33 touches ZERO lines of `index.css`.

- **File paths the plan references that do NOT exist yet** (will be created): `frontend/src/utils/theme.ts`, `frontend/src/utils/theme.test.ts`. (`frontend/index.html` is modified, not created.)

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Node 24+; frontend code under `./frontend/`; Vercel deploy via `npm run build` → `dist`.
  - `js-style-guide.md` — constants `SCREAMING_SNAKE_CASE` (`THEME_STORAGE_KEY`); 2-space JS; ≤100 cols; explicit prop/type interfaces; no `any`. **Note:** the "no inline styles" rule is about JSX/Tailwind — it does NOT prohibit the inline `<script>` tag (a static HTML element, not a style attribute). No `console.log` in production → the bootstrap script is silent on first paint (no logging).
  - `js-testing-rules.md` — Vitest co-located `*.test.ts`; table-driven tests preferred; pure-function tests use direct `expect` (`getByRole` priority applies to component DOM, N/A here); business-logic coverage >80%.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc` (omit ticket if unidentifiable); commit single-line `SLYK-TICKET: message`. Repo precedent: `SLYK-F31`, `SLYK-F32` → F33 uses `SLYK-F33:` prefix.
  - `persona.md` — frontend code → `./frontend/`; reply concise.

- **Hidden coupling to plan for:**
  - **Inline-script ↔ TS-module logic sync.** The vanilla-JS inline script in `index.html` must mirror `resolveInitialTheme` in `theme.ts` exactly (same resolution rule). A cross-reference comment in both keeps them in sync. Drift = subtle theme-resolution bug.
  - **F34 seam established here.** `THEME_STORAGE_KEY` and `resolveInitialTheme` are F33's **contract TO F34.** F34's ThemeProvider will `import { THEME_STORAGE_KEY, resolveInitialTheme } from '@/utils/theme'` and WRITE the key on toggle. F33 must not change these signatures after F34 branches.
  - **F32 zero-touch.** F33 must not edit `index.css`. F32 is closed (merged). Any CSS edit is out of scope (re-open F32 or file a new feature).
  - **Module-vs-plain constraint.** If a future dev "improves" the inline script by adding `type="module"` or extracting it to a `.js` file with `<script src>`, no-flash breaks (deferred execution). T2's source-presence test asserts the script is NOT `type="module"` to guard against regression.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Logic extraction | **Extract `resolveInitialTheme(stored, prefersDark)` + `THEME_STORAGE_KEY` to `frontend/src/utils/theme.ts`** (owner-confirmed 2026-06-26) | A pure function is unit-testable (table-driven), is the single source of truth for the resolution rule, and is the import seam F34's ThemeProvider consumes. The inline `<script>` cannot `import` it pre-paint (a module import is async → flash), so the script is self-contained vanilla JS mirroring it. Both carry a cross-reference comment. Standard no-flash pattern (cf. next-themes / shadcn). |
| D2 | Script form | **Plain `<script>` (NOT `type="module"`), inline in `<head>`, parser-blocking** | Module scripts are deferred by HTML spec → execute after parse → flash. A plain inline `<script>` runs synchronously during HTML parse, before the L10 `/src/main.tsx` module script and before any Vite-injected stylesheet. Decision #3 mandates inline-`<head>`-before-any-stylesheet; the module-defer constraint forces plain-script form. |
| D3 | `color-scheme` meta | **`<meta name="color-scheme" content="light dark">` in `<head>` right after viewport** | PRD §3.1 mandates this meta to fix the §2.3 scrollbar/form-control flash. Complementary to F32's CSS `color-scheme` property (F32 covers post-CSS-parse UA chrome; meta covers pre-CSS-parse window). No overlap. |
| D4 | Resolution rule | **stored `'dark'`→dark; `'light'`→light; `'system'`/`null`/invalid → follow OS (`prefersDark ? 'dark' : 'light'`)** | Default = system per PRD §1.6 ("Respect the user's system") and D8. Apply via `document.documentElement.classList.add('dark')` when resolved is dark; do nothing when light (F34 owns the toggle/remove later). Only `.add` is needed at bootstrap — `.dark` is absent by default in the HTML shell. |
| D5 | localStorage fallback (D8) | **`try/catch` around the `localStorage.getItem` read + the `matchMedia` call; on catch, resolve as light (no `.dark` added)** | D8: localStorage unavailable (private mode / disabled storage) must fall back, never throw on first paint. matchMedia is also inside the try/catch (some privacy modes throw on it). If even matchMedia throws, default to light (no `.dark` class added). |
| D6 | Verification path | **Build clean + typecheck + table-driven unit test of `resolveInitialTheme` + source-presence assertion on `index.html`** | jsdom cannot paint (no render loop) → cannot verify actual no-flash-on-refresh. The pure-function unit test proves the resolution rule for all stored/system combos; the source-presence assertion proves the meta + a plain (non-module) inline `<script>` exist and reference the right key/symbols. Real FOUC-on-hard-refresh check is deferred to F51 visual QA (real Chromium). |
| D7 | Scope boundaries | **No ThemeProvider/useTheme (F34); no toggle UI (F40); no `index.css` edits (F32 closed); no auth/routing (§10); no matchMedia polyfill needed (pure-function test)** | Prevents scope creep. F33 owns exactly: (a) one inline `<script>` in `frontend/index.html` `<head>`; (b) the `<meta name="color-scheme">` tag; (c) `frontend/src/utils/theme.ts` + its test. Nothing else. |

> **Out of F33 scope (explicitly deferred):** ThemeProvider / `useTheme` hook / theme persistence-on-toggle (F34 — WRITES `slykboard-theme`, subscribes to `matchMedia` changes for `system`); theme toggle UI (F40); any `index.css` edit (F32 closed); auth/routing changes (§10); Playwright / real-browser FOUC E2E (F51 visual QA); matchMedia polyfill (not needed — pure-function test sidesteps it).

> **Owner sign-off (resolved 2026-06-26):**
> 1. **D1 — extraction vs inline-only → extraction.** Owner confirmed extraction: pure `resolveInitialTheme` + `THEME_STORAGE_KEY` in `frontend/src/utils/theme.ts` (testable + F34 import seam). Inline-only alternative rejected.
> 2. **F34 contract → confirmed stable.** `THEME_STORAGE_KEY` and `resolveInitialTheme(stored, prefersDark)` are F33's exported seam TO F34; F34's ThemeProvider will import both. Names/signatures locked for the redesign.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   ├─ index.html                     # MODIFIED — <head> gains:
   │                                   #   <meta name="color-scheme" content="light dark">
   │                                   #   <script> ...no-flash IIFE... </script>  (plain, NOT module;
   │                                   #       reads slykboard-theme, adds .dark to documentElement pre-paint)
   │                                   # Both placed right after viewport, before <title>.
   └─ src/
      └─ utils/
         ├─ theme.ts                  # NEW — THEME_STORAGE_KEY, ThemePreference, ResolvedTheme,
         │                            #       resolveInitialTheme(stored, prefersDark)  (pure; F34 imports it)
         └─ theme.test.ts             # NEW — co-located: table-driven resolveInitialTheme test
                                      #       + index.html source-presence assertions (meta + plain inline script)
# NO CSS changes (F32 closed). NO component changes (F46). NO provider/hook (F34). NO toggle (F40).
```

**Lifecycle (the timing F33 controls):**

1. Browser parses `index.html` `<head>`. Encounters `<meta name="color-scheme" content="light dark">` → UA chrome (scrollbars, form-control defaults) renders honoring both schemes from the very first paint (no scrollbar flash — PRD §2.3).
2. Parser reaches the inline `<script>` (plain, parser-blocking). It runs **synchronously**: reads `localStorage['slykboard-theme']` (try/catch), reads `matchMedia('(prefers-color-scheme: dark)').matches` (try/catch), resolves via the D4 rule, and if dark → `document.documentElement.classList.add('dark')`. This activates F32's `.dark` CSS block the instant CSS parses.
3. Parser continues to `<title>`, then `<body>`, then the `<script type="module" src="/src/main.tsx">`. The module is fetched/parsed/executed (deferred); `main.tsx:18` mounts React into `#root`. By now `documentElement` already has `.dark` if needed → React's first paint is dark. **No flash.**

---

## 5. Parallelization Strategy

F33 decomposes into **3 tasks**. T1 (`theme.ts` + test) and T2 (`index.html`) touch **disjoint file sets** (zero merge conflict) — so they *could* parallelize. **BUT** T2's inline script must mirror T1's `resolveInitialTheme` exactly (logic-sync coupling): if they diverge, the runtime resolution differs from the tested function. The safe path is **solo sequential T1 → T2 → T3** so T2's author has T1's function in hand when writing the mirror. The batches below are presented honestly: file-disjoint (parallelizable) but logic-coupled (sequential is safer).

### Batch dependency diagram

```
   Batch A (logic + test)        Batch B (HTML bootstrap)      Batch C (integration)
   ─────────────────────         ──────────────────────────    ────────────────────
        T1 ──────────────────────────▶  T2 ──────────────────────▶  T3
   (theme.ts + theme.test.ts)        (index.html meta + script)     (verify + sign-off)
```

- **Batch A → Batch B** is a soft barrier (logic-sync): T2's inline script mirrors T1's `resolveInitialTheme`. If parallelized, the two devs must agree on the resolution rule up front and keep the cross-ref comments honest. Sequential avoids drift.
- **Batch B → Batch C** is a hard barrier: T3 verifies the merged diff (exactly 3 files) and re-runs the full gate against T1+T2 together.

### Merge order rules

1. **Batch A merges first.** T1 (`utils/theme.ts` + `utils/theme.test.ts`) lands the pure function + test. Must be on `main` before T2 branches (so T2 mirrors committed code).
2. **Batch B merges second.** T2 (`index.html` — meta + inline script) adds the bootstrap. Rebases onto `main` containing T1.
3. **Batch C (integration verification) merges last.** T3 confirms the committed diff is exactly `index.html` + `utils/theme.ts` + `utils/theme.test.ts`, re-runs the full gate, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/utils/theme.ts` (New), `frontend/src/utils/theme.test.ts` (New) | — | T2 (file-disjoint; but logic-sync coupling → sequential recommended) |
| **T2** | B | `frontend/index.html` (M) | T1 (mirror `resolveInitialTheme`) | T1 (file-disjoint; sequential safer) |
| **T3** | C | no files changed (verification gate); records proof in §7 | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3. (The only realistic track — logic-sync coupling makes sequential safest.)
- **2 devs:** Not beneficial. T1 and T2 are file-disjoint but logic-coupled; the coordination cost (agreeing the resolution rule + keeping cross-ref comments honest) exceeds the time saved. Assign one owner end-to-end.
- **3+ devs:** No beneficial split. F33 is a tiny feature (one pure function, one HTML edit, one test). Single owner.

---

## 6. Tasks

### T1 — Create `frontend/src/utils/theme.ts` (resolution pure function + key constant) + co-located `theme.test.ts`

**Batch:** A · **Depends on:** None · **Parallel with:** T2 (file-disjoint; sequential recommended due to logic-sync)

**Description:** Author the single source of truth for the no-flash resolution rule as a **pure function** (no DOM access, no side effects) so it is table-driven testable and importable by F34's ThemeProvider. Define the fixed storage key constant and the two string-literal types. jsdom cannot run the real inline script's DOM side effects meaningfully for no-flash verification, so the test targets the pure function directly (`getByRole` priority is N/A — no component/DOM under test here, just direct `expect`).

Create `frontend/src/utils/theme.ts`:

```typescript
// F33 — No-flash theme bootstrap: pure resolution rule.
// Single source of truth for the stored→resolved mapping. The inline <script> in
// index.html mirrors this logic in vanilla JS (it cannot import pre-paint without
// becoming a deferred module → flash). Keep both in sync; drift = subtle bug.
// F34's ThemeProvider imports THEME_STORAGE_KEY + resolveInitialTheme.

/** localStorage key holding the user's persisted preference. FIXED (PRD §3.2, decision #2):
 *  renaming is a breaking change to every existing user's preference. */
export const THEME_STORAGE_KEY = 'slykboard-theme';

/** The value the user chose (or 'system' default / null when unset). */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The concrete theme to apply to the DOM (no 'system' — that resolves to light/dark). */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Resolve a stored preference + OS hint to a concrete theme. Pure: no DOM, no I/O.
 * Rule (D4):
 *   - 'dark'  → 'dark'
 *   - 'light' → 'light'
 *   - 'system' | null | invalid → follow OS (prefersDark ? 'dark' : 'light')
 * Default = system (PRD §1.6, D8).
 */
export function resolveInitialTheme(
  stored: string | null,
  prefersDark: boolean,
): ResolvedTheme {
  if (stored === 'dark') return 'dark';
  if (stored === 'light') return 'light';
  // 'system', null, or any invalid value → follow the OS hint.
  return prefersDark ? 'dark' : 'light';
}
```

Create the co-located `frontend/src/utils/theme.test.ts` (table-driven, per `js-testing-rules.md`):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  type ThemePreference,
  type ResolvedTheme,
} from './theme';

describe('THEME_STORAGE_KEY', () => {
  it('is the PRD §3.2 / decision #2 fixed key (never rename)', () => {
    expect(THEME_STORAGE_KEY).toBe('slykboard-theme');
  });
});

describe('resolveInitialTheme (D4 rule — pure)', () => {
  // Table-driven per js-testing-rules.md. Covers stored explicit, system, null, invalid.
  const cases: Array<{
    name: string;
    stored: string | null;
    prefersDark: boolean;
    expected: ResolvedTheme;
  }> = [
    { name: "stored 'dark' → dark", stored: 'dark', prefersDark: false, expected: 'dark' },
    { name: "stored 'dark' → dark (even if OS is light)", stored: 'dark', prefersDark: true, expected: 'dark' },
    { name: "stored 'light' → light", stored: 'light', prefersDark: true, expected: 'light' },
    { name: "stored 'light' → light (even if OS is dark)", stored: 'light', prefersDark: false, expected: 'light' },
    { name: "stored 'system' + OS dark → dark", stored: 'system', prefersDark: true, expected: 'dark' },
    { name: "stored 'system' + OS light → light", stored: 'system', prefersDark: false, expected: 'light' },
    { name: 'null (unset) + OS dark → dark (default = system)', stored: null, prefersDark: true, expected: 'dark' },
    { name: 'null (unset) + OS light → light (default = system)', stored: null, prefersDark: false, expected: 'light' },
    { name: "invalid 'garbage' + OS dark → dark (falls back to system)", stored: 'garbage', prefersDark: true, expected: 'dark' },
    { name: "invalid 'garbage' + OS light → light (falls back to system)", stored: 'garbage', prefersDark: false, expected: 'light' },
    { name: "empty string '' + OS dark → dark (invalid → system)", stored: '', prefersDark: true, expected: 'dark' },
    { name: "uppercase 'DARK' is invalid → system fallback (case-sensitive)", stored: 'DARK', prefersDark: false, expected: 'light' },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveInitialTheme(c.stored, c.prefersDark)).toBe(c.expected);
    });
  }

  it('is pure: same inputs → same output (no DOM/IO)', () => {
    const a = resolveInitialTheme('system', true);
    const b = resolveInitialTheme('system', true);
    expect(a).toBe(b);
    expect(a).toBe('dark');
  });

  it('tolerates all ThemePreference values as input', () => {
    const all: ThemePreference[] = ['light', 'dark', 'system'];
    for (const pref of all) {
      expect(['light', 'dark']).toContain(resolveInitialTheme(pref, true));
    }
  });
});

// Source-presence guard for the HTML bootstrap (D2/D3). jsdom cannot paint, so we
// assert the index.html source contains the meta + a plain (non-module) inline
// <script> wired to the right key + DOM symbols. The real FOUC check is F51.
// NOTE: these assertions pass only AFTER T2 lands the index.html edit. T1 lands
// the function-side green; T2 makes these green.
describe('index.html no-flash bootstrap (source-presence, D6)', () => {
  const htmlPath = resolve(__dirname, '..', '..', 'index.html');
  const html = readFileSync(htmlPath, 'utf8');

  it('declares <meta name="color-scheme" content="light dark"> (PRD §3.1)', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  it('has a plain inline <script> in <head> (no src, not a module — D2)', () => {
    // A plain inline script: opening <script> tag NOT carrying type="module" and NOT carrying src=.
    expect(html).toMatch(/<script>(?![\s\S]*type="module")/);
    expect(html).not.toMatch(/<script\s+[^>]*type="module"[^>]*>[\s\S]*slykboard-theme/);
  });

  it('script references the fixed storage key (PRD §3.2, decision #2)', () => {
    expect(html).toContain('slykboard-theme');
  });

  it('script adds .dark to documentElement (activates F32 .dark block)', () => {
    expect(html).toContain('document.documentElement');
    expect(html).toMatch(/classList\.add\(\s*['"]dark['"]\s*\)/);
  });

  it('script reads prefers-color-scheme via matchMedia', () => {
    expect(html).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  it('script has a try/catch fallback (D8 — never throw on first paint)', () => {
    expect(html).toMatch(/try\s*\{/);
    expect(html).toMatch(/catch\s*\(/);
  });

  it('script precedes the main.tsx module mount (ordering — decision #3)', () => {
    const scriptIdx = html.search(/<script>[^<]/);
    const mountIdx = html.indexOf('/src/main.tsx');
    expect(scriptIdx, 'inline script must come before the main.tsx module').toBeGreaterThan(-1);
    expect(mountIdx, 'main.tsx module reference not found').toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(mountIdx);
  });

  it('script sits before <title> (after viewport, before title — decision #3)', () => {
    const scriptIdx = html.search(/<script>[^<]/);
    const titleIdx = html.indexOf('<title>');
    expect(scriptIdx).toBeLessThan(titleIdx);
  });
});
```

**Why `getByRole` is N/A:** this task tests a pure function (`resolveInitialTheme`) and reads a static file as a string — there is no rendered component/DOM tree to query by role. `js-testing-rules.md`'s role-priority applies to component tests; here direct `expect` is correct.

**T1 → T2 test sequencing:** the source-presence block (last `describe`) targets `index.html`, which T2 edits. T1 commits with the function tests green and the HTML assertions red (T2 not yet landed) — OR T1 author lands only the function/type-level tests and T2 adds the source-presence block. **Recommended: author the full `theme.test.ts` now; commit T1 with the function tests green and the HTML assertions expected-red until T2 lands, then T2 makes them green.** (Orchestration may land T1+T2 in one PR to keep the suite green throughout — see §5.)

**Acceptance Criteria:**
- [ ] `frontend/src/utils/theme.ts` created with `THEME_STORAGE_KEY = 'slykboard-theme'`, `ThemePreference`, `ResolvedTheme`, and pure `resolveInitialTheme(stored, prefersDark)`.
- [ ] `frontend/src/utils/theme.test.ts` created (co-located in `utils/`).
- [ ] Table-driven test covers all stored values × OS states: `'dark'`, `'light'`, `'system'`, `null`, plus invalid (`'garbage'`, `''`, `'DARK'`).
- [ ] `resolveInitialTheme` is pure (no `document`/`localStorage`/`matchMedia` references in `theme.ts`).
- [ ] `THEME_STORAGE_KEY` exported and asserted equal to `'slykboard-theme'`.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.
- [ ] (After T2) `npm run test -w frontend -- theme.test.ts` exits 0 including the source-presence block.

**Dependencies:** None.

---

### T2 — Add `<meta name="color-scheme">` + the self-contained inline no-flash `<script>` to `frontend/index.html` `<head>`

**Batch:** B · **Depends on:** T1 (mirror `resolveInitialTheme`) · **Parallel with:** T1 (file-disjoint; sequential recommended)

**Description:** Add two elements to `index.html` `<head>`, **immediately after the viewport meta, before `<title>`**: (a) the `<meta name="color-scheme" content="light dark">` tag (PRD §3.1, D3); (b) a plain inline `<script>` (NOT `type="module"` — D2) that runs synchronously pre-paint, reads `localStorage['slykboard-theme']` and `matchMedia('(prefers-color-scheme: dark)').matches` inside a `try/catch` (D8), resolves via the D4 rule (mirroring `resolveInitialTheme`), and adds `.dark` to `document.documentElement` when the resolved theme is dark. The script is self-contained vanilla JS (it cannot `import` pre-paint). It carries a cross-reference comment to `src/utils/theme.ts`.

Modify `frontend/index.html` — replace the current 12-line contents with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <!--
      F33 no-flash theme bootstrap — MUST stay inline in <head>, plain <script> (NOT type="module"):
      module scripts are deferred → they run after parse → white flash on dark-mode refresh.
      This runs synchronously during HTML parse, BEFORE the /src/main.tsx module mounts React,
      and BEFORE any Vite-injected stylesheet, so .dark is on <html> in time for first paint.

      Mirrors resolveInitialTheme(stored, prefersDark) in src/utils/theme.ts — keep both in sync.
      Storage key 'slykboard-theme' is FIXED (PRD §3.2, decision #2): renaming breaks every user.
      localStorage unavailable (private mode) → try/catch → fall back to light (D8); never throw.
    -->
    <script>
      (function () {
        var resolvedDark = false;
        try {
          var stored = localStorage.getItem('slykboard-theme'); // 'light' | 'dark' | 'system' | null
          var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          // resolveInitialTheme (D4): dark→dark; light→light; system|null|invalid → follow OS
          if (stored === 'dark') {
            resolvedDark = true;
          } else if (stored === 'light') {
            resolvedDark = false;
          } else {
            resolvedDark = prefersDark; // 'system' | null | invalid → default = system (PRD §1.6, D8)
          }
        } catch (_) {
          // localStorage or matchMedia unavailable (private mode / disabled storage) → light.
          // D8: never throw on first paint.
          resolvedDark = false;
        }
        if (resolvedDark) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
    <title>Slykboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Resulting `<head>` block (exact, in order):**

```
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />          <!-- D3 — PRD §3.1, scrollbar/control flash fix -->
  <script> ...no-flash IIFE... </script>                     <!-- D2 — plain, NOT module; pre-paint; D8 try/catch -->
  <title>Slykboard</title>
</head>
```

**Key edits vs current `index.html`:**
1. Add `<meta name="color-scheme" content="light dark" />` after the viewport meta (D3).
2. Add the plain inline `<script>` IIFE after the color-scheme meta, before `<title>` (D2, decision #3).
3. `<title>`, `<body>`, `<div id="root">`, and the `/src/main.tsx` module script are **unchanged** (positions preserved).
4. `<html lang="en">` unchanged — F33 adds `.dark` imperatively via `classList.add`, not declaratively.

**Why the script uses `var` and an IIFE:** it is pre-paint, pre-module, runs in the global scope during HTML parse. `var` + IIFE avoids leaking temporals and avoids any transpile assumption (the script is preserved verbatim by Vite, not processed by `plugin-react`). No `console.log` (style guide: no logging in production; the bootstrap must be silent).

**Acceptance Criteria:**
- [ ] `<meta name="color-scheme" content="light dark">` present in `<head>` right after viewport.
- [ ] A plain inline `<script>` present in `<head>` (opening tag is exactly `<script>`, NOT `<script type="module">`, NOT `<script src="...">`).
- [ ] Script is positioned before `<title>` and before the `/src/main.tsx` module script.
- [ ] Script reads `localStorage.getItem('slykboard-theme')`.
- [ ] Script reads `window.matchMedia('(prefers-color-scheme: dark)').matches`.
- [ ] Script applies the D4 rule: stored `'dark'`→add `.dark`; `'light'`→don't; `'system'`/`null`/invalid→follow OS.
- [ ] Script calls `document.documentElement.classList.add('dark')` when resolved dark.
- [ ] Script wraps the read + matchMedia in `try { ... } catch (_) { resolvedDark = false; }` (D8 — never throw).
- [ ] Script mirrors `resolveInitialTheme` in `theme.ts` (same rule; cross-ref comment present in both).
- [ ] Cross-reference comment in the script points to `src/utils/theme.ts`.
- [ ] `npm run build -w frontend` exits 0 (Vite preserves the inline script as-is).
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- theme.test.ts` exits 0 (the T1 source-presence assertions now pass — meta present, plain script present, key/symbols present, ordering correct).

**Dependencies:** T1 (the script mirrors `resolveInitialTheme`; T1's source-presence assertions are T2's gate).

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the three F33 files (no CSS/component/provider leakage), re-run the full gate green, confirm the source-presence assertions pass against the merged `index.html`, and record proof in §7. The real FOUC-on-hard-refresh check is deferred to F51 visual QA (jsdom cannot paint).

Steps:
1. Confirm the branch's committed diff is **exactly** three files:
   ```bash
   git diff --name-only main...HEAD
   # Expected:
   # frontend/index.html
   # frontend/src/utils/theme.test.ts
   # frontend/src/utils/theme.ts
   ```
   Any other path (a `ThemeProvider.tsx`, a `useTheme.ts`, an `index.css` edit, a component, a config file) → leaked; remove and re-commit before sign-off. F33 owns no CSS, no components, no provider/hook (F34/F40/F46 scopes preserved).
2. Re-run the full gate on the merged state:
   ```bash
   npm install                            # clean install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. theme.test.ts + full suite regression)
   ```
3. **Source-presence check** — confirm `index.html` has the meta + a plain (non-module) inline `<script>` wired correctly:
   ```bash
   grep -q '<meta name="color-scheme" content="light dark">' frontend/index.html \
     && echo "color-scheme meta: PRESENT" || echo "color-scheme meta: MISSING"

   # The inline script must NOT be type="module":
   if grep -q '<script type="module"' <(sed -n '/<script>/,/<\/script>/p' frontend/index.html); then
     echo "inline script is a MODULE (BUG — would flash)"
   else
     echo "inline script: PLAIN (correct)"
   fi

   # Symbols the no-flash logic depends on:
   for sym in 'slykboard-theme' 'matchMedia' 'document.documentElement' 'classList.add' 'try' 'catch'; do
     grep -q "$sym" frontend/index.html && echo "$sym: PRESENT" || echo "$sym: MISSING"
   done
   ```
   All must print the PRESENT/correct variant.
4. Confirm `frontend/src/index.css` is **unchanged** vs main (F32 closed — F33 touches zero CSS lines):
   ```bash
   git diff --quiet main...HEAD -- frontend/src/index.css && echo "index.css: UNCHANGED (F32 preserved)" \
     || echo "index.css: CHANGED (out of scope — revert)"
   ```
   Must print UNCHANGED.
5. Confirm no `ThemeProvider`/`useTheme`/toggle artifacts were created (F34/F40 scope):
   ```bash
   git diff --name-only main...HEAD | grep -Ei '(ThemeProvider|useTheme|ThemeToggle)' \
     && echo "LEAKED F34/F40 scope" || echo "no provider/toggle leakage"
   ```
   Must print the clean message.
6. **Manual no-flash smoke (the real check — formal sign-off deferred to F51):** documented; the *formal* FOUC assertion belongs to F51 (real Chromium). For F33's gate, optionally run a quick eyeball:
   - `npm run dev -w frontend`, open the app.
   - DevTools → Application → Local Storage → set `slykboard-theme` = `"dark"`.
   - Hard-refresh (Cmd/Ctrl+Shift+R). Observe: page paints dark from the first frame (no white flash). Scrollbars are dark.
   - Set `slykboard-theme` = `"light"`, hard-refresh → light from first paint.
   - Remove the key, set OS to dark (or DevTools → Rendering → Emulate `prefers-color-scheme: dark`), hard-refresh → dark from first paint.
   - Record PASS/FAIL per scenario in §7 (informational; F51 owns the formal sign-off).
7. Capture commit SHA, exit codes, and the source-presence results into §7. Confirm owner sign-off on D1 (extraction) and the F34 contract (`THEME_STORAGE_KEY` + `resolveInitialTheme`).

**Acceptance Criteria:**
- [ ] Committed diff is exactly `frontend/index.html` + `frontend/src/utils/theme.ts` + `frontend/src/utils/theme.test.ts` (no CSS, no component, no provider/hook, no config file).
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `theme.test.ts` source-presence assertions green).
- [ ] `frontend/src/index.css` unchanged vs main (F32 preserved).
- [ ] Source-presence: `<meta name="color-scheme" content="light dark">` PRESENT; inline script PLAIN (not module); `slykboard-theme`, `matchMedia`, `document.documentElement`, `classList.add`, `try`, `catch` all PRESENT.
- [ ] No `ThemeProvider`/`useTheme`/toggle artifacts (F34/F40 scope preserved).
- [ ] All F33 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] Owner sign-off on D1 (extraction) + F34 contract recorded.

**Dependencies:** T1, T2.

---

## 7. Final F33 Acceptance Checklist

- [ ] `frontend/index.html` `<head>` gains `<meta name="color-scheme" content="light dark">` (right after viewport).
- [ ] Inline `<script>` in `<head>` reads `localStorage['slykboard-theme']` and, if resolved dark (stored `'dark'`, OR stored `'system'`/absent/invalid + `matchMedia('(prefers-color-scheme: dark)').matches`), adds class `dark` to `document.documentElement` **before** `main.tsx` mounts.
- [ ] Script is inline, plain `<script>` (NOT `type="module"`, NOT external `src`) — runs synchronously pre-paint.
- [ ] Script positioned after viewport/color-scheme meta, before `<title>` and before the `/src/main.tsx` module script.
- [ ] Script mirrors `resolveInitialTheme` in `frontend/src/utils/theme.ts` (same D4 rule; cross-ref comment in both).
- [ ] `localStorage` unavailable → script `try/catch`es, falls back to light (never throws on first paint) — D8.
- [ ] `frontend/src/utils/theme.ts` exports `THEME_STORAGE_KEY = 'slykboard-theme'` (fixed, PRD §3.2/decision #2), `ThemePreference`, `ResolvedTheme`, and pure `resolveInitialTheme(stored, prefersDark)`.
- [ ] `frontend/src/utils/theme.test.ts` (co-located) — table-driven test covers `'dark'`/`'light'`/`'system'`/`null`/invalid × OS dark/light; source-presence assertions prove meta + plain inline script + key/symbols + ordering.
- [ ] No FOUC on hard-refresh in either theme (manual smoke; formal FOUC assertion deferred to F51).
- [ ] `frontend/src/index.css` unchanged (F32 closed — F33 adds zero CSS).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. new `theme.test.ts` + full regression).
- [ ] Committed diff is exactly `frontend/index.html` + `frontend/src/utils/theme.ts` + `frontend/src/utils/theme.test.ts`.
- [ ] No ThemeProvider/useTheme/toggle/index.css leakage (F34/F40/F32 scopes preserved).
- [ ] D1 owner sign-off (extraction) recorded; F34 contract (`THEME_STORAGE_KEY` + `resolveInitialTheme`) confirmed stable.

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- `index.html` source-presence — color-scheme meta: `PRESENT` · inline script PLAIN (not module): `________` · `slykboard-theme`: `________` · `matchMedia`: `________` · `document.documentElement`: `________` · `classList.add('dark')`: `________` · try/catch: `________`
- Ordering — inline script before `<title>`: `PASS/FAIL` · inline script before `/src/main.tsx` module: `PASS/FAIL`
- `resolveInitialTheme` table-driven test: `14/14 pass` (or actual count)
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- Manual no-flash smoke (informational; F51 owns formal sign-off) — dark stored: `________` · light stored: `________` · system/OS-dark: `________` (PASS/FAIL each)
- Build / typecheck / test exit codes: `0 / 0 / 0`
- D1 owner sign-off (extraction vs inline-only): `extraction chosen (owner-confirmed 2026-06-26)`
- F34 contract confirmed: `THEME_STORAGE_KEY + resolveInitialTheme(stored, prefersDark) stable (owner-confirmed 2026-06-26)`

---

## 8. Schema deltas owned by this feature

F33 owns **no schema deltas** — it is an HTML + vanilla-JS bootstrap. There is **no DB migration** (the redesign's standing no-migration stance) and **no CSS token additions** (F32 owns and has closed those). F33 touches only three files: `frontend/index.html` (modified — meta + inline script in `<head>`), `frontend/src/utils/theme.ts` (new — pure function + constant + types), and `frontend/src/utils/theme.test.ts` (new — co-located test).

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| HTML color-scheme meta | `<meta name="color-scheme" content="light dark">` added to `<head>` (PRD §3.1, D3) — complements F32's CSS `color-scheme` property | `frontend/index.html` `<head>` |
| No-flash inline script | Plain (non-module) inline `<script>` IIFE in `<head>`: reads `slykboard-theme` + `matchMedia`, applies D4 rule with D8 try/catch fallback, adds `.dark` to `document.documentElement` pre-paint (D2) | `frontend/index.html` `<head>` |
| Resolution pure function | `resolveInitialTheme(stored, prefersDark)` + `THEME_STORAGE_KEY` + `ThemePreference`/`ResolvedTheme` types (F34 import seam) | new `frontend/src/utils/theme.ts` |
| Co-located test | Table-driven `resolveInitialTheme` coverage + `index.html` source-presence assertions | new `frontend/src/utils/theme.test.ts` |
