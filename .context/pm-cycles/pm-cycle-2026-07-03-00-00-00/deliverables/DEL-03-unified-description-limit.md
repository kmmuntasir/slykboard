# DEL-03 — Unified 10,000-Character Description Limit

**Source issue(s):** Derived from the brief during clarification — ticket creation currently caps the description at ~500 characters while editing allows ~5000, an arbitrary inconsistency. The product owner locked a single, higher, unified limit so tickets can hold substantial descriptions regardless of whether they are being created or edited.
**Status:** Draft
**Dependencies:** None (independent; pairs naturally with DEL-01's wider formatting/sanitization)

## Problem
The description length limit is inconsistent across the two ways a user can set a description: creating a ticket allows only ~500 characters, while editing an existing ticket allows ~5000. A user who starts a terse description at create-time is later able to expand it many times over at edit-time — but is needlessly blocked from writing a thorough description up front. The 500-character create cap is too small for real ticket documentation. The product owner wants a single, generous, consistent limit applied everywhere a description is entered.

## Solution
End-to-end desired behavior:

### Single unified limit
- The ticket description has **one length limit: 10,000 characters**, applied identically whether the ticket is being **created** or **edited**.
- The limit is measured consistently (on the stored description content) on both the create and the edit paths.

### Both entry points enforce the same cap
- Creating a ticket: the description may be up to 10,000 characters (replaces the ~500 cap).
- Editing a ticket: the description may be up to 10,000 characters (replaces the ~5000 cap).
- Validation must enforce 10,000 characters on both paths, so the create and edit experiences are identical with respect to length.

### Consistency with the wider editor (DEL-01)
- Because DEL-01 widens the allowed formatting (and thus the sanitization allow-list), the 10,000-character budget must apply to the richer content users can now author. The limit is the same single number regardless of how much formatting is used.

### User feedback on the limit
- When a user approaches or exceeds 10,000 characters, the editor surfaces clear feedback (e.g. a character count / remaining-count indicator and a prevent-or-warn behavior on overflow), consistent with how the product handles other length limits. (Treat as a product behavior: the user must know they are at/over the limit; the specific UI wording is not prescribed.)

## Acceptance criteria
- [ ] Creating a ticket accepts a description up to 10,000 characters and rejects/flags anything beyond that.
- [ ] Editing a ticket accepts a description up to 10,000 characters and rejects/flags anything beyond that.
- [ ] The create and edit paths enforce the same 10,000-character ceiling — no path-specific override remains.
- [ ] The previous ~500 (create) and ~5000 (edit) caps are removed.
- [ ] The user gets clear feedback when at or over the 10,000-character limit on both create and edit.
- [ ] Existing tickets whose descriptions are within 10,000 characters remain valid and editable with no forced change.

## Dependencies
- None. (Pairs with DEL-01: the wider formatting/sanitization lets users actually fill the larger budget, but neither deliverable blocks the other.)

## Out of scope
- No change to any field other than the ticket description.
- No change to the comments editor or comment length.
- No migration/trimming of existing descriptions that exceed prior limits (existing data within 10,000 chars stays valid).
- The specific wording/styling of the overflow indicator is left to implementation; only the behavior (user knows they are at/over the limit) is required here.
