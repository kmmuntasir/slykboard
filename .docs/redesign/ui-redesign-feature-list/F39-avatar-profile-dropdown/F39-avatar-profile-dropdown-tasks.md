# F39 — Avatar → profile Dropdown menu with Sign out: Plan + Task Breakdown

> **Feature:** F39 — Avatar → profile Dropdown menu with Sign out (Phase 1 — Chrome · Feature)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F36 (done) + F37 (done) · **PRD ref:** §4.4 (avatar → profile menu), §2.1 (flat Sign out at TopNav.tsx:102-108), §3.3 (LogOut/User icons), §10 (auth untouched)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency features: [F36](../F36-dropdown-tooltip-primitives/F36-dropdown-tooltip-primitives-tasks.md) (Dropdown — done); [F37](../F37-navbar-fullwidth-brand-clusters/F37-navbar-fullwidth-brand-clusters-tasks.md) (right-cluster slot — done); [F35](../F35-shared-ui-primitives/F35-shared-ui-primitives-tasks.md) (Avatar — done).

---

## 1. F39 Recap

**Goal:** Replace the floating flat "Sign out" text button with a proper profile menu — the navbar avatar becomes a Dropdown trigger revealing a signed-in header (avatar + name + email) and a Sign out item that reuses the existing `handleSignOut`.

**Ships:** The signed-in user clicks their avatar in the navbar right cluster → a `Dropdown` menu opens with a header ("Signed in as" + name + email) and a `LogOut`-iconed **Sign out** item. Clicking Sign out runs the existing `handleSignOut` (`logout()` → `clear()` → `broadcastLogout()` → `navigate('/login')`). The floating "Sign out" text button is gone from the TopNav.

**Acceptance (definition of done):**
1. Avatar opens the `Dropdown` (F36). Header renders the signed-in user's avatar + name + email ("signed in as").
2. Sign out `DropdownItem` calls the **existing `handleSignOut`** — no new auth logic (§10 auth flow untouched; `logout`/`clear`/`broadcastLogout`/`navigate` reused verbatim).
3. Floating "Sign out" text button removed from `TopNav`.
4. Test: menu opens (Radix `pointerDown`), header shows user identity, Sign out `menuitem` invokes `handleSignOut`.
5. F37's right-cluster layout (theme slot placeholder + avatar + hamburger) preserved — only the `avatarBlock` is swapped; theme slot + hamburger STAY.

**Edge cases resolved up front:**
- **Theme toggle in the menu** → **Decision: OMIT.** F40 owns the navbar theme toggle; PRD §4.4 explicitly permits "or omit if in navbar." F40 is un-done, so including a menu toggle now would duplicate state source. F39 does NOT import `useTheme` and renders NO theme item. (D2.)
- **User object shape** → **Decision: reuse `useAuthStore` `user` (`AuthUser`); don't invent a new fetch.** The TopNav already reads `user` via `useAuthStore((s) => s.user)` (`:46`). `AuthUser = { token, id, email, name, role, avatarUrl: string|null, blocked }` (`useAuthStore.ts:6-14`). F39 feeds `user.avatarUrl` + `user.name || user.email` to the F35 `Avatar`.
- **Email fallback (Avatar has no email param)** → **Decision: pass `name={user.name || user.email}` to `Avatar`.** F35 `Avatar` has NO email param — nameless users would hit the generic `User`-icon fallback. Feeding email-as-name preserves the prior "initials from email local-part" intent (now per-word: "bob@x.com" → "B"). (D1.)
- **Sign-out item variant** → **Decision: `destructive` (`text-destructive` red text).** Sign-out is a visual "leaving" signal, not data-destruction, so NO confirmation modal (per the confirm-modals memory — that rule covers delete/deactivate/promote/demote, not session-end). (D3.)
- **Avatar size** → **Decision: `md` (`h-8 w-8`).** Matches F37's inline avatar visual (`:177,180` both `h-8 w-8`); the navbar has room. (D4.)

---

## 2. Codebase Analysis Summary

- **State:** Partial — `TopNav.tsx` (227 lines, F37 version) is the single source file F39 edits. The flat "Sign out" lives at `:184-190` inside `avatarBlock` (`:171-192`). F36 (`Dropdown`, 7 exports), F37 (right-cluster slot), and F35 (`Avatar`) are done + merged — F39's deps are live in code, not just checked off. F39 MODIFIES `TopNav.tsx` + `TopNav.test.tsx`; no new files.

- **`TopNav.tsx` current structure (verbatim, line-cited) — what F39 swaps:**
  - `:33-36` local `getInitials(name, email)` — per-name-char `source.slice(0,2).toUpperCase()` (`"Alice"` → `"AL"`, `"bob"` → `"BO"`). **F39 DROPS this** (uses F35 Avatar's per-word algo instead). Removing it is what breaks the `'AL'`/`'BO'` test assertions.
  - `:46` `const user = useAuthStore((s) => s.user);` — F39 reuses (no new fetch).
  - `:47` `clear` from `useAuthStore`; `:48` `isAdmin` via `useRequireRole('ADMIN')`; `:49` `navigate`.
  - `:56-65` `handleSignOut` — `try { await logout(); } catch {} clear(); broadcastLogout(); navigate('/login', { replace: true });`. **F39 reuses VERBATIM** (wires it to `DropdownItem onSelect`).
  - `:171-192` `avatarBlock` — `<div className="flex items-center gap-3">` containing: `<img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full" />` OR initials `<span className="flex h-8 w-8 ... bg-muted text-xs ...">{getInitials(user.name, user.email)}</span>`, then flat `<button onClick={handleSignOut} className="text-sm text-muted hover:text-foreground">Sign out</button>`. **F39 replaces this entire block** with `<Dropdown>…<Avatar/> trigger…<DropdownContent>…</Dropdown>`.
  - `:211-226` F37 right-cluster container — `<div className="flex items-center gap-3">`: theme slot `<div data-slot="theme" aria-hidden="true" />` (`:213`, **F40 owns, STAYS**) + `{avatarBlock}` (`:214`, **F39 SWAPS**) + hamburger `<button … md:hidden aria-label="Toggle navigation">` (`:215-225`, **STAYS**).

- **F35 `Avatar`** (`components/ui/Avatar.tsx`): `AvatarProps { src?: string|null; name?: string|null; size?: 'sm'|'md'|'lg'; className?: string }`. Fallback chain: `src` → `<img alt={name ?? 'avatar'}>`; else `name` → `<span aria-label={name}>{getInitials(name)}</span>` (per-word: `.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()`, so "Ada Lovelace"→"AL", "munna"→"M", "bob@x.com"→"B"); else generic `<User>`-icon span (`aria-label="Unassigned"`). Size `md` = `h-8 w-8 text-sm`. **NO email param.** F39 feeds `src={user.avatarUrl}` + `name={user.name || user.email}` (D1).

- **F36 `Dropdown`** (`components/ui/Dropdown.tsx`, 7 exports confirmed):
  - `:15` `Dropdown` = `DropdownMenuPrimitive.Root` (Radix controls open state; auto-closes on item `onSelect`).
  - `:18-23` `DropdownTrigger` — **`asChild` passthrough** via `{...rest}` (F39 wraps `<Avatar>` as the trigger).
  - `:32-53` `DropdownContent` — Portal to `document.body`, `bg-popover text-popover-foreground border-border`, `sideOffset=4`, `z-50`, `min-w-[8rem]`.
  - `:69-86` `DropdownItem` — `variant: 'default' | 'destructive'`; `destructive` = `text-destructive focus:bg-accent focus:text-accent-foreground`; `onSelect` passthrough.
  - `:89-100` `DropdownSeparator` — `-mx-1 my-1 h-px bg-border`.
  - `:103-117` `DropdownLabel` — `px-2 py-1.5 text-sm font-semibold text-muted-foreground`.
  - `:120` `DropdownGroup`.

- **lucide `LogOut`** — importable from `lucide-react` (F31; standard icon). Not yet imported anywhere in `src/` (F37 uses `Layers`/`LayoutGrid`/`BarChart3`/`Settings`; F35 Avatar uses `User`). F39 adds `LogOut`.

- **`useTheme`** (`hooks/useTheme.ts`) — exists (F34), returns `{ theme, setTheme, resolvedTheme }`. **F39 does NOT call it** (F40 owns the toggle — D2). Documented as the seam F40 will wire.

- **`TopNav.test.tsx` current structure (245 lines, 18 tests) — what F39 breaks + fixes:**
  - `:14` mocks `@/api/auth` (`logoutMock`); `:15` mocks `@/hooks/useCrossTabLogout` (`broadcastLogoutMock`); `:19-24` mocks `useProjects` (one project so ProjectPicker renders its `aria-label`); `:26-29` mocks `react-router` `useNavigate` (keeps `MemoryRouter` + `NavLink` real).
  - `:31-39` `fullUser` fixture — `name: 'Demo User'`, `email: 'demo@slykboard.local'`, `avatarUrl: 'https://example.com/a.png'`, `role: 'ADMIN'`.
  - `:63-68` `'renders avatar img when avatarUrl is set'` → `getByRole('img', { name: fullUser.name })`. F35 Avatar's `<img alt={name}>` still resolves to `img` role with name = "Demo User". **SURVIVES** (re-verify trigger wrapping doesn't change alt/role).
  - `:70-76` `'renders initials when avatarUrl is null'` → `getByText('AL')` for `name: 'Alice'`. F35 per-word algo: "Alice" (single word) → `"A"`. **BREAKS** → update to `'A'`.
  - `:78-88` `'initials fall back to email local-part when name empty'` → `getByText('BO')` for `email: 'bob@x.com'`. With D1 (`name={user.name || user.email}`), Avatar sees name "bob@x.com" → per-word → `"B"`. **BREAKS** → update to `'B'` (and retitle the test).
  - `:90-103` + `:105-118` sign-out tests → `getByRole('button', { name: 'Sign out' })`. F39 changes Sign out to a `DropdownItem` → role `menuitem`, and the menu must open first (Radix opens on `pointerDown`, not `click` — confirmed in `Dropdown.test.tsx:46` + `ProjectPicker.test.tsx:134`). **BREAKS** → open menu via `pointerDown` on the avatar trigger, then `click` the `menuitem`.
  - `:120-193` brand/cluster/nav/Settings/picker-left/mobile-panel tests — **UNAFFECTED** (F39 touches only the avatar block; nav + picker + mobile logic untouched).

- **Build gate:** `dev` / `build` / `typecheck` / `test`. Radix open pattern: `fireEvent.pointerDown(trigger, { button: 0 })` (PointerEvent polyfill at `src/test-setup.ts:10`, F36+).

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; explicit prop interfaces; functional + hooks; Zustand for client UI state. Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files; **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; no inline styles (Tailwind only); SCREAMING_SNAKE_CASE constants; avoid prop drilling.
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `getByRole`/`getByLabelText` priority; `vi.fn()` mocks; table-driven preferred; **components >70% coverage**.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F38:` → F39 uses `SLYK-F39:` prefix; branch `feature/SLYK-redesign-f39-avatar-profile-dropdown`.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations. Reply concise.
  - `confirm-modals` memory — destructive/role-changing actions (promote/demote/deactivate/delete) require a confirmation modal. Sign-out is session-end, NOT in that list → NO confirmation modal (D3).

- **File paths the plan references that do NOT exist yet:** NONE. F39 MODIFIES only `TopNav.tsx` + `TopNav.test.tsx` (both exist). No new files.

- **Hidden coupling to plan for:**
  - **F37 TopNav.test initials break** — dropping the local `getInitials` (`:33-36`) and adopting F35 Avatar's per-word algo changes `"Alice"`→`"A"` and `"bob@x.com"`→`"B"`. The `'AL'`/`'BO'` `getByText` assertions MUST update or the suite goes red.
  - **Email-fallback gap** — F35 `Avatar` has NO email param. Without D1 (`name={user.name || user.email}`), nameless users fall to the generic `User`-icon span (`aria-label="Unassigned"`), losing the prior email-local-part initials behavior entirely. D1 feeds email-as-name.
  - **DropdownItem role change** — Sign out moves from `role="button"` to `role="menuitem"` (Radix DropdownItem). Both sign-out tests must open the menu via `pointerDown` on the avatar trigger first, then `click` the `menuitem`. The `fullUser` fixture has `avatarUrl` set → the trigger is `<img alt="Demo User">` (not a labelled button), so the open-step queries the trigger by its `img` accessible name OR by `aria-label` on the trigger wrapper (F39 adds `aria-label` to the DropdownTrigger-wrapped button — see D5).
  - **Trigger accessibility** — `DropdownTrigger asChild` requires a single child. Wrapping `<Avatar>` directly: Radix merges props onto Avatar's root. Avatar's roots are `<img>`, `<span>`, or `<span>` — none is focusable/`<button>`-like by default, and Radix Trigger needs a focusable element. **F39 wraps Avatar in a `<button>`** inside `asChild` so Radix has a real trigger (this also gives a stable `aria-label="Account menu"` for test queries + a11y). Avatar becomes the button's child.
  - **Avatar `alt` preservation** — F35 Avatar `<img alt={name}>` keeps role `img` with name = user.name. The `:63-68` `getByRole('img', { name: fullUser.name })` test survives as long as the trigger button wrapping doesn't strip alt.
  - **`handleSignOut` reuse** — wired verbatim to `onSelect`. Radix fires `onSelect` on click + Enter; Radix auto-closes on select. No new auth logic, no routing change (§10).
  - **Mobile panel D11 focus trap** — the avatar-trigger `<button>` is in the right cluster (always visible), NOT inside the mobile slide-down panel. The panel trap (`TABBABLE` selector at `:41-42`) queries only inside `panelRef`, so the avatar dropdown is unaffected. F39 must NOT move the avatar into the panel.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Email fallback (Avatar has no email param) | **Pass `name={user.name || user.email}` to `Avatar`.** | F35 `Avatar` (`Avatar.tsx:10-19`) has NO email param — nameless users hit the generic `User`-icon fallback (`aria-label="Unassigned"`), losing the prior "initials from email local-part" behavior. Feeding `user.name || user.email` as `name` keeps email-local-part initials alive via Avatar's per-word algo ("bob@x.com" → "B"). Avatar's per-word algo handles single-word email local-part → 1 char. (Analyst; F35 Avatar API.) |
| D2 | Theme toggle in menu | **OMIT.** | PRD §4.4 explicitly permits "or omit if in navbar." F40 owns the navbar theme toggle (un-done); including a menu toggle now would duplicate state source (`useTheme` called from two places). F39 does NOT import `useTheme`, renders NO theme item. The F40 seam (`hooks/useTheme.ts`) is documented for F40 to wire. (PRD §4.4 theme-toggle edge.) |
| D3 | Sign-out item variant | **`destructive` (`text-destructive` red text).** | Sign-out is a visual "leaving" signal (red), matching `DropdownItem` `destructive` variant (`Dropdown.tsx:56,65-67`). Sign-out is session-end, NOT data-destruction → NO confirmation modal (per the `confirm-modals` memory, which covers delete/deactivate/promote/demote — not session end). (§3.3; confirm-modals memory.) |
| D4 | Avatar size | **`md` (`h-8 w-8 text-sm`).** | Matches F37's inline avatar visual exactly (`TopNav.tsx:177,180` both `h-8 w-8`); the navbar right cluster has room. F35 `Avatar` size `md` = `h-8 w-8` (`Avatar.tsx:21-25`). (F37 right cluster; F35 size tokens.) |
| D5 | Menu structure | **`<Dropdown>` → `<DropdownTrigger asChild><button aria-label="Account menu"><Avatar src={user.avatarUrl} name={user.name \|\| user.email} size="md" /></button></DropdownTrigger>` → `<DropdownContent>` → `<DropdownLabel>` (header: "Signed in as" + name + email) + `<DropdownSeparator>` + `<DropdownItem variant="destructive" onSelect={handleSignOut}>` (`LogOut` icon + "Sign out").** Inline in TopNav (NO separate `ProfileMenu` component — one-file scope). The trigger `<button>` wrapper is required: Radix `DropdownTrigger asChild` needs a single focusable child; Avatar's roots (`<img>`/`<span>`) aren't focusable/button-like, so a real `<button>` gives Radix a trigger + a stable `aria-label` for tests/a11y. | PRD §4.4 structure ("avatar + name + email ('signed in as')", "Sign out (`LogOut` icon) → existing `handleSignOut`"). §3.3 `LogOut`. F36 `DropdownTrigger asChild` passthrough (`Dropdown.tsx:18-23`). Inline keeps F39 to one file (D6). (§4.4; §3.3; F36 trigger contract.) |
| D6 | Scope | **Only `TopNav.tsx` (swap `avatarBlock` + drop local `getInitials` + import `Avatar`/`Dropdown` parts/`LogOut`) + `TopNav.test.tsx` (update initials per-word, email-fallback via `name \|\| email`, sign-out via `menuitem` open-first, add menu-opens/header/signout-invokes-handleSignOut tests).** | F39 owns ONLY the avatar→profile-menu swap. F36 installed Radix + exports Dropdown; F37 rendered the avatar slot in the right cluster; F35 exports Avatar. No index.css/index.html/main.tsx/AppLayout/theme-toggle/health/scoping/migration/new deps. (Analyst scope finding.) |

> **Out of F39 scope (explicitly deferred):** Theme toggle — **F40** (F39 omits per D2; the `useTheme` seam at `hooks/useTheme.ts` is F40's to wire). Dropdown/Tooltip primitives — **F36 (done)**. Avatar primitive — **F35 (done)**. Navbar layout/right-cluster slot — **F37 (done)**. CSS tokens — **F32 (closed)**. `index.html` no-flash — **F33 (closed)**. HealthBadge — **F41**. Nav scoping — **F42**. Auth flow / `handleSignOut` internals — **untouched (§10)**; F39 only re-points the call site. New deps — none (Radix via F36; lucide `LogOut` via F31; `Avatar` via F35).

> **Owner sign-off needed (defaults chosen, surface in chat):**
> - **D1 → email-as-name fallback** (preserves prior email-local-part initials intent via Avatar's per-word algo). Alternative = drop the fallback (nameless users get the `User` icon). Default = preserve behavior.
> - **D2 → omit theme toggle from menu** (F40 owns; PRD §4.4 permits). Alternative = include a non-wired placeholder. Default = omit (avoid dead UI).
> - **D3 → destructive variant** (red Sign out, no confirmation modal). Alternative = `default` variant. Default = destructive (matches "leaving" intent).

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      └─ components/
         ├─ TopNav.tsx        # MODIFIED — swap avatarBlock (:171-192) for an F36 Dropdown
         │                    #   wrapping an F35 Avatar (md) as the trigger (inside a real
         │                    #   <button aria-label="Account menu">) + DropdownContent
         │                    #   with a DropdownLabel header ("Signed in as" + name + email),
         │                    #   DropdownSeparator, and a destructive DropdownItem "Sign out"
         │                    #   (LogOut icon) calling the existing handleSignOut. DROP the
         │                    #   local getInitials (:33-36) — use F35 Avatar's per-word algo.
         │                    #   Import Avatar from @/components/ui/Avatar, Dropdown parts
         │                    #   from @/components/ui/Dropdown, LogOut from lucide-react.
         │                    #   handleSignOut (:56-65) reused VERBATIM (onSelect). Theme
         │                    #   slot (:213) + hamburger (:215-225) STAY.
         └─ TopNav.test.tsx   # MODIFIED — initials 'AL'→'A', 'BO'→'B' (per-word + D1);
                              #   sign-out tests open menu via pointerDown on the Account-menu
                              #   trigger, then click the menuitem; add menu-opens /
                              #   header-renders / signout-invokes-handleSignOut coverage.
# NO new files. NO ProjectPicker change (F38 owns). NO index.css (F32 closed),
# NO index.html (F33 closed), NO main.tsx, NO AppLayout (F41 owns HealthBadge).
# NO schema migration. NO new deps (Radix via F36; lucide via F31; Avatar via F35).
```

**Data flow:** `TopNav()` reads `user = useAuthStore((s) => s.user)` (existing, `:46`), `clear`, `isAdmin`, `navigate`. `handleSignOut` (`:56-65`) is unchanged. The new `avatarBlock` renders only when `user` is truthy (same guard as today). It mounts `<Dropdown>` → `<DropdownTrigger asChild>` wrapping a `<button aria-label="Account menu">` whose child is `<Avatar src={user.avatarUrl} name={user.name || user.email} size="md" />`. `<DropdownContent align="end">` renders `<DropdownLabel>` showing "Signed in as" + the user's name + email, a `<DropdownSeparator>`, and `<DropdownItem variant="destructive" onSelect={handleSignOut}>` with `<LogOut>` + "Sign out". Radix controls open state (opens on pointerDown, auto-closes on item select / Esc / outside-pointerdown). Clicking Sign out fires `onSelect` → `handleSignOut` → `logout()` → `clear()` → `broadcastLogout()` → `navigate('/login', { replace: true })`.

---

## 5. Parallelization Strategy

F39 is **one component + its co-located test**, tightly coupled (the test imports the component and exercises its new DOM — avatar trigger, menu header, sign-out menuitem). The swap (T1) and the test updates (T2) touch one logical surface; T2's assertions target T1's exact DOM. **Solo sequential track: T1 → T2 → T3 (verify).** No cross-file parallelism is honest for a single-file-pair feature.

### Batch dependency diagram

```
   Batch A (swap)                  Batch B (test)                  Batch C (integration)
   ───────────                     ─────────────                    ─────────────────────
       T1 ─────────────────────────────▶  T2  ─────────────────────────▶  T3
   (TopNav.tsx: swap avatarBlock      (TopNav.test.tsx: update           (verify: exactly 2 files,
    for F36 Dropdown + F35 Avatar      initials 'AL'→'A','BO'→'B',        gate green, no scope
    trigger + header + destructive     sign-out via menuitem-open-first,  leakage, handleSignOut
    Sign out; drop getInitials)        add menu/header/signout tests)     verbatim, theme slot stays)
```

- **Batch A → Batch B** is a hard barrier: T2's new assertions (avatar trigger `aria-label`, `menuitem` role, per-word initials, menu header text) target T1's new DOM; T1 must land first so the test compiles against the swapped component.
- **Batch B → Batch C** is a hard barrier: T3 verifies the merged diff (exactly 2 files), re-runs the full gate, confirms F37's other TopNav tests still pass, confirms `handleSignOut` is verbatim, confirms the theme slot + hamburger are untouched.

### Merge order rules

1. **Batch A merges first.** T1 (`TopNav.tsx` swap) lands the Dropdown+Avatar+header+destructive-Sign-out + drops `getInitials`. Must be on `main` before T2 branches.
2. **Batch B merges second.** T2 (`TopNav.test.tsx`) updates the broken initials/sign-out assertions and adds the menu/header/signout-invokes coverage. Lands after T1.
3. **Batch C (integration verification) merges last.** T3 confirms the committed diff is exactly 2 files, re-runs the full gate, confirms F37 TopNav tests still green, confirms no scope leakage, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/TopNav.tsx` (Modified — swap avatarBlock) | — | — |
| **T2** | B | `frontend/src/components/TopNav.test.tsx` (Modified — fix + add tests) | T1 | — |
| **T3** | C | no files changed (verification gate); records proof in §7 | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 (sequential; single file pair, test imports component).
- **2 devs:** Not recommended — the component + its test are one logical unit; splitting risks the test author guessing at T1's exact DOM. If forced: Dev-A does T1+T2 serially; Dev-B does nothing until T3 (verification).
- **3 devs:** Overkill. One author owns the whole feature end-to-end.

---

## 6. Tasks

### T1 — Swap `avatarBlock` in `TopNav.tsx` for an F36 Dropdown + F35 Avatar profile menu

**Batch:** A · **Depends on:** None (F36 done, F37 done, F35 done) · **Parallel with:** —

**Description:** Replace the `avatarBlock` (`TopNav.tsx:171-192`) — a flat `<div>` with an inline `<img>`/initials-`<span>` plus a floating "Sign out" `<button>` — with an F36 `Dropdown` whose trigger is an F35 `Avatar` (size `md`, D4) wrapped in a real `<button aria-label="Account menu">` (Radix needs a focusable trigger child). The `DropdownContent` renders a `DropdownLabel` header ("Signed in as" + name + email), a `DropdownSeparator`, and a `destructive`-variant `DropdownItem` (D3) with the lucide `LogOut` icon and "Sign out" text, wired `onSelect={handleSignOut}`. **Reuse `handleSignOut` (`:56-65`) VERBATIM** — no auth changes (§10). Drop the local `getInitials` (`:33-36`); F35 Avatar's per-word algo replaces it (D1 — pass `name={user.name || user.email}`). Preserve the F37 right-cluster structure: theme slot (`:213`, F40) + hamburger (`:215-225`) stay byte-for-byte; only `{avatarBlock}` is swapped. **OMIT the theme toggle** (D2 — no `useTheme` import, no theme item). Inline in TopNav (no `ProfileMenu` component — D5/D6). Token utilities only (no raw colors, no `dark:`).

**Modify** `frontend/src/components/TopNav.tsx`:

Imports (replace `:3` lucide import; add Avatar + Dropdown parts):
```typescript
import { Layers, LayoutGrid, BarChart3, Settings, LogOut } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownLabel,
    DropdownSeparator,
    DropdownItem,
} from '@/components/ui/Dropdown';
```

Delete the local `getInitials` (`:33-36` — gone entirely; F35 Avatar owns initials now):
```typescript
// DELETED:
// function getInitials(name: string, email: string): string { ... }
```

Replace `avatarBlock` (`:171-192`):
```typescript
    // F39 — Avatar → profile Dropdown. The inline img/initials + flat "Sign out"
    // button (F37) is replaced by an F36 Dropdown whose trigger is an F35 Avatar
    // (md, D4). Header: "Signed in as" + name + email. Sign out is a destructive
    // DropdownItem (D3) calling the existing handleSignOut VERBATIM (§10 untouched).
    // Theme toggle OMITTED (D2 — F40 owns the navbar toggle; PRD §4.4 permits).
    const avatarBlock = user && (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    aria-label="Account menu"
                    aria-haspopup="menu"
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Avatar
                        src={user.avatarUrl}
                        name={user.name || user.email}
                        size="md"
                    />
                </button>
            </DropdownTrigger>
            <DropdownContent align="end" className="min-w-[14rem]">
                <DropdownLabel>
                    <div className="flex items-center gap-2">
                        <Avatar
                            src={user.avatarUrl}
                            name={user.name || user.email}
                            size="sm"
                        />
                        <div className="flex flex-col">
                            <span className="text-xs font-normal text-muted-foreground">
                                Signed in as
                            </span>
                            <span className="text-sm font-semibold text-foreground">
                                {user.name || user.email}
                            </span>
                            <span className="truncate text-xs font-normal text-muted-foreground">
                                {user.email}
                            </span>
                        </div>
                    </div>
                </DropdownLabel>
                <DropdownSeparator />
                <DropdownItem variant="destructive" onSelect={handleSignOut}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    <span>Sign out</span>
                </DropdownItem>
            </DropdownContent>
        </Dropdown>
    );
```

> **Key correctness notes for the implementer:**
> - **`handleSignOut` VERBATIM** — do NOT touch `:56-65`. F39 only re-points the call site from `onClick` to `onSelect`. Radix fires `onSelect` on click + Enter and auto-closes the menu. No new auth logic (§10).
> - **Drop `getInitials`** (`:33-36`) entirely — nothing else in TopNav uses it. F35 Avatar's per-word algo (`Avatar.tsx:34-42`) replaces it: "Ada Lovelace"→"AL", "munna"→"M", "bob@x.com"→"B". This is what changes the `'AL'`/`'BO'` test assertions in T2.
> - **D1 email fallback:** pass `name={user.name || user.email}` to BOTH the trigger Avatar AND the header Avatar. When `user.name` is empty, email becomes the initials source ("bob@x.com"→"B") instead of hitting Avatar's generic `User`-icon fallback.
> - **Trigger wrapper is a real `<button>`** — Radix `DropdownTrigger asChild` needs a single focusable child. Avatar's roots (`<img>`/`<span>`) aren't focusable, so the `<button>` gives Radix a trigger + a stable `aria-label="Account menu"` for test queries + a11y. `rounded-full` + focus-ring keep the avatar's circle shape and add keyboard focus visibility.
> - **D2 OMIT theme toggle** — do NOT import `useTheme`, do NOT render a theme `DropdownItem`. The F37 theme slot (`:213`) stays as F40's placeholder.
> - **D3 destructive variant** — `variant="destructive"` applies `text-destructive` (red) to the Sign out item (`Dropdown.tsx:65-67`). NO confirmation modal (sign-out is session-end, not delete/deactivate — confirm-modals memory).
> - **D5 inline** — keep this inside `TopNav`; do NOT create `ProfileMenu.tsx`. One-file scope (D6).
> - **Right-cluster preservation** — the theme slot (`:213`) and hamburger (`:215-225`) are UNCHANGED. Only `{avatarBlock}` (`:214`) is swapped. F37's layout, gutter, clusters, mobile panel (D11) all stay.
> - **Token utilities only** — `bg-*`/`text-*`/`border-*` token classes; no raw colors, no `dark:` classes. The Dropdown primitives already carry their own tokens (`bg-popover`, `text-destructive`, `bg-border`).
> - **No `any`**; `user` is already typed `AuthUser | null` via `useAuthStore`; `avatarBlock` guards on `user &&`. Functions <50 lines. 4-space JSX / 2-space TS. ≤100 cols. Trailing commas. Import order: external (react-router, lucide) → internal (`@/…`) → relative (`./ProjectPicker`).

**Acceptance Criteria:**
- [ ] `TopNav.tsx` imports `LogOut` from `lucide-react`; `Avatar` from `@/components/ui/Avatar`; `Dropdown`, `DropdownTrigger`, `DropdownContent`, `DropdownLabel`, `DropdownSeparator`, `DropdownItem` from `@/components/ui/Dropdown`.
- [ ] Local `getInitials` (`:33-36`) DELETED (grep-clean); no other call site in the file.
- [ ] `avatarBlock` swapped: renders `<Dropdown>` → `<DropdownTrigger asChild>` wrapping a `<button aria-label="Account menu">` whose child is `<Avatar src={user.avatarUrl} name={user.name || user.email} size="md" />` → `<DropdownContent align="end">` with `<DropdownLabel>` (header: "Signed in as" + name + email, with a `sm` Avatar), `<DropdownSeparator>`, `<DropdownItem variant="destructive" onSelect={handleSignOut}>` (`<LogOut>` + "Sign out").
- [ ] `handleSignOut` (`:56-65`) UNCHANGED — same `try/catch` + `clear()` + `broadcastLogout()` + `navigate('/login', { replace: true })`.
- [ ] NO `useTheme` import; NO theme `DropdownItem` (D2 omit).
- [ ] F37 right-cluster preserved: theme slot `<div data-slot="theme" aria-hidden="true" />` + hamburger `<button … aria-label="Toggle navigation">` UNCHANGED.
- [ ] `avatarBlock` still guards on `user &&` (renders nothing when logged out — same as today).
- [ ] No `any`; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; token utilities only (no raw colors, no `dark:`).
- [ ] `ProjectPicker.tsx`, `index.css`, `index.html`, `main.tsx`, `AppLayout.tsx`, `Avatar.tsx`, `Dropdown.tsx`, `package.json` NOT modified.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** F36 (Dropdown — done); F35 (Avatar — done); F31 (`lucide-react` `LogOut`); existing `useAuthStore`/`handleSignOut`.

---

### T2 — Update `TopNav.test.tsx` (fix initials + sign-out-via-menuitem, add menu/header/signout-invokes tests)

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** T1 breaks three assertions in `TopNav.test.tsx`: the `'AL'` initials test (`:74`) — F35 Avatar's per-word algo makes "Alice" → `"A"`; the `'BO'` email-fallback test (`:87`) — D1 makes "bob@x.com" → `"B"`; and both sign-out tests (`:90-103`, `:105-118`) — Sign out is now a `DropdownItem` (`role="menuitem"`) inside a Radix menu that opens on `pointerDown`. Update those three, then ADD coverage for the new menu: menu opens on avatar-trigger `pointerDown`, header renders "Signed in as" + name + email, and the Sign out `menuitem` invokes `handleSignOut` (the PRD §8 "Profile menu: opens, Sign out calls `handleSignOut`" case). Use the confirmed Radix open pattern: `fireEvent.pointerDown(trigger, { button: 0 })` (PointerEvent polyfill at `src/test-setup.ts:10`; mirrored from `Dropdown.test.tsx:46` + `ProjectPicker.test.tsx:134`). The avatar-trigger `<button aria-label="Account menu">` (D5) gives a stable query handle for both img-avatar and initials-avatar cases.

**Modify** `frontend/src/components/TopNav.test.tsx`:

Update the initials assertions (`:70-76`):
```typescript
    it('renders initials when avatarUrl is null', () => {
        useAuthStore.getState().setUser({ ...fullUser, avatarUrl: null, name: 'Alice' });
        renderTopNav();

        // F39 — F35 Avatar per-word algo: single-word "Alice" → "A" (was per-name-char "AL").
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.queryByRole('img')).toBeNull();
    });
```

Update the email-fallback assertions (`:78-88`):
```typescript
    it('initials fall back to email local-part when name empty', () => {
        useAuthStore.getState().setUser({
            ...fullUser,
            name: '',
            email: 'bob@x.com',
            avatarUrl: null,
        });
        renderTopNav();

        // F39 — D1: F35 Avatar has no email param; TopNav passes name={user.name||user.email},
        // so "bob@x.com" becomes the initials source. Per-word algo → "B" (was per-name-char "BO").
        expect(screen.getByText('B')).toBeInTheDocument();
    });
```

Update the sign-out tests (`:90-103`, `:105-118`) — open the menu via `pointerDown` on the `Account menu` trigger, then `click` the `menuitem`:
```typescript
    it('Sign out menu item calls logout + clear + navigate', async () => {
        logoutMock.mockResolvedValue(undefined);
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // F39 — Sign out is now a DropdownItem (role="menuitem") inside a Radix menu.
        // Radix opens on pointerDown (jsdom + PointerEvent polyfill at test-setup.ts:10).
        const trigger = screen.getByRole('button', { name: 'Account menu' });
        await act(async () => {
            fireEvent.pointerDown(trigger, { button: 0 });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
        });

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().user).toBeNull();
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('clears local state + navigates even when logout rejects', async () => {
        logoutMock.mockRejectedValue(new Error('500'));
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        const trigger = screen.getByRole('button', { name: 'Account menu' });
        await act(async () => {
            fireEvent.pointerDown(trigger, { button: 0 });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
        });

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().user).toBeNull();
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });
```

ADD new tests (after the sign-out tests, before the brand/cluster tests — covers PRD §8 "Profile menu: opens, Sign out calls `handleSignOut`"):
```typescript
    // --- F39 profile-menu coverage (PRD §8) ------------------------------------

    it('profile menu opens on avatar trigger pointerDown (menu role appears)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        const trigger = screen.getByRole('button', { name: 'Account menu' });
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        fireEvent.pointerDown(trigger, { button: 0 });

        expect(screen.getByRole('menu')).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('profile menu header shows "Signed in as" + name + email', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        expect(screen.getByText('Signed in as')).toBeInTheDocument();
        expect(screen.getByText(fullUser.name)).toBeInTheDocument();
        expect(screen.getByText(fullUser.email)).toBeInTheDocument();
    });

    it('Sign out menu item invokes handleSignOut (logout + clear + broadcast + navigate)', async () => {
        logoutMock.mockResolvedValue(undefined);
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
        });

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().user).toBeNull();
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('Sign out menu item uses the destructive variant (text-destructive)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        const signOutItem = screen.getByRole('menuitem', { name: /Sign out/ });
        expect(signOutItem.className).toContain('text-destructive');
    });

    it('does NOT render the floating "Sign out" button (replaced by the menu)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // Menu is closed → the only "Sign out" affordance is inside the closed menu
        // (not queryable as a button). The old flat <button> is gone.
        expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });

    it('avatar trigger has aria-label="Account menu" (a11y + test contract)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    });
```

> **Test notes:**
> - The `'AL'`→`'A'` and `'BO'`→`'B'` updates are the direct consequence of T1 dropping the local `getInitials` (per-name-char) and adopting F35 Avatar's per-word algo + D1 (`name={user.name || user.email}`). Single-word inputs now yield a single character.
> - Both sign-out tests switch from `getByRole('button', { name: 'Sign out' })` to open-the-menu-then-`getByRole('menuitem', { name: /Sign out/ })`. The open step uses `fireEvent.pointerDown(trigger, { button: 0 })` — the confirmed Radix-open pattern (PointerEvent polyfill at `test-setup.ts:10`; mirrored from `Dropdown.test.tsx:46` + `ProjectPicker.test.tsx:134`). The trigger is queried as `getByRole('button', { name: 'Account menu' })` (D5's `aria-label`) — stable for both img-avatar and initials-avatar cases.
> - The `:63-68` `'renders avatar img when avatarUrl is set'` test (`getByRole('img', { name: fullUser.name })`) **survives unchanged** — F35 Avatar's `<img alt={name}>` keeps role `img` with name "Demo User", and the `<button>` wrapper doesn't strip alt. (Re-verify in T3.)
> - The 6 added tests cover PRD §8 ("Profile menu: opens, Sign out calls `handleSignOut`"): menu opens (`menu` role + `aria-expanded`), header renders "Signed in as" + name + email, Sign out invokes `handleSignOut` (full chain: logout + clear + broadcast + navigate), destructive variant (`text-destructive`), the old floating button is gone, and the trigger has a stable `aria-label`.
> - `vi.hoisted` mocks (`:8-12`) + `vi.mock` for `@/api/auth` / `@/hooks/useCrossTabLogout` / `useProjects` / `react-router` are unchanged — they already cover `handleSignOut`'s deps. `act` wraps the pointerDown+click sequence because `handleSignOut` is async (`await logout()`).
> - js-testing-rules: `getByRole` priority (menuitem, button, img, text), `vi.fn()` mocks, components >70% — the new tests push TopNav coverage past the avatar-menu surface.

**Acceptance Criteria:**
- [ ] `'renders initials when avatarUrl is null'` asserts `getByText('A')` (per-word, was `'AL'`).
- [ ] `'initials fall back to email local-part when name empty'` asserts `getByText('B')` (D1 email-as-name, was `'BO'`).
- [ ] Both sign-out tests open the menu via `fireEvent.pointerDown(getByRole('button', { name: 'Account menu' }), { button: 0 })`, then `fireEvent.click(getByRole('menuitem', { name: /Sign out/ }))`; assertions unchanged (logout + clear + broadcast + navigate).
- [ ] NEW: `'profile menu opens on avatar trigger pointerDown'` — `menu` role present + `aria-expanded="true"` + `aria-haspopup="menu"` on trigger.
- [ ] NEW: `'profile menu header shows "Signed in as" + name + email'`.
- [ ] NEW: `'Sign out menu item invokes handleSignOut'` — full chain (logout + clear + broadcast + navigate).
- [ ] NEW: `'Sign out menu item uses the destructive variant'` — `text-destructive` in className.
- [ ] NEW: `'does NOT render the floating "Sign out" button'` — `queryByRole('button', { name: 'Sign out' })` is null (menu closed).
- [ ] NEW: `'avatar trigger has aria-label="Account menu"'`.
- [ ] The `:63-68` `'renders avatar img when avatarUrl is set'` test still passes unchanged (img role + name survives the trigger wrapper).
- [ ] All other F37 tests (brand, clusters, nav, Settings, picker-left, mobile panel) unchanged and passing.
- [ ] `npm run test -w frontend -- TopNav.test.tsx` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.

**Dependencies:** T1.

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the 2 F39 files (`TopNav.tsx` modified + `TopNav.test.tsx` modified), re-run the full gate green, confirm `handleSignOut` is byte-for-byte unchanged (§10), confirm F37's other TopNav tests still pass, confirm no scope leakage (no ProjectPicker/index.css/index.html/main.tsx/AppLayout/Avatar/Dropdown/theme-toggle/health/scoping/migration/new-deps), and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the F39 files:
   ```bash
   git diff --name-only main...HEAD | sort
   # Expected (exactly 2):
   # frontend/src/components/TopNav.test.tsx
   # frontend/src/components/TopNav.tsx
   ```
   Any other path (a `ProjectPicker.tsx` edit, an `index.css` edit, an `Avatar.tsx`/`Dropdown.tsx` edit, a `main.tsx`/`AppLayout.tsx` edit, a new `ProfileMenu.tsx`, a schema migration, a Radix/lucide install) → leaked; remove and re-commit. F39 owns only the avatar→profile-menu swap + its test.
2. Re-run the full gate on the merged state:
   ```bash
   npm install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. TopNav.test.tsx + F38 ProjectPicker regression)
   ```
3. Confirm scope-boundary files are **unchanged** vs main:
   ```bash
   for f in frontend/src/components/ProjectPicker.tsx frontend/src/index.css \
            frontend/index.html frontend/src/main.tsx frontend/src/components/AppLayout.tsx \
            frontend/src/components/ui/Avatar.tsx frontend/src/components/ui/Dropdown.tsx \
            frontend/package.json; do
     git diff --quiet main...HEAD -- "$f" \
       && echo "$f: UNCHANGED" \
       || echo "$f: CHANGED (out of scope — revert)"
   done
   ```
   All must print UNCHANGED. (`ProjectPicker.tsx` — F38 owns; `index.css` — F32 closed; `index.html` — F33 closed; `main.tsx` — F39 uninvolved; `AppLayout.tsx` — F41 owns HealthBadge; `Avatar.tsx` — F35 owns the primitive; `Dropdown.tsx` — F36 owns the primitive; `package.json` — Radix via F36, lucide `LogOut` via F31, no new deps.)
4. Confirm `handleSignOut` is **verbatim** (§10 auth untouched):
   ```bash
   git diff main...HEAD -- frontend/src/components/TopNav.tsx | grep -E '^[-+].*(await logout|clear\(\)|broadcastLogout|navigate\(.\/login)'
   ```
   Must show NO `-`/`+` lines touching the `handleSignOut` body (only the call-site move from `onClick` to `onSelect` is allowed). If the body changed, revert to the F37 version and re-point only the call site.
5. Confirm the local `getInitials` is GONE (F35 Avatar owns initials now):
   ```bash
   grep -n "function getInitials" frontend/src/components/TopNav.tsx \
     && echo "BUG: local getInitials still present (should use F35 Avatar)" \
     || echo "getInitials dropped: OK"
   ```
6. Confirm the F39 wiring is present:
   ```bash
   grep -E "import \{ Layers, LayoutGrid, BarChart3, Settings, LogOut \} from 'lucide-react'" frontend/src/components/TopNav.tsx
   grep -E "import \{ Avatar \} from '@/components/ui/Avatar'" frontend/src/components/TopNav.tsx
   grep -E "Dropdown, DropdownTrigger, DropdownContent, DropdownLabel, DropdownSeparator, DropdownItem" frontend/src/components/TopNav.tsx
   grep -n 'aria-label="Account menu"' frontend/src/components/TopNav.tsx
   grep -n 'variant="destructive" onSelect={handleSignOut}' frontend/src/components/TopNav.tsx
   grep -n 'Signed in as' frontend/src/components/TopNav.tsx
   grep -n 'name={user.name || user.email}' frontend/src/components/TopNav.tsx
   ```
   All must match.
7. Confirm D2 (theme toggle OMITTED — no `useTheme` import, no theme item):
   ```bash
   grep -n "useTheme" frontend/src/components/TopNav.tsx \
     && echo "BUG: useTheme imported (D2 says OMIT)" || echo "theme toggle omitted (D2): OK"
   grep -ni "theme" frontend/src/components/TopNav.tsx | grep -v "data-slot=\"theme\"" \
     && echo "REVIEW: unexpected theme reference" || echo "no theme item (only F40 slot): OK"
   ```
   Both must print OK. (The F37 theme slot `<div data-slot="theme" aria-hidden="true" />` is the only allowed `theme` reference — it's F40's placeholder, unchanged.)
8. Confirm the F37 right-cluster is preserved (theme slot + hamburger UNCHANGED):
   ```bash
   grep -n 'data-slot="theme" aria-hidden="true"' frontend/src/components/TopNav.tsx
   grep -n 'aria-label="Toggle navigation"' frontend/src/components/TopNav.tsx
   ```
   Both must match (the theme slot + mobile hamburger are still there).
9. Confirm the test updates landed (initials per-word + email-fallback + sign-out-via-menuitem + new menu tests):
   ```bash
   grep -nE "getByText\('A'\)|getByText\('B'\)" frontend/src/components/TopNav.test.tsx
   grep -nE "getByRole\('button', \{ name: 'Account menu' \}\)" frontend/src/components/TopNav.test.tsx
   grep -nE "getByRole\('menuitem', \{ name: /Sign out/ \}\)" frontend/src/components/TopNav.test.tsx
   grep -nE "fireEvent.pointerDown.*Account menu" frontend/src/components/TopNav.test.tsx
   grep -n "Signed in as" frontend/src/components/TopNav.test.tsx
   grep -n "text-destructive" frontend/src/components/TopNav.test.tsx
   grep -n 'name: .Account menu.' frontend/src/components/TopNav.test.tsx
   ```
   All must match.
10. Confirm token-only classes (no raw colors, no `dark:` color classes) in the F39-added code:
    ```bash
    grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' frontend/src/components/TopNav.tsx \
      && echo "RAW COLOR FOUND (BUG — must use tokens)" || echo "token-only: OK"
    grep -REn 'dark:(bg|text|border)-' frontend/src/components/TopNav.tsx \
      && echo "dark: color class FOUND (BUG — tokens carry theme)" || echo "no dark: color classes: OK"
    ```
    Both must print OK.
11. Capture commit SHA, exit codes, test counts into §7. Confirm D1/D2/D3 owner sign-offs (email-as-name fallback / omit theme toggle / destructive variant) — surface defaults before merge.

**Acceptance Criteria:**
- [ ] Committed diff is exactly 2 files: `TopNav.tsx`, `TopNav.test.tsx` — no ProjectPicker/index.css/index.html/main.tsx/AppLayout/Avatar/Dropdown/package.json/migration/ProfileMenu/Radix-install leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `TopNav.test.tsx` + F38 `ProjectPicker.test.tsx` regression).
- [ ] `handleSignOut` body byte-for-byte unchanged (§10 auth untouched); only the call site moved `onClick`→`onSelect`.
- [ ] Local `getInitials` dropped (F35 Avatar owns initials).
- [ ] F39 wiring present: `LogOut` + `Avatar` + 6 Dropdown imports; `aria-label="Account menu"`; `variant="destructive" onSelect={handleSignOut}`; "Signed in as" header; `name={user.name || user.email}` (D1).
- [ ] D2 confirmed: no `useTheme` import, no theme item (only the F40 theme-slot placeholder remains).
- [ ] F37 right-cluster preserved: theme slot + hamburger UNCHANGED.
- [ ] Test updates landed: `'A'`/`'B'` initials; `Account menu` trigger; `menuitem` `/Sign out/`; `pointerDown` open; "Signed in as"; `text-destructive`.
- [ ] Token-only classes (no raw colors, no `dark:`).
- [ ] All F39 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] D1/D2/D3 owner sign-offs recorded.

**Dependencies:** T1, T2.

---

## 7. Final F39 Acceptance Checklist

- [ ] **Avatar opens the Dropdown** (F36) — trigger is `<DropdownTrigger asChild>` wrapping a `<button aria-label="Account menu">` + F35 `<Avatar size="md">`.
- [ ] **Header** renders avatar + "Signed in as" + name + email (`DropdownLabel`).
- [ ] **Sign out `DropdownItem`** (`variant="destructive"`, `LogOut` icon) calls the **existing `handleSignOut`** (no new auth logic — §10).
- [ ] **Floating "Sign out" text button removed** from `TopNav` (replaced by the menu item).
- [ ] **D1 email fallback** — `name={user.name || user.email}` to Avatar (preserves email-local-part initials via per-word algo).
- [ ] **D2 theme toggle OMITTED** — no `useTheme`, no theme item (F40 owns the navbar toggle; PRD §4.4 permits).
- [ ] **D3 destructive variant** — Sign out item is red (`text-destructive`); NO confirmation modal (session-end, not delete).
- [ ] **D4 Avatar size `md`** (`h-8 w-8`) — matches F37's inline avatar.
- [ ] **D5 inline** — no `ProfileMenu.tsx`; the menu lives inside `TopNav`.
- [ ] F37 right-cluster preserved (theme slot + hamburger UNCHANGED); mobile D11 panel unaffected.
- [ ] Local `getInitials` dropped (F35 Avatar per-word algo replaces it).
- [ ] `TopNav.test.tsx` updated: `'A'`/`'B'` initials; sign-out via `pointerDown`-open + `menuitem` click; +6 new menu/header/signout/destructive/no-flat-button/aria-label tests.
- [ ] No `any`; explicit interfaces; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order.
- [ ] `ProjectPicker.tsx`, `index.css`, `index.html`, `main.tsx`, `AppLayout.tsx`, `Avatar.tsx`, `Dropdown.tsx`, `package.json` unchanged.
- [ ] No new deps (Radix via F36; lucide `LogOut` via F31; `Avatar` via F35).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. `TopNav.test.tsx` + F38 ProjectPicker regression).
- [ ] Committed diff is exactly 2 files (`TopNav.tsx` + `TopNav.test.tsx`).
- [ ] Commit message single-line `SLYK-F39: <message>`; branch `feature/SLYK-redesign-f39-avatar-profile-dropdown`; rebase-and-merge only.

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- Diff = exactly 2 files (`TopNav.tsx` modified, `TopNav.test.tsx` modified); no ProjectPicker/CSS/index.html/main.tsx/AppLayout/Avatar/Dropdown/package.json/migration/ProfileMenu/Radix-install leakage: `PASS/FAIL`
- `handleSignOut` body byte-for-byte unchanged (§10 auth untouched): `PASS/FAIL`
- Local `getInitials` dropped (F35 Avatar owns initials): `PASS/FAIL`
- `LogOut` imported from `lucide-react`: `PASS/FAIL`
- `Avatar` imported from `@/components/ui/Avatar`: `PASS/FAIL`
- 6 F36 Dropdown imports present (`Dropdown, DropdownTrigger, DropdownContent, DropdownLabel, DropdownSeparator, DropdownItem`): `PASS/FAIL`
- Trigger `<button aria-label="Account menu">` wrapping `<Avatar size="md">`: `PASS/FAIL`
- Header "Signed in as" + name + email (`DropdownLabel`): `PASS/FAIL`
- Sign out `variant="destructive" onSelect={handleSignOut}` (`LogOut` icon): `PASS/FAIL`
- D1 `name={user.name || user.email}` (email fallback): `PASS/FAIL`
- D2 theme toggle OMITTED (no `useTheme`, only F40 slot placeholder): `PASS/FAIL`
- D3 destructive variant — no confirmation modal: `PASS/FAIL`
- F37 theme slot + hamburger UNCHANGED: `PASS/FAIL`
- `TopNav.test.tsx` result: `__/__ pass` (initials `'A'`/`'B'`, sign-out ×2 via menuitem-open-first, +6 new: opens/header/signout-invokes/destructive/no-flat-button/aria-label, plus the 12 unaffected F37 tests)
- `:63-68` `'renders avatar img'` test still passes (img role + alt survives trigger wrapper): `PASS/FAIL`
- F38 `ProjectPicker.test.tsx` result: `__/__ pass` (regression — F39 didn't touch the picker)
- No raw colors / no `dark:` color classes in F39-added code: `token-only: OK`
- `ProjectPicker.tsx` vs main: `UNCHANGED (F38 preserved)`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- `index.html` vs main: `UNCHANGED (F33 preserved)`
- `main.tsx` vs main: `UNCHANGED`
- `AppLayout.tsx` vs main: `UNCHANGED (F41 preserved)`
- `Avatar.tsx` vs main: `UNCHANGED (F35 preserved)`
- `Dropdown.tsx` vs main: `UNCHANGED (F36 preserved)`
- `package.json` vs main: `UNCHANGED (Radix via F36, lucide via F31 — no new deps)`
- New deps added by F39: `0`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- D1 owner sign-off (email-as-name fallback vs drop): `recorded (date: ________)`
- D2 owner sign-off (omit theme toggle vs placeholder): `recorded (date: ________)`
- D3 owner sign-off (destructive variant vs default): `recorded (date: ________)`

---

## 8. Schema deltas owned by this feature

F39 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance), **no CSS token additions** (F32 owns and has closed those — `index.css` is frozen), **no `index.html` change** (F33 owns the no-flash bootstrap), **no `main.tsx` change** (F39 uninvolved), **no `AppLayout.tsx` change** (F41 owns `<HealthBadge />`), **no `ProjectPicker.tsx` change** (F38 owns), and **no primitive changes** (`Avatar.tsx` is F35; `Dropdown.tsx` is F36 — both frozen). F39 adds **no new dependencies** (Radix via F36; `lucide-react` `LogOut` via F31; `Avatar` via F35). F39 touches only `frontend/src/components/TopNav.tsx` (avatar block swapped) + `frontend/src/components/TopNav.test.tsx` (assertions updated + tests added) — a component edit + its test, no schema surface.

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| No `main.tsx` change | None — F39 does not mount providers | `frontend/src/main.tsx` unchanged |
| No `AppLayout.tsx` change | None — F41 owns `<HealthBadge />` | `frontend/src/components/AppLayout.tsx` unchanged |
| No `ProjectPicker.tsx` change | None — F38 owns the picker | `frontend/src/components/ProjectPicker.tsx` unchanged |
| No `Avatar.tsx` / `Dropdown.tsx` change | None — F35/F36 own the primitives (frozen) | `frontend/src/components/ui/Avatar.tsx`, `Dropdown.tsx` unchanged |
| No new dependencies | Radix via F36; `lucide-react` `LogOut` via F31; `Avatar` via F35 | `frontend/package.json` unchanged |
| Avatar → profile Dropdown swap | `avatarBlock` (`TopNav.tsx:171-192`) replaced by F36 `Dropdown` (Avatar trigger via `<button aria-label="Account menu">` + `DropdownContent` header "Signed in as" + destructive `DropdownItem` "Sign out" with `LogOut` icon, `onSelect={handleSignOut}`). Local `getInitials` dropped (F35 Avatar per-word replaces it). `handleSignOut` reused verbatim. Theme toggle omitted (D2 — F40 owns). | `frontend/src/components/TopNav.tsx` modified |
| Test updates + additions | Initials `'AL'`→`'A'`, `'BO'`→`'B'` (per-word + D1); sign-out tests open menu via `pointerDown` on `Account menu` trigger, then click `menuitem`; +6 new tests (menu opens, header renders, signout invokes `handleSignOut`, destructive variant, no floating button, trigger `aria-label`). | `frontend/src/components/TopNav.test.tsx` modified |
