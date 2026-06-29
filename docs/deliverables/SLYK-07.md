# SLYK-07 · [Bugfix] · Dropdown Item Icon/Text Spacing

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-07)

## Problem (original issue #7)

In the profile dropdown, the Theme options
(Light/System/Dark) and Sign Out have icons and text that sit too close together.

## Root cause (confirmed in code)

The shared dropdown item primitive lays out its
children with flexbox but defines **no gap**, so the icon and the text touch.

## Solution (end-to-end)

- Add proper spacing between the icon and text in the shared dropdown item
  primitive so every dropdown item (Theme options, Sign Out, and any future ones)
  has consistent, comfortable spacing.

## Acceptance criteria

- Theme option rows and the Sign Out row have clear, consistent icon-to-text
  spacing.
- The fix applies globally to all dropdown items, not just these two.

## Dependencies

None.
