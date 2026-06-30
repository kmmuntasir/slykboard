# Implementation Plan — SLYK-06

**Ticket:** `docs/deliverables/SLYK-06.md`
**Type:** Bug
**Title:** Theme Contrast Fixes (inactive nav, project-picker icon, ticket card)
**Generated:** 2026-06-30

---

## Summary

A Tailwind theme-token misuse plus a flat card surface cause low-contrast UI in both light and dark mode. (1) The sidebar nav items **Board**, **Reports**, and **Project Settings** paint inactive text/icons with the `text-muted` utility, which resolves to `--muted` — a **background surface token** (gray-100 light / gray-800 dark), not a text token — making them near-invisible. (2) The **project-picker** trigger icons (FolderKanban + ChevronDown beside the selected project) reuse the same wrong `text-muted` token. (3) The **ticket card** uses `bg-card`, whose underlying `--card` token equals `--background` in **light mode** (both pure white), so cards have no fill separation from the page/board background.

The fix swaps every offending `text-muted` → `text-muted-foreground` (the canonical legible-but-deemphasized text token, gray-500 light / gray-400 dark, already used ~60× across the codebase), and gives the ticket card a distinct surface from the page/board background so it reads as a separate element in both modes.

## Root Cause

All three symptoms trace to misusing a **surface token as a text color**, plus an underspecified card surface.

1. **`text-muted` is a surface token, not a text token.** In `frontend/src/index.css`, Tailwind's `@theme inline` maps `--color-muted: var(--muted)` (`index.css:111-112`). `--muted` is defined as a *background* surface — gray-100 in light (`index.css:25`), gray-800 in dark. The correct deemphasized-text token is `--muted-foreground` (gray-500 light / gray-400 dark, `index.css:26`), surfaced as `--color-muted-foreground: var(--muted-foreground)` (`index.css:112`). Using `text-muted` paints text with a surface color → contrast ~1.05 on white (near-invisible) and **identical color** to a `bg-card`/`bg-muted` surface in dark mode.

2. **Inactive nav** — `components/TopNav.tsx:205-208`, the shared `navLinkClass` builder, sets the inactive branch to `'text-muted hover:text-foreground'`. The hover target is already correct; only the base color is wrong. Applied to all three items via the shared function (`TopNav.tsx:225` Board/Reports, `:258` Project Settings).

3. **Project-picker trigger** — `components/ProjectPicker.tsx` paints the FolderKanban icon (`:89`, `:97`, `:159`) and the ChevronDown caret (`:119`) with `text-muted`, so the icon beside the selected project name vanishes. (Auxiliary wrong-token uses at `:76`, `:90` for "Loading…" / "No projects yet" text share the defect.)

4. **Ticket card flat surface** — `components/TicketCard.tsx:32` uses `bg-card`. In light mode `--card: oklch(1 0 0)` (`index.css:13`) === `--background: oklch(1 0 0)` (`index.css:10`) → both pure white → the card fill is indistinguishable from the page background; only `border` + `shadow-sm` separate it. Board columns themselves render `bg-muted/40` (`BoardColumn.tsx:24`), so in **dark** mode the solid `bg-card` (gray-800) over the translucent gray-800 column yields weak separation. The card needs a surface/border distinct from the board background in both modes.

> **Ticket wording note.** The ticket refers to a "foreground-on-muted token." The codebase has no token by that name; the established, semantically equivalent legible-but-deemphasized token is **`text-muted-foreground`** (gray-500 / gray-400), used pervasively (e.g. `BoardColumn.tsx:30,48`, `TicketCard.tsx:36`, `ReportsPage.tsx`). This plan uses `text-muted-foreground` as that token.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Component | `frontend/src/components/TopNav.tsx` | `navLinkClass` inactive branch uses `text-muted` (`:207`); affects Board / Reports / Project Settings |
| Component | `frontend/src/components/ProjectPicker.tsx` | FolderKanban + ChevronDown + helper text use `text-muted` (`:76`, `:89`, `:90`, `:97`, `:119`, `:159`) |
| Component | `frontend/src/components/TicketCard.tsx` | `bg-card` indistinguishable from page/board background (`:32`) |
| Theme | `frontend/src/index.css` | Token defs to verify (`--muted` vs `--muted-foreground` at `:25-26`; `--card`/`--background` at `:10,13`) |

**In-scope secondary offenders** (same root defect, same one-token swap — fix together to avoid leaving identical bugs behind):
`components/Loading.tsx:6`, `components/Retry.tsx:9`, `components/ErrorFallback.tsx:10`, `components/TicketNotFound.tsx:17`, `components/TicketDetailModal.tsx:112`, `pages/NotFoundPage.tsx:10`, `pages/ForbiddenPage.tsx:10`, `pages/ProjectsPage.tsx:123`.

## Proposed Implementation

All changes are **frontend-only**. Styling is plain Tailwind utilities composed via `cn()` — no nav-config refactor needed. Build order: theme token check → text-token swaps → card surface.

### Frontend Changes

#### 1. Fix inactive nav text/icon — `frontend/src/components/TopNav.tsx`

- **What:** In `navLinkClass` (around `:205-208`), change the inactive-branch base color from `text-muted` to `text-muted-foreground`. Keep the existing `hover:text-foreground` (already correct) so inactive items are legible but de-emphasized and escalate to full foreground on hover/active. The active branch (`text-primary`) is untouched.
- **Why:** `text-muted` is a surface token → near-invisible; `text-muted-foreground` is the canonical deemphasized-text token. Hover already matches the established `hover:text-foreground` pattern (`TopNav.tsx:379`, `Modal.tsx:77`).
- **Code reference:** existing inactive→hover pattern at `TopNav.tsx:379` (`text-muted-foreground ... hover:bg-accent hover:text-foreground`).
- **Result:** Board / Reports / Project Settings readable in both modes; full prominence on hover/active.

#### 2. Fix project-picker selected-project icon — `frontend/src/components/ProjectPicker.tsx`

- **What:** Swap `text-muted` → `text-muted-foreground` on the FolderKanban trigger icon (`:89`, `:97`) and the ChevronDown caret (`:119`), so the icon beside the selected project name is visible. Also fix the FolderKanban inside dropdown options (`:159`) and helper text (`:76` "Loading…", `:90` "No projects yet") for consistency. Trigger body text already uses `text-foreground` (`:104-109`) — leave as-is.
- **Why:** Same root cause as the nav; the picker icons inherit the surface-token bug. `text-muted-foreground` matches how other pickers color control icons (`ProjectMembersPage.tsx:151`).
- **Code reference:** `ProjectPicker.tsx:104-109` (correct `text-foreground` usage in the same component).
- **Result:** selected-project icon clearly visible in both modes.

#### 3. Differentiate the ticket card from the board background — `frontend/src/components/TicketCard.tsx`

- **What:** Strengthen the card's visual separation from the page/board background in **both** modes. Two complementary, convention-aligned edits on the card root (`:32`):
  1. Give the card a surface distinct from the board column. Prefer a localized change: keep `bg-card` but add a visible border using the semantic border token and a stronger shadow — e.g. `rounded border border-border bg-card p-2 text-sm shadow-sm ring-1 ring-black/5 dark:ring-white/5` (a subtle elevation ring reads clearly on the `bg-muted/40` column in dark and on white in light). 
  2. If a pure-fill separation is preferred instead, swap `bg-card` → `bg-popover` on this card only (popover is a distinct raised surface already used for elevated UI), avoiding any global token change.
- **Why:** In light mode `--card === --background` (both white), so the card has zero fill separation from the page; in dark the card sits on a near-identical translucent column. A border-token + elevation ring (or a distinct raised surface) restores separation without touching the global `--card` token (which would ripple to every `Card`/`Card.tsx`/popover/skeleton and risks regressions).
- **Recommendation:** Apply the **border-token + elevation ring** option (keeps `--card` global semantics intact, surgical to the ticket card). Note `border` alone (current) uses the default color; explicitly `border-border` + ring guarantees contrast.
- **Code reference:** `components/ui/Card.tsx:14` (canonical `bg-card` usage to stay consistent with); `BoardColumn.tsx:24` (the `bg-muted/40` surface the card sits on).
- **Result:** ticket cards visually distinct from the board background in both modes.

#### 4. Fix same-defect secondary offenders (consistency)

- **What:** Swap `text-muted` → `text-muted-foreground` at: `Loading.tsx:6`, `Retry.tsx:9`, `ErrorFallback.tsx:10`, `TicketNotFound.tsx:17`, `TicketDetailModal.tsx:112`, `pages/NotFoundPage.tsx:10`, `pages/ForbiddenPage.tsx:10`, `pages/ProjectsPage.tsx:123` (project slug).
- **Why:** Identical surface-token-as-text defect; leaving them keeps the same illegible text bug in error/empty/loading states. Same one-token swap, no behavior change.

### Theme-token verification (no edit expected)

- **What:** Confirm `frontend/src/index.css` already defines `--muted-foreground` distinctly from `--muted` in both `:root` (light, `:25-26`) and `.dark` (dark, around `:78-79`), and that `@theme inline` exposes `--color-muted-foreground` (`:112`). No change is required — these exist. The fix is at the **utility-class** layer, not the token-definition layer.
- **Why:** Guards against assuming a missing token; keeps the fix purely in component className strings.

## Edge Cases & Risks

- **Global `--card` token change rejected.** Editing `index.css:13` to differentiate `--card` from `--background` in light mode would ripple to **every** card/popover/skeleton (`Card.tsx:14`, `RichTextEditor.tsx:36`, `TicketModalSkeleton.tsx:5`, `LabelMultiSelect.tsx:64`). This plan deliberately localizes the ticket-card fix and leaves the global token alone to avoid un-scoped visual regressions.
- **Dark-mode card-on-column.** Dark columns are `bg-muted/40` (translucent gray-800) and `bg-card` is solid gray-800; the elevation ring / stronger border is what guarantees separation there — verify in dark mode during manual QA.
- **Hover consistency.** Ensure the nav inactive branch still escalates to full foreground (`hover:text-foreground` preserved); do not accidentally demote the hover target.
- **Scope creep guard.** Do not "fix" `bg-card` elsewhere (generic `Card`, popovers, skeletons) — those are out of scope and their surfaces are correct for their contexts.
- **No backend / API / data impact.** Pure CSS/Tailwind className changes; no types, contracts, migrations, or tests beyond visual regression snapshots.

## Testing

*Project conventions — Vitest + Testing Library; table-driven; one behavior per test; co-locate `*.test.tsx` next to source.*

- **Unit/component tests (className assertions):**
  - `TopNav` — inactive NavLink renders a className containing `text-muted-foreground` (not `text-muted`); active NavLink renders `text-primary`.
  - `ProjectPicker` — selected-project trigger icon (FolderKanban) and caret (ChevronDown) classNames contain `text-muted-foreground`.
  - `TicketCard` — root className includes the new separation (e.g. `border-border` + ring, or `bg-popover`) distinct from plain `bg-card`.
- **Regression (table-driven):** loop the swapped files and assert no remaining `text-muted` token usage in the in-scope set (a grep-backed test or a snapshot of computed className).
- **Token test:** `frontend/src/tokens.test.ts` already guards token definitions — extend (if not present) to assert `--muted-foreground !== --muted` and (light) the ticket-card surface differs from `--background` in computed style.
- **Manual verification (both light + dark):**
  1. Open the board sidebar — Board / Reports / Project Settings are clearly readable when inactive and become fully prominent on hover/active.
  2. Open the project picker — the icon beside the selected project name is clearly visible; the dropdown caret is visible.
  3. On the board, ticket cards are visually distinct from the board/column background.
  4. Toggle light ↔ dark and re-check all three.

## Acceptance Criteria

- [ ] Inactive nav items (Board, Reports, Project Settings) are clearly readable in light **and** dark mode, and become fully prominent on hover/active.
- [ ] The selected-project icon in the picker is clearly visible in both modes.
- [ ] Ticket cards are visually distinct from the board background in both modes.
- [ ] No remaining bare `text-muted` (surface-as-text) usage in the in-scope file set.
- [ ] Manual QA passes for all three fixes in both light and dark mode.

## Open Questions  *(optional)*

- **Ticket-card separation strategy:** confirm the preferred approach — (a) `border-border` + elevation ring (keeps global `--card` token, recommended) vs (b) local `bg-card` → `bg-popover` swap. Plan defaults to (a); trivial to switch at implementation time.
- The ticket mentions a "foreground-on-muted token"; this plan maps that to the codebase's existing `text-muted-foreground`. Confirm if a brand-new dedicated token is desired (not recommended — `text-muted-foreground` already serves this semantic).

## Out of Scope

- Changing the global `--card` / `--background` token values in `index.css` (risk of un-scoped regressions across all cards/popovers/skeletons).
- `bg-card` usage on generic `Card.tsx`, `RichTextEditor.tsx`, `TicketModalSkeleton.tsx`, `LabelMultiSelect.tsx`, popovers — correct for their contexts, not part of this bug.
- The bare `border` (no token) on `TicketCard.tsx:32` as a standalone concern — addressed implicitly by switching to `border-border` as part of fix #3.
- Any backend, API, database, migration, or RBAC change — this is a frontend-only CSS/Tailwind fix.
- Theme token-definition refactors beyond verifying the existing `--muted-foreground` definitions.
