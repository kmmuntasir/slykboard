# SLYK-06 · [Bugfix] · Theme Contrast Fixes

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-06)

## Problem (original issues #2 and #3)

In both dark and light modes: inactive nav
items (Board, Reports, Project Settings) render in an almost-invisible color; the
icon beside the selected project name in the project picker is almost invisible;
and the ticket card background is too close to the main background.

## Root cause (confirmed in code)

Inactive nav text uses `text-muted`, which maps
to `--muted` — the *background* surface token (gray-100 in light, gray-800 in dark)
— instead of `text-muted-foreground`. The project-picker icon reuses the same wrong
token. The ticket card uses `bg-card`, which equals `--background` in light mode, so
the card has no separation from the page.

## Solution (end-to-end)

- Switch inactive nav item text/icon to the **foreground-on-muted** token so it is
  legible but de-emphasized in **both** modes, with a clear hover to full
  foreground.
- Fix the project-picker selected-project icon to use a visible foreground token in
  both modes.
- Differentiate the ticket card from the page background in both modes (e.g. a
  distinct card surface token, or stronger border/elevation) so cards read as
  separate elements on the board.

## Acceptance criteria

- Inactive nav items (Board, Reports, Project Settings) are clearly readable in
  light **and** dark mode, and become fully prominent on hover/active.
- The selected-project icon in the picker is clearly visible in both modes.
- Ticket cards are visually distinct from the board background in both modes.

## Dependencies

None.
