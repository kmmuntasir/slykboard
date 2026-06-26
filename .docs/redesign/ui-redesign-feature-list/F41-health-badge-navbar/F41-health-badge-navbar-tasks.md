# F41 — Fold HealthBadge into navbar (Activity icon + dot, delete standalone bar): Plan + Task Breakdown

> **Feature:** F41 — Fold HealthBadge into navbar (Activity icon + dot, delete standalone bar) (Phase 1 — Chrome · Enhancement)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F37 (done) + F36 (done) · **PRD ref:** §4.2 (health folds in), §2.1 (standalone bar at AppLayout.tsx:11), §3.3 (Activity icon)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency features: [F37](../F37-navbar-fullwidth-brand-clusters/F37-navbar-fullwidth-brand-clusters-tasks.md) (navbar right-cluster — done); [F36](../F36-dropdown-tooltip-primitives/F36-dropdown-tooltip-primitives-tasks.md) (Tooltip primitive — done); [F32](../F32-design-tokens-css/F32-design-tokens-css-tasks.md) (`--success`/`--danger` tokens — done).

---

## 1. F41 Recap

**Goal:** Remove the standalone full-width "Healthy" bar and surface health as a compact navbar indicator — an `Activity` icon + colored status dot with an explanatory tooltip, replacing the dedicated `<HealthBadge />` row.

**Ships:** The navbar right cluster shows an `Activity` lucide icon with a colored status dot (green = healthy / red = unhealthy / muted = checking) and an F36 Tooltip explaining the status ("Healthy"/"Unhealthy — {detail}"/"Checking…"). The standalone `<HealthBadge />` row at `AppLayout.tsx:11` and its import at `:3` are deleted. The inline `useQuery(['health'])` logic is extracted into a reusable `useHealth()` hook with a proper `isLoading` branch, fixing the current false-red-while-loading bug.

**Acceptance (definition of done):**
1. `AppLayout.tsx:11` standalone `<HealthBadge />` row removed (and its import at `:3`).
2. Navbar shows `Activity` icon + status dot; tooltip reads "Healthy"/"Unhealthy" with detail (or "Checking…" while in-flight).
3. Status tint uses `--success`/`--danger` tokens (added in F32) — `bg-success` (healthy) / `bg-danger` (unhealthy) / `bg-muted-foreground` (loading/neutral).
4. No layout shift when health flips between states — the indicator occupies a fixed-size slot.
5. Health state has three branches: `isLoading` → neutral muted dot + "Checking…"; `ok === true` → `bg-success` + "Healthy"; `ok === false || isError` → `bg-danger` + "Unhealthy". No false green while in-flight.
6. Tooltip reuses the F36 `Tooltip`/`TooltipTrigger`/`TooltipContent` primitive — NOT a hand-rolled `title` attribute (a11y).
7. `TooltipProvider` mounted app-wide in `main.tsx` (fixes F37 debt; unblocks F42).
8. Tests: `useHealth` hook tests (3 states); `TopNav.test.tsx` health-indicator assertions (dot tint + tooltip text per state); `App.test.tsx` wraps in `TooltipProvider` alongside `ThemeProvider`.

**Edge cases resolved up front:**
- **Tooltip primitive vs `title` attribute** → **Decision: reuse the F36 Tooltip primitive.** Mount `TooltipProvider` in `main.tsx` (inside `ThemeProvider`, wrapping `RouterProvider` — the F36 canonical mount point). F37 was supposed to mount it but skipped it; F41 fixes the debt and incidentally unblocks F42 (nav scoping tooltips will need it too). Add the provider wrap to `TopNav.test.tsx` and `App.test.tsx` harnesses. Never a hand-rolled `title` (a11y — F36 Tooltip is keyboard-focusable, has correct `role="tooltip"`, Portal positioning, and 300ms delay). (D3.)
- **Slow/in-flight health check** → **Decision: three explicit states, not a boolean.** `isLoading` → neutral `bg-muted-foreground` dot + "Checking…" tooltip; `ok === true` → `bg-success` + "Healthy"; `ok === false || isError` → `bg-danger` + "Unhealthy". The current `HealthBadge` computes `ok = data?.status === 'ok' && !isError` with NO `isLoading` branch — during the initial fetch `data` is `undefined`, `isError` is `false`, so `ok` is `false` and it renders RED (the exact bug F41's edge case calls out). The extracted `useHealth` hook exposes `{ ok, isLoading, isError, detail }` so the indicator renders the neutral state during the first 30s-stale fetch. (D1.)

---

## 2. Codebase Analysis Summary

- **State:** Partial. `HealthBadge.tsx` (35 lines) exists with the standalone full-width bar; F41 extracts its query logic into `useHealth`, deletes the component, and re-homes the indicator inline in `TopNav`. `AppLayout.tsx:11` mounts the standalone bar. F36 Tooltip primitive exists and is exported but **`TooltipProvider` is NOT mounted app-wide** (F37 debt). F32 `--success`/`--danger` tokens resolve. F37 navbar right-cluster exists with the insertion point between `<ThemeToggle />` (F40) and the avatar block.

- **HealthBadge.tsx (35 lines) — the extraction source** (`frontend/src/components/HealthBadge.tsx`):
  - `:24-32` — full-width bar: `<div className="flex items-center justify-center gap-2 bg-muted px-4 py-1 text-xs">`.
  - Dot: `<span className={ok ? 'bg-green-500' : 'bg-red-500'} />` — **RAW Tailwind colors (`bg-green-500`/`bg-red-500`), NOT tokens.** F41 migrates to `bg-success`/`bg-danger` (acceptance).
  - Inline `useQuery` (`:10-21`): queryKey `['health']`, `fetch GET /health`, `staleTime: 30_000`. **No `refetchInterval` — no polling** (F41 keeps this; health is informational, stale-30s is fine; the spec doesn't require live polling).
  - `ok = data?.status === 'ok' && !isError` (`:23`) — **NO `isLoading` branch** → in-flight renders RED (the bug). F41 fixes via the 3-state `useHealth` hook.
  - Return shape: `{ status: string, service: string }`. `service` becomes the tooltip detail.

- **AppLayout.tsx** — `<HealthBadge />` at `:11` (between `TopNav` and `<main>`). Import at `:3`. **F41 deletes both.** This is the PRD §2.1 "standalone bar wastes a row" reference.

- **TopNav.tsx right cluster** (`:284-299`): `[<ThemeToggle /> (F40)] → [{avatarBlock} (F39)] → [hamburger]`. **F41 inserts the health indicator between `<ThemeToggle />` and the avatar block** (far-left of the right-cluster per PRD §4.2).

- **F36 Tooltip primitive** (`components/ui/Tooltip.tsx`) — exports: `Tooltip`, `TooltipTrigger` (supports `asChild`), `TooltipContent` (Portal, `bg-primary`), `TooltipProvider` (`delayDuration=300`). **`TooltipProvider` is NOT mounted app-wide** — F37 was supposed to but didn't. F41 mounts it in `main.tsx`. This is the ONLY permitted `main.tsx` edit.

- **F32 tokens** (`frontend/src/index.css`): `bg-success` (`:124`), `bg-danger` (`:130`) resolve. Neutral/loading: `bg-muted-foreground` (`:112`). All used by the 3-state dot.

- **lucide `Activity`** — importable from `lucide-react` (F31; `TopNav.tsx:3` already imports from lucide). Add `Activity` to the existing import statement.

- **HealthBadge.test.tsx (35 lines, 2 tests)** — asserts `findByText('Healthy')` / `findByText('Unhealthy')`. **F41 deletes this file** (the component is deleted; the assertions relocate to `TopNav.test.tsx` as health-indicator tests).

- **Build gate:** `dev` / `build` / `typecheck` / `test`.

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; explicit prop interfaces; functional + hooks; React Query for server state (health check is server state — `useHealth` wraps `useQuery`); custom hooks in `hooks/`. Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files; camelCase hooks with `use` prefix (`useHealth.ts`); **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; no inline styles (Tailwind only); SCREAMING_SNAKE_CASE constants; avoid prop drilling (health via `useHealth` hook — correct).
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`/`*.test.ts`; RTL `getByRole`/`getByLabelText` priority (`tooltip`, `button`); `vi.fn()` mocks; table-driven preferred; **business logic >80% (`useHealth`)**; **components >70% (`TopNav` health indicator)**.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F40:` → F41 uses `SLYK-F41:` prefix; branch `feature/SLYK-redesign-f41-health-badge-navbar`.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations. Reply concise.

- **File paths the plan references that do NOT exist yet:**
  - `frontend/src/hooks/useHealth.ts` (new — T1).
  - `frontend/src/hooks/useHealth.test.ts` (new — T3).
  - (Modified, exist:) `frontend/src/components/TopNav.tsx`, `frontend/src/components/TopNav.test.tsx`, `frontend/src/components/AppLayout.tsx`, `frontend/src/main.tsx`, `frontend/src/App.test.tsx` (or wherever the app-level test harness lives — confirm in T3).
  - (Deleted, exist:) `frontend/src/components/HealthBadge.tsx`, `frontend/src/components/HealthBadge.test.tsx`.

- **Hidden coupling to plan for:**
  - **`TooltipProvider` not mounted app-wide (F37 debt, load-bearing)** — F41 MUST mount `<TooltipProvider>` in `main.tsx` (inside `<ThemeProvider>`, wrapping `<RouterProvider>`). Without it, the F41 tooltip (and any future F36 consumer) silently fails to render. This is the ONLY permitted `main.tsx` edit. T2 owns it.
  - **Test-harness provider wraps (load-bearing)** — `TopNav.test.tsx` `renderTopNav()` must wrap in `<TooltipProvider>` (alongside the existing `<ThemeProvider>` from F40) once `TopNav` renders the F36 Tooltip. `App.test.tsx` must wrap in `<TooltipProvider>` too. Every TopNav/App test otherwise fails to surface the tooltip content. T3 owns both.
  - **Token migration** — `bg-green-500`/`bg-red-500` → `bg-success`/`bg-danger` (F32 tokens). Acceptance bullet. The `useHealth`-driven indicator never references raw Tailwind colors.
  - **Fixed-size indicator (no layout shift)** — the indicator must occupy a constant-width slot regardless of state. The dot is a fixed `h-2 w-2` span; the trigger button is a fixed `h-9 w-9`. Tooltip content is Portal-rendered (out of flow) so its text-length variance doesn't shift the navbar.
  - **`useHealth` is a pure hook** — it owns the `useQuery(['health'])` call; `TopNav` only reads `{ ok, isLoading, isError, detail }`. No inline `useQuery` in `TopNav`. Single source of truth.
  - **Stale-30s, no polling** — the current `HealthBadge` has `staleTime: 30_000` and no `refetchInterval`. F41 preserves this (health is informational; the spec doesn't mandate live polling). `useHealth` keeps the same query config.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Extract `useHealth` hook | **`frontend/src/hooks/useHealth.ts`** — extracted from `HealthBadge`'s inline `useQuery`. Returns `{ ok: boolean | undefined, isLoading: boolean, isError: boolean, detail: string }`. `ok` is `undefined` during loading (the 3-state discriminator). Query config preserved: queryKey `['health']`, `GET /health`, `staleTime: 30_000`, no `refetchInterval`. | Enables the 3-state rendering (loading/healthy/unhealthy) that fixes the current false-red-while-loading bug. Separating server-state logic from presentation (js-development-rules: React Query for server state; custom hooks in `hooks/`). The hook is independently testable (mock `useQuery`/fetch). (Analyst; F41 edge case "slow/in-flight → neutral".) |
| D2 | Indicator structure | **Inline in `TopNav`** — `<TooltipProvider><Tooltip><TooltipTrigger asChild><button aria-label="Health"><Activity /><span dot/></button></TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip></TooltipProvider>`. Dot color 3-state: `bg-success` (healthy) / `bg-danger` (unhealthy) / `bg-muted-foreground` (loading). Fixed-size trigger (`h-9 w-9`) + dot (`h-2 w-2`) → no layout shift. Tooltip text: "Healthy" / "Unhealthy — {service}" / "Checking…". Token-only. | PRD §4.2 "Activity icon + colored dot at the far left of the right-cluster". The indicator is navbar-specific (no other mount site), so a separate component file would be over-extraction — inline in `TopNav` with `useHealth` providing the logic. F36 Tooltip primitive reused (never a `title` attr — a11y). Fixed sizes guarantee no layout shift on state flip (acceptance). (PRD §4.2, §3.3; F36 contract.) |
| D3 | TooltipProvider mount | **Mount `<TooltipProvider>` in `main.tsx`** — inside `<ThemeProvider>`, wrapping `<RouterProvider>` (the F36 canonical mount point). F37 skipped this; F41 fixes the debt and unblocks F42 (nav scoping tooltips). | The F41 tooltip needs an ancestor `<TooltipProvider>`. F37 was supposed to mount it app-wide but didn't — without it, the tooltip silently fails. Mounting once at the root is the F36-documented pattern and benefits all future Tooltip consumers (F42+). This is the ONLY permitted `main.tsx` edit. (Analyst F37-debt finding; F36 canonical mount point.) |
| D4 | Delete HealthBadge | **Delete `HealthBadge.tsx` + `HealthBadge.test.tsx`** (`rm` both). The standalone bar is removed (PRD §2.1); the query logic moves to `useHealth` (D1); the indicator moves inline to `TopNav` (D2). | The component has no other consumer and the standalone bar is explicitly deleted (acceptance bullet 1). Keeping a dead component would be dead code. The query logic is fully preserved in `useHealth`; nothing is lost. (PRD §2.1; acceptance bullet 1.) |
| D5 | Scope | **8 files:** `AppLayout.tsx` (delete row + import) + `TopNav.tsx` (add indicator + imports) + `main.tsx` (mount `TooltipProvider`) + `hooks/useHealth.ts` (new) + delete `HealthBadge.tsx` + delete `HealthBadge.test.tsx` + `TopNav.test.tsx` (health tests + `TooltipProvider` wrap) + `App.test.tsx` (`TooltipProvider` wrap alongside `ThemeProvider`). | F41 owns ONLY the health-indicator fold-in. No F36 Tooltip primitive changes (frozen), no F37 navbar layout changes (only an insertion between F40 toggle and F39 avatar), no F32 token changes (closed), no F34 ThemeProvider changes, no schema, no new deps (lucide `Activity` via F31; Tooltip parts via F36). (Analyst scope finding.) |

> **Out of F41 scope (explicitly deferred):** Tooltip/Dropdown primitives — **F36 (done, frozen)**. Navbar layout / right-cluster structure — **F37 (done)** (F41 only inserts an indicator between F40 toggle and F39 avatar; doesn't restructure). Theme toggle — **F40 (done)**. Avatar/profile Dropdown — **F39 (done)**. CSS tokens — **F32 (closed)**. `index.html` no-flash — **F33 (closed)**. `useTheme`/ThemeProvider — **F34 (done)**. Nav scoping tooltips — **F42** (but F41's `TooltipProvider` mount unblocks it). New deps — none (lucide `Activity` via F31; `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` via F36).

> **Owner sign-off (resolved 2026-06-27 — all defaults confirmed):**
> - **D3 → mount `TooltipProvider` in `main.tsx`** (fixes F37 debt + unblocks F42; canonical F36 mount point). Alternative "local `TooltipProvider` per TopNav" rejected — would not unblock F42 and would duplicate the provider.
> - **D4 → delete `HealthBadge.tsx` + `HealthBadge.test.tsx`** (standalone bar deleted per acceptance; query logic fully preserved in `useHealth`). Alternative "keep as deprecated re-export" rejected — dead code.
> No further sign-off blocking F41.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      ├─ hooks/
      │  ├─ useHealth.ts          # NEW — extracted from HealthBadge's inline useQuery.
      │  │                        #   useQuery(['health']) GET /health, staleTime 30s.
      │  │                        #   Returns { ok, isLoading, isError, detail }.
      │  │                        #   ok===undefined while loading (3-state discriminator).
      │  └─ useHealth.test.ts     # NEW — co-located: 3 states (loading/ok/error),
      │                           #   query config, no refetchInterval (no polling).
      ├─ components/
      │  ├─ TopNav.tsx            # MODIFIED — import Activity + Tooltip parts + useHealth.
      │  │                        #   Insert health indicator in right cluster between
      │  │                        #   <ThemeToggle /> (F40) and {avatarBlock} (F39):
      │  │                        #   <TooltipProvider><Tooltip><TooltipTrigger asChild>
      │  │                        #   <button aria-label="Health"><Activity /><span dot/>
      │  │                        #   </button></TooltipTrigger><TooltipContent>...
      │  │                        #   Dot: bg-success/bg-danger/bg-muted-foreground.
      │  │                        #   Fixed sizes (no layout shift).
      │  ├─ TopNav.test.tsx       # MODIFIED — wrap renderTopNav() in <TooltipProvider>
      │  │                        #   (alongside F40's <ThemeProvider>); add health-indicator
      │  │                        #   tests (3 states: dot tint + tooltip text).
      │  ├─ AppLayout.tsx         # MODIFIED — delete <HealthBadge /> at :11 + import at :3.
      │  ├─ HealthBadge.tsx       # DELETED — standalone bar removed (query → useHealth).
      │  └─ HealthBadge.test.tsx  # DELETED — assertions relocate to TopNav.test.tsx.
      ├─ App.test.tsx             # MODIFIED — wrap app harness in <TooltipProvider>
      │                           #   alongside <ThemeProvider>.
      └─ main.tsx                 # MODIFIED — mount <TooltipProvider> inside
                                  #   <ThemeProvider>, wrapping <RouterProvider>
                                  #   (F36 canonical mount point; fixes F37 debt).
# NO Tooltip/Dropdown primitive change (F36 frozen). NO navbar layout change (F37 —
#   only an insertion). NO ThemeProvider change (F34). NO token change (F32 closed).
# NO index.css, NO index.html (F33). NO schema migration. NO new deps
#   (lucide Activity via F31; Tooltip parts via F36).
```

**Data flow:** `useHealth()` wraps `useQuery(['health'])` → fetches `GET /health` → returns `{ ok, isLoading, isError, detail }`. `TopNav` reads the hook and renders a fixed-size `<button>` trigger (`Activity` icon + colored dot) wrapped in an F36 `Tooltip`. The dot color is derived from the hook state (`bg-success`/`bg-danger`/`bg-muted-foreground`); the `TooltipContent` text mirrors the state ("Healthy"/"Unhealthy — {service}"/"Checking…"). `<TooltipProvider>` mounted at `main.tsx` (inside `ThemeProvider`, wrapping `RouterProvider`) provides the tooltip context to the whole tree. F34's ThemeProvider is untouched; F36's Tooltip primitive is untouched; F37's right-cluster structure is preserved (insertion only).

---

## 5. Parallelization Strategy

F41 is a solo sequential feature: T1 (the `useHealth` hook) is the barrier — T2's `TopNav` indicator imports it. T2 also owns the `main.tsx` `TooltipProvider` mount, the `AppLayout` cleanup, and the `HealthBadge` deletion (all interdependent). T3 owns the tests (which depend on both T1's hook and T2's wiring). T4 is the verification gate. Within a batch there are no parallelizable disjoint file sets — each task builds on the prior.

### Batch dependency diagram

```
   Batch A (primitive)          Batch B (integration)          Batch C (tests)          Batch D (verify)
   ────────────────             ──────────────────────         ───────────────          ────────────────
       T1 ─────────────────────────┬─▶  T2 ───────────────────────┬─▶  T3 ──────────────────┬─▶  T4
   (hooks/useHealth.ts,            (TopNav.tsx: indicator +        (TopNav.test.tsx +         (verify: 8 files,
    useHealth.test.ts)              AppLayout.tsx: delete row +     App.test.tsx: provider      gate green, 3-state
                                    main.tsx: TooltipProvider +     wraps + useHealth.test +   rendering, no false
                                    delete HealthBadge.tsx +        health-indicator tests)    red, no layout shift,
                                    HealthBadge.test.tsx)                                       TooltipProvider mounted)
```

- **Batch A → Batch B** is a hard barrier: T2's `TopNav` calls `useHealth()` — the hook must exist and be typed before `TopNav` compiles.
- **Batch B → Batch C** is a hard barrier: T3's tests assert against the `TopNav` health indicator and the `useHealth` hook — both must be wired before tests are meaningful.
- **Batch C → Batch D** is a hard barrier: T4 verifies the merged 8-file diff and re-runs the full gate green.

### Merge order rules

1. **Batch A merges first.** T1 (`useHealth.ts` + `useHealth.test.ts`) lands the extracted hook. Must be on `main` before T2 branches.
2. **Batch B merges second.** T2 (`TopNav.tsx` indicator + `AppLayout.tsx` cleanup + `main.tsx` `TooltipProvider` + delete `HealthBadge.tsx` + `HealthBadge.test.tsx`) — all interdependent in one commit.
3. **Batch C merges third.** T3 (`TopNav.test.tsx` health tests + `TooltipProvider` wrap; `App.test.tsx` `TooltipProvider` wrap).
4. **Batch D (integration verification) merges last.** T4 confirms the committed diff is exactly the F41 files, re-runs the full gate, confirms 3-state rendering, confirms no false-red, confirms no layout shift, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/hooks/useHealth.ts` (new), `frontend/src/hooks/useHealth.test.ts` (new) | — | — |
| **T2** | B | `frontend/src/components/TopNav.tsx` (Modified — indicator), `frontend/src/components/AppLayout.tsx` (Modified — delete row + import), `frontend/src/main.tsx` (Modified — `TooltipProvider`), `frontend/src/components/HealthBadge.tsx` (Deleted), `frontend/src/components/HealthBadge.test.tsx` (Deleted) | T1 | — |
| **T3** | C | `frontend/src/components/TopNav.test.tsx` (Modified — provider wrap + health tests), `frontend/src/App.test.tsx` (Modified — provider wrap), `frontend/src/hooks/useHealth.test.ts` (finalize — created in T1, asserted in T3) | T1, T2 | — |
| **T4** | D | no files changed (verification gate); records proof in §7 | T1, T2, T3 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 → T4.
- **2 devs:** Overkill — Dev-A: T1 → T2; Dev-B: T3 (after T2) → T4. Marginal benefit.
- **3 devs:** Not applicable — strictly sequential.

---

## 6. Tasks

### T1 — Extract `useHealth` hook (3-state health query) + co-located test

**Batch:** A · **Depends on:** None (F36/F37 done) · **Parallel with:** —

**Description:** Extract the inline `useQuery(['health'])` from `HealthBadge.tsx:10-21` into a reusable `useHealth` hook. The hook returns a 3-state discriminable shape: `{ ok, isLoading, isError, detail }`. `ok` is `boolean | undefined` — `undefined` while loading (the discriminator the current `HealthBadge` lacks, causing the false-red bug). Preserve the query config exactly: queryKey `['health']`, `GET /health`, `staleTime: 30_000`, no `refetchInterval` (health is informational; the spec doesn't mandate polling). The co-located test covers all three states (loading/ok/error) plus the query config invariants. This hook is the single source of truth for health state — `TopNav` (T2) is a pure consumer.

**Create** `frontend/src/hooks/useHealth.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from '@/constants';

interface HealthResponse {
    status: string;
    service: string;
}

export interface UseHealthResult {
    /** `true` when status==='ok' && !isError; `false` when unhealthy; `undefined` while loading. */
    ok: boolean | undefined;
    isLoading: boolean;
    isError: boolean;
    /** Human-readable detail for the tooltip — the `service` field, or a fallback per state. */
    detail: string;
}

async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
    const response = await fetch(`${API_BASE_URL}/health`, {
        headers: { 'Content-Type': 'application/json' },
        signal,
    });
    if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
    }
    return response.json() as Promise<HealthResponse>;
}

/**
 * F41 — server-state hook for the backend health check. Extracted from the
 * standalone HealthBadge's inline useQuery so the navbar indicator can render
 * a 3-state UI (loading / healthy / unhealthy) without a false red during the
 * initial fetch. Single source of truth; TopNav is a pure consumer.
 *
 * Query config preserved from HealthBadge: queryKey ['health'], GET /health,
 * staleTime 30s, NO refetchInterval (health is informational; spec doesn't
 * mandate live polling).
 */
export function useHealth(): UseHealthResult {
    const query = useQuery<HealthResponse>({
        queryKey: ['health'],
        queryFn: ({ signal }) => fetchHealth(signal),
        staleTime: 30_000,
    });

    const ok =
        query.isLoading
            ? undefined
            : query.data?.status === 'ok' && !query.isError;

    const detail = query.isLoading
        ? 'Checking…'
        : query.isError || query.data?.status !== 'ok'
            ? query.data?.service ?? 'Service unavailable'
            : query.data?.service ?? 'All systems operational';

    return {
        ok,
        isLoading: query.isLoading,
        isError: query.isError,
        detail,
    };
}
```

> **Key correctness notes for the implementer:**
> - **`ok: boolean | undefined`** — `undefined` while loading is the discriminator that fixes the false-red bug. The current `HealthBadge` computes `ok = data?.status === 'ok' && !isError` with no loading branch (during fetch, `data` is `undefined`, `isError` is `false`, so `ok` is `false` → renders RED). `useHealth` returns `undefined` during `isLoading`, enabling the neutral state. D1.
> - **Preserve query config** — queryKey `['health']`, `GET /health`, `staleTime: 30_000`, no `refetchInterval`. Do NOT add polling (spec doesn't require it; health is informational).
> - **`AbortSignal`** — pass React Query's `signal` to `fetch` for request cancellation on unmount/query invalidation (React Query v5 best practice).
> - **`API_BASE_URL`** — confirm the import path (`@/constants` is the convention per js-style-guide SCREAMING_SNAKE_CASE constants). If the existing `HealthBadge` imports it from elsewhere, match that path. Grep before finalizing.
> - **No `any`** — explicit `HealthResponse` interface + `UseHealthResult`. `as Promise<HealthResponse>` on the JSON parse (typed cast, not `any`).
> - **Single responsibility** — the hook owns the query; it does NOT render anything. `TopNav` (T2) reads `{ ok, isLoading, isError, detail }` and renders the indicator.
> - **No `console.log`** — proper error surfacing via `isError`/`detail`.

**Create** `frontend/src/hooks/useHealth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHealth } from './useHealth';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    // eslint-disable-next-line react/display-name
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };
}

function mockHealthResponse(
    body: unknown,
    init: { ok?: boolean; status?: number } = {},
) {
    const ok = init.ok ?? true;
    return vi.fn(() =>
        Promise.resolve({
            ok,
            status: init.status ?? (ok ? 200 : 500),
            json: () => Promise.resolve(body),
        } as Response),
    ) as unknown as typeof fetch;
}

describe('useHealth', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('reports isLoading + ok===undefined during the initial fetch', () => {
        // Never-resolving fetch → perpetually loading.
        global.fetch = vi.fn(
            () => new Promise<Response>(() => undefined),
        ) as unknown as typeof fetch;

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        expect(result.current.isLoading).toBe(true);
        expect(result.current.ok).toBeUndefined();
        expect(result.current.detail).toBe('Checking…');
    });

    it('reports ok===true + the service detail on a healthy response', async () => {
        global.fetch = mockHealthResponse({
            status: 'ok',
            service: 'slykboard-api',
        });

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.ok).toBe(true);
        expect(result.current.isError).toBe(false);
        expect(result.current.detail).toBe('slykboard-api');
    });

    it('reports ok===false + isError on a non-ok status body', async () => {
        global.fetch = mockHealthResponse({
            status: 'degraded',
            service: 'slykboard-api',
        });

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.ok).toBe(false);
        expect(result.current.detail).toBe('slykboard-api');
    });

    it('reports ok===false + isError when fetch rejects (network/server error)', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('network down')),
        ) as unknown as typeof fetch;

        const { result } = renderHook(() => useHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.ok).toBe(false);
        expect(result.current.detail).toBe('Service unavailable');
    });

    it('uses queryKey ["health"] and staleTime 30s (no polling)', async () => {
        const fetchSpy = mockHealthResponse({
            status: 'ok',
            service: 'slykboard-api',
        });
        global.fetch = fetchSpy;

        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );

        renderHook(() => useHealth(), { wrapper });

        await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
        const observer = queryClient.getQueryCache().find({ queryKey: ['health'] });
        expect(observer).toBeDefined();
        // staleTime is set on the hook's useQuery options; assert via the observer
        // config is read-only in v5, so assert behavior: a second mount within
        // staleTime does NOT refetch.
        const initialCallCount = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.length;
        renderHook(() => useHealth(), { wrapper });
        await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
        expect((fetchSpy as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
            initialCallCount,
        );
    });
});
```

> **Test notes:**
> - **`renderHook` + `QueryClientProvider`** — `useHealth` calls `useQuery`, so the hook must run inside a `QueryClientProvider`. Each test gets a fresh `QueryClient` with `retry: false` to avoid retry noise.
> - **3-state coverage** — loading (never-resolving fetch), ok (200 + `status:'ok'`), unhealthy-body (`status:'degraded'`), fetch-reject (network). The loading test asserts `ok === undefined` (the discriminator).
> - **Query config invariants** — `queryKey ['health']` found in the cache; `staleTime` 30s asserted behaviorally (a second mount within staleTime doesn't refetch). No `refetchInterval` (not tested directly, but the absence of timers means no polling).
> - **`vi.restoreAllMocks()` in `beforeEach`** — reset `global.fetch` between tests.
> - **js-testing-rules:** `getByRole` N/A (hook test); `renderHook` is the hook-testing equivalent; business logic >80% coverage target.

**Acceptance Criteria:**
- [ ] `useHealth.ts` created at `frontend/src/hooks/useHealth.ts`; exports `useHealth` (named) + `UseHealthResult` interface.
- [ ] Returns `{ ok: boolean | undefined, isLoading: boolean, isError: boolean, detail: string }`; `ok === undefined` during `isLoading`.
- [ ] Query config preserved: queryKey `['health']`, `GET {API_BASE_URL}/health`, `staleTime: 30_000`, NO `refetchInterval`.
- [ ] `fetchHealth` passes React Query's `AbortSignal` to `fetch`.
- [ ] No `any`; explicit `HealthResponse`/`UseHealthResult` interfaces; functions <50 lines; 2-space TS; ≤100 cols; trailing commas; import order.
- [ ] `useHealth.test.ts` created; wraps in `QueryClientProvider`; covers loading (ok===undefined), healthy (ok===true + service detail), unhealthy-body (ok===false), fetch-reject (isError), query-config invariants.
- [ ] `npm run test -w frontend -- useHealth.test.ts` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** React Query (`@tanstack/react-query` — already a dep); F31 constants.

---

### T2 — Wire health indicator into `TopNav`, delete `HealthBadge`, mount `TooltipProvider` in `main.tsx`

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Five interdependent edits in one batch. (1) Insert the health indicator inline in `TopNav`'s right cluster (between `<ThemeToggle />` F40 and the avatar block F39) — an F36 `Tooltip` wrapping a fixed-size `<button>` trigger with an `Activity` icon + colored dot, driven by `useHealth`. (2) Delete the `<HealthBadge />` row from `AppLayout.tsx:11` and its import at `:3`. (3) Mount `<TooltipProvider>` in `main.tsx` (inside `<ThemeProvider>`, wrapping `<RouterProvider>`) — fixes F37 debt, unblocks F42. (4) `rm HealthBadge.tsx` + `HealthBadge.test.tsx` (standalone bar deleted; query logic extracted to `useHealth` in T1). The indicator is 3-state (loading/healthy/unhealthy) with token-only colors and fixed sizes (no layout shift).

**Modify** `frontend/src/components/TopNav.tsx`:

Add imports (extend the existing lucide import + add Tooltip parts + useHealth):
```typescript
import { Activity } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/Tooltip';
import { useHealth } from '@/hooks/useHealth';
import { cn } from '@/utils/cn';
```

> Confirm `@/components/ui/Tooltip` is the F36 export path (grep the F36 file). Confirm `@/utils/cn` is the project's classname-merge utility (adjust to `@/lib/utils` if that's where F31 put it).

Call `useHealth` at the top of the component (alongside the F40 `useTheme` call):
```typescript
    // F41 — server-state for the health indicator. Single source of truth;
    // this component is a pure consumer. ok===undefined while loading (3-state).
    const health = useHealth();
```

Add a derived 3-state descriptor (table-driven per js-style-guide):
```typescript
    type HealthState = 'healthy' | 'unhealthy' | 'loading';
    const healthState: HealthState = health.isLoading
        ? 'loading'
        : health.ok === false || health.isError
            ? 'unhealthy'
            : 'healthy';

    const HEALTH_INDICATOR: Record<
        HealthState,
        { dot: string; label: string }
    > = {
        healthy: { dot: 'bg-success', label: 'Healthy' },
        unhealthy: { dot: 'bg-danger', label: `Unhealthy — ${health.detail}` },
        loading: { dot: 'bg-muted-foreground', label: 'Checking…' },
    };
    const indicator = HEALTH_INDICATOR[healthState];
```

Insert the indicator in the right cluster (between `<ThemeToggle />` at the F40 slot and `{avatarBlock}`):
```typescript
    {/* F41 (D2) — health indicator folded into the navbar (PRD §4.2). Activity
        icon + colored status dot (3-state) with an F36 Tooltip. Fixed-size
        trigger (h-9 w-9) + dot (h-2 w-2) → no layout shift on state flip. */}
    <TooltipProvider delayDuration={300}>
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label="Health"
                    className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    <span
                        className={cn(
                            'absolute right-1.5 top-1.5 h-2 w-2 rounded-full',
                            indicator.dot,
                        )}
                        aria-hidden="true"
                    />
                </button>
            </TooltipTrigger>
            <TooltipContent>{indicator.label}</TooltipContent>
        </Tooltip>
    </TooltipProvider>
```

> **Key correctness notes for the implementer:**
> - **3-state table-driven** — `HEALTH_INDICATOR` record keyed by `HealthState`; the dot class and tooltip label come from one lookup. No inline ternaries in JSX. `ok === undefined` (loading) maps to `loading`; `ok === false || isError` maps to `unhealthy`; otherwise `healthy`.
> - **Fixed sizes (no layout shift)** — trigger `h-9 w-9`, dot `h-2 w-2`. Both constant across states. `TooltipContent` is Portal-rendered (out of flow) so its text-length variance (the `service` detail) does NOT shift the navbar. Satisfies acceptance bullet 4.
> - **`bg-success`/`bg-danger`/`bg-muted-foreground`** — F32 tokens ONLY (acceptance bullet 3). No `bg-green-500`/`bg-red-500` (the old raw colors). The dot is positioned `absolute right-1.5 top-1.5` on the trigger so the `Activity` icon stays centered.
> - **F36 Tooltip reused** — `<TooltipProvider><Tooltip><TooltipTrigger asChild><button>…</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>`. `asChild` lets the primitive wrap the native `<button>` (keyboard-focusable, correct a11y). NEVER a `title` attribute (acceptance bullet 6, edge case). The local `<TooltipProvider>` here is belt-and-suspenders; the app-wide one in `main.tsx` (below) is the real fix.
> - **`useHealth()` consumer only** — `TopNav` reads `health`; it does NOT call `useQuery` directly. Single source of truth (D1). The F40 `useTheme` call and the F41 `useHealth` call coexist at the top of the component.
> - **Insertion point** — between `<ThemeToggle />` (F40 slot) and `{avatarBlock}` (F39). PRD §4.2 "far left of the right-cluster (or beside the brand)". F40's toggle is currently the far-left of the right cluster; the health indicator goes between it and the avatar. Do NOT restructure the F37 cluster container or move the F39 avatar/F40 toggle.
> - **`aria-label="Health"`** on the trigger — the `Activity` icon is decorative (the dot conveys state); the label gives screen readers a name. The `TooltipContent` provides the textual status.
> - **Token-only classes** — no raw Tailwind colors, no `dark:` variants. `cn()` merges the dynamic dot class with the fixed positioning.
> - **No `any`**; explicit `HealthState` union + `HEALTH_INDICATOR` record; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; import order.

**Modify** `frontend/src/components/AppLayout.tsx`:

Delete the import at `:3`:
```diff
- import { HealthBadge } from './HealthBadge';
```

Delete the row at `:11` (between `<TopNav />` and `<main>`):
```diff
-             <HealthBadge />
```

> Confirm the exact line numbers in T2 (the layout may have shifted since the analyst snapshot). Grep `HealthBadge` in `AppLayout.tsx` to find both the import and the usage; delete both. The `<TopNav />` and `<main>` siblings remain unchanged.

**Modify** `frontend/src/main.tsx` (the ONLY permitted `main.tsx` edit):

Mount `<TooltipProvider>` inside `<ThemeProvider>`, wrapping `<RouterProvider>`:
```typescript
import { TooltipProvider } from '@/components/ui/Tooltip';
// ... existing imports including ThemeProvider + RouterProvider

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ThemeProvider>
            {/* F41 (D3) — mount TooltipProvider app-wide (F36 canonical mount point).
                F37 was supposed to do this but skipped it; F41 fixes the debt and
                unblocks F42 (nav scoping tooltips). Inside ThemeProvider so Tooltip
                Portal content inherits theme tokens (bg-primary etc.). */}
            <TooltipProvider delayDuration={300}>
                <RouterProvider router={router} />
            </TooltipProvider>
        </ThemeProvider>
    </StrictMode>,
);
```

> Confirm the exact `main.tsx` structure in T2 (the F40 doc references `main.tsx:24` wrapping `RouterProvider` in `<ThemeProvider>`). The insertion is: wrap the existing `<RouterProvider>` in `<TooltipProvider>`, inside the existing `<ThemeProvider>`. Do NOT touch the ThemeProvider, the StrictMode, or any other provider.

**Delete** `frontend/src/components/HealthBadge.tsx`:
```bash
rm frontend/src/components/HealthBadge.tsx
```

**Delete** `frontend/src/components/HealthBadge.test.tsx`:
```bash
rm frontend/src/components/HealthBadge.test.tsx
```

> The query logic is fully preserved in `useHealth` (T1); the indicator is re-homed in `TopNav`. No behavior is lost. Grep the whole `frontend/src` for `HealthBadge` after deletion to confirm no dangling import (only `AppLayout.tsx` and the test referenced it — both handled).

**Acceptance Criteria:**
- [ ] `TopNav.tsx` imports `Activity` (lucide), `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` (F36), `useHealth` (T1), `cn`.
- [ ] Calls `const health = useHealth()` at the top of `TopNav`; derives `healthState` + `indicator` via a `HEALTH_INDICATOR` record.
- [ ] Health indicator inserted between `<ThemeToggle />` (F40) and `{avatarBlock}` (F39) in the right cluster.
- [ ] Dot classes: `bg-success` (healthy) / `bg-danger` (unhealthy) / `bg-muted-foreground` (loading). NO `bg-green-500`/`bg-red-500`.
- [ ] Trigger is fixed `h-9 w-9`; dot is fixed `h-2 w-2` (absolute-positioned). No layout shift on state flip.
- [ ] F36 Tooltip wraps a native `<button aria-label="Health">` (keyboard-focusable). NO `title` attribute.
- [ ] TooltipContent text: "Healthy" / "Unhealthy — {service}" / "Checking…".
- [ ] `AppLayout.tsx` — `<HealthBadge />` row at `:11` AND import at `:3` deleted. `<TopNav />` + `<main>` siblings unchanged.
- [ ] `main.tsx` — `<TooltipProvider>` mounted inside `<ThemeProvider>`, wrapping `<RouterProvider>`. ThemeProvider/StrictMode untouched.
- [ ] `HealthBadge.tsx` + `HealthBadge.test.tsx` deleted (`rm`). No dangling `HealthBadge` import anywhere in `frontend/src`.
- [ ] No `any`; explicit interfaces; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order; token-only classes.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** T1 (`useHealth`); F36 (Tooltip — done); F37 (right-cluster — done); F40 (ThemeToggle slot — done); F39 (avatar block — done); F32 (tokens — done).

---

### T3 — Tests: `TopNav.test.tsx` health-indicator assertions + `TooltipProvider` wraps + finalize `useHealth.test.ts`

**Batch:** C · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** Two load-bearing harness wraps + the health-indicator assertions. (1) `TopNav.test.tsx` `renderTopNav()` must wrap in `<TooltipProvider>` (alongside the F40 `<ThemeProvider>`) once `TopNav` renders the F36 Tooltip — or the tooltip content won't surface and the health tests fail. Add health-indicator tests: dot tint + tooltip text per state (3 states), `aria-label="Health"`, F36 Tooltip usage (not a `title`), no layout shift. (2) `App.test.tsx` wraps in `<TooltipProvider>` alongside its existing `<ThemeProvider>`. (3) Finalize `useHealth.test.ts` (created in T1) — confirm it passes against the merged hook.

**Modify** `frontend/src/components/TopNav.test.tsx`:

Add the import + wrap `renderTopNav()`:
```typescript
import { TooltipProvider } from '@/components/ui/Tooltip';

function renderTopNav() {
    return render(
        // F41 — TopNav now renders an F36 Tooltip (health indicator). Must be
        // inside <TooltipProvider> or the tooltip content won't render and the
        // health tests fail. F40 already wraps <ThemeProvider>; layer <TooltipProvider>
        // alongside it.
        <ThemeProvider>
            <TooltipProvider delayDuration={0}>
                <MemoryRouter>
                    <TopNav />
                </MemoryRouter>
            </TooltipProvider>
        </ThemeProvider>,
    );
}
```

Add health-indicator tests (mock `useHealth` to drive each state):
```typescript
import { useHealth } from '@/hooks/useHealth';

// Mock useHealth so each test can pin the state without touching fetch.
vi.mock('@/hooks/useHealth', () => ({
    useHealth: vi.fn(),
}));
const mockedUseHealth = vi.mocked(useHealth);

function setHealthState(state: 'loading' | 'healthy' | 'unhealthy', detail = 'slykboard-api') {
    if (state === 'loading') {
        mockedUseHealth.mockReturnValue({
            ok: undefined,
            isLoading: true,
            isError: false,
            detail: 'Checking…',
        });
    } else if (state === 'healthy') {
        mockedUseHealth.mockReturnValue({
            ok: true,
            isLoading: false,
            isError: false,
            detail,
        });
    } else {
        mockedUseHealth.mockReturnValue({
            ok: false,
            isLoading: false,
            isError: true,
            detail,
        });
    }
}

describe('F41 — health indicator (TopNav)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the health trigger button with aria-label="Health"', () => {
        setHealthState('healthy');
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('button', { name: 'Health' })).toBeInTheDocument();
    });

    it('uses the Activity icon (not a raw title attribute) for a11y', () => {
        setHealthState('healthy');
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        const trigger = screen.getByRole('button', { name: 'Health' });
        // F36 Tooltip, NOT a hand-rolled title (acceptance bullet 6).
        expect(trigger).not.toHaveAttribute('title');
        // The tooltip role exists in the document (Radix Portal).
        expect(document.querySelector('[role="tooltip"]')).toBeInTheDocument();
    });

    it.each([
        ['healthy', 'bg-success'],
        ['unhealthy', 'bg-danger'],
        ['loading', 'bg-muted-foreground'],
    ] as const)('renders the %s dot tint', (state, expectedClass) => {
        setHealthState(state);
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        const trigger = screen.getByRole('button', { name: 'Health' });
        const dot = trigger.querySelector('span.rounded-full');
        expect(dot?.className).toContain(expectedClass);
    });

    it('shows "Healthy" tooltip content when healthy', async () => {
        setHealthState('healthy');
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        await waitFor(() => {
            expect(screen.getByText('Healthy')).toBeInTheDocument();
        });
    });

    it('shows "Unhealthy — {service}" tooltip content when unhealthy', async () => {
        setHealthState('unhealthy', 'slykboard-api');
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        await waitFor(() => {
            expect(screen.getByText('Unhealthy — slykboard-api')).toBeInTheDocument();
        });
    });

    it('shows "Checking…" tooltip content while loading (no false red)', async () => {
        setHealthState('loading');
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // The loading dot is muted, NOT red — assert the false-red bug is fixed.
        const trigger = screen.getByRole('button', { name: 'Health' });
        const dot = trigger.querySelector('span.rounded-full');
        expect(dot?.className).not.toContain('bg-danger');
        expect(dot?.className).toContain('bg-muted-foreground');

        await waitFor(() => {
            expect(screen.getByText('Checking…')).toBeInTheDocument();
        });
    });

    it('does not change layout size between states (fixed trigger + dot)', () => {
        // Render healthy, capture the trigger bounding box; switch to unhealthy;
        // confirm the trigger size is identical (no layout shift).
        setHealthState('healthy');
        useAuthStore.getState().setUser(fullUser);
        const { rerender } = renderTopNav();
        const healthyTrigger = screen.getByRole('button', { name: 'Health' });
        const healthyBox = healthyTrigger.getBoundingClientRect();

        setHealthState('unhealthy');
        rerender(
            <ThemeProvider>
                <TooltipProvider delayDuration={0}>
                    <MemoryRouter>
                        <TopNav />
                    </MemoryRouter>
                </TooltipProvider>
            </ThemeProvider>,
        );
        const unhealthyTrigger = screen.getByRole('button', { name: 'Health' });
        const unhealthyBox = unhealthyTrigger.getBoundingClientRect();

        expect(unhealthyBox.width).toBe(healthyBox.width);
        expect(unhealthyBox.height).toBe(healthyBox.height);
    });
});
```

> **Test notes:**
> - **Mock `useHealth`** in `TopNav.test.tsx` — the unit under test is the indicator's rendering logic, not the query. Driving each state via `mockedUseHealth.mockReturnValue(...)` is deterministic and fast. The real query behavior is covered by `useHealth.test.ts` (T1). This mirrors js-testing-rules (mock external deps; test the unit).
> - **`TooltipContent` in a Portal** — Radix renders the tooltip content in a Portal at `document.body`, so `screen.getByText(...)` finds it (it queries `document.body`). `delayDuration={0}` in the test harness makes the tooltip content render immediately (no 300ms wait).
> - **`getByRole('button', { name: 'Health' })`** — js-testing-rules priority (`getByRole` first). The `aria-label="Health"` is the accessible name.
> - **No-`title` assertion** — `expect(trigger).not.toHaveAttribute('title')` enforces acceptance bullet 6 (F36 Tooltip, not a hand-rolled `title`). The `role="tooltip"` query confirms the F36 primitive is in use.
> - **No-false-red assertion** — the loading test explicitly asserts the dot is NOT `bg-danger` and IS `bg-muted-foreground`. This is the regression guard for the bug F41 fixes.
> - **No-layout-shift assertion** — `getBoundingClientRect()` width/height comparison between healthy and unhealthy states. Fixed CSS sizes (`h-9 w-9`, `h-2 w-2`) make this pass.
> - **Existing F37/F39/F40 TopNav tests unaffected** — the provider wrap only adds context; the F40 `<ThemeProvider>` wrap remains. Re-run the full `TopNav.test.tsx` to confirm.

**Modify** `frontend/src/App.test.tsx` (confirm exact path in T3):

Wrap the app harness in `<TooltipProvider>` alongside the existing `<ThemeProvider>`:
```typescript
import { TooltipProvider } from '@/components/ui/Tooltip';

// In the render call:
render(
    <ThemeProvider>
        <TooltipProvider delayDuration={0}>
            {/* existing MemoryRouter / RouterProvider / App */}
        </TooltipProvider>
    </ThemeProvider>,
);
```

> Confirm the `App.test.tsx` location (`frontend/src/App.test.tsx` or `frontend/src/App.test.tsx` — grep). If no app-level test exists, skip this edit (the `TopNav.test.tsx` wrap is the load-bearing one). The purpose is to ensure any app-level render that includes `TopNav` also provides the tooltip context.

**Finalize** `frontend/src/hooks/useHealth.test.ts` (created in T1):

Re-run `npm run test -w frontend -- useHealth.test.ts` against the merged state. Confirm all 5 tests pass (loading, healthy, unhealthy-body, fetch-reject, query-config). No edits expected — T1 wrote the tests; T3 verifies them post-integration.

**Acceptance Criteria:**
- [ ] `TopNav.test.tsx` `renderTopNav()` wraps in `<TooltipProvider>` (alongside F40's `<ThemeProvider>`); `delayDuration={0}` for test speed.
- [ ] Health-indicator tests added: `aria-label="Health"` trigger; no `title` attribute; `role="tooltip"` present; 3 dot tints (`bg-success`/`bg-danger`/`bg-muted-foreground`); 3 tooltip texts ("Healthy"/"Unhealthy — {service}"/"Checking…"); no-false-red (loading dot is NOT `bg-danger`); no-layout-shift (trigger size identical across healthy↔unhealthy).
- [ ] `useHealth` mocked in `TopNav.test.tsx` (deterministic state driving); real query covered in `useHealth.test.ts`.
- [ ] `App.test.tsx` wraps in `<TooltipProvider>` alongside `<ThemeProvider>` (if the test file exists).
- [ ] `useHealth.test.ts` passes against the merged state (5 tests).
- [ ] All existing F37/F39/F40 TopNav tests still pass.
- [ ] `npm run test -w frontend` exits 0 (full suite incl. `useHealth.test.ts` + `TopNav.test.tsx` + F40 regression).
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** T1 (`useHealth`), T2 (`TopNav` indicator + `main.tsx` `TooltipProvider`).

---

### T4 — Integration verification & sign-off

**Batch:** D (terminal) · **Depends on:** T1, T2, T3 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the 8 F41 files (3 modified + 1 new + 2 deleted + 2 test modified), re-run the full gate green, confirm 3-state rendering (no false red), confirm no layout shift, confirm `TooltipProvider` mounted app-wide, confirm `HealthBadge` fully removed, confirm no scope leakage, and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the F41 file set:
   ```bash
   git diff --name-status main...HEAD | sort
   # Expected (exactly 8):
   # D    frontend/src/components/HealthBadge.test.tsx
   # D    frontend/src/components/HealthBadge.tsx
   # A    frontend/src/hooks/useHealth.test.ts
   # A    frontend/src/hooks/useHealth.ts
   # M    frontend/src/App.test.tsx
   # M    frontend/src/components/AppLayout.tsx
   # M    frontend/src/components/TopNav.test.tsx
   # M    frontend/src/components/TopNav.tsx
   # M    frontend/src/main.tsx
   ```
   Any other path (a `Tooltip.tsx`/`Dropdown.tsx` edit, an `index.css` edit, a `useTheme.ts`/`ThemeProvider.tsx` edit, a schema migration, a lucide/Radix install) → leaked; remove and re-commit. (9 entries for 8 logical files because deleted files show as `D`.)
2. Re-run the full gate on the merged state:
   ```bash
   npm install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (useHealth + TopNav + F40 regression)
   ```
3. Confirm scope-boundary files are **unchanged** vs main:
   ```bash
   for f in frontend/src/components/ui/Tooltip.tsx frontend/src/components/ui/Dropdown.tsx \
            frontend/src/hooks/useTheme.ts frontend/src/components/ThemeProvider.tsx \
            frontend/src/index.css frontend/index.html \
            frontend/src/components/ui/Button.tsx frontend/package.json; do
     git diff --quiet main...HEAD -- "$f" \
       && echo "$f: UNCHANGED" \
       || echo "$f: CHANGED (out of scope — revert)"
   done
   ```
   All must print UNCHANGED. (`Tooltip.tsx`/`Dropdown.tsx` — F36; `Button.tsx` — F35; `useTheme.ts`/`ThemeProvider.tsx` — F34; `index.css` — F32 closed; `index.html` — F33 closed; `package.json` — lucide via F31, Tooltip via F36, no new deps.)
4. Confirm `HealthBadge` is **fully gone** (no dangling references):
   ```bash
   grep -REn 'HealthBadge' frontend/src \
     && echo "BUG: dangling HealthBadge reference" \
     || echo "HealthBadge fully removed: OK"
   test ! -f frontend/src/components/HealthBadge.tsx && echo "HealthBadge.tsx deleted: OK"
   test ! -f frontend/src/components/HealthBadge.test.tsx && echo "HealthBadge.test.tsx deleted: OK"
   ```
   All must print OK.
5. Confirm `AppLayout.tsx` no longer mounts the standalone bar:
   ```bash
   grep -n 'HealthBadge' frontend/src/components/AppLayout.tsx \
     && echo "BUG: HealthBadge still in AppLayout" \
     || echo "AppLayout standalone bar removed: OK"
   ```
6. Confirm `TooltipProvider` is mounted in `main.tsx`:
   ```bash
   grep -n '<TooltipProvider' frontend/src/main.tsx
   grep -n 'RouterProvider' frontend/src/main.tsx
   # TooltipProvider must wrap RouterProvider, inside ThemeProvider.
   ```
7. Confirm the 3-state wiring in `TopNav.tsx`:
   ```bash
   grep -n "import { useHealth } from '@/hooks/useHealth'" frontend/src/components/TopNav.tsx
   grep -n "import { Activity } from 'lucide-react'" frontend/src/components/TopNav.tsx
   grep -n 'bg-success' frontend/src/components/TopNav.tsx
   grep -n 'bg-danger' frontend/src/components/TopNav.tsx
   grep -n 'bg-muted-foreground' frontend/src/components/TopNav.tsx
   grep -n 'aria-label="Health"' frontend/src/components/TopNav.tsx
   grep -n 'TooltipContent' frontend/src/components/TopNav.tsx
   ```
   All must match. Then confirm NO raw colors in the health indicator:
   ```bash
   grep -REn 'bg-(green|red)-[0-9]' frontend/src/components/TopNav.tsx \
     && echo "RAW COLOR FOUND (BUG)" || echo "token-only: OK"
   ```
8. Confirm the `useHealth` hook returns the 3-state shape:
   ```bash
   grep -n 'ok: boolean | undefined' frontend/src/hooks/useHealth.ts
   grep -n 'queryKey:.*\[.health.\]' frontend/src/hooks/useHealth.ts
   grep -n 'staleTime: 30_000' frontend/src/hooks/useHealth.ts
   # Confirm NO refetchInterval (no polling).
   grep -n 'refetchInterval' frontend/src/hooks/useHealth.ts \
     && echo "BUG: polling added (spec doesn't require it)" || echo "no polling: OK"
   ```
9. Confirm the load-bearing test-harness wraps landed:
   ```bash
   grep -n '<TooltipProvider' frontend/src/components/TopNav.test.tsx
   grep -n "getByRole('button', { name: 'Health' })" frontend/src/components/TopNav.test.tsx
   grep -n "not.toHaveAttribute('title')" frontend/src/components/TopNav.test.tsx
   grep -n 'bg-muted-foreground' frontend/src/components/TopNav.test.tsx  # no-false-red assertion
   ```
   All must match.
10. Confirm token-only classes (no raw colors, no `dark:` color classes) in F41-added code:
    ```bash
    grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' \
      frontend/src/hooks/useHealth.ts frontend/src/components/TopNav.tsx \
      && echo "RAW COLOR FOUND (BUG)" || echo "token-only: OK"
    grep -REn 'dark:(bg|text|border)-' frontend/src/components/TopNav.tsx \
      && echo "dark: color class FOUND (BUG)" || echo "no dark: color classes: OK"
    ```
    Both must print OK.
11. Confirm the F37 right-cluster + F39 avatar + F40 toggle are **unchanged in structure** (F41 only inserts):
    ```bash
    git diff main...HEAD -- frontend/src/components/TopNav.tsx | grep -E '^[-+].*(<ThemeToggle|avatarBlock|handleSignOut)'
    # No - lines removing ThemeToggle/avatarBlock/sign-out — only + lines inserting the health indicator.
    ```
12. Manual smoke (optional): run `npm run dev -w frontend`, confirm:
    - The standalone "Healthy" bar is GONE (no full-width row below the navbar).
    - The navbar shows an `Activity` icon with a colored dot (top-right area, near the theme toggle).
    - On first load (loading state): dot is muted gray, tooltip says "Checking…" (NOT red).
    - After fetch resolves healthy: dot is green, tooltip says "Healthy".
    - Stop the backend → after staleTime, the dot goes red and tooltip says "Unhealthy — ...".
    - Flipping states does NOT shift the navbar layout (the trigger/dot stay fixed-size).
    - Tab to the indicator → it's keyboard-focusable; the tooltip appears.
    Record screenshots/observations in §7.
13. Capture commit SHA, exit codes, test counts into §7. Confirm D3 (`main.tsx` `TooltipProvider`) + D4 (delete `HealthBadge`) owner sign-offs — surface defaults before merge.

**Acceptance Criteria:**
- [ ] Committed diff is exactly 8 files (3 modified + 1 new hook + 1 new hook test + 2 deleted + 2 test modified) — no `Tooltip.tsx`/`Dropdown.tsx`/`Button.tsx`/`index.css`/`index.html`/`useTheme.ts`/`ThemeProvider.tsx`/`package.json`/migration leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `useHealth.test.ts` + `TopNav.test.tsx` + F40 regression).
- [ ] `HealthBadge.tsx` + `HealthBadge.test.tsx` deleted; no dangling `HealthBadge` reference in `frontend/src`.
- [ ] `AppLayout.tsx` no longer references `HealthBadge`.
- [ ] `TooltipProvider` mounted in `main.tsx` (inside `<ThemeProvider>`, wrapping `<RouterProvider>`).
- [ ] `useHealth` returns `ok: boolean | undefined`; queryKey `['health']`; `staleTime: 30_000`; NO `refetchInterval`.
- [ ] Health indicator is 3-state: `bg-success`/`bg-danger`/`bg-muted-foreground`; tooltip "Healthy"/"Unhealthy — {service}"/"Checking…".
- [ ] No false red: loading dot is `bg-muted-foreground`, NOT `bg-danger`.
- [ ] F36 Tooltip used (not a `title` attribute); trigger is `aria-label="Health"` + keyboard-focusable.
- [ ] Fixed sizes (trigger `h-9 w-9`, dot `h-2 w-2`); no layout shift on state flip.
- [ ] `TopNav.test.tsx` wraps `<TooltipProvider>`; health-indicator tests present.
- [ ] F37 right-cluster structure + F39 avatar + F40 toggle unchanged (F41 only inserts).
- [ ] Token-only classes (no raw colors, no `dark:`).
- [ ] All F41 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] D3/D4 owner sign-offs recorded.

**Dependencies:** T1, T2, T3.

---

## 7. Final F41 Acceptance Checklist

- [ ] **Standalone bar removed** — `<HealthBadge />` row at `AppLayout.tsx:11` + import at `:3` deleted.
- [ ] **Navbar indicator** — `Activity` icon + colored dot in the right cluster (between F40 toggle and F39 avatar); tooltip reads "Healthy"/"Unhealthy" with detail.
- [ ] **Token tints** — `bg-success` (healthy) / `bg-danger` (unhealthy) / `bg-muted-foreground` (loading). NO `bg-green-500`/`bg-red-500`.
- [ ] **No layout shift** — fixed trigger (`h-9 w-9`) + dot (`h-2 w-2`); tooltip content Portal-rendered out of flow.
- [ ] **3-state, no false red** — `isLoading` → `bg-muted-foreground` + "Checking…"; `ok===true` → `bg-success` + "Healthy"; `ok===false||isError` → `bg-danger` + "Unhealthy — {service}".
- [ ] **F36 Tooltip reused** — NOT a hand-rolled `title` attribute; `aria-label="Health"` trigger; keyboard-focusable; `role="tooltip"` present.
- [ ] **D1 `useHealth` hook** — extracted from `HealthBadge`'s inline `useQuery`; returns `{ ok: boolean|undefined, isLoading, isError, detail }`; queryKey `['health']`, `staleTime: 30_000`, no polling.
- [ ] **D2 inline indicator** — table-driven `HEALTH_INDICATOR` record; `cn()` merge; token-only.
- [ ] **D3 `TooltipProvider` mounted** — in `main.tsx` inside `<ThemeProvider>`, wrapping `<RouterProvider>` (fixes F37 debt; unblocks F42).
- [ ] **D4 `HealthBadge` deleted** — `HealthBadge.tsx` + `HealthBadge.test.tsx` removed; query logic preserved in `useHealth`.
- [ ] F37 right-cluster structure + F39 avatar + F40 toggle unchanged (insertion only).
- [ ] No `any`; explicit interfaces; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order; token-only classes.
- [ ] `Tooltip.tsx`/`Dropdown.tsx`, `Button.tsx`, `useTheme.ts`/`ThemeProvider.tsx`, `index.css`, `index.html`, `package.json` unchanged.
- [ ] No new deps (lucide `Activity` via F31; Tooltip parts via F36).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. `useHealth.test.ts` + `TopNav.test.tsx` + F40 regression).
- [ ] Committed diff is exactly 8 files.
- [ ] Commit message single-line `SLYK-F41: <message>`; branch `feature/SLYK-redesign-f41-health-badge-navbar`; rebase-and-merge only.

**Integration record (fill during T4):**
- Feature commit SHA: `________`
- Diff = exactly 8 files (`useHealth.ts` new, `useHealth.test.ts` new, `TopNav.tsx` modified, `TopNav.test.tsx` modified, `AppLayout.tsx` modified, `main.tsx` modified, `App.test.tsx` modified, `HealthBadge.tsx` deleted, `HealthBadge.test.tsx` deleted); no Tooltip/Dropdown/Button/index.css/index.html/useTheme/ThemeProvider/package.json/migration leakage: `PASS/FAIL`
- `useHealth` returns `ok: boolean | undefined` (3-state discriminator); queryKey `['health']`; `staleTime: 30_000`; no `refetchInterval`: `PASS/FAIL`
- `AppLayout.tsx:11` standalone `<HealthBadge />` row + `:3` import deleted: `PASS/FAIL`
- `HealthBadge.tsx` + `HealthBadge.test.tsx` deleted; no dangling reference: `PASS/FAIL`
- `TooltipProvider` mounted in `main.tsx` inside `<ThemeProvider>`, wrapping `<RouterProvider>`: `PASS/FAIL`
- Health indicator: `Activity` + dot, 3 tints (`bg-success`/`bg-danger`/`bg-muted-foreground`), F36 Tooltip (no `title`): `PASS/FAIL`
- No-false-red: loading dot is `bg-muted-foreground`, NOT `bg-danger`: `PASS/FAIL`
- No-layout-shift: trigger `h-9 w-9` + dot `h-2 w-2` identical across states: `PASS/FAIL`
- `TopNav.test.tsx` wraps `<TooltipProvider>` (alongside F40 `<ThemeProvider>`): `PASS/FAIL`
- Health-indicator tests: `aria-label="Health"`, no-`title`, `role="tooltip"`, 3 tints, 3 tooltip texts, no-false-red, no-layout-shift: `__/__ pass`
- `useHealth.test.ts` result: `__/__ pass` (loading/healthy/unhealthy-body/fetch-reject/query-config)
- F40 TopNav regression (theme toggle): `PASS/FAIL`
- No raw colors / no `dark:` color classes in F41-added code: `token-only: OK`
- `Tooltip.tsx` vs main: `UNCHANGED (F36 preserved)`
- `Dropdown.tsx` vs main: `UNCHANGED (F36 preserved)`
- `Button.tsx` vs main: `UNCHANGED (F35 preserved)`
- `useTheme.ts` vs main: `UNCHANGED (F34 preserved)`
- `ThemeProvider.tsx` vs main: `UNCHANGED (F34 preserved)`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- `index.html` vs main: `UNCHANGED (F33 preserved)`
- `package.json` vs main: `UNCHANGED (lucide via F31, Tooltip via F36 — no new deps)`
- New deps added by F41: `0`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- Manual smoke (bar gone; indicator renders; loading=neutral not red; healthy=green; backend down=red; no layout shift; keyboard-focusable): `PASS/FAIL/skipped`
- D3 owner sign-off (`main.tsx` TooltipProvider vs local provider): `recorded (date: ________)`
- D4 owner sign-off (delete HealthBadge vs keep deprecated): `recorded (date: ________)`

---

## 8. Schema deltas owned by this feature

F41 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance), **no CSS token additions** (F32 owns and has closed those — `index.css` is frozen; F41 only consumes `--success`/`--danger`/`--muted-foreground`), **no `index.html` change** (F33 owns the no-flash bootstrap), **no `useTheme.ts`/`ThemeProvider.tsx` change** (F34 owns the hook/provider — frozen), and **no primitive changes** (`Tooltip.tsx`/`Dropdown.tsx` is F36; `Button.tsx` is F35 — all frozen; F41 uses the existing Tooltip exports). F41's only non-component edit is mounting the existing `<TooltipProvider>` in `main.tsx` (consuming the F36 export — not modifying the primitive). F41 adds **no new dependencies** (lucide `Activity` via F31; `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` via F36). F41 creates `useHealth.ts` + `useHealth.test.ts` (new hook + test), modifies `TopNav.tsx` (indicator insertion), `TopNav.test.tsx` (provider wrap + tests), `AppLayout.tsx` (delete row + import), `main.tsx` (mount `TooltipProvider`), `App.test.tsx` (provider wrap), and deletes `HealthBadge.tsx` + `HealthBadge.test.tsx` — a hook + test, three integration edits, one provider mount, and two deletions, no schema surface.

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed; F41 consumes `--success`/`--danger`/`--muted-foreground` | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| No `useTheme.ts` / `ThemeProvider.tsx` change | None — F34 owns the hook/provider (frozen); F41 doesn't touch theme | `frontend/src/hooks/useTheme.ts` + provider file unchanged |
| No `Tooltip.tsx` / `Dropdown.tsx` / `Button.tsx` change | None — F36/F35 own the primitives (frozen); F41 consumes existing Tooltip exports | `frontend/src/components/ui/Tooltip.tsx`, `Dropdown.tsx`, `Button.tsx` unchanged |
| No new dependencies | lucide `Activity` via F31; `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` via F36 | `frontend/package.json` unchanged |
| `main.tsx` provider mount | `<TooltipProvider>` mounted inside `<ThemeProvider>`, wrapping `<RouterProvider>` (F36 canonical mount point; fixes F37 debt; unblocks F42). Consumes the F36 export — no primitive change. | `frontend/src/main.tsx` modified |
| New `useHealth` hook + test | `useHealth.ts` — extracted from `HealthBadge`'s inline `useQuery`; returns `{ ok: boolean\|undefined, isLoading, isError, detail }`; queryKey `['health']`, `staleTime: 30_000`, no polling. 3-state discriminator fixes the false-red bug. `useHealth.test.ts` — co-located, 5 tests (loading/healthy/unhealthy-body/fetch-reject/query-config). | `frontend/src/hooks/useHealth.ts` + `useHealth.test.ts` created |
| TopNav health indicator | Inline indicator inserted between `<ThemeToggle />` (F40) and `{avatarBlock}` (F39): F36 `<Tooltip>` wrapping a fixed-size `<button aria-label="Health">` (`Activity` + colored dot). Table-driven `HEALTH_INDICATOR` record; token-only (`bg-success`/`bg-danger`/`bg-muted-foreground`); fixed sizes (no layout shift). `useHealth()` consumer. | `frontend/src/components/TopNav.tsx` modified |
| TopNav test-harness provider wrap + health tests | `renderTopNav()` wraps `<TooltipProvider>` (alongside F40's `<ThemeProvider>`); health-indicator tests (3 states, no-`title`, no-false-red, no-layout-shift). `useHealth` mocked for deterministic state driving. | `frontend/src/components/TopNav.test.tsx` modified |
| AppLayout standalone bar removal | `<HealthBadge />` row at `:11` + import at `:3` deleted (PRD §2.1 "standalone bar wastes a row"). | `frontend/src/components/AppLayout.tsx` modified |
| App test-harness provider wrap | `App.test.tsx` wraps `<TooltipProvider>` alongside `<ThemeProvider>` (if the test file exists). | `frontend/src/App.test.tsx` modified |
| HealthBadge deletion | `HealthBadge.tsx` + `HealthBadge.test.tsx` removed — standalone bar deleted (acceptance bullet 1); query logic fully preserved in `useHealth`. | `frontend/src/components/HealthBadge.tsx` + `HealthBadge.test.tsx` deleted |
