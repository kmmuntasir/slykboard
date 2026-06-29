# SLYK-02 · [Feature] · Member Management (project-scoped)

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-02)

## Problem

There is no project-scoped member management. Today's "User Management"
is workspace-global and only activates/deactivates or toggles a global role. The
product needs per-project member CRUD with a smart add flow, and the section should
be renamed from "User Management" to **"Member Management"**.

## Solution (end-to-end)

- A **Member Management** section lives inside Project Settings (hosted by DEL-03),
  available to Platform Admins and Project Admins of the current project.
- A **members table** with columns: user (avatar + full name + display name +
  email), project role, status, and row actions (change role, remove from project).
- A **basic search** that filters by name **or** email match.
- An **"Add Member"** button (top-right, above the table) opens a modal containing a
  single email input that **auto-searches** as the user types. The modal branches:
  - Email **already a member of this project** → *"Already a Member"* error.
  - Email is a **Platform Admin** → *"Already a Member"* error (platform admins are
    default members of all projects).
  - Email **exists on the platform** (in other projects) → show the user's details
    and a **confirmation prompt** → on confirm, add to this project → success.
  - Email **does not exist** → the modal **expands** to show input fields:
    **Full Name**, **Display Name**, **Email** (read-only, pre-filled), and a
    **Project Role** selector (`Member` / `Project Admin`). Submit → enforce
    `ALLOWED_DOMAIN` + dedupe → **confirmation prompt** → on confirm, create the
    platform user and add them to this project → success. Wrong domain →
    *"domain not allowed"*; duplicate → *"already exists"*.
- Row actions: **change role** (Member ↔ Project Admin) and **remove from project**
  (with confirmation). Removing a member does **not** delete the platform user.
- Renaming throughout: "User Management" → "Member Management".

## Acceptance criteria

- Searching by partial name or email filters the table live.
- All four Add-Member branches behave exactly as specified, with the correct
  success/error messaging and confirmation prompts.
- A newly created user (via the expanded form) can subsequently log in with Google
  and lands inside this project.
- A Platform Admin added by email shows "Already a Member".
- Role changes and removals take effect immediately and are reflected in project
  access.
- Creating a user with a disallowed domain or a duplicate email is blocked with the
  specified error.

## Dependencies

DEL-01 (roles/membership), DEL-03 (host layout).
