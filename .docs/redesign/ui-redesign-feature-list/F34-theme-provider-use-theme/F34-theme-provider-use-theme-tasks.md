# F34 — ThemeProvider + useTheme hook: Plan + Task Breakdown

> **Feature:** F34 — ThemeProvider + useTheme hook (persist + matchMedia + .dark toggle) (Phase 0 — Foundations · Infrastructure)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F33 (done) · **PRD ref:** §3.2 (ThemeProvider + useTheme), §1.6 (system-theme respect), D8 (localStorage fallback), decision #2 (fixed key)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency feature: [F33](../F33-no-flash-theme-bootstrap/F33-no-flash-theme-bootstrap-tasks.md) (no-flash bootstrap — done; F34 imports its `THEME_STORAGE_KEY` + `resolveInitialTheme`).

---

## 1. F34 Recap

**Goal:** Give the app a React-side theme controller that owns the `'light' | 'dark' | 'system'` state, persists it, and reacts to OS scheme changes — so the rest of the UI (F40 toggle, F36 portal-dark, F50 cascade) can read and drive theme programmatically.

**Ships:** Programmatic theme control available app-wide; `useTheme()` returns `{ theme, setTheme, resolvedTheme }`; `.dark` class on `<html>` always matches the resolved preference; OS scheme changes are followed live when the user's choice is `system`.

**Acceptance (definition of done):**
1. `frontend/src/components/ThemeProvider.tsx` + `frontend/src/hooks/useTheme.ts` created.
2. Provider mounted in `main.tsx` **above** `RouterProvider` (inside `QueryClientProvider`).
3. State persisted to `localStorage` key `slykboard-theme`; `.dark` added/removed on `document.documentElement` to match the resolved value.
4. Subscribes to `window.matchMedia('(prefers-color-scheme: dark)')` `change` events when theme is `system`; unsubscribes on cleanup (and when switching away from `system`).
5. `useTheme()` outside provider throws a clear error (no silent undefined).

**Edge cases to resolve up front:**
- **D8 localStorage fallback** → **Decision: provider `try/catch`es BOTH the read (seed) and the write (`setTheme`) and the `matchMedia` access; on any catch fall back to `'system'`/light, keep working in-memory, never throw.** (PRD §3.2, decision #10.)
- **No-flash agreement (load-bearing)** → **Decision: lazy-initialize state from `resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia('(prefers-color-scheme: dark)').matches)` so React's first render equals the F33 pre-paint script's result (same key + same rule) → no re-flash. The `.dark`-sync `useEffect` is idempotent on first run.** (F33 edge case; F33 contract.)
- **`resolvedTheme` distinct from `theme`** → **Decision: expose BOTH `theme` (the user's choice `'light' | 'dark' | 'system'`) and `resolvedTheme` (the concrete `'light' | 'dark'` after system resolution).** Components that need to pick an icon (F40) consume `resolvedTheme`; the toggle UI shows `theme`.
- **Mechanism (Context vs Zustand) — D1** → **Decision: React Context (`createContext` + `useContext` in `ThemeProvider.tsx`), NOT Zustand.** Rationale below in §3. Diverges from the auth Zustand+persist precedent.
- **`useTheme()` outside provider** → **Decision: `useContext` returns `undefined` → throw a clear `Error`.** No silent undefined. (F34 acceptance.)
- **`.dark` target** → **Decision: `document.documentElement`** — locked by F36 (portal-dark inheritance depends on it) and already targeted by F33's pre-paint script.

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for React-side theme code. Grep of `frontend/src` for `createContext`/`useContext`/`ThemeProvider`/`useTheme` = 0 hits. **F34 is the app's first custom React Context.** The only theme code today is F33's `index.html` inline script + `frontend/src/utils/theme.ts`. No duplication risk.

- **`frontend/src/main.tsx` mount tree (verbatim, L18-29 — load-bearing for T2 insertion):**
  ```
  createRoot(rootElement).render(
    <StrictMode>
      <GoogleOAuthProvider clientId={env.googleClientId}>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            <Toaster />
          </QueryClientProvider>
        </ErrorBoundary>
      </GoogleOAuthProvider>
    </StrictMode>
  )
  ```
  Nesting outer→inner: `StrictMode` → `GoogleOAuthProvider` → `ErrorBoundary` → `QueryClientProvider` → (`RouterProvider` + `Toaster` siblings). **Insertion point:** wrap `RouterProvider` and keep `Toaster` inside the new provider → `<QueryClientProvider><ThemeProvider><RouterProvider/><Toaster/></ThemeProvider></QueryClientProvider>`. `import './index.css'` is at L11 (F32-owned — F34 MUST NOT touch). New import: `import { ThemeProvider } from '@/components/ThemeProvider'`.

- **No existing React Context pattern** — `grep -rE 'createContext|useContext' frontend/src` = 0 hits; no `*Provider.tsx` component except `GoogleOAuthProvider` (third-party). F34 is the first custom Context in the app.

- **Zustand precedent (the divergence point — D1):** `frontend/src/stores/useAuthStore.ts` uses `create<AuthState>()(persist(..., { storage: createJSONStorage(() => window.localStorage) }))`, key from `@/constants/auth`. `useProjectStore` also Zustand+persist (`lastSelectedSlug`). The app uses **Zustand+persist for persisted client state.** `js-development-rules.md` names Zustand for "client/global UI state" — but does NOT forbid Context, and the PRD §3.2 explicitly names a `ThemeProvider` component mounted above `RouterProvider` (a tree-scoped provider, not a global store). See D1.

- **`frontend/src/hooks/` conventions (verified):** exists (has `.gitKeep`). Hooks are flat, camelCase `use*`, **named exports** — `export function useBoard(...)` at `useBoard.ts:16`; `export function useToast(): ToastApi` at `useToast.ts:11`. Co-located tests: `useBoard.test.tsx`, `useToast.test.tsx`. F34's `useTheme.ts` follows this exactly.

- **`frontend/src/components/` conventions (verified):** flat (no `providers/` subdir). `ThemeProvider.tsx` flat in `components/` is consistent with `ErrorBoundary.tsx` / `Toaster.tsx`. PascalCase file.

- **F33 seam importable (the locked contract):** `frontend/src/utils/theme.ts` exports `THEME_STORAGE_KEY` (L9, `'slykboard-theme'`), `ThemePreference` (L12, `'light' | 'dark' | 'system'`), `ResolvedTheme` (L15, `'light' | 'dark'`), `resolveInitialTheme(stored, prefersDark)` (L25-33, pure). `@/` → `src/` via `vite.config.ts` + `tsconfig.json:11-13`. `import { THEME_STORAGE_KEY, resolveInitialTheme, type ThemePreference, type ResolvedTheme } from '@/utils/theme'` resolves. **F34 MUST use these verbatim — not re-derive the key or resolution rule.** Owner sign-off recorded 2026-06-26: `THEME_STORAGE_KEY + resolveInitialTheme stable`.

- **No-flash agreement contract (load-bearing for D2):** F33's `index.html:18-39` inline script reads `localStorage['slykboard-theme']` + `matchMedia` and applies `.dark` to `document.documentElement` BEFORE React mounts. F34's provider MUST seed initial state from the SAME source via the SAME rule → `resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia('(prefers-color-scheme: dark)').matches)` → guaranteed equal to the script's result (same key + same D4 rule) → React's first render is a no-op on `.dark` (the `.dark`-sync effect toggles nothing on its first run). Provider must NOT re-apply `.dark` on mount in a flipping way.

- **Read vs write split:** F33 = read-only one-shot (closed). **F34 = sole writer** — `setItem` on `setTheme` + `.dark` toggle + re-reads for state seed.

- **`system` subscription ownership:** F33 checks `matchMedia` once. **F34 owns the live subscription** — `addEventListener('change', …)` only when `theme === 'system'`; re-resolve + toggle `.dark`; `removeEventListener` on cleanup and when switching away from `system`.

- **Test setup (verified — and the matchMedia gap):** Vitest 3 + jsdom 25 + RTL 16; config in `vite.config.ts` (env `jsdom`, `globals: true`, setupFiles `['./src/test-setup.ts']`, alias `@` → `./src`). **`matchMedia` is NOT polyfilled** — `test-setup.ts` is 8 lines (env stubs + `@testing-library/jest-dom` import only); jsdom v25 lacks `matchMedia` → calling `window.matchMedia(...)` throws. → F34 tests MUST stub `matchMedia` per-test via `vi.stubGlobal('matchMedia', ...)` returning `{ matches, addEventListener: vi.fn(), removeEventListener: vi.fn(), media, onchange: null, dispatchEvent: vi.fn() }`. **Do NOT add to global test-setup** (keep per-test for determinism). jsdom v25 DOES implement `localStorage` (Storage stub). RTL `render(<ThemeProvider><TestConsumer/></ThemeProvider>)`; assert via consumer output + `document.documentElement.classList.contains('dark')` + `localStorage.getItem(THEME_STORAGE_KEY)`.

- **Build gate (`frontend/package.json`):** `dev` (vite), `build` (`tsc -b && vite build`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). `tsc -b` uses project references — new `src/` files auto-picked.

- **Prior art / partial work:** F33 (commit `477daef`, merged to main, 100% verified, 542/542 tests) is the sole dependency and is DONE. F33 established the resolution rule + key + types; F34 consumes them and becomes the sole writer. Zero React-side theme code exists today — F34 introduces it.

- **File paths the plan references that do NOT exist yet** (will be created): `frontend/src/components/ThemeProvider.tsx`, `frontend/src/hooks/useTheme.ts`, `frontend/src/hooks/useTheme.test.tsx`. (`frontend/src/main.tsx` is modified, not created.)

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite; React Query for server state; Zustand for client/global UI state (does NOT forbid Context — see D1); `useState` for local. Frontend code under `./frontend/`; Vercel deploy via `npm run build` → `dist`.
  - `js-style-guide.md` — hooks camelCase `use*`; components PascalCase; explicit prop interfaces (`ThemeProviderProps`); no `any`; string-literal union types; 2-space TS / 4-space JSX; ≤100 cols; import order external → internal → type → relative; functions <50 lines; no `console.log` in production; no inline styles (Tailwind).
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `render`/`screen`/`fireEvent`; `getByRole` priority; `vi.fn()` mocks; table-driven preferred; coverage business >80% / components >70%.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc` (omit ticket if unidentifiable); commit single-line `SLYK-TICKET: message`. Repo precedent: `SLYK-F31`, `SLYK-F32`, `SLYK-F33` → F34 uses `SLYK-F34:` prefix.
  - `persona.md` — frontend code → `./frontend/`; hooks → `hooks/`, components → `components/`; lists "context" alongside state mgmt.

- **Hidden coupling to plan for:**
  - **No-flash agreement (F33 ↔ F34).** Provider's lazy initializer must produce the same result as F33's pre-paint script (same key + same `resolveInitialTheme` rule). Drift = re-flash on first render. Enforced by importing `resolveInitialTheme` rather than re-deriving.
  - **F36 downstream coupling.** `.dark` MUST target `document.documentElement` — F36 portal-dark inheritance depends on the class living on `<html>`, not on a wrapper div. F33 already targets `documentElement`; F34 must keep it.
  - **F40 downstream API.** F40 (theme toggle UI) consumes `useTheme()` → `{ theme, setTheme, resolvedTheme }`. The shape is locked by F34-spec; changing it breaks F40.
  - **F33 zero-touch.** F34 must not edit `index.html` (F33 closed) or `index.css` (F32 closed). Any edit to either is out of scope.
  - **matchMedia-not-polyfilled gap.** Every F34 test that exercises provider behavior must stub `matchMedia` per-test; relying on a global polyfill would couple tests to test-setup changes and break determinism.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Mechanism (Context vs Zustand) | **React Context** (`createContext` + `useContext` in `ThemeProvider.tsx`), NOT Zustand+persist (owner-confirmed 2026-06-26) | PRD §3.2 explicitly names a `ThemeProvider.tsx` component and mandates mounting it above `RouterProvider` — a tree-scoped provider. F34 acceptance "`useTheme()` outside provider throws" is idiomatic Context (`useContext` throw-on-undefined) — Zustand has no provider/outside-provider concept. Theme needs mount-time side effects (`.dark` sync + `matchMedia` subscribe) = `useEffect` in a provider component — the natural home. `js-development-rules.md` "Zustand for client/global UI state" does not forbid Context for a tree-scoped domain; the PRD's explicit provider naming + the throw contract override. **Diverges from `useAuthStore`/`useProjectStore` Zustand+persist precedent** — but auth is cross-store/cross-tab and global; theme is one mounted provider with DOM side effects and a single consumer tree (F40). |
| D2 | No-flash agreement | **Lazy-initialize state from `resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia('(prefers-color-scheme: dark)').matches)`; the `.dark`-sync `useEffect` is idempotent on first run** | F33's `index.html:18-39` script applies `.dark` pre-paint using the same key + same `resolveInitialTheme` rule. Seeding from the same source guarantees React's first render equals the script's result → the effect toggles nothing on mount → no re-flash. Importing `resolveInitialTheme` (not re-deriving) is what keeps the agreement honest. |
| D3 | `.dark` target | **`document.documentElement`** | Locked by F36 (portal-dark inheritance depends on `.dark` living on `<html>`). F33's script already targets `documentElement`; F34 must match. Wrapping in a div would break portals. |
| D4 | `system` subscription | **`useEffect` adds `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` ONLY when `theme === 'system'`; re-resolve + toggle `.dark`; cleanup `removeEventListener`; re-subscribe when theme transitions to/from `system`** | PRD §3.2 + §1.6 ("Respect the user's system"). Only `system` needs to follow OS changes live; explicit `light`/`dark` ignore them. The effect's dep array includes `theme` so it re-subscribes on every theme transition. |
| D5 | D8 fallback | **`try/catch` around read (seed) + write (`setTheme`) + `matchMedia` access; on catch fall back to `'system'`/light, keep working in-memory, never throw** | Decision #10: localStorage unavailable (private mode / disabled storage) must fall back to `system`, never throw. `matchMedia` is also try/caught (some privacy modes throw on it). The provider keeps state in-memory even when persistence fails — the UI still works. |
| D6 | `resolvedTheme` exposed distinct from `theme` | **Return `{ theme, setTheme, resolvedTheme }`** | F34 edge case: `resolvedTheme` (concrete `'light'`/`'dark'`) is what components need for icon-picking; `theme` (user choice incl. `'system'`) is what the toggle UI shows. F40 consumes both. Exposing only `theme` would force every consumer to re-resolve. |
| D7 | `useTheme()` outside provider | **`useContext` returns `undefined` → throw a clear `Error`** | F34 acceptance ("throws a clear error, no silent undefined"). Idiomatic Context. Catches wiring mistakes (consumer rendered outside `<ThemeProvider>`) loudly instead of crashing on a `undefined.theme` access later. |
| D8 | Mount location | **`main.tsx`, inside `QueryClientProvider`, wrapping `RouterProvider` (keep `Toaster` inside the new provider)** | PRD §3.2 "mount `<ThemeProvider>` in `main.tsx` above `RouterProvider`." Placing inside `QueryClientProvider` keeps the existing outer nesting intact; keeping `Toaster` inside the new provider lets toasts inherit theme. |
| D9 | Scope boundaries | **No `index.html` (F33 closed), no `index.css` (F32 closed), no toggle UI (F40), no global `matchMedia` polyfill, no DB migration, no CSS tokens** | Prevents scope creep. F34 owns exactly: `ThemeProvider.tsx` + `useTheme.ts` + `useTheme.test.tsx` + the `main.tsx` mount edit. Everything else belongs to a sibling or later feature. |

> **Out of F34 scope (explicitly deferred):** theme toggle UI (F40); portal-dark inheritance wiring (F36 — but F34 satisfies its `.dark`-on-`documentElement` precondition); F50 cascade test (`useTheme` is named in PRD §8 but the cascade itself is F50); any `index.html` edit (F33 closed); any `index.css` edit (F32 closed); global `matchMedia` polyfill (per-test stubs only); real-browser FOUC E2E (F51 visual QA).

> **Owner sign-off (resolved 2026-06-26):** **D1 — Context vs Zustand → React Context.** Owner confirmed Context (rationale above). Diverges from the auth `useAuthStore` Zustand+persist precedent (deliberate — theme is one mounted provider with DOM side effects + the outside-provider-throw contract; auth is cross-store/cross-tab global). **Everything else is locked by PRD §3.2 / §1.6, decisions #2/#10, and the F33 contract** (re-using `THEME_STORAGE_KEY` + `resolveInitialTheme`, recorded 2026-06-26). No further sign-off blocking F34.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   ├─ src/
   │  ├─ components/
   │  │  └─ ThemeProvider.tsx       # NEW — createContext + ThemeProvider component + .dark sync effect
   │  │                              #       + system matchMedia subscription effect. Imports
   │  │                              #       THEME_STORAGE_KEY + resolveInitialTheme from @/utils/theme.
   │  ├─ hooks/
   │  │  ├─ useTheme.ts             # NEW — useContext(ThemeContext); throws if undefined (outside provider)
   │  │  └─ useTheme.test.tsx       # NEW — co-located: RTL render(provider+consumer); matchMedia stubbed per-test
   │  └─ main.tsx                   # MODIFIED — import ThemeProvider; wrap <RouterProvider>+<Toaster> inside <ThemeProvider>
   └─ (no other files changed)
# NO index.html changes (F33 closed). NO index.css changes (F32 closed). NO toggle (F40). NO DB migration.
```

**Lifecycle (the runtime F34 controls):**

1. F33's pre-paint `index.html` script has already added `.dark` to `document.documentElement` if needed (resolved dark) BEFORE React mounts.
2. `main.tsx` mounts React. `ThemeProvider` runs its lazy `useState` initializer: reads `localStorage['slykboard-theme']` + `matchMedia('(prefers-color-scheme: dark)').matches` (both try/caught), calls `resolveInitialTheme(stored, prefersDark)` → the SAME result as the F33 script → state seed equals current DOM → no flip.
3. The `.dark`-sync `useEffect` runs on mount (idempotent — class already matches) and whenever `theme`/`resolvedTheme` change: it adds/removes `.dark` on `document.documentElement` to match `resolvedTheme`.
4. The `system`-subscription `useEffect` runs when `theme === 'system'`: registers a `matchMedia(...)` `change` listener that re-resolves and toggles `.dark` on OS scheme change. Cleanup removes the listener; the effect re-runs when `theme` transitions to/from `system`.
5. `setTheme(pref)` persists to `localStorage` (try/caught) and updates state → the sync effects re-run → `.dark` follows.
6. Any descendant calls `useTheme()` → `{ theme, setTheme, resolvedTheme }`; outside `<ThemeProvider>` → throws.

---

## 5. Parallelization Strategy

F34 decomposes into **3 tasks**. T1 (`ThemeProvider.tsx` + `useTheme.ts` + `useTheme.test.tsx`) and T2 (`main.tsx` mount) touch **disjoint file sets** — so they are file-disjoint (zero merge conflict). **BUT** T2 imports T1's `ThemeProvider` export — T2 cannot compile/typecheck until T1 lands (or T2 is authored on a branch containing T1). The safe path is **solo sequential T1 → T2 → T3**.

### Batch dependency diagram

```
   Batch A (provider + hook + test)    Batch B (mount)          Batch C (integration)
   ─────────────────────────────       ────────────────         ────────────────────
        T1 ──────────────────────────────▶  T2 ──────────────────▶  T3
   (ThemeProvider.tsx + useTheme.ts          (main.tsx                (verify + sign-off:
    + useTheme.test.tsx)                      import + wrap)           exactly 4 files, gate green)
```

- **Batch A → Batch B** is a hard barrier (import dependency): T2's `import { ThemeProvider } from '@/components/ThemeProvider'` resolves only after T1 lands. T2 branches off `main` containing T1.
- **Batch B → Batch C** is a hard barrier: T3 verifies the merged diff (exactly 4 files) and re-runs the full gate against T1+T2 together.

### Merge order rules

1. **Batch A merges first.** T1 (`components/ThemeProvider.tsx` + `hooks/useTheme.ts` + `hooks/useTheme.test.tsx`) lands the provider, hook, and co-located test. Must be on `main` before T2 branches.
2. **Batch B merges second.** T2 (`main.tsx` — import + wrap) mounts the provider above `RouterProvider`. Rebases onto `main` containing T1.
3. **Batch C (integration verification) merges last.** T3 confirms the committed diff is exactly `ThemeProvider.tsx` + `useTheme.ts` + `useTheme.test.tsx` + `main.tsx`, re-runs the full gate, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/ThemeProvider.tsx` (New), `frontend/src/hooks/useTheme.ts` (New), `frontend/src/hooks/useTheme.test.tsx` (New) | — | T2 (file-disjoint; but T2 imports T1's export → sequential) |
| **T2** | B | `frontend/src/main.tsx` (M) | T1 (import `ThemeProvider`) | T1 (file-disjoint; sequential required) |
| **T3** | C | no files changed (verification gate); records proof in §7 | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3. (The only realistic track — T2's import dependency on T1 forces sequential.)
- **2 devs:** Not beneficial. T2 cannot start until T1's export exists. Assign one owner end-to-end.
- **3+ devs:** No beneficial split. F34 is a small feature (one provider, one hook, one test, one mount edit). Single owner.

---

## 6. Tasks

### T1 — Create `ThemeProvider.tsx` (Context + provider + side effects) + `useTheme.ts` (hook with throw) + co-located `useTheme.test.tsx`

**Batch:** A · **Depends on:** None · **Parallel with:** T2 (file-disjoint; sequential required — T2 imports T1's export)

**Description:** Author the React-side theme controller as the app's first custom Context. The provider owns `'light' | 'dark' | 'system'` state, persists it, syncs `.dark` on `document.documentElement`, and subscribes to OS scheme changes when the choice is `system`. The hook reads the context and throws if used outside a provider. Both reuse F33's locked seam (`THEME_STORAGE_KEY` + `resolveInitialTheme` + `ThemePreference` + `ResolvedTheme`) — F34 must NOT re-derive the key or resolution rule. The test stubs `matchMedia` per-test (jsdom v25 lacks it) and renders a consumer via RTL to assert behavior end-to-end.

Create `frontend/src/components/ThemeProvider.tsx`:

```typescript
// F34 — ThemeProvider + useTheme: React-side theme controller.
// Owns 'light' | 'dark' | 'system' state, persists it (key slykboard-theme),
// syncs .dark on document.documentElement, and follows OS scheme changes when 'system'.
//
// NO-FLASH AGREEMENT (load-bearing): the lazy useState seed calls
// resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia(...).matches)
// — the SAME key + SAME rule as F33's index.html pre-paint script — so React's first
// render equals the script's result and the .dark-sync effect toggles nothing on mount.
//
// Reuses F33's seam verbatim (do NOT re-derive the key or resolution rule):
//   THEME_STORAGE_KEY, resolveInitialTheme, ThemePreference, ResolvedTheme
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/utils/theme'

/** Value exposed by useTheme() and consumed by descendants (e.g. F40 toggle). */
interface ThemeContextValue {
  /** The user's choice ('light' | 'dark' | 'system'). */
  theme: ThemePreference
  /** Update the choice + persist it. */
  setTheme: (next: ThemePreference) => void
  /** The concrete theme after system resolution ('light' | 'dark') — use for icon-picking etc. */
  resolvedTheme: ResolvedTheme
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

/** Read prefersDark safely (D8: matchMedia may throw in some privacy modes). */
function readPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches
  } catch {
    return false
  }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Lazy seed — runs ONCE. Reads the SAME key + SAME rule as F33's pre-paint script
  // so the seed equals the current DOM .dark state → no flip on first render.
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null
      // resolveInitialTheme returns 'light' | 'dark'; but the USER CHOICE we surface
      // is the stored value (incl. 'system'). Stored invalid/null → default 'system'.
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored
      }
      return 'system'
    } catch {
      // D8: localStorage unavailable → default 'system' (in-memory only).
      return 'system'
    }
  })

  const prefersDark = readPrefersDark()

  // resolvedTheme: concrete light/dark after system resolution. F40 icon-picking consumes this.
  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? resolveInitialTheme(null, prefersDark) : theme

  // setTheme: persist (try/catch — D8) + update state.
  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // D8: persistence failed (private mode / disabled storage) → keep working in-memory.
    }
  }, [])

  // .dark-sync effect (D3: document.documentElement). Idempotent on first run (seed equals DOM).
  useEffect(() => {
    const root = document.documentElement
    if (resolvedTheme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [resolvedTheme])

  // system-subscription effect (D4): only when theme === 'system'. Follows OS scheme changes.
  useEffect(() => {
    if (theme !== 'system') return // explicit light/dark ignores OS changes

    let mql: MediaQueryList
    try {
      mql = window.matchMedia(DARK_MEDIA_QUERY)
    } catch {
      // D8: matchMedia unavailable → nothing to subscribe to; .dark-sync effect still holds.
      return
    }

    const onChange = () => {
      const root = document.documentElement
      // Re-resolve from the LIVE matchMedia state (not the captured prefersDark).
      const nextResolved = resolveInitialTheme(null, mql.matches)
      if (nextResolved === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }

    mql.addEventListener('change', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
    }
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
```

Create `frontend/src/hooks/useTheme.ts`:

```typescript
// F34 — useTheme hook. Reads ThemeContext; throws if used outside <ThemeProvider>.
import { useContext } from 'react'
import { ThemeContext } from '@/components/ThemeProvider'
import type { ThemeContextValue } from '@/components/ThemeProvider'

/**
 * Read the theme controller. MUST be called inside <ThemeProvider>.
 * Returns { theme, setTheme, resolvedTheme }.
 * Throws a clear Error if called outside a provider (no silent undefined) — D7.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a <ThemeProvider>.')
  }
  return ctx
}
```

> **Circular-import note:** `useTheme.ts` imports from `ThemeProvider.tsx`; `ThemeProvider.tsx` does NOT import `useTheme.ts` → no cycle. The `ThemeContext` + `ThemeContextValue` are exported from `ThemeProvider.tsx` (the natural home — they are defined there). If a cycle ever appears, lift `ThemeContext`/`ThemeContextValue` to `@/context/theme-context.ts`; not needed today.

Create the co-located `frontend/src/hooks/useTheme.test.tsx` (per `js-testing-rules.md`: RTL, `getByRole` priority, `vi.fn()` mocks, table-driven where applicable; `matchMedia` stubbed **per-test** — never globally):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { useTheme } from './useTheme'
import { THEME_STORAGE_KEY } from '@/utils/theme'

/** A consumer that renders the hook's values + a button to toggle theme. */
function TestConsumer({ target }: { target: 'light' | 'dark' | 'system' }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme(target)}>set-{target}</button>
    </div>
  )
}

/** Consumer rendered OUTSIDE the provider — to assert the throw. */
function BareConsumer() {
  useTheme()
  return <span>should-not-render</span>
}

/** Build a fake MediaQueryList. matches + a change listener we can fire. */
function makeMql(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    ),
    removeEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    ),
    dispatchEvent: vi.fn(),
    // Test-only helper: fire a change event to all registered listeners.
    __fire(newMatches: boolean) {
      const evt = { matches: newMatches } as MediaQueryListEvent
      for (const cb of listeners) cb(evt)
    },
  }
}

/** Install a fresh matchMedia stub returning a controlled mql. Returns the mql + a restore fn. */
function stubMatchMedia(initialMatches: boolean) {
  const mql = makeMql(initialMatches)
  const stub = vi.fn((_q: string) => mql)
  vi.stubGlobal('matchMedia', stub)
  return {
    mql,
    restore: () => vi.unstubAllGlobals(),
  }
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeProvider — .dark sync + persistence', () => {
  const cases: Array<{
    name: string
    stored: string | null
    osDark: boolean
    expectedResolved: 'light' | 'dark'
    expectedDarkClass: boolean
  }> = [
    { name: "stored 'dark' → .dark present", stored: 'dark', osDark: false, expectedResolved: 'dark', expectedDarkClass: true },
    { name: "stored 'light' → .dark absent", stored: 'light', osDark: true, expectedResolved: 'light', expectedDarkClass: false },
    { name: "stored 'system' + OS dark → .dark present", stored: 'system', osDark: true, expectedResolved: 'dark', expectedDarkClass: true },
    { name: "stored 'system' + OS light → .dark absent", stored: 'system', osDark: false, expectedResolved: 'light', expectedDarkClass: false },
    { name: 'null (unset) + OS dark → .dark present (default system)', stored: null, osDark: true, expectedResolved: 'dark', expectedDarkClass: true },
    { name: 'null (unset) + OS light → .dark absent (default system)', stored: null, osDark: false, expectedResolved: 'light', expectedDarkClass: false },
  ]

  for (const c of cases) {
    it(c.name, () => {
      if (c.stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, c.stored)
      stubMatchMedia(c.osDark)

      render(
        <ThemeProvider>
          <TestConsumer target="dark" />
        </ThemeProvider>,
      )

      expect(screen.getByTestId('resolved').textContent).toBe(c.expectedResolved)
      expect(document.documentElement.classList.contains('dark')).toBe(c.expectedDarkClass)
    })
  }

  it('setTheme("dark") persists to localStorage and adds .dark', () => {
    stubMatchMedia(false) // OS light
    render(
      <ThemeProvider>
        <TestConsumer target="dark" />
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByText('set-dark'))

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setTheme("light") persists to localStorage and removes .dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    stubMatchMedia(true)

    render(
      <ThemeProvider>
        <TestConsumer target="light" />
      </ThemeProvider>,
    )

    // initial: dark
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    fireEvent.click(screen.getByText('set-light'))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('ThemeProvider — system follows matchMedia change', () => {
  it('OS dark → light while theme=system: .dark removed', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    const { mql } = stubMatchMedia(true)

    render(
      <ThemeProvider>
        <TestConsumer target="dark" />
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      mql.__fire(false) // OS flips to light
    })

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(screen.getByTestId('resolved').textContent).toBe('light')
  })

  it('OS light → dark while theme=system: .dark added', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    const { mql } = stubMatchMedia(false)

    render(
      <ThemeProvider>
        <TestConsumer target="dark" />
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      mql.__fire(true) // OS flips to dark
    })

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })

  it('theme=light ignores OS change (no subscription effect)', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    const { mql } = stubMatchMedia(true)

    render(
      <ThemeProvider>
        <TestConsumer target="light" />
      </ThemeProvider>,
    )

    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      mql.__fire(false)
    })

    // unchanged — explicit light ignores OS
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('cleans up the matchMedia listener on unmount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    const { mql } = stubMatchMedia(true)

    const { unmount } = render(
      <ThemeProvider>
        <TestConsumer target="dark" />
      </ThemeProvider>,
    )

    expect(mql.addEventListener).toHaveBeenCalledTimes(1)
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1)
  })
})

describe('ThemeProvider — no-flash agreement', () => {
  it('pre-seeded localStorage=dark → .dark present WITHOUT a flip (seed equals DOM)', () => {
    // Simulate F33's pre-paint script: it already added .dark to <html>.
    document.documentElement.classList.add('dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    stubMatchMedia(false)

    render(
      <ThemeProvider>
        <TestConsumer target="dark" />
      </ThemeProvider>,
    )

    // No toggle: .dark stays present; resolvedTheme matches.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
  })
})

describe('ThemeProvider — D8 fallback (localStorage unavailable)', () => {
  it('provider still renders when localStorage throws (in-memory only)', () => {
    // Force localStorage.getItem to throw (private-mode simulation).
    const getter = vi.fn(() => {
      throw new Error('Storage disabled')
    })
    const setter = vi.fn(() => {
      throw new Error('Storage disabled')
    })
    vi.spyOn(Storage.prototype, 'getItem', 'get').mockImplementation(getter)
    vi.spyOn(Storage.prototype, 'setItem', 'set').mockImplementation(setter)
    stubMatchMedia(false)

    expect(() =>
      render(
        <ThemeProvider>
          <TestConsumer target="dark" />
        </ThemeProvider>,
      ),
    ).not.toThrow()

    // Defaults to 'system' (no stored value readable).
    expect(screen.getByTestId('theme').textContent).toBe('system')

    // setTheme does not throw despite write failure.
    expect(() => fireEvent.click(screen.getByText('set-dark'))).not.toThrow()
    expect(screen.getByTestId('theme').textContent).toBe('dark')
  })
})

describe('useTheme — outside provider throws (D7)', () => {
  it('throws a clear error when rendered outside <ThemeProvider>', () => {
    // Suppress the expected console.error noise from React's error boundary logging.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<BareConsumer />)).toThrow(
      /useTheme must be used within a <ThemeProvider>/,
    )

    spy.mockRestore()
  })
})
```

**Why `getByTestId` here (not `getByRole`):** the consumer renders raw state as `<span>` text for assertion. `js-testing-rules.md`'s role-priority applies to user-facing component tests; here the consumer is a test harness whose only role is to surface hook state. `getByText` is used for the toggle button. This is consistent with how `useBoard.test.tsx`/`useToast.test.tsx` surface hook values.

**Acceptance Criteria:**
- [ ] `frontend/src/components/ThemeProvider.tsx` created with `ThemeContext`, `ThemeProvider` (exported), `ThemeProviderProps`; imports `THEME_STORAGE_KEY` + `resolveInitialTheme` + types from `@/utils/theme` (no re-derivation).
- [ ] `frontend/src/hooks/useTheme.ts` created with named export `useTheme()` that throws `Error('useTheme must be used within a <ThemeProvider>.')` outside a provider.
- [ ] `frontend/src/hooks/useTheme.test.tsx` created (co-located in `hooks/`); `matchMedia` stubbed per-test (NOT in global test-setup).
- [ ] Provider lazy-seeds state via `resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia(...).matches)` (same key + rule as F33 script).
- [ ] `.dark`-sync effect targets `document.documentElement` (D3) and is idempotent on first run (no-flash agreement — covered by the pre-seed test).
- [ ] `system`-subscription effect adds `addEventListener('change', …)` only when `theme === 'system'`; removes on cleanup; explicit `light`/`dark` do not subscribe (covered).
- [ ] `setTheme` persists to `localStorage.setItem(THEME_STORAGE_KEY, next)` and updates state (covered).
- [ ] D8: read + write + matchMedia all try/caught; provider never throws on localStorage/matchMedia failure; keeps working in-memory (covered).
- [ ] `useTheme()` outside provider throws the clear error (covered).
- [ ] Table-driven `.dark`-sync coverage: stored `'dark'`/`'light'`/`'system'`/`null` × OS dark/light (6 cases).
- [ ] No `console.log` in the provider/hook (style guide).
- [ ] No `any` (style guide); explicit `ThemeProviderProps`/`ThemeContextValue` interfaces.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run test -w frontend -- useTheme.test.tsx` exits 0.

**Dependencies:** None (F33's `@/utils/theme` seam is already on `main`).

---

### T2 — Mount `<ThemeProvider>` in `main.tsx` above `RouterProvider`

**Batch:** B · **Depends on:** T1 (import `ThemeProvider`) · **Parallel with:** T1 (file-disjoint; sequential required)

**Description:** Wire the provider into the app's mount tree per PRD §3.2 ("mount `<ThemeProvider>` in `main.tsx` above `RouterProvider`") and D8 (mount location). Insert it inside `QueryClientProvider`, wrapping `RouterProvider` and keeping `Toaster` inside the new provider (so toasts inherit theme). Do NOT touch `import './index.css'` (L11 — F32-owned, closed).

Modify `frontend/src/main.tsx`:

**Before (current mount tree, L18-29):**
```tsx
createRoot(rootElement).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={env.googleClientId}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster />
        </QueryClientProvider>
      </ErrorBoundary>
    </GoogleOAuthProvider>
  </StrictMode>,
)
```

**After:**
```tsx
import { ThemeProvider } from '@/components/ThemeProvider'
// ... (existing imports unchanged; the new import follows import-order convention:
//      external libs → internal @/ imports → types → relative. Place with the other @/ imports.)

// ... inside render():
createRoot(rootElement).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={env.googleClientId}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <RouterProvider router={router} />
            <Toaster />
          </ThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GoogleOAuthProvider>
  </StrictMode>,
)
```

**Key edits:**
1. Add `import { ThemeProvider } from '@/components/ThemeProvider'` (placed with the other `@/` imports, per `js-style-guide.md` import order).
2. Wrap `<RouterProvider router={router} />` AND `<Toaster />` in `<ThemeProvider>…</ThemeProvider>` — both now children of the new provider, inside `QueryClientProvider`.
3. Do NOT change the order of `StrictMode` → `GoogleOAuthProvider` → `ErrorBoundary` → `QueryClientProvider`.
4. Do NOT touch `import './index.css'` (L11 — F32-owned, closed).
5. No other lines change.

**Why `<ThemeProvider>` is inside `<QueryClientProvider>`:** the existing outer nesting is established and correct; theme is a UI concern local to the rendered tree, not a server-state concern. Keeping it inside `QueryClientProvider` (and inside `ErrorBoundary`) preserves the boundary semantics. `Toaster` stays inside the new provider so toasts inherit `.dark`.

**Acceptance Criteria:**
- [ ] `import { ThemeProvider } from '@/components/ThemeProvider'` added (with the other `@/` imports).
- [ ] `<RouterProvider router={router} />` and `<Toaster />` are both children of `<ThemeProvider>`, inside `<QueryClientProvider>`.
- [ ] Outer nesting unchanged: `StrictMode` → `GoogleOAuthProvider` → `ErrorBoundary` → `QueryClientProvider` → `<ThemeProvider>` → (`RouterProvider` + `Toaster`).
- [ ] `import './index.css'` (L11) untouched.
- [ ] No other files changed in this task.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (full regression — no test should break from adding the provider to the tree).

**Dependencies:** T1 (the `ThemeProvider` export must exist for the import to resolve).

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the four F34 files (no `index.html`/`index.css`/toggle leakage), re-run the full gate green, confirm the provider wraps `RouterProvider`, confirm `.dark` targets `documentElement`, and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** four files:
   ```bash
   git diff --name-only main...HEAD
   # Expected:
   # frontend/src/components/ThemeProvider.tsx
   # frontend/src/hooks/useTheme.ts
   # frontend/src/hooks/useTheme.test.tsx
   # frontend/src/main.tsx
   ```
   Any other path (an `index.html` edit, an `index.css` edit, a `ThemeToggle.tsx`, a config file, a `stores/` file) → leaked; remove and re-commit before sign-off. F34 owns no CSS, no HTML, no toggle UI, no Zustand store (F33/F32/F40 scopes preserved).
2. Re-run the full gate on the merged state:
   ```bash
   npm install                            # clean install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. useTheme.test.tsx + full suite regression)
   ```
3. Confirm `frontend/index.html` is **unchanged** vs main (F33 closed — F34 touches zero HTML):
   ```bash
   git diff --quiet main...HEAD -- frontend/index.html && echo "index.html: UNCHANGED (F33 preserved)" \
     || echo "index.html: CHANGED (out of scope — revert)"
   ```
   Must print UNCHANGED.
4. Confirm `frontend/src/index.css` is **unchanged** vs main (F32 closed — F34 touches zero CSS):
   ```bash
   git diff --quiet main...HEAD -- frontend/src/index.css && echo "index.css: UNCHANGED (F32 preserved)" \
     || echo "index.css: CHANGED (out of scope — revert)"
   ```
   Must print UNCHANGED.
5. Confirm no toggle UI / Zustand theme store artifacts (F40 / out-of-scope):
   ```bash
   git diff --name-only main...HEAD | grep -Ei '(ThemeToggle|useThemeStore)' \
     && echo "LEAKED F40 / out-of-scope store" || echo "no toggle/store leakage"
   ```
   Must print the clean message.
6. **Mount-tree check** — confirm `main.tsx` wraps `RouterProvider` in `ThemeProvider` and keeps `Toaster` inside:
   ```bash
   grep -q "import { ThemeProvider } from '@/components/ThemeProvider'" frontend/src/main.tsx \
     && echo "ThemeProvider import: PRESENT" || echo "ThemeProvider import: MISSING"

   # Provider wraps RouterProvider (ThemeProvider opens before RouterProvider).
   awk '/<ThemeProvider>/{tp=NR} /<RouterProvider/{rp=NR} END{print (tp && rp && tp<rp) ? "wrap order: OK (ThemeProvider before RouterProvider)" : "wrap order: CHECK"}' frontend/src/main.tsx
   ```
   Must print PRESENT and OK.
7. **`.dark`-target check** — confirm the provider toggles `document.documentElement` (D3 — F36 depends on it):
   ```bash
   grep -q "document.documentElement" frontend/src/components/ThemeProvider.tsx \
     && echo "documentElement target: PRESENT" || echo "documentElement target: MISSING"
   ```
   Must print PRESENT.
8. **No-flash agreement check** — confirm the provider seeds from F33's seam (not re-derived):
   ```bash
   grep -q "resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY)" frontend/src/components/ThemeProvider.tsx \
     && echo "no-flash seed: PRESENT (reuses F33 seam)" || echo "no-flash seed: CHECK"
   grep -q "THEME_STORAGE_KEY = " frontend/src/components/ThemeProvider.tsx && echo "RE-DERIVED KEY (BUG)" \
     || echo "no key re-derivation (correct)"
   ```
   Must print PRESENT and "no key re-derivation (correct)".
9. Capture commit SHA, exit codes, and the source-presence results into §7. Confirm owner sign-off on D1 (Context vs Zustand).

**Acceptance Criteria:**
- [ ] Committed diff is exactly `frontend/src/components/ThemeProvider.tsx` + `frontend/src/hooks/useTheme.ts` + `frontend/src/hooks/useTheme.test.tsx` + `frontend/src/main.tsx` (no HTML, no CSS, no toggle, no store).
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `useTheme.test.tsx` + full regression).
- [ ] `frontend/index.html` unchanged vs main (F33 preserved).
- [ ] `frontend/src/index.css` unchanged vs main (F32 preserved).
- [ ] No `ThemeToggle`/`useThemeStore` artifacts (F40 / out-of-scope preserved).
- [ ] `main.tsx` imports `ThemeProvider` and wraps `RouterProvider` (+ `Toaster`) inside it.
- [ ] Provider targets `document.documentElement` for `.dark` (D3 — F36 precondition).
- [ ] Provider seeds via `resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), …)` (no-flash agreement — no key re-derivation).
- [ ] All F34 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] Owner sign-off on D1 (Context vs Zustand) recorded.

**Dependencies:** T1, T2.

---

## 7. Final F34 Acceptance Checklist

- [ ] `frontend/src/components/ThemeProvider.tsx` created (Context + provider + `.dark`-sync effect + `system`-subscription effect).
- [ ] `frontend/src/hooks/useTheme.ts` created; `useTheme()` returns `{ theme, setTheme, resolvedTheme }` and throws outside a provider.
- [ ] Provider mounted in `main.tsx` **above** `RouterProvider` (inside `QueryClientProvider`); `Toaster` kept inside.
- [ ] State persisted to `localStorage` key `slykboard-theme` (F33's `THEME_STORAGE_KEY`) on `setTheme`.
- [ ] `.dark` added/removed on `document.documentElement` to match `resolvedTheme` (D3 — F36 precondition).
- [ ] Subscribes to `window.matchMedia('(prefers-color-scheme: dark)')` `change` events when `theme === 'system'`; unsubscribes on cleanup + when switching away from `system` (D4).
- [ ] `useTheme()` outside provider throws a clear error (D7).
- [ ] No-flash agreement: lazy seed = `resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia(...).matches)` → React first render equals F33 script result → no re-flash.
- [ ] D8: read + write + matchMedia try/caught; falls back to `'system'`/light; never throws; keeps working in-memory.
- [ ] `resolvedTheme` exposed distinct from `theme` (D6 — F40 icon-picking consumes it).
- [ ] Reuses F33's seam (`THEME_STORAGE_KEY` + `resolveInitialTheme` + `ThemePreference` + `ResolvedTheme`) verbatim — no key re-derivation, no rule re-derivation.
- [ ] `frontend/src/hooks/useTheme.test.tsx` (co-located) — matchMedia stubbed per-test; covers `.dark` sync (table-driven), persistence, system reactivity, no-flash agreement, D8 fallback, outside-provider throw.
- [ ] `frontend/index.html` unchanged (F33 preserved).
- [ ] `frontend/src/index.css` unchanged (F32 preserved).
- [ ] No `ThemeToggle`/`useThemeStore` artifacts (F40 / out-of-scope preserved).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. new `useTheme.test.tsx` + full regression).
- [ ] Committed diff is exactly `ThemeProvider.tsx` + `useTheme.ts` + `useTheme.test.tsx` + `main.tsx`.

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- Diff = exactly 4 files (no HTML/CSS/toggle/store leakage): `PASS/FAIL`
- `main.tsx` import `ThemeProvider`: `PRESENT/MISSING`
- `main.tsx` wrap order (`ThemeProvider` before `RouterProvider`, `Toaster` inside): `OK/CHECK`
- Provider `.dark` target = `document.documentElement`: `PRESENT/MISSING`
- No-flash seed (`resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), …)`, no key re-derivation): `PRESENT/CHECK`
- `useTheme.test.tsx` result: `__/__ pass` (incl. table-driven `.dark`-sync, persistence, system reactivity, no-flash agreement, D8 fallback, outside-provider throw)
- `index.html` vs main: `UNCHANGED (F33 preserved)`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- No toggle/store leakage: `PASS`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- D1 owner sign-off (Context vs Zustand): `Context chosen — owner sign-off recorded (date: ________)`
- F34 contract re-use confirmed: `THEME_STORAGE_KEY + resolveInitialTheme re-used verbatim from F33 (stable)`

---

## 8. Schema deltas owned by this feature

F34 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance) and **no CSS token additions** (F32 owns and has closed those). F34 touches only four frontend files: `ThemeProvider.tsx` (new), `useTheme.ts` (new), `useTheme.test.tsx` (new), and `main.tsx` (modified — one import + one wrap).

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| Theme controller (Context + provider) | `createContext` + `ThemeProvider` with `.dark`-sync + `system`-subscription effects; reuses F33's `THEME_STORAGE_KEY` + `resolveInitialTheme` | new `frontend/src/components/ThemeProvider.tsx` |
| Theme hook | `useTheme()` → `{ theme, setTheme, resolvedTheme }`; throws outside provider | new `frontend/src/hooks/useTheme.ts` |
| Co-located test | RTL render(provider+consumer); matchMedia stubbed per-test; covers `.dark` sync, persistence, system reactivity, no-flash agreement, D8, outside-provider throw | new `frontend/src/hooks/useTheme.test.tsx` |
| Mount wiring | `main.tsx` imports `ThemeProvider` and wraps `RouterProvider` + `Toaster` inside it (inside `QueryClientProvider`) | modified `frontend/src/main.tsx` |
