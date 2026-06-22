# F10 — Board auto-polling (30s) & conflict handling: Plan + Task Breakdown

> **Feature:** F10 — Board auto-polling (30s) & conflict handling (Phase 2 — Board Read)
> **Feature index:** [`features.md`](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F09 (merged ✓) · **PRD ref:** REQ-2.4, PRD §6.2, PRD §4 (out-of-scope)
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/{js-development-rules,js-style-guide,js-testing-rules,git-guidelines,persona}.md`, plus dependency task doc: [F09](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md)

---

## 1. F10 Recap

**Goal:** The board reflects other users' changes without a manual refresh — TanStack Query refetches the board on a 30-second interval while the tab is visible, pauses polling when the tab is hidden, and never yanks a card out from under a user mid-drag.

**Ships:** Any authenticated user has `/projects/:slug` open in a background tab; another user moves a card → within one 30-second poll the moved card appears in its new column. When the user switches tabs away, polling pauses (no pointless load + token churn); on focus it resumes. While the user is mid-drag (F11 wired), a poll defers rather than re-rendering the dragged list.

**Acceptance (definition of done):**

1. `POLL_INTERVAL_SECONDS` (default `30`) drives the refetch interval — surfaced as a frontend env var `VITE_POLL_INTERVAL_SECONDS` (Vite inlines only `VITE_`-prefixed vars at build time), default 30 when unset/garbage.
2. A card another user moved appears in its new column within one poll (≤ 30s).
3. Polling pauses when the tab is hidden and resumes on focus (avoid pointless load + token churn).
4. (Edge resolutions below are part of DoD.)

**Edge cases — resolved up front:**

- **Mid-drag when a poll returns → don't yank the card out from under them** → **Decision:** `useBoard` sets `refetchInterval: () => (useBoardUiStore.getState().dragInProgress ? false : POLL_INTERVAL_MS)`. Returning `false` from the v5 `refetchInterval` callback **DEFERS** (not discards) — the next tick after drag-end fires normally (TanStack v5 Polling guide). F10 **creates and consumes** the store seam (`useBoardUiStore.dragInProgress`); **F11** wires `onDragStart`/`onDragEnd` to flip the flag. F10 ships with the flag hard-defaulted to `false`, so read-only behavior is unaffected.
- **Optimistic UI must roll back on 409/error** → **Decision:** F10 is **read-only** — it issues NO mutations, so there is no 409 source in F10 itself. F10 owns the **stable queryKey contract** (`boardKeys.detail(slug)`, unchanging) plus a documented forward contract for the canonical optimistic-rollback recipe (`onMutate` → `cancelQueries` → snapshot `getQueryData` → `setQueryData` → `onError` rollback → `onSettled` invalidate `boardKeys.all`) that **F11 will implement**. Read-path errors surface via the query `error` state (`BoardPage` already renders it) — **no toast library is introduced** (toasts owned by F28). 409 handling is F11's.
- **Stale-data race: last-write-wins** → **Decision:** Client-side last-write-wins is the MVP policy (PRD §4 out-of-scope note + F10 spec accept it). `tickets.updatedAt` is present in the payload but **unused in F10** — no ETag / `If-Match` / version column exists (Agent B confirmed: `BoardPayload.project` has no `updatedAt`; the only versioning signal is per-ticket `updatedAt`). ETag/If-Match escalation is a future F11 concern, not F10.

**Scope boundary (explicit deferrals):**

- **Drag-and-drop write / optimistic mutation / 409 handling / ETag** → **F11.** F10 only creates + consumes the `dragInProgress` flag seam.
- **Toast notifications (success/error)** → **F28.** F10 surfaces read errors via the query `error` state only.
- **Board virtualization** → later, if soft-cap warnings prove insufficient.
- **Backend changes** → **none.** F10 ships zero backend code (the existing `GET /api/projects/:slug/board` endpoint from F09 is the poll target). `POLL_INTERVAL_SECONDS` is mis-categorized in the backend env table; F10 corrects it to a frontend var (Q1).

---

## 2. Codebase Analysis Summary

- **State:** **Partial / seam-additive.** F09 (board read) is fully implemented and merged on `main`. The board query exists but polls **never**. F10 adds: one env var, one Zustand UI store (new file), one hook modification, one `.env.example`, and docs. **Zero backend touch.**
- **Existing structure F10 builds on (with path citations):**
  - **`useBoard` hook** — `frontend/src/hooks/useBoard.ts:5-11`. Minimal: `useQuery({ queryKey, queryFn: () => fetchBoard(slug!), enabled: !!slug })`. **No `refetchInterval`, no `refetchIntervalInBackground` yet.** This is the single code touch point for the poll.
  - **`fetchBoard`** — `frontend/src/api/boards.ts:4-6`, rides shared `apiFetch` (`frontend/src/api/client.ts:45-131`, F07 auth header + 401 refresh-coalescing interceptor, `ApiClientError`, unwraps `Envelope<T>.data`). F10 inherits 401 refresh on every poll for free — no change to the client.
  - **`boardKeys`** — `frontend/src/api/queryKeys.ts:7-10`: `{ all: ['boards'], detail: (slug) => ['boards','detail',slug] }`. F09 task note: "F10 will use `boardKeys.all` for invalidation." F10 **keeps this contract stable** so F11 can layer optimistic writes + `boardKeys.all` invalidation on top.
  - **`QueryClient` defaults** — `frontend/src/lib/queryClient.ts:4-22`: `staleTime: 30_000` (`:7`), **`refetchOnWindowFocus: true` already global** (`:8`), retry skips 401 (`:14-19`). **No global `refetchInterval`, no global `refetchIntervalInBackground`.** Critical gap: the global `refetchOnWindowFocus:true` covers **resume-on-focus** but does **not** pause polls while hidden — that gap is closed by per-query `refetchInterval` + `refetchIntervalInBackground:false` on the board query (D1, D3).
  - **Frontend config** — `frontend/src/config/env.ts:18` frozen `env: { apiBaseUrl, googleClientId }`, read via `import.meta.env.VITE_*`, `Object.freeze`. Test precedent `frontend/src/config/env.test.ts` uses `vi.stubEnv`+`vi.resetModules`+dynamic import. F10 extends the Zod schema with `pollIntervalSeconds` + exports a derived `POLL_INTERVAL_MS` constant.
  - **Backend `POLL_INTERVAL_SECONDS`** — appears **NOWHERE** in `backend/src` (grep of poll/Poll/POLL = NONE). Only in `js-development-rules.md:145` (backend env table) and `features.md:243`. **Mis-categorized** — it is a frontend var. Q1.
  - **DnD** — `@hello-pangea/dnd` NOT in `frontend/package.json`. No Zustand board/UI store for drag coordination. Existing stores `useAuthStore`, `useProjectStore` (lastSelectedSlug only) — unsuitable. **`frontend/src/stores/useBoardUiStore.ts` DOES NOT EXIST** — F10 creates it (D4).
  - **Optimistic-update infra** — absent (no `onMutate`/`setQueryData`/`getQueryData` in `frontend/src`). Closest prior art `useCreateProject` (`useProjects.ts:21-29`) = invalidate-on-success only. F10 documents the v5 optimistic recipe; F11 implements it.
  - **Toast system** — absent (no `sonner`/`react-hot-toast`/etc.). Inline error in `BoardPage.tsx:17-22`. **Toasts owned by F28** — F10 does not add a toast lib.
  - **Test harness** — `frontend/src/hooks/useBoard.test.tsx`: module-level `vi.mock('@/api/boards')`, local QueryClient `{ retry:false, gcTime:0 }`, `createWrapper` factory, `renderHook`+`waitFor`. **jsdom does NOT auto-implement `document.VisibilityState` changes** — tests MUST stub `Object.defineProperty(document,'hidden',{value:true})` and dispatch `visibilitychange`.
  - **F09 render is pure presentational** — `BoardPage`, `BoardColumn`, `TicketCard`, `UnsortedBucket` are React-keyed lists (`key={ticket.id}`, `key={column.id}`). Background refetch re-renders cleanly; no uncontrolled state to collide. Conflict risk ≈ 0 for read-only F09 render; only real once F11 writes land.
- **File paths the plan references that DO NOT EXIST yet** (will be created): `frontend/src/stores/useBoardUiStore.ts`, `frontend/src/stores/useBoardUiStore.test.ts`, `frontend/.env.example`. Plus `VITE_POLL_INTERVAL_SECONDS` does not yet exist in `config/env.ts`, and `refetchInterval` does not yet exist on `useBoard`.
- **Project rules this plan must satisfy:** `js-development-rules.md` (React Query server state + 30s board polling/caching; frontend env vars prefixed `VITE_`; Zustand for client/global UI state; React 19 + Vite + Tailwind), `js-style-guide.md` (hooks camelCase `use*`; stores camelCase; constants SCREAMING_SNAKE `POLL_INTERVAL_MS`; import order external→internal→type→relative; "Magic numbers — define constants"; no inline styles; no `any`; async/await), `js-testing-rules.md` (Vitest co-located `*.test.ts(x)`; `vi.fn()`; RTL priority getByRole>labelText>text>testid; business logic coverage >80%), `git-guidelines.md` (branch `type/SLYK-TICKET-desc`; single-line commits `SLYK-TICKET: msg`; "If ticket unidentifiable, omit prefix — message only"; rebase-only no squash; sacred rule "NEVER run git without explicit approval"), `persona.md` (React 19 + Express 5 + Postgres + Vite + Tailwind).
- **Hidden coupling to plan for:**
  - **Vite build-time inlining.** Vite inlines only `VITE_`-prefixed vars at build time as **strings** — numeric coercion must be explicit (D2, D9). Deploy target is Vercel → var MUST be `VITE_POLL_INTERVAL_SECONDS` (not backend `POLL_INTERVAL_SECONDS`).
  - **TanStack v5 `refetchInterval` callback signature.** `refetchInterval?: number | false | ((query) => number | false)` — the callback takes a single `query` arg; return `false` to pause/defer (Agent D). **`refetchIntervalInBackground` defaults to `false` in v5** → polling auto-pauses on `document.hidden`, resumes on focus. No manual `visibilitychange` listener needed for basic behavior (D3).
  - **Stable queryKey contract.** F10 must NOT change `boardKeys.detail(slug)` — F11 will layer `getQueryData`/`setQueryData` optimistic writes on the exact same key. Any key drift breaks F11.
  - **`vi.stubGlobal('document', ...)` pitfalls.** jsdom's `document.hidden` is writable but `Object.defineProperty` is the robust stub. The `visibilitychange` event must be dispatched manually for the v5 in-background pause to register in tests.
  - **No `console.log`.** Read-path errors are already surfaced via `BoardPage` (F09); F10 adds no logging.
  - **`verbatimModuleSyntax`.** Type-only imports use `import type`.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | **Where to set the 30s interval** | **Per-query `refetchInterval` on `useBoard`** (NOT a global `QueryClient` default) | The board is the only resource that polls; a global default would force a 30s cadence on `useProjects`/`useProject` too (waste + token churn). Per-query keeps blast radius minimal. Codebase: `useBoard.ts:5-11` is the single touch point. TanStack v5: per-query options override defaults. |
| D2 | **Env var name + layer** | **`VITE_POLL_INTERVAL_SECONDS` (frontend)**, NOT backend `POLL_INTERVAL_SECONDS` | Vite inlines only `VITE_`-prefixed vars at build time (persona.md / Vercel deploy). The poll runs in the browser, so the var is consumed client-side. `POLL_INTERVAL_SECONDS` appears NOWHERE in `backend/src` (grep NONE) and is mis-categorized in `js-development-rules.md:145` + `features.md:243`. **Delta from rules doc — Q1 resolved YES (T4 corrects the rules doc).** |
| D3 | **Pause/resume mechanism** | **Rely on v5 default `refetchIntervalInBackground:false` + existing global `refetchOnWindowFocus:true`** (no manual `visibilitychange` listener) | v5 `refetchIntervalInBackground` DEFAULTS to `false` → polling auto-pauses on `document.hidden`, resumes on focus (TanStack Polling guide, Agent D). The existing global `refetchOnWindowFocus:true` (`queryClient.ts:8`) handles resume-on-focus for free. No listener = less code, less churn. F10 sets `refetchInterval` + inherits the in-background default; explicitly sets `refetchIntervalInBackground: false` for readability/clarity (matches intent even though it's the default). |
| D4 | **Mid-drag pause seam** | **New `useBoardUiStore` (Zustand) `{ dragInProgress: boolean; setDragInProgress }`** consumed by `refetchInterval`, populated by F11 | F10 creates + consumes the seam; F11 wires `onDragStart`/`onDragEnd`. `useBoard` reads `useBoardUiStore.getState().dragInProgress` inside the `refetchInterval` callback → returns `false` to DEFER (not discard). Returning `false` means the next tick after drag-end fires normally (TanStack guide). No DnD lib in F10 (`@hello-pangea/dnd` is F11). `dragInProgress` defaults `false` so read-only F10 behavior is unaffected. |
| D5 | **Stale-data conflict policy** | **Client-side last-write-wins** (no ETag / `If-Match` / version column in MVP) | PRD §4 out-of-scope explicitly chooses polling over WebSocket push (implicit LWW). F10 spec accepts LWW. Per-ticket `updatedAt` exists in the payload but is unused in F10 MVP. ETag/If-Match escalation is a future F11 concern. |
| D6 | **Optimistic rollback ownership** | **F10 owns the stable queryKey + rollback CONTRACT only**; actual `useMutation`/optimistic in F11 | F10 is read-only (no mutation, no 409 source). The canonical v5 recipe (`onMutate` → `cancelQueries` → snapshot `getQueryData` → `setQueryData` → `onError` rollback → `onSettled` invalidate `boardKeys.all`) is documented here for F11. F10 keeps `boardKeys.detail(slug)` stable. |
| D7 | **Read-path error surfacing** | **Via query `error` state** (already rendered by `BoardPage.tsx:17-22`); **no toast lib** | Toasts owned by F28. F10 adds no `sonner`/`react-hot-toast`. The query `error` (an `ApiClientError`) already flows to `BoardPage`'s error branch. |
| D8 | **`.env.example`** | **Create `frontend/.env.example`** documenting `VITE_POLL_INTERVAL_SECONDS=30` | **No `.env.example` exists anywhere in the repo** (Agent A). Convention: document every `VITE_` var. F10 is the first to add one; future features append. |
| D9 | **Env parsing** | **Zod `z.coerce.number().int().positive().default(30)`** in `config/env.ts`; expose `pollIntervalSeconds` + `POLL_INTERVAL_MS` (= `pollIntervalSeconds * 1000`) | Vite inlines `VITE_*` as strings → numeric coercion explicit. Matches existing `config/env.ts` Zod/parse pattern. `.int().positive()` rejects garbage; `.default(30)` honors PRD REQ-2.4. `POLL_INTERVAL_MS` is the constant consumed by `useBoard` (style guide: "Magic numbers — define constants"; TanStack `refetchInterval` takes ms). |

> **Out of F10 scope (explicitly deferred):**
> - **Drag-and-drop write / optimistic mutation / 409 handling / ETag / `If-Match`** → **F11.** F10 creates + consumes only the `dragInProgress` flag.
> - **Toast notifications** → **F28.**
> - **Board virtualization** → later.
> - **Backend changes** → none.

> **Owner sign-off — RESOLVED (see §9 for final answers):**
> - **Q1 = YES:** Correct `js-development-rules.md:145` — add a frontend `VITE_POLL_INTERVAL_SECONDS` env row (T4 will perform this edit).
> - **Q2 = repo convention:** Commits use `SLYK-F10: <msg>` and branch `feature/SLYK-F10-board-auto-polling` (matches repo log — feature ID treated as ticket equivalent, per `SLYK-F09:` history).
> - **Q3 = DEFER:** No optimistic-rollback scaffold in F10 — F11 owns it; F10 documents the recipe only.
> - **Q4 = KEEP LWW:** No `project.updatedAt` board-level watermark; pure client-side last-write-wins.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
└── frontend/
    ├── .env.example                                        # NEW (T1) — documents VITE_POLL_INTERVAL_SECONDS=30
    └── src/
        ├── config/
        │   ├── env.ts                                      # MODIFY (T1) — add pollIntervalSeconds (Zod) + POLL_INTERVAL_MS constant
        │   └── env.test.ts                                 # MODIFY (T1) — add cases (default 30, coerce, reject garbage)
        ├── stores/
        │   ├── useBoardUiStore.ts                          # NEW (T2) — { dragInProgress, setDragInProgress } (F11 seam)
        │   └── useBoardUiStore.test.ts                     # NEW (T2)
        ├── hooks/
        │   ├── useBoard.ts                                 # MODIFY (T3) — add refetchInterval (drag-aware) + refetchIntervalInBackground:false
        │   └── useBoard.test.tsx                           # MODIFY (T3) — poll fires, suppressed mid-drag, suppressed when hidden, card-in-new-column-within-one-poll
        └── (NO other frontend files touched)
```

**Explicitly NO backend changes.** F10 reuses `GET /api/projects/:slug/board` (F09, `backend/src/routes/projects.routes.ts:36-45`) verbatim as the poll target. The F09 payload (`BoardPayload = { project, columns: BoardColumn[] }`, nested tickets, sorted ASC by `position`, unsorted appended last) is returned unchanged on every poll — no re-mapping.

**Poll lifecycle (post-F10):**

1. `BoardPage` mounts → `useBoard(slug)` issues the initial fetch (F09 behavior unchanged).
2. While `document.hidden === false` AND `dragInProgress === false`: `useQuery` refetches every `POLL_INTERVAL_MS` (default `30_000`).
3. On each refetch: `fetchBoard(slug)` → `apiFetch('/projects/:slug/board')` → Bearer injected → F07 401 refresh-coalescing interceptor runs (free) → unwrap `Envelope<BoardPayload>.data` → `useQuery` replaces `data` → React re-renders `BoardPage`/`BoardColumn`/`TicketCard` (pure presentational, React-keyed → clean re-render, no collision).
4. Tab hidden (`document.hidden === true`): v5 `refetchIntervalInBackground:false` (default, set explicitly for clarity) → polling **pauses**.
5. Tab focused: existing global `refetchOnWindowFocus:true` (`queryClient.ts:8`) fires an immediate refetch + the `refetchInterval` resumes.
6. Mid-drag (F11 flips `dragInProgress:true`): `refetchInterval` callback returns `false` → poll **defers**. On `onDragEnd` (F11 flips `dragInProgress:false`) → next tick resumes normally.
7. Read error (e.g. 401 after token-version bump, 404, 500): `apiFetch` throws `ApiClientError` → `useQuery.error` set → `BoardPage` renders the error branch (F09). No toast.

---

## 5. Parallelization Strategy

Tasks grouped into **2 batches** by dependency order. Within Batch 1, tasks touch **disjoint file sets** → zero merge conflicts. Batch 2 depends on Batch 1's outputs (the env value + the store flag).

### Batch dependency diagram

```
              ┌─────────────────────────────────────────────────────────────┐
   Batch 1    │ T1  config: VITE_POLL_INTERVAL_SECONDS + POLL_INTERVAL_MS    │
   (parallel, │     [frontend/src/config/env.ts, env.test.ts, .env.example]  │
   disjoint   │ T2  store: useBoardUiStore (dragInProgress seam)             │
   file sets) │     [frontend/src/stores/useBoardUiStore.ts + test]          │
              │ T4  docs/contract: edge-case resolutions + F11 forward        │
              │     contract + optional rules-doc correction (Q1)             │
              │     [this tasks doc; .claude/rules/js-development-rules.md]   │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (env value + store flag both exist)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 2    │ T3  useBoard: refetchInterval (drag-aware) + tests            │
   (after B1) │     [frontend/src/hooks/useBoard.ts + useBoard.test.tsx]     │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (polling wired)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 3    │ T5  Acceptance gate (terminal)                                │
   (gate)     │     (no files; lint/typecheck/test/build + smoke)             │
              └─────────────────────────────────────────────────────────────┘
```

- **B1 (T1 ‖ T2 ‖ T4) parallel:** disjoint file sets — config vs store vs docs. No overlap, zero conflicts.
- **B1 → B2 hard barrier:** T3's `useBoard` imports BOTH `POLL_INTERVAL_MS` (from T1's `config/env.ts`) AND reads `useBoardUiStore.getState().dragInProgress` (from T2's store). T3 cannot typecheck without T1 + T2 on `main`.
- **B2 → B3 hard barrier:** terminal verification needs the poll wired.
- **T4's optional rules-doc correction** (Q1) touches only `.claude/rules/js-development-rules.md` — disjoint from T1/T2/T3. If the owner declines Q1, T4 skips that edit.

### Merge order rules

1. **B1: (T1 ‖ T2 ‖ T4) merge first, any order.** Disjoint files. Rebase-only (no merge commits, no squash — git-guidelines.md).
2. **B2: T3 merges after B1.** Depends on T1's `POLL_INTERVAL_MS` + T2's store.
3. **B3 (T5) merges last.** Terminal verification; owns no files.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | B1 | `frontend/src/config/env.ts`, `frontend/src/config/env.test.ts`, `frontend/.env.example` (NEW) | F09 | T2, T4 |
| **T2** | B1 | `frontend/src/stores/useBoardUiStore.ts` (NEW), `frontend/src/stores/useBoardUiStore.test.ts` (NEW) | F09 | T1, T4 |
| **T4** | B1 | this tasks doc; `.claude/rules/js-development-rules.md` (gated Q1) | F09 | T1, T2 |
| **T3** | B2 | `frontend/src/hooks/useBoard.ts`, `frontend/src/hooks/useBoard.test.tsx` | T1, T2 | — |
| **T5** | B3 | (no files — terminal verification) | T3 | — |

### Developer assignment tracks

- **Solo (recommended):** (T1 ‖ T2 ‖ T4) → T3 → T5. ~0.5 day.
- **2 devs:** Dev-A: T1 → T3 (after T2 lands). Dev-B: T2 ‖ T4. Merge B1 → B2 → B3.
- **3 devs:** Dev-A: T1, Dev-B: T2, Dev-C: T4. Then T3 → T5 together.

---

## 6. Tasks

### T1 — Frontend config: `VITE_POLL_INTERVAL_SECONDS` + `POLL_INTERVAL_MS` + `.env.example`

**Batch:** B1 · **Depends on:** F09 (merged) · **Parallel with:** T2, T4

**Description:** Add the poll-interval env var to `frontend/src/config/env.ts` (Zod coerce `.int().positive().default(30)`, expose `pollIntervalSeconds` + derived `POLL_INTERVAL_MS` constant — the ms value `useBoard` consumes). Create `frontend/.env.example` documenting the var. Extend `frontend/src/config/env.test.ts` with cases (default 30 when unset, coerce a valid string, reject garbage → default, reject non-positive → default). This is the configuration foundation T3 imports.

Create / Modify:

- **`frontend/src/config/env.ts`** (MODIFY — extend the existing Zod schema).

  Add `pollIntervalSeconds` to the schema and a derived `POLL_INTERVAL_MS` constant (style guide: SCREAMING_SNAKE for constants; "Magic numbers — define constants"):

  ```typescript
  import { z } from 'zod';
  // ... existing imports

  // F10 D9: Vite inlines VITE_* as STRINGS → numeric coercion explicit.
  // PRD REQ-2.4: 30s default. js-development-rules.md:34 pins 30s.
  const envSchema = z.object({
      apiBaseUrl: z.string().url(),
      googleClientId: z.string(),
      pollIntervalSeconds: z.coerce.number().int().positive().default(30),
  });

  const parsed = envSchema.safeParse({
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
      googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      pollIntervalSeconds: import.meta.env.VITE_POLL_INTERVAL_SECONDS,
  });

  if (!parsed.success) {
      throw new Error(`Invalid frontend env: ${parsed.error.message}`);
  }

  export const env = Object.freeze(parsed.data);

  // F10 D9: refetchInterval takes ms. Single source of truth.
  export const POLL_INTERVAL_MS = env.pollIntervalSeconds * 1000;
  ```

  Notes: (a) Preserve the existing `apiBaseUrl`/`googleClientId` fields + the `Object.freeze` (do not regress F07/F08). (b) `z.coerce.number()` coerces the string Vite inlines. (c) `.int().positive()` rejects `0`, negatives, floats, garbage. (d) `.default(30)` honors PRD REQ-2.4 even when unset. (e) `POLL_INTERVAL_MS` derived once (no recompute per poll). (f) If the existing `env.ts` parses differently (e.g. inline `z.object().parse`), mirror its error-handling shape — this snippet is the target shape, adapt to the existing style.

- **`frontend/.env.example`** (NEW).

  ```dotenv
  # F10 D2/D8: frontend env vars (Vite inlines VITE_* at build time).
  # Polling interval for the board query (TanStack Query refetchInterval).
  # Default 30 when unset/invalid (PRD REQ-2.4). Units: seconds.
  VITE_POLL_INTERVAL_SECONDS=30

  # (F07/F08 vars — document if not already present elsewhere; F10 adds only the above.)
  # VITE_API_BASE_URL=https://your-api.onrender.com/api
  # VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
  ```

  Notes: No `.env.example` exists anywhere in the repo (Agent A). F10 creates the first one. Comment out F07/F08 vars (they're not F10's to introduce formally, but documenting them is helpful and low-risk). Keep `VITE_POLL_INTERVAL_SECONDS` uncommented as the F10-owned entry. Ensure `.env` (real secrets) is in `.gitignore` (git-guidelines.md) — it is; `.env.example` is intentionally committed.

- **`frontend/src/config/env.test.ts`** (MODIFY — add cases).

  Follow the existing precedent (`vi.stubEnv` + `vi.resetModules` + dynamic import):

  - **env: defaults pollIntervalSeconds to 30 when unset** — stub nothing for `VITE_POLL_INTERVAL_SECONDS`; dynamic-import `env.ts`; assert `env.pollIntervalSeconds === 30` and `POLL_INTERVAL_MS === 30_000`.
  - **env: coerces a valid numeric string** — `vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', '45')`; assert `pollIntervalSeconds === 45` and `POLL_INTERVAL_MS === 45_000`.
  - **env: rejects garbage → default 30** — `vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', 'abc')` (or `'not-a-number'`); the schema's `.default(30)` applies ONLY when the value is `undefined`. For garbage strings, `z.coerce.number()` yields `NaN` → `.int()` fails → the whole parse throws. **Decision:** match the existing file's behavior. If the existing file throws on bad env, the test asserts the throw. If we want garbage → default (not throw), use a `preprocess` or `catch` — **recommend throw** (fail-fast, surfaces misconfiguration at build). Document the choice. Either way, add a test for the chosen behavior.
  - **env: rejects non-positive → throws (or default per decision above)** — `vi.stubEnv('VITE_POLL_INTERVAL_SECONDS', '0')` and `'-5'`; assert throw (or default).

**Acceptance Criteria:**
- [ ] `config/env.ts` parses `VITE_POLL_INTERVAL_SECONDS` via `z.coerce.number().int().positive().default(30)`, exports `env.pollIntervalSeconds` and `POLL_INTERVAL_MS` (= `pollIntervalSeconds * 1000`).
- [ ] `frontend/.env.example` exists, documents `VITE_POLL_INTERVAL_SECONDS=30`, and `.env` remains gitignored.
- [ ] `env.test.ts` covers: default 30 when unset; coerce valid string (e.g. `'45'`); garbage/non-positive behavior (throw OR default — documented and tested).
- [ ] `apiBaseUrl`/`googleClientId` (F07/F08) UNCHANGED — no regression.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F09. Blocks T3.

---

### T2 — Frontend store: `useBoardUiStore` (drag-seam for F11)

**Batch:** B1 · **Depends on:** F09 (merged) · **Parallel with:** T1, T4

**Description:** Create `frontend/src/stores/useBoardUiStore.ts` — a Zustand store holding board-UI state that must coordinate across the render tree. F10 ships a single field `dragInProgress: boolean` (default `false`) + `setDragInProgress`. **F11** will flip this on `onDragStart`/`onDragEnd`; **F10** consumes it in `useBoard`'s `refetchInterval` (T3) to DEFER polls mid-drag. Defaulting `false` means read-only F10 behavior is unaffected.

Create / Modify:

- **`frontend/src/stores/useBoardUiStore.ts`** (NEW).

  ```typescript
  import { create } from 'zustand';

  // F10 D4: cross-tree board-UI state. F10 consumes dragInProgress to defer
  // polls mid-drag (useBoard refetchInterval). F11 wires onDragStart/onDragEnd.
  // dragInProgress defaults false → F10 read-only behavior unaffected.
  interface BoardUiState {
      dragInProgress: boolean;
      setDragInProgress: (value: boolean) => void;
  }

  export const useBoardUiStore = create<BoardUiState>((set) => ({
      dragInProgress: false,
      setDragInProgress: (value) => set({ dragInProgress: value }),
  }));
  ```

  Notes: (a) Zustand (already a project dep — `js-development-rules.md` mandates it for client UI state). (b) Single responsibility — board UI only. (c) `create` factory (Zustand v4+/v5 idiom). (d) No persistence (this is ephemeral session state, not `lastSelectedSlug`). (e) If the project uses the `create` from `zustand` vs `zustand/react`, match the existing stores (`useAuthStore`, `useProjectStore`) — read those first and mirror the import.

- **`frontend/src/stores/useBoardUiStore.test.ts`** (NEW).

  - **useBoardUiStore: defaults dragInProgress to false** — fresh store; assert `getState().dragInProgress === false`.
  - **useBoardUiStore: setDragInProgress(true) flips the flag** — call `getState().setDragInProgress(true)`; assert `getState().dragInProgress === true`.
  - **useBoardUiStore: setDragInProgress(false) resets** — set true then false; assert `false`.

  Notes: Reset the store between tests (`useBoardUiStore.setState({ dragInProgress: false })` in `beforeEach`) so tests are independent. Table-driven per js-testing-rules.

**Acceptance Criteria:**
- [ ] `stores/useBoardUiStore.ts` exports `useBoardUiStore` (Zustand `create`) with `dragInProgress: boolean` (default `false`) + `setDragInProgress`.
- [ ] `stores/useBoardUiStore.test.ts` covers default + set true + set false.
- [ ] Import style matches existing `useAuthStore`/`useProjectStore`.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F09. Blocks T3.

---

### T3 — Frontend hook: `useBoard` drag-aware `refetchInterval` + tests

**Batch:** B2 · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** Modify `frontend/src/hooks/useBoard.ts` to add `refetchInterval` (drag-aware via `useBoardUiStore`) + `refetchIntervalInBackground: false` (D3, explicit for clarity even though it's the v5 default). Do NOT touch the global `QueryClient` defaults (`queryClient.ts`) — per-query keeps blast radius minimal (D1). Extend `useBoard.test.tsx`: poll fires at `POLL_INTERVAL_MS` (fake timers), poll suppressed when `dragInProgress === true` (returns `false` → defers), poll suppressed when `document.hidden` (jsdom stub `Object.defineProperty(document,'hidden',{value:true})` + dispatch `visibilitychange`), and a card another user moved appears in its new column within one poll (acceptance #2).

Create / Modify:

- **`frontend/src/hooks/useBoard.ts`** (MODIFY).

  ```typescript
  import { useQuery } from '@tanstack/react-query';
  import { fetchBoard } from '@/api/boards';
  import { boardKeys } from '@/api/queryKeys';
  import { POLL_INTERVAL_MS } from '@/config/env';
  import { useBoardUiStore } from '@/stores/useBoardUiStore';

  // F10 D1/D3/D4: 30s refetch while visible + not dragging.
  // dragInProgress (F11 seam) DEFERS (returns false) — next tick resumes after drag-end.
  // refetchIntervalInBackground:false (v5 default, explicit) pauses on document.hidden;
  // existing global refetchOnWindowFocus:true resumes on focus.
  export function useBoard(slug: string | undefined) {
      return useQuery({
          queryKey: boardKeys.detail(slug ?? ''),
          queryFn: () => fetchBoard(slug!),
          enabled: !!slug,
          refetchInterval: () =>
              useBoardUiStore.getState().dragInProgress ? false : POLL_INTERVAL_MS,
          refetchIntervalInBackground: false,
      });
  }
  ```

  Notes: (a) `useBoardUiStore.getState()` read inside the callback (not via the hook selector) so the callback closure stays current without re-subscribing the component — the `refetchInterval` callback is re-evaluated by TanStack on each tick. (b) `POLL_INTERVAL_MS` from T1's config (D9). (c) `refetchIntervalInBackground: false` is the v5 default but set explicitly for intent clarity (D3). (d) Do NOT add `refetchInterval` to `queryClient.ts` defaults (D1). (e) Keep `queryKey` EXACTLY `boardKeys.detail(slug ?? '')` — stable contract for F11 (D6). (f) Preserve `enabled: !!slug`.

- **`frontend/src/hooks/useBoard.test.tsx`** (MODIFY — add poll scenarios).

  Use Vitest fake timers (`vi.useFakeTimers`) for interval assertions. Stub `document.hidden` via `Object.defineProperty(document, 'hidden', { configurable: true, value: <bool> })` and dispatch `new Event('visibilitychange')` for the in-background pause. Reuse the existing `createWrapper` + test `QueryClient`.

  - **useBoard: polls at POLL_INTERVAL_MS (default 30s)** — `vi.useFakeTimers`; mock `fetchBoard('SLYK')` → resolve `{project:{slug:'SLYK'},columns:[]}`; `renderHook(() => useBoard('SLYK'))`; `waitFor` initial fetch called once; `vi.advanceTimersByTime(30_000)`; assert `fetchBoard` called twice (initial + 1 poll); advance another 30s → called 3×. Restore timers in `afterEach`.
  - **useBoard: respects VITE_POLL_INTERVAL_SECONDS** — `vi.stubEnv('VITE_POLL_INTERVAL_SECONDS','10')` + dynamic-import the hook; advance 10s → second call. (Tests the env wiring end-to-end.)
  - **useBoard: DEFERS poll when dragInProgress === true** — `useBoardUiStore.getState().setDragInProgress(true)`; advance 60s; assert `fetchBoard` NOT called again (still just the initial). Then `setDragInProgress(false)`; advance 30s; assert called again (proves defer, not discard — D4).
  - **useBoard: pauses poll when document.hidden === true** — `Object.defineProperty(document,'hidden',{configurable:true,value:true})`; `document.dispatchEvent(new Event('visibilitychange'))`; advance 60s; assert no poll. Then set `hidden:false`; dispatch; advance 30s; assert poll fires (resume). Restore `document.hidden` in `afterEach`.
  - **useBoard: card appears in new column within one poll (acceptance #2)** — mock `fetchBoard` to return `columns:[{id:'c1',tickets:[tA]}]` on first call, then `columns:[{id:'c1',tickets:[]},{id:'c2',tickets:[tA]}]` on the poll (simulating another user moving tA c1→c2); advance 30s; assert the hook's `result.current.data.columns[1].tickets[0].id === tA.id` (the card moved within one poll). This is a hook-level assertion; a render-level assertion lives in `BoardPage.test.tsx` (F09 owns that file — if the owner wants a UI-level poll test, append there, but F10's acceptance is hook-level).

  Notes: (a) jsdom does NOT auto-implement `document.VisibilityState` — the stub + dispatch are required. (b) `vi.useFakeTimers` must be paired with `vi.useRealTimers` in `afterEach`. (c) The existing 3 scenarios (success, enabled-on-slug, 404 propagation) MUST still pass — do not regress F09. (d) Mock `@/api/boards` at module level (existing pattern).

**Acceptance Criteria:**
- [ ] `useBoard.ts` adds `refetchInterval: () => (dragInProgress ? false : POLL_INTERVAL_MS)` reading `useBoardUiStore.getState()` + `refetchIntervalInBackground: false`.
- [ ] `queryClient.ts` global defaults UNCHANGED (no `refetchInterval` added globally).
- [ ] `boardKeys.detail(slug ?? '')` queryKey UNCHANGED (stable contract for F11).
- [ ] Poll fires at 30s default; respects `VITE_POLL_INTERVAL_SECONDS`; defers (not discards) when `dragInProgress`; pauses when `document.hidden`, resumes on focus; moved card appears within one poll.
- [ ] Existing F09 hook scenarios (success, enabled, 404) still pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`POLL_INTERVAL_MS`), T2 (`useBoardUiStore`). Blocks T5.

---

### T4 — Docs & F11 forward contract + optional rules-doc correction

**Batch:** B1 · **Depends on:** F09 (merged) · **Parallel with:** T1, T2

**Description:** Resolve the F10 edge cases into documented decisions + record the F11 forward contract (stable queryKey, `boardKeys.all` invalidation seam, canonical optimistic-rollback recipe F11 implements, LWW decision). This is the "glue" task that makes F11's job turnkey. Per Q1 (approved), correct `js-development-rules.md:145` to add a frontend `VITE_POLL_INTERVAL_SECONDS` env row (convention correction).

Create / Modify:

- **`/home/munna/speedo/localhost/slykboard/.docs/features/F10-board-auto-polling/F10-board-auto-polling-tasks.md`** (this doc — already produced by the plan step). Ensure the edge-case resolutions (mid-drag DEFER, read-only no-409, LWW) and the F11 forward contract below are present.

- **F11 forward contract (document in this tasks doc, §3 D6 + here):**

  ```text
  F11 will implement optimistic board writes against the STABLE queryKey contract F10 owns:
    - queryKey: boardKeys.detail(slug) — DO NOT change (F10 locks it).
    - invalidation seam: boardKeys.all — F11 calls queryClient.invalidateQueries({ queryKey: boardKeys.all }) in onSettled.
    - canonical v5 optimistic recipe (TanStack docs, Agent D):
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: boardKeys.all });
            const prev = queryClient.getQueryData<BoardPayload>(boardKeys.detail(slug));
            queryClient.setQueryData<BoardPayload>(boardKeys.detail(slug), optimisticNext(variables));
            return { prev };
        },
        onError: (_err, _variables, context) => {
            if (context?.prev) queryClient.setQueryData(boardKeys.detail(slug), context.prev); // ROLLBACK
        },
        onSettled: () => { queryClient.invalidateQueries({ queryKey: boardKeys.all }); },
    - 409 handling: F11's write endpoint returns 409 on conflict → onError rolls back (above). F10 has no write → no 409.
    - conflict policy: client-side last-write-wins (F10 D5). ETag/If-Match escalation is a F11+ concern, NOT F10.
    - drag seam: F11 wires onDragStart → setDragInProgress(true); onDragEnd → setDragInProgress(false).
        F10's refetchInterval reads useBoardUiStore.getState().dragInProgress and returns false to DEFER.
  ```

- **`.claude/rules/js-development-rules.md`** (MODIFY — **Q1 approved**). The backend env table at `:145` lists `POLL_INTERVAL_SECONDS | No | 30`; F10 consumes this client-side. Apply the **preferred** correction: add a new frontend env section documenting `VITE_POLL_INTERVAL_SECONDS | No | 30` and note that `POLL_INTERVAL_SECONDS` (backend) is NOT used by F10 (the value lives client-side).

**Acceptance Criteria:**
- [ ] This tasks doc records the 3 edge-case resolutions (mid-drag DEFER, read-only no-409, LWW) as explicit decisions.
- [ ] F11 forward contract (stable queryKey, `boardKeys.all` invalidation, optimistic recipe, 409 ownership, drag-seam wiring) is documented.
- [ ] `js-development-rules.md` corrected (Q1 approved): frontend `VITE_POLL_INTERVAL_SECONDS` env row added; backend `POLL_INTERVAL_SECONDS` noted as unused-by-F10.

**Dependencies:** F09. (Q1 sign-off is external.)

---

### T5 — Integration verification & sign-off

**Batch:** B3 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof.

Steps:

1. **Frontend:**
   ```bash
   cd frontend && npm run typecheck && npm run lint && npm run format:check && npm test
   npm run build
   ```
2. **Config verification:**
   - With `VITE_POLL_INTERVAL_SECONDS` unset → build succeeds; `env.pollIntervalSeconds === 30`; `POLL_INTERVAL_MS === 30_000`.
   - With `VITE_POLL_INTERVAL_SECONDS=15` → `pollIntervalSeconds === 15`.
   - With `VITE_POLL_INTERVAL_SECONDS=garbage` → build fails (fail-fast) OR defaults per the T1 decision (document the observed behavior).
3. **Poll verification (fake-timer unit tests — T3):** all 5 T3 scenarios green.
4. **Live smoke (browser, backend running + seeded via F09's seed):**
   - Login → land on `/projects/SLYK` → board renders (F09).
   - Open DevTools Network → confirm a `GET /projects/SLYK/board` fires every 30s while the tab is focused.
   - In a second browser/user (or via `curl` with a valid JWT), move a ticket's `status_column` in the DB (or via F11 once it exists — for F10, mutate the DB directly via the F09 seed script) → within ≤ 30s the card appears in its new column in the first browser (acceptance #2).
   - Switch tabs away (minimize the browser / switch to another app so `document.hidden === true`) → confirm no further `GET /projects/SLYK/board` fires for 60s+ (acceptance #3, pause).
   - Switch back → an immediate refetch fires (global `refetchOnWindowFocus`) + the 30s cadence resumes (acceptance #3, resume).
   - (Mid-drag cannot be live-tested in F10 — no DnD yet. The T3 unit test covers the DEFER behavior. F11 will live-test it.)
5. **Read-error surfacing:** stop the backend mid-session → next poll's `fetchBoard` rejects → `BoardPage` renders the error branch (F09 wiring, unchanged). Confirm no toast (D7).
6. **No-backend confirmation:** `git diff main -- backend/` is EMPTY (F10 ships zero backend code).
7. **Record proof:** commit SHAs, sample Network captures, screenshot paths.

**Acceptance Criteria:**
- [ ] Every F10 Acceptance bullet (§1 items 1–4) satisfied; record commit SHAs + observations.
- [ ] `VITE_POLL_INTERVAL_SECONDS` (default 30) drives the refetch interval; configurable via env.
- [ ] A card another user moved appears in its new column within one poll (≤ 30s) — observed live + unit-tested.
- [ ] Polling pauses when the tab is hidden; resumes on focus — observed live + unit-tested.
- [ ] Poll DEFERS (not discards) when `dragInProgress` — unit-tested (live test is F11).
- [ ] No backend changes (`git diff main -- backend/` empty).
- [ ] No toast library added; read errors surface via `BoardPage` error branch.
- [ ] Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`.

**Dependencies:** T3 (all prior).

---

## 7. Final F10 Acceptance Checklist

- [ ] `VITE_POLL_INTERVAL_SECONDS` (default `30`) drives the board `refetchInterval`; exposed via `config/env.ts` (`pollIntervalSeconds` + `POLL_INTERVAL_MS`); documented in `frontend/.env.example`.
- [ ] `useBoard` sets `refetchInterval: () => (dragInProgress ? false : POLL_INTERVAL_MS)` + `refetchIntervalInBackground: false`; global `QueryClient` defaults UNCHANGED.
- [ ] A card another user moved appears in its new column within one poll (≤ 30s) — live-observed + unit-tested.
- [ ] Polling pauses when the tab is hidden (`document.hidden`) and resumes on focus (existing global `refetchOnWindowFocus:true` + v5 default `refetchIntervalInBackground:false`) — live-observed + unit-tested.
- [ ] Mid-drag poll DEFERS via `useBoardUiStore.dragInProgress` (F11 seam) — unit-tested; flag defaults `false`.
- [ ] F10 is read-only — no mutation, no 409 source; read errors surface via `BoardPage` error state; no toast lib (F28).
- [ ] Stale-data policy = client-side last-write-wins; `tickets.updatedAt` present but unused in F10 MVP (documented).
- [ ] Stable `boardKeys.detail(slug)` queryKey + `boardKeys.all` invalidation seam + canonical optimistic-rollback recipe documented for F11.
- [ ] Zero backend changes (`git diff main -- backend/` empty).
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + test pass (frontend).
- [ ] `npm run build` (frontend) succeeds.

**Integration record (fill during T5):**
- Feature commit SHA: `________`
- Branch: `feature/SLYK-F10-board-auto-polling` (commits: `SLYK-F10: <msg>` per repo convention — Q2 resolved).
- Observed poll interval (Network tab): `________` ms (expect 30000 default).
- Card-move-within-one-poll observed: `yes / no` (timestamp: `________`).
- Pause-on-hidden observed (no requests for 60s+): `yes / no`.
- Resume-on-focus observed (immediate refetch + cadence resumes): `yes / no`.
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`.

---

## 8. Schema deltas owned by this feature

**F10 owns NO schema delta.** No new table, no new column, no migration. The `features.md` schema-deltas table has no F10 row. F10 is a pure frontend polling + UI-state feature that reuses the F09 board endpoint (`GET /api/projects/:slug/board`) and the F09 `BoardPayload` shape verbatim.

| Delta | Detail | Migration |
| --- | --- | --- |
| _(none)_ | F10 adds no DB schema. | _(none)_ |

---

## 9. Sign-off list (owner questions — RESOLVED)

All 4 owner questions resolved. Final answers below.

- **Q1 — Rules-doc correction → YES:** `js-development-rules.md:145` lists `POLL_INTERVAL_SECONDS` in the **backend** env table, but F10 consumes it as the **frontend** `VITE_POLL_INTERVAL_SECONDS` (Vite-inlined). **T4 corrects the rules doc** — adds a frontend env row + notes the backend var is unused by F10.
- **Q2 — Git convention → repo convention (`SLYK-F10:`):** Commits use `SLYK-F10: <msg>` and branch `feature/SLYK-F10-board-auto-polling`. Repo log treats the feature ID (F10) as the ticket equivalent (matches the `SLYK-F09:` commit history) — the feature-ID-vs-ticket-ID ambiguity is resolved in favor of `SLYK-F<NN>`.
- **Q3 — Optimistic scaffold → DEFER:** No `useMutation` optimistic-rollback scaffold in F10 — F11 owns it. F10 documents the recipe (T4) so F11 is turnkey.
- **Q4 — `project.updatedAt` watermark → KEEP LWW:** No board-level watermark; pure client-side last-write-wins. 30s polling is cheap; the watermark would add payload surface + a backend change F10 explicitly avoids.
