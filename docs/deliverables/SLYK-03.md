# SLYK-03 · [Enhancement] · Settings Information Architecture

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-03)

## Problem

The nav item labeled "Settings" is ambiguous (a future platform
"Settings" and an "Account Settings" will also exist), points at a workspace-global
page, and Project Settings is not laid out for future growth. The profile menu also
needs the two future settings entries stubbed.

## Solution (end-to-end)

- Rename the nav item **"Settings" → "Project Settings"**, retarget it to
  `/projects/:slug/settings`, and make it **require a selected project** — when no
  project is selected it renders the same disabled-tooltip state Board/Reports use
  today.
- "Project Settings" is visible to **Platform Admins** and **Project Admins** of the
  current project (not to Project Members).
- Rebuild Project Settings as a **two-column layout**: a left sidebar of sections
  and a right content pane. Initial sidebar items: **General** (project name +
  columns + deactivation, per DEL-04), **Member Management** (per DEL-02), and
  **Labels**. The sidebar is the extension point for future sections.
- Reserve `/settings` for the future platform **"Settings"**: render a **"Coming
  Soon"** page, linked from the **profile menu**, visible to **Platform Admins
  only**.
- Add an **"Account Settings"** entry to the profile menu (available to **all
  users**) that routes to a **"Coming Soon"** page.
- Remove/redirect the old workspace-global settings page so there is a single,
  unambiguous IA.

## Acceptance criteria

- With no project selected, "Project Settings" is disabled with a tooltip.
- Selecting a project enables "Project Settings"; navigating there shows the
  two-column layout with the initial sidebar sections.
- A Project Member does not see "Project Settings".
- The profile menu shows "Settings" (Platform Admin only) and "Account Settings"
  (everyone); both lead to "Coming Soon".
- The old global settings route no longer exists as a primary surface (redirects or
  is removed cleanly).

## Dependencies

DEL-01 (role gating); hosts DEL-02.
