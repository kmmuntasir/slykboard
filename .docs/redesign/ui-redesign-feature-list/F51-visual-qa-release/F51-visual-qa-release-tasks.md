# F51 — Light/dark visual QA across all routes + ship redesign release: Plan + Task Breakdown

> **Feature:** F51 — The terminal feature of the UI-redesign track (F31–F51). Prove the redesign renders correctly in **both** themes on **every** route + state, then cut a release.
> **Feature index:** [`../ui-redesign-features.md`](../ui-redesign-features.md) (lines 406-417)
> **Slug:** `SLYK` · **Depends on:** F50 (gate green — terminal precondition) · **PRD ref:** §7 Phase 4 T4.3, §8 (visual pass)
> **Sources:** [`../ui-redesign-features.md`](../ui-redesign-features.md), [`../../ui-redesign-plan.md`](../../ui-redesign-plan.md) §7-§8, `.claude/rules/git-guidelines.md`, `frontend/src/routes/index.tsx` (route list), `frontend/src/components/{ThemeProvider,ThemeToggle,TopNav}.tsx`, `frontend/src/components/ui/{Dropdown,Tooltip}.tsx` (Radix portal `.dark` wiring), `frontend/index.html` (F33 no-flash script), `scripts/merge-gate.sh`, `Makefile`.

---

## 1. F51 Recap

**Goal:** Close the redesign loop. Two deliverables: (a) a signed-off visual-QA pass that exercises every route + every named state in **light and dark**, and (b) a release.

**Ships:**
- A documented light + dark visual-QA checklist covering all 7 routes + the ticket modal, confirm dialogs, and empty/error/loading states (§4).
- Radix-portal `.dark` inheritance spot-check — the risk F36 opened (portals render to `document.body`, outside any wrapper a naive `.dark .x {}` selector would miss). F32/F36 mitigated it via `@custom-variant dark` + `:where(.dark, .dark *)` zero-specificity mapping; F51 confirms the mitigation holds on the live dropdowns/tooltips/modals.
- No-flash verification on hard refresh in both themes — closes the loop F33 opened (the `<head>` pre-paint script must equal React's first render).
- Gate re-run green (F50 owns the gate definition; F51 re-confirms it at release time).
- Release tagged per `git-guidelines.md` (branch `release/x.y.z`, version only — no ticket, no description).

**Acceptance (definition of done):**
- §4 checklist fully executed and marked PASS for both themes.
- §5 portal `.dark` spot-check PASS for both themes.
- §6 no-flash check PASS for both themes.
- `./scripts/merge-gate.sh all` (== `make gate`) exits 0 — all 5 stages green at release time.
- Release tagged (see §7 — tagging is the **owner's** manual step per `.claude/rules/git-guidelines.md`; this doc records readiness, not the tag itself).

**Edge cases / scope guards:**
- This is the QA/release capstone — it maps to no single PRD REQ but is justified as the implied T4.3 visual pass + the §7 "independently shippable" deployment gate.
- F51 is **not** a bug-fix feature. Any real visual defect found during QA is filed against its **owning** feature (F32 owns token contrast, F37 owns navbar, F43 owns Modal, F44 owns the form, F49 owns Reports surfaces, etc.) and fixed there. F51 owns only the checklist + the release.
- This is an **automated** pipeline (no manual browser QA). The checklist below is the artifact a human owner walks through post-merge or in a staging preview; the gate-green result is the machine-verifiable signal the automation can produce.
- Screenshots (before/after Board + Create modal) are an owner/manual step — captured out-of-band and attached to the release, not committed here.

---

## 2. Decisions (resolved)

- **D1 — F51 produces a checklist, not a test.** Visual QA is inherently human-judgment (contrast, spacing, "does this look right"). An automated screenshot-diff harness is out of scope (deferred — would need a Percy/Chromatic-style baseline infra). The deliverable is the documented checklist + the machine-verifiable gate.
- **D2 — Gate re-run is a precondition, not the deliverable.** F50 owns the gate. F51 re-runs it at release time and records the result, but does not redefine or modify the gate script.
- **D3 — Tagging is the owner's manual step.** Per `.claude/rules/git-guidelines.md` ("NEVER run `git` command without the user's explicit approval") and the merge policy (rebase-and-merge only, no local merges), the release branch + tag are cut by the owner. This doc records readiness + the exact commands; it does not execute them.
- **D4 — Version number is the owner's call.** The redesign is a non-breaking visual refresh (no API contract changes; the only BE change is Reports-scoping which already shipped behind redirects in F48/F49). Whether that is a minor (`0.x → 0.x+1`) or patch is a release-management decision, not an engineering one. §7 leaves the version as `x.y.z`.
- **D5 — Portal `.dark` check is live, not theoretical.** The risk F36 flagged is a real one (a portal child renders to `document.body`; if `.dark` were ever moved off `<html>` or if a component used a scoped `.dark .x` selector, the portalled content would render light-on-light). F51's spot-check opens an actual Dropdown / Tooltip / Modal in dark mode and confirms the popover background resolves to `--popover` (dark), not the light `--card`.

---

## 3. Tasks (T1–T3)

### T1 — Write the visual-QA + release task doc (this file)
**Status:** ✅ Done
- Catalogued all routes from `frontend/src/routes/index.tsx` (§4.1).
- Catalogued all named states (empty / error / loading / forbidden / 404) from the component inventory.
- Recorded the portal `.dark` spot-check method (§5) and the no-flash method (§6).
- Recorded release-readiness + tagging commands (§7).

### T2 — Re-run the full gate end-to-end and confirm green
**Status:** ✅ Done — `./scripts/merge-gate.sh all` exits 0; all 5 stages PASS. See §8 for the result block.

### T3 — Document release readiness
**Status:** ✅ Done — §7 records the gate-green result, the deferred owner steps (tagging, screenshots, version bump), and the exact release commands. No `git` commands are executed by F51.

---

## 4. Visual-QA checklist (light + dark)

**Method:** For each row, load the route in a browser, toggle the theme via the F40 `ThemeToggle` (and verify persistence across reload via `slykboard-theme` localStorage), and confirm the visual contract below holds in **both** light and dark. The `@custom-variant dark` + `:where(.dark, .dark *)` mapping (F32) means every semantic token (`bg-card`, `bg-popover`, `text-muted-foreground`, `border`, `text-destructive`, etc.) must resolve to its dark value when `.dark` is on `<html>`.

**Routes are enumerated from `frontend/src/routes/index.tsx`.** All authenticated routes render inside `AppLayout` (full-width gutter + navbar clusters — F37) and the `RouteErrorBoundary`.

### 4.1 Routes (7)

| # | Route | Page component | QA focus (both themes) | Light | Dark |
|---|---|---|---|---|---|
| 1 | `/login` | `LoginPage` | Centred card on themed background; Google button; no navbar (outside `RequireAuth`). Form text + error toast contrast. | ☐ | ☐ |
| 2 | `/projects` | `ProjectsPage` | Empty-state ("Select a project" placeholder per D13) + populated grid of project cards. Card bg = `--card`, text = `--card-foreground`. Create link visible. | ☐ | ☐ |
| 3 | `/projects/:slug` | `BoardPage` | Full-width board; columns bg = `--card`-family; `TicketCard` uses `--card`/`--foreground`/`--border`. Health badge (F41) in navbar. Project picker (F38) in navbar shows current project. | ☐ | ☐ |
| 4 | `/projects/:slug/settings` | `ProjectSettingsPage` | Settings card; label manager + project-columns manager use `--popover` for their dropdowns. Admin-only surfaces gated. | ☐ | ☐ |
| 5 | `/projects/:slug/reports` | `ReportsPage` | Project-scoped reports (F48/F49). Stat cards, tables, period selector all themed. Non-member → redirected to `/projects` (D7). | ☐ | ☐ |
| 6 | `/settings` | `SettingsPage` (ADMIN only, `RequireRole`) | User list table, role badges (`--success`/`--warning`/`--danger`), confirm dialogs. Destructive actions gated by modal (per MEMORY). | ☐ | ☐ |
| 7 | `/forbidden`, `*` (404) | `ForbiddenPage`, `NotFoundPage` | Themed error card; readable in both themes. | ☐ | ☐ |

### 4.2 Ticket modal (Create + Edit) — F43/F44

| Surface | QA focus | Light | Dark |
|---|---|---|---|
| `CreateTicketModal` (New ticket button on Board) | Modal size prop → `max-w-*` correct; backdrop scrim themed (`--popover`-family, not raw black/white). | ☐ | ☐ |
| `TicketDetailModal` (`/projects/:slug/tickets/:displayId`) | Two-column form (F44): left = description/RTE, right = attributes. Both columns themed. X-icon close button visible. | ☐ | ☐ |
| `TicketModalSkeleton` | Loading skeleton shimmers in `--muted`-family, not raw gray. | ☐ | ☐ |
| `TicketNotFound` (bad displayId) | Empty/error state inside modal — themed, readable. | ☐ | ☐ |

### 4.3 Confirm dialogs (destructive actions — per MEMORY)

| Dialog | QA focus | Light | Dark |
|---|---|---|---|
| `ConfirmDiscardDialog` | Backdrop + panel themed (`--popover`); confirm = `--destructive` button. | ☐ | ☐ |
| `DeleteTicketConfirm` | Destructive button red resolves to `--destructive` (dark: brighter `red-500`), not raw `red-600`. | ☐ | ☐ |
| Role-change / deactivate / delete confirm (SettingsPage) | Per MEMORY: every role-changing/destructive action requires a confirm modal. Verify each fires and is themed. | ☐ | ☐ |

### 4.4 States (empty / error / loading) — cross-route

| State | Component(s) | QA focus | Light | Dark |
|---|---|---|---|---|
| **Empty** | `EmptyState` (icon via lucide), `UnsortedBucket` | Icon + text use `--muted-foreground`; not raw gray. | ☐ | ☐ |
| **Error** | `ErrorFallback`, `RouteErrorBoundary`, `Retry` | Error card bg = `--card`; retry button = `--primary`. No raw red. | ☐ | ☐ |
| **Loading** | `Loading`, `Skeleton`, `BoardSkeleton`, `TicketModalSkeleton` | Skeleton bg = `--muted`-family; shimmer anim visible in dark. | ☐ | ☐ |
| **Offline** | `OfflineBanner` | Banner uses `--warning` token; visible in both themes. | ☐ | ☐ |
| **Toaster** | `Toaster` (sonner/radix) | Toast panel = `--popover`; success/error icons use `--success`/`--destructive`. | ☐ | ☐ |

### 4.5 Navbar + primitives (cross-route chrome)

| Surface | QA focus | Light | Dark |
|---|---|---|---|
| `TopNav` clusters (F37) | Full-width gutter; brand = lucide `Layers` + "Slykboard" (D6); nav links muted+disabled when no project (F42) with Tooltip (F36/D5). | ☐ | ☐ |
| `ProjectPicker` (F38) | Radix dropdown; retry-on-error; empty-state create link. Dropdown panel = `--popover` (dark in dark mode — see §5). | ☐ | ☐ |
| Avatar → profile menu (F39) | Radix dropdown; Sign out item. Panel = `--popover`. | ☐ | ☐ |
| `ThemeToggle` (F40) | Icon reflects `resolvedTheme`; cycle light → dark → system; persists across reload. | ☐ | ☐ |
| Health badge (F41) | ok/degraded/down states use `--success`/`--warning`/`--danger`. | ☐ | ☐ |

---

## 5. Radix portal `.dark` inheritance spot-check

**The risk (from F36):** Radix `Portal` renders content to `document.body`, **outside** the React root. If dark mode were implemented as a scoped selector (e.g. `.my-app.dark .x`), portalled content would render in the wrong theme. F32 mitigated this by putting `.dark` on `<html>` (`document.documentElement` — see `ThemeProvider.tsx` line 88) and using Tailwind v4's `@custom-variant dark` with `:where(.dark, .dark *)` zero-specificity mapping, so portalled descendants of `<html>` inherit the dark tokens.

**Spot-check (both themes):**
1. Set theme to **dark** via `ThemeToggle`.
2. Open the **ProjectPicker** dropdown (`TopNav`) → confirm the popover background is dark (`--popover` = `oklch(0.278 0.033 256.848)` gray-800), **not** the light `--card`. Text = `--popover-foreground` (light-on-dark).
3. Open the **Avatar profile menu** → same check.
4. Hover a disabled nav link (F42 "Select a project first") → confirm the **Tooltip** (F36) panel renders dark with light text.
5. Open the **CreateTicketModal** → confirm the modal panel (rendered via `createPortal` to `document.body`) renders dark.

| Portal surface | Light | Dark |
|---|---|---|
| `Dropdown` (ProjectPicker, profile menu, label/column managers) | ☐ | ☐ |
| `Tooltip` (disabled-nav hint) | ☐ | ☐ |
| `Modal` (CreateTicketModal, TicketDetailModal, confirms) | ☐ | ☐ |

**Pass criterion:** all portalled surfaces render in the active theme. A light popover in dark mode (or vice-versa) is a regression in F32/F36 and must be filed there, not patched in F51.

---

## 6. No-flash verification (closes F33's loop)

**The risk (from F33):** on hard refresh, the browser paints the HTML before React hydrates. If the pre-paint `<head>` script and React's first render disagree about the theme, the page flashes the wrong theme. F33's agreement: the inline script (key `slykboard-theme`, same resolution rule as `ThemeProvider`'s lazy seed) sets `.dark` on `<html>` before paint, and `ThemeProvider`'s seed equals it so the `.dark`-sync effect is a no-op on mount.

**Spot-check (both themes):**
1. Set theme to **dark**. Hard-refresh (Ctrl+Shift+R) `/projects/:slug`. Confirm **no light flash** on first paint.
2. Set theme to **light**. Hard-refresh. Confirm **no dark flash**.
3. Set theme to **system**, OS = dark. Hard-refresh. Confirm dark renders immediately.
4. Clear `localStorage['slykboard-theme']`, OS = light. Hard-refresh. Confirm defaults to light (D8 fallback: `system` → resolves to light), no flash.

| Scenario | No-flash |
|---|---|
| Stored = dark, hard refresh | ☐ |
| Stored = light, hard refresh | ☐ |
| Stored = system, OS = dark, hard refresh | ☐ |
| No stored key (D8 fallback), hard refresh | ☐ |

---

## 7. Release readiness + tagging (owner's manual step)

**Gate status (machine-verifiable):** ✅ GREEN — see §8. The redesign is independently shippable per PRD §7.

**Owner steps (not executed by F51 — per `.claude/rules/git-guidelines.md` "NEVER run `git` without explicit approval" and the rebase-and-merge-only policy):**

1. **Pick the version.** The redesign is a non-breaking visual refresh; the only contract-adjacent BE change (Reports scoping) already shipped deprecation-redirected in F48/F49. Owner decides minor vs patch — leave as `x.y.z`.
2. **Cut the release branch** (version only, no ticket/description per git-guidelines):
   ```bash
   git checkout main
   git pull --rebase
   git checkout -b release/x.y.z
   ```
3. **Re-run the gate on the release branch** (final confirmation):
   ```bash
   make gate        # == ./scripts/merge-gate.sh all
   ```
4. **Open the release PR** (`release/x.y.z` → `main`). Repo policy is **rebase-and-merge only** — no squash, no merge commit.
5. **Capture before/after screenshots** of Board + Create/Edit modal (PRD §7 T4.3 ships requirement) and attach to the release. These are out-of-band for this automated pipeline.
6. **Tag** (after the release PR is rebased-and-merged):
   ```bash
   git checkout main && git pull --rebase
   git tag -a vx.y.z -m "SLYK UI redesign release"
   git push origin vx.y.z
   ```
7. **File the follow-up** to remove the deprecated global `/reports/*` BE routes (decision D5 — one-release deprecation window, then removal ticket).

**Deferred (post-release, per PRD §10 and F50 §7):**
- CI wiring of the gate (GitHub Actions / Vercel preview gate).
- Vite manual chunking to silence the >500 kB build advisory (accepted warning; build exits 0).
- Coverage-threshold enforcement (`vitest --coverage`).
- Automated a11y / axe pass.

---

## 8. Gate result (release-time re-run)

`./scripts/merge-gate.sh all` (== `make gate`) — run at F51 release time (exit code 0):

```
=== typecheck ===    [typecheck] PASS
=== build ===        [build] PASS
=== lint ===         [lint] PASS
=== prettier ===     [prettier] PASS
=== test ===         [test] PASS

=== GATE GREEN (5/5 stages passed) ===
```

- Backend: 34 test files, **515/515 tests** green.
- Frontend: 95 test files, **700/700 tests** green.
- Zero lint problems (`--max-warnings=0`). Zero prettier diffs.
- FE build emits the accepted >500 kB chunk advisory (build exits 0 — F50 D7).

F51's release-readiness claim rests on this block: **5/5 PASS confirmed.**

---

## 9. Out of scope (deferred)

- **Manual browser QA execution.** This pipeline is automated; the checklist is the artifact for a human owner / staging preview. The §4-§6 checkboxes are filled by the owner, not by F51.
- **Screenshot capture and commit.** Out-of-band; attached to the release, not the repo.
- **The actual `git tag` / release branch.** Owner's manual step (§7).
- **CI wiring, chunking, coverage gate, axe.** Deferred per F50 §7 and PRD §10.
