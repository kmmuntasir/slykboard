# F16 — Ticket detail modal (view & edit): Plan + Task Breakdown

> **Feature:** F16 — Ticket detail modal (view & edit) (Phase 2 — Board)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F13 (DONE ✅), F14 (DONE ✅), F15 (DONE ✅) · **PRD ref:** REQ-3.2, REQ-3.3, User Journey 1 (PRD §7), PRD §8.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F13](../F13-ticket-attributes-title-description-assignee-priority/F13-ticket-attributes-title-description-assignee-priority-tasks.md), [F14](../F14-labels-catalog/F14-labels-catalog-tasks.md), [F15](../F15-checklist/F15-checklist-tasks.md)

---

## 1. F16 Recap

**Goal:** A single surface to read and edit everything about a ticket — title, ID, description, assignee, priority, labels, checklist, creator, and timestamps — with optimistic in-place saves and a clean, accessible close.

**Ships:** Clicking a card opens a modal showing all attributes (display ID `SLYK-NNN`, title, description, assignee, priority, labels, checklist, creator with avatar, created/updated timestamps). Every field is inline-editable with optimistic save + rollback on error. The modal closes cleanly via Esc, backdrop-click, or close button — but when the form is dirty, a confirm-discard dialog intercepts. The modal is deep-linkable (`/projects/:slug/tickets/:ticketId`), shareable, back-closable, and keyboard-accessible (focus trap, scroll lock, focus restore). Board polling drift reconciles without clobbering in-flight edits.

**Acceptance (definition of done):**
- Modal shows title, display ID (`SLYK-NNN`), description, assignee, priority, labels, checklist, creator (name + avatar), and created/updated timestamps.
- Inline editing of each field with optimistic save + rollback on error (reuse F13 `useUpdateTicket`).
- Closes cleanly via Esc / backdrop / close button; unsaved-confirm guard when mid-edit.
- Deep-link: URL param `tickets/:ticketId` opens the modal directly (board stays mounted).
- Keyboard: Esc to close, focus trap, scroll lock, focus restore on close.
- Board/modal drift: an external edit during modal-open reconciles without losing user input.

**Edge cases to resolve up front:**
- **Modal state vs. board state drift (polling updates while modal open)** → **Decision:** the detail query enables `refetchOnMount`, `refetchOnWindowFocus`, and a `refetchInterval` (30s, matching the board) while the modal is open. User input in the RHF form is NOT lost because RHF holds its own state (`defaultValues` seeded once on open, not re-seeded on refetch). In-flight optimistic edits reconcile via `useUpdateTicket.onSettled` invalidation of both `boardKeys.all` and `ticketKeys.detail(id)` (already in place, `useUpdateTicket.ts:62-63`). **Cite:** React Query refetch options; `useUpdateTicket.ts:61-71`.
- **Deep-link to a ticket (URL param) so it can be shared/opened directly** → **Decision:** nested route `/projects/:slug/tickets/:ticketId` rendered as a modal overlay over the board `<Outlet>` (board stays mounted → no refetch; back-button closes; URL is shareable; modal reads `useParams().ticketId`). Query-param (`?ticket=:id` via `useSearchParams`) is the lighter alternative but nested route is cleaner and idiomatic for react-router v7 data routers. **Cite:** React Router v7 URL-powered modals; `routes/index.tsx:34-68`.
- **Keyboard: Esc to close, focus trap, scroll lock** → **Decision:** hand-rolled `useModalA11y` hook + `Modal` primitive, **0 new deps** (no Radix / Headless UI / react-focus-lock). Esc is guarded by the unsaved-confirm when dirty. **Cite:** W3C APG Dialog Pattern; WHATWG #7732 (inert/scroll-lock). ~60-80 lines vs Radix restyle cost.
- **Unsaved-confirm guard if mid-edit** → **Decision:** RHF `formState.isDirty` + react-router `useBlocker` (stable in v7) + a custom `ConfirmDiscardDialog`. `useBlocker` guards route nav (back/forward); Esc, backdrop-click, and the close button are guarded separately with the same `isDirty` confirm. No `window.confirm`. **Cite:** React Router `useBlocker` docs; RR Decision 0001.

---

## 2. Codebase Analysis Summary

- **State:** **Partial — edit-only modal exists; view-only metadata + a11y + deep-link + unsaved-guard are all MISSING.** F13 (DONE ✅), F14 (DONE ✅), F15 (DONE ✅) shipped the `TicketAttributeForm` primitive (title/description/priority/assigneeId/labelIds/checklist), the merged optimistic `PATCH`, `useUpdateTicket`, and `ChecklistEditor`. F16 wraps these in an accessible, deep-linkable, unified shell.

- **Existing structure this feature builds on (with path citations):**
    - **Edit modal host (REPLACE):** `frontend/src/components/EditTicketModal.tsx:15-60` — edit-only, opened via `BoardPage.handleEdit` (`BoardPage.tsx:38-41`) → `BoardColumn`/`UnsortedBucket` → `TicketCard` `onEdit` (`TicketCard.tsx:34`); rendered at `BoardPage.tsx:115-120`. Renders `<TicketAttributeForm mode="edit">` (`EditTicketModal.tsx:42-55`). Sources ticket from a SEPARATE `useQuery(ticketKeys.detail(ticketId))` (`EditTicketModal.tsx:17-21`), not the board cache.
    - **Reusable form primitive (REUSE AS EDIT BODY):** `frontend/src/components/TicketAttributeForm.tsx:35-41` props `{ mode: 'create'|'edit'; projectSlug; defaultValues; onSubmit; onCancel }`, RHF+zod (`:16-33`). Manages title/description/priority/assigneeId/labelIds/checklist. **NO view-mode, NO display ID, NO creator, NO timestamps, NO unsaved hook.** F16 wraps it in a shell that renders static metadata around it.
    - **MISSING F16 attributes today:** display ID built only in `TicketCard.tsx:39-40` (`SLYK-NNN`); `creatorId` on the type (`types/ticket.ts:31-45`) but never rendered; `createdAt`/`updatedAt` on the type (`:44-45`) but never shown. No view-only surface exists.
    - **CREATOR-RESOLUTION GAP (REQUIRED backend change):** `getTicket` (`backend/src/services/ticketService.ts:223-231`) returns `TicketRow & { labels }` — bare `creatorId` + bare `assigneeId`, NO user join. Even `getBoard` (`boardService.ts:61-81`) resolves only the assignee (left-join users for `assigneeFullName`/`assigneeAvatarUrl` at `:96-108`), NOT the creator. FE `Ticket` (`types/ticket.ts:31-45`) has `creatorId: string` (no `creator` object) and `assignee: Assignee|null`. **F16 must widen `getTicket` to left-join `users` for BOTH creator and assignee** (mirror `boardService`'s FK-dangle guard at `:96-108`) so the detail path returns resolved `creator {id,fullName,avatarUrl}` + resolved `assignee`. **No migration needed** — FK `creator_id → users.id` exists at `schema.ts:121-123`; it is a query-shape change only.
    - **Routing:** react-router data router (`createBrowserRouter` + `RouterProvider`, `frontend/src/routes/index.tsx:34-68`); board route is `/projects/:slug` (`:50`). **`useSearchParams` unused — no query-param UI precedent.** Deep-link = NEW pattern; nested route is the cleanest fit.
    - **Modal a11y today = NONE.** `EditTicketModal.tsx:31-36` and `CreateTicketModal.tsx:31-36` are bare `<div className="fixed inset-0 z-50 ... bg-black/50" role="dialog" aria-modal="true">`. No Esc, no focus trap, no scroll lock, no click-outside, no focus restore. **No reusable Modal/Dialog primitive exists.**
    - **Optimistic edit:** `useUpdateTicket` (`hooks/useUpdateTicket.ts:14-73`) covers title/description/priority/checklist optimistically (board+detail caches); `labelIds` skips optimistic (server join for colors, `:24-31`); **assigneeId is NOT in the optimistic set** (`:42-48` only patches title/description/priority/checklist) → avatar flickers stale until `onSettled` refetch (`:61-71`). Minor cleanup opportunity (T9, optional).
    - **Board↔modal drift:** modal sources ticket from `useQuery(ticketKeys.detail(ticketId))` (`EditTicketModal.tsx:17-21`), NOT the board cache. Board polls 30s (`useBoard.ts:11-19`). `onSettled` invalidates both `boardKeys.all` + `ticketKeys.detail` (`useUpdateTicket.ts:62-63`). **Drift risk:** external edit during modal-open updates board cache but not the open detail cache (detail only refetches on its own interval/mount/focus). F16 adds `refetchInterval`/`refetchOnMount`/`refetchOnWindowFocus` to the detail query.
    - **Unsaved-changes guard = ABSENT.** Only `formState: { errors, isSubmitting }` destructured (`TicketAttributeForm.tsx:55`); `isDirty` available but unused. No confirm dialog. Build from scratch.
    - **Display ID format:** `SLUG-NNN` (REQ-3.1) — already computed in `TicketCard.tsx:39-40`; F16 replicates via a shared util.
    - **Priority display conversion:** storage is UPPERCASE enum; REQ-3.2 is Title-case. F09 `PRIORITY_DISPLAY` exists — reuse.
    - **Date formatting:** no util today; timestamps rendered nowhere. Add a small `formatDate` util.

- **Files F16 creates:**
    - `frontend/src/components/Modal.tsx` (a11y primitive)
    - `frontend/src/hooks/useModalA11y.ts`
    - `frontend/src/components/TicketDetailModal.tsx`
    - `frontend/src/components/ConfirmDiscardDialog.tsx`
    - `frontend/src/utils/formatDate.ts`
    - `frontend/src/utils/formatTicketId.ts` (or extend an existing util)
    - co-located tests for all of the above
- **Files F16 modifies:**
    - `backend/src/services/ticketService.ts` (getTicket creator+assignee join + FK-dangle guard)
    - `backend/src/services/ticketService.test.ts`
    - `frontend/src/types/ticket.ts` (+`creator`)
    - `frontend/src/routes/index.tsx` (nested route)
    - `frontend/src/pages/BoardPage.tsx` (deep-link wiring)
    - `frontend/src/components/EditTicketModal.tsx` (port onto Modal primitive OR replace with TicketDetailModal)
    - optionally `frontend/src/components/CreateTicketModal.tsx` (port onto Modal)
    - optionally `frontend/src/hooks/useUpdateTicket.ts` (assigneeId optimistic cleanup)

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F16-ticket-detail-modal`, single-line commits `SLYK-F16: <msg>`, rebase-only no squash, slug SLYK, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful `/api/tickets/:id`, TanStack Query = server state, Zustand only if global, `authenticate` only for edit — REQ-3.3 — NO admin gate, consistent JSON envelope); `.claude/rules/js-style-guide.md` (PascalCase components, camelCase hooks/utils, 4-space JSX / 2-space JS, no `any`, no inline styles / Tailwind only, import order external→internal→types→relative, functions <50 lines, early returns); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `getByRole` priority, coverage >70% components); `.claude/rules/persona.md` (React 19 + Express 5 + Drizzle + Postgres + Vite + Tailwind; `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).

- **Hidden coupling to plan for:**
    - **`getTicket` creator/assignee resolution is the spine.** The view header cannot render creator without it. The change is a query-shape change (left-join users), NOT a schema delta — the `creator_id` FK already exists (`schema.ts:121-123`). State explicitly: F16 adds NO migration, NO schema-delta-table row.
    - **Board stays mounted under the modal.** Nested-route deep-link renders the modal OVER the board `<Outlet>`, so the board cache + 30s poll continue uninterrupted; the modal does not refetch the board.
    - **RHF owns form state; TanStack Query owns server state.** Drift reconciliation is safe because RHF `defaultValues` are seeded once on open and never re-seeded on background refetch — only the board/detail caches update; the user's unsaved typing is preserved.
    - **`useBlocker` only blocks route nav** (back/forward, deep-link change). Esc, backdrop-click, and the close button must each independently check `isDirty` and route through `ConfirmDiscardDialog`.
    - **`noUncheckedIndexedAccess`.** Tabbable-element queries return arrays → index access is `T | undefined`; narrow.
    - **`verbatimModuleSyntax`.** `import type { Creator, Assignee, Ticket }` everywhere.
    - **F17 owns delete.** F16 must NOT ship a delete button. Reserve a structural seam (e.g. a placeholder slot in the header) only.
    - **F19 owns activity feed.** F16 ships attributes only; reserve structural space in the modal layout but do not build the feed.
    - **F18 owns audit.** F16 preserves the `{ old, new }` seam already in `updateTicket` (`ticketService.ts:239-294`); do not add logging.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Modal a11y primitive | **Hand-rolled `useModalA11y` hook + `Modal` component, 0 new deps** (no Radix/Headless UI/react-focus-lock). | App hand-rolls overlays and avoids heavy deps; trap/scroll/Esc/restore is ~60-80 lines vs Radix restyle cost. W3C APG Dialog Pattern; WHATWG #7732 (`inert`/scroll-lock). Rules silent on dialog a11y — cite APG, not project rules. |
| D2 | Edit body reuse | **`TicketDetailModal` wraps the reused `TicketAttributeForm`** + a static-metadata view header; do NOT fork the form. | `TicketAttributeForm.tsx:35-41` already hosts title/description/priority/assigneeId/labelIds/checklist (F13/F14/F15). Reuse preserves the single source of truth for validation + edit semantics. F15 task doc D7: "keep `ChecklistEditor` standalone-reusable; F16 owns the unified modal." |
| D3 | Backend creator/assignee resolution | **Widen `getTicket` to left-join `users` for BOTH creator and assignee**, mirroring `boardService`'s FK-dangle guard (`boardService.ts:96-108`). **REQUIRED. No migration.** | `getTicket` (`ticketService.ts:223-231`) returns bare `creatorId`+`assigneeId`; `getBoard` resolves assignee only. FK `creator_id → users.id` exists (`schema.ts:121-123`) → query-shape change, not schema delta. |
| D4 | FE `Ticket.creator` field | **Add `creator: { id, fullName, avatarUrl } \| null` to FE `Ticket` type** (mirror `Assignee`). | REQ-3.2 lists "Created By (system generated)" as a canonical modal attribute. `types/ticket.ts:31-45` has `creatorId` but no resolved object. |
| D5 | Deep-link mechanism | **Nested route `/projects/:slug/tickets/:ticketId` rendered as a modal overlay over the board `<Outlet>`.** | react-router v7 data router (`routes/index.tsx:34-68`); board stays mounted (no refetch, no lost state), back-button closes, URL shareable, modal reads `useParams().ticketId`. Query-param alternative is lighter but nested route is cleaner. **Deviate flag:** NEW pattern (no `useSearchParams` precedent). |
| D6 | Unsaved-changes guard | **RHF `formState.isDirty` + react-router `useBlocker` + custom `ConfirmDiscardDialog`.** Also guard Esc/backdrop/close-button on `isDirty`. No `window.confirm`. | `useBlocker` is STABLE in react-router ^7.18; `formState.isDirty` available in RHF ^7.66. `useBlocker` blocks route nav only; the three close vectors need separate guards. Avoid `unstable_usePrompt` (buggy). RR useBlocker docs; RR Decision 0001. |
| D7 | Board/modal drift reconciliation | **Detail query enables `refetchOnMount`, `refetchOnWindowFocus`, and `refetchInterval` (30s) while modal is open.** RHF form state seeded once (not re-seeded on refetch) → user input preserved. | Board polls 30s (`useBoard.ts:11-19`); detail currently refetches only on own mount/focus. `useUpdateTicket.onSettled` already invalidates `boardKeys.all` + `ticketKeys.detail` (`useUpdateTicket.ts:62-63`). |
| D8 | Delete button | **F16 does NOT ship delete.** Reserve a seam only (F17 owns admin-delete). | REQ-3.3: delete is Admin-only; F17 owns it. F16 must not ship it. |
| D9 | Activity feed | **F16 does NOT build the activity feed.** Reserve structural space in the modal layout only (F19 owns). | User Journey 3 / REQ-5.1 activity feed = F19. F16 ships attributes only. |
| D10 | Port existing modals onto `Modal` primitive | **Port `EditTicketModal` (and optionally `CreateTicketModal`) onto the new `Modal`** for shared a11y. | `EditTicketModal.tsx:31-36` and `CreateTicketModal.tsx:31-36` are bare `<div role="dialog">` with no a11y. Once `Modal` exists, porting them eliminates duplicate a11y bugs. |
| D11 | Assignee optimistic-write cleanup | **Optional: add `assigneeId` to the optimistic set** in `useUpdateTicket`. | `useUpdateTicket.ts:42-48` omits `assigneeId` → avatar flickers stale until `onSettled`. Minor; can defer. **Deviate flag:** not required for F16 acceptance. |
| D12 | Display ID + date utils | **Add `formatTicketId(slug, ticketNumber)` + `formatDate(iso)` utils.** | `SLUG-NNN` (REQ-3.1) currently computed inline in `TicketCard.tsx:39-40`; timestamps rendered nowhere. Extract shared utils so card + modal agree. |
| D13 | Auth | **`authenticate` only — NO `requireRole`** for the detail/edit path. | REQ-3.3: any authenticated user may edit tickets. |
| D14 | No new dependency | **No new FE/BE package.** | a11y hand-rolled; date format via `Intl.DateTimeFormat`; tabbable query via `querySelectorAll`. |
| D15 | Error responses | **Mirror existing 401/404/400 `{ error }` envelope.** No invented codes. | `js-development-rules.md` envelope; no canonical error-code enum exists. |

> **Out of F16 scope (explicitly deferred):**
> - **Delete ticket (Admin-only)** → **F17** (REQ-3.3). F16 reserves a seam only.
> - **Activity feed / history** → **F19** (REQ-5.1, User Journey 3). F16 reserves structural space only.
> - **Audit logging on edit** → **F18** (REQ-5.2/5.3). F16 preserves the `{ old, new }` seam.
> - **Timer / time tracking in the modal** → **F20** (User Journey 1 steps 5/7). Out of scope.
> - **WYSIWYG rich-text description** → REQ-3.2 calls for it, but the current description is a plain textarea; rich text is a separate concern not in F16's acceptance.

> **Owner sign-off needed (see §9):** deep-link nested-route vs query-param (recommend nested route); hand-roll a11y vs Radix/HeadlessUI (recommend hand-roll, 0 deps); confirm F16 does NOT ship delete (F17 owns); confirm F16 omits/reserves activity (F19 owns); drift strategy refetchInterval vs board-cache seed (recommend refetchInterval); port CreateTicketModal now or defer; assigneeId optimistic cleanup in F16 or defer.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       └── services/
│           ├── ticketService.ts                            # MODIFY (T1) — getTicket left-join users (creator + assignee) with FK-dangle guard
│           └── ticketService.test.ts                       # MODIFY (T1/T4) — creator/assignee hydration; FK-dangle (null user)
└── frontend/
    └── src/
        ├── types/
        │   └── ticket.ts                                   # MODIFY (T2) — Ticket.creator { id, fullName, avatarUrl } | null
        ├── utils/
        │   ├── formatDate.ts                               # NEW (T5) — Intl.DateTimeFormat wrapper (created/updated display)
        │   └── formatTicketId.ts                           # NEW (T5) — `${slug.toUpperCase()}-${ticketNumber}` shared by card + modal
        ├── hooks/
        │   ├── useModalA11y.ts                             # NEW (T3) — focus trap, Esc, scroll lock, inert, focus restore
        │   └── useModalA11y.test.ts                        # NEW (T7) — Esc, trap wrap, scroll lock, restore, inert
        ├── components/
        │   ├── Modal.tsx                                   # NEW (T3) — shell: backdrop, role=dialog, aria-labelledby, portals a11y hook
        │   ├── Modal.test.tsx                              # NEW (T7)
        │   ├── ConfirmDiscardDialog.tsx                    # NEW (T5) — "discard changes?" on dirty close
        │   ├── ConfirmDiscardDialog.test.tsx               # NEW (T7)
        │   ├── TicketDetailModal.tsx                       # NEW (T5) — view header (ID, creator, timestamps) + TicketAttributeForm + unsaved guard + drift refetch
        │   ├── TicketDetailModal.test.tsx                  # NEW (T8)
        │   ├── EditTicketModal.tsx                         # MODIFY (T6) — port onto <Modal> OR redirect to TicketDetailModal
        │   └── CreateTicketModal.tsx                       # MODIFY (T6, optional) — port onto <Modal>
        ├── routes/
        │   └── index.tsx                                   # MODIFY (T6) — nested route tickets/:ticketId over board <Outlet>
        └── pages/
            └── BoardPage.tsx                               # MODIFY (T6) — deep-link wiring (read :ticketId, render TicketDetailModal)
```

**Modal open lifecycle (post-F16, deep-linked):**

1. User clicks a card → `navigate(\`/projects/${slug}/tickets/${ticketId}\`)` (or direct URL entry).
2. react-router matches the nested route; board `<Outlet>` stays mounted; `TicketDetailModal` renders over it.
3. `TicketDetailModal` reads `useParams().ticketId`; `useQuery({ queryKey: ticketKeys.detail(id), refetchInterval: 30000, refetchOnMount: true, refetchOnWindowFocus: true })` fetches the resolved ticket (creator + assignee hydrated by T1).
4. RHF `TicketAttributeForm` seeded once from the detail query's first load (`defaultValues`); background refetches update the query cache but never re-seed RHF → unsaved input preserved.
5. On edit → `useUpdateTicket` optimistic-spreads into board + detail caches; `onSettled` invalidates both.
6. On close (Esc / backdrop / close button) → if `formState.isDirty`, `ConfirmDiscardDialog` intercepts → discard (`onClose()`) or cancel. `useBlocker(isDirty)` guards back/forward route nav.
7. `useModalA11y` on mount: capture `document.activeElement`, focus first tabbable, lock scroll (`body.overflow=hidden` + `inert` on app `<main>`), Tab wraps first↔last; on Esc dispatch the dirty-check; on unmount restore focus to trigger.

---

## 5. Parallelization Strategy

Tasks are grouped into **5 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently. The backend creator/assignee resolution (T1) and the FE modal a11y primitive (T3) are fully independent chains.

### Batch dependency diagram

```
 ┌─ Batch 1 (independent foundations) ───────────────────────────────────┐
 │  T1  BE getTicket creator+assignee join + FK-dangle guard + test      │
 │      [backend/src/services/ticketService.ts,                          │
 │       backend/src/services/ticketService.test.ts]                     │
 │  T3  FE useModalA11y hook + Modal primitive (+test)                   │
 │      [frontend/src/hooks/useModalA11y.ts,                             │
 │       frontend/src/components/Modal.tsx,                              │
 │       frontend/src/hooks/useModalA11y.test.ts,                        │
 │       frontend/src/components/Modal.test.tsx]                         │
 │  (T1 ‖ T3 disjoint — BE vs FE, zero overlap)                          │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (creator hydration contract; a11y primitive)
                          ▼
 ┌─ Batch 2 (FE foundation layer 2) ─────────────────────────────────────┐
 │  T2  FE Ticket.creator type                                            │
 │      [frontend/src/types/ticket.ts]                                    │
 │  T5  ConfirmDiscardDialog + formatDate/formatTicketId utils +          │
 │      TicketDetailModal (view header + TicketAttributeForm embed +      │
 │      unsaved guard isDirty+useBlocker + drift refetch)                 │
 │      [frontend/src/utils/formatDate.ts,                                │
 │       frontend/src/utils/formatTicketId.ts,                            │
 │       frontend/src/components/ConfirmDiscardDialog.tsx,                │
 │       frontend/src/components/TicketDetailModal.tsx]                   │
 │  (T2 → T5 serialized WITHIN B2; T5 imports Ticket.creator from T2)     │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (modal shell + types available)
                          ▼
 ┌─ Batch 3 (wiring) ─────────────────────────────────────────────────────┐
 │  T6  nested route + BoardPage deep-link wiring + port EditTicketModal  │
 │      (+ optionally CreateTicketModal) onto <Modal>                     │
 │      [frontend/src/routes/index.tsx,                                   │
 │       frontend/src/pages/BoardPage.tsx,                                │
 │       frontend/src/components/EditTicketModal.tsx,                     │
 │       frontend/src/components/CreateTicketModal.tsx]                   │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (feature wired end-to-end)
                          ▼
 ┌─ Batch 4 (tests + optional cleanup) ───────────────────────────────────┐
 │  T7  a11y primitive tests (useModalA11y, Modal, ConfirmDiscardDialog)  │
 │      [frontend/src/hooks/useModalA11y.test.ts,                         │
 │       frontend/src/components/Modal.test.tsx,                          │
 │       frontend/src/components/ConfirmDiscardDialog.test.tsx]           │
 │  T8  TicketDetailModal integration tests + deep-link test              │
 │      [frontend/src/components/TicketDetailModal.test.tsx]              │
 │  T9  (optional) assigneeId optimistic cleanup                          │
 │      [frontend/src/hooks/useUpdateTicket.ts]                           │
 │  (T7 ‖ T8 ‖ T9 disjoint; T9 optional/deferred)                         │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │
                          ▼
 ┌─ Batch 5 (terminal verification) ──────────────────────────────────────┐
 │  T10 Integration gate: typecheck/lint/format/test/build + live smoke   │
 │      (no new feature files)                                            │
 └────────────────────────────────────────────────────────────────────────┘
```

- **B1: T1 ‖ T3.** T1 owns `ticketService.ts` (BE); T3 owns `useModalA11y.ts` + `Modal.tsx` (FE). **Zero file overlap.**
- **B1 → B2 hard barrier:** T5's `TicketDetailModal` consumes `Ticket.creator` (T2) AND the `Modal` primitive (T3); T2's type mirrors the BE contract from T1.
- **Within B2: T2 → T5.** T5 imports `Ticket.creator` from T2 (`types/ticket.ts`).
- **B2 → B3 hard barrier:** T6 wires the route + BoardPage around the now-existing `TicketDetailModal` (T5).
- **B3 → B4 hard barrier:** tests run against the as-wired feature.
- **Within B4: T7 ‖ T8 ‖ T9.** a11y tests vs modal tests vs optional hook cleanup — disjoint files. T9 may be deferred.
- **B4 → B5 hard barrier:** T10 verifies the merged feature.

### Merge order rules

1. **B1 (T1 ‖ T3) merges first.** Both touch disjoint files; either order. `main` must have both before B2 branches.
2. **B2 (T2 → T5) merges second.** FE foundation; T5 needs T2's type.
3. **B3 (T6) merges third.** Route + BoardPage + modal port.
4. **B4 (T7 ‖ T8 ‖ T9) merges fourth.** Tests; T9 optional.
5. **B5 (T10) merges last.** Verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/services/ticketService.ts`, `backend/src/services/ticketService.test.ts` | F13–F15 (DONE) | T3 |
| **T2** | 2 | `frontend/src/types/ticket.ts` | T1 (contract) | — |
| **T3** | 1 | `frontend/src/hooks/useModalA11y.ts`, `frontend/src/components/Modal.tsx`, `frontend/src/hooks/useModalA11y.test.ts`, `frontend/src/components/Modal.test.tsx` | F13–F15 (DONE) | T1 |
| **T4** | 1 | `backend/src/services/ticketService.test.ts` (consolidated into T1; listed separately if split) | T1 | — |
| **T5** | 2 | `frontend/src/utils/formatDate.ts`, `frontend/src/utils/formatTicketId.ts`, `frontend/src/components/ConfirmDiscardDialog.tsx`, `frontend/src/components/TicketDetailModal.tsx` | T2, T3 | — |
| **T6** | 3 | `frontend/src/routes/index.tsx`, `frontend/src/pages/BoardPage.tsx`, `frontend/src/components/EditTicketModal.tsx`, `frontend/src/components/CreateTicketModal.tsx` | T5 | — |
| **T7** | 4 | `frontend/src/hooks/useModalA11y.test.ts`, `frontend/src/components/Modal.test.tsx`, `frontend/src/components/ConfirmDiscardDialog.test.tsx` | T3, T5 | T8, T9 |
| **T8** | 4 | `frontend/src/components/TicketDetailModal.test.tsx` | T5, T6 | T7, T9 |
| **T9** | 4 | `frontend/src/hooks/useUpdateTicket.ts` (optional) | F13 | T7, T8 |
| **T10** | 5 | (verification record only) | T1–T9 | — |

### Developer assignment tracks

- **Solo (recommended):** (T1 ‖ T3) → (T2 → T5) → T6 → (T7 ‖ T8) → T10. ~2-2.5 days.
- **2 devs:**
    - **Dev-A (backend + a11y):** T1 → T3 → T7.
    - **Dev-B (frontend modal):** waits for B1 contracts, then (T2 → T5) → T6 → T8.
    - Merge order: B1 → B2 → B3 → B4 → B5.
- **3 devs:** Dev-A T1; Dev-B T3; Dev-C waits then T2→T5. Converge on T6 → (T7 ‖ T8) → T10.

---

## 6. Tasks

### T1 — BE getTicket: left-join users for creator + assignee (FK-dangle guard)

**Batch:** 1 · **Depends on:** F13–F15 (DONE) · **Parallel with:** T3

**Description:** The view-header spine. Widen `getTicket` (`backend/src/services/ticketService.ts:223-231`) to left-join `users` twice (creator + assignee) and return resolved `{ id, fullName, avatarUrl }` objects — mirroring `boardService`'s FK-dangle guard at `boardService.ts:96-108` (assignee left-join that tolerates a null/deleted user). **No migration** — FK `creator_id → users.id` exists at `schema.ts:121-123`. This is a query-shape change.

Modify `backend/src/services/ticketService.ts` — `getTicket` (`:223-231`):

```typescript
import { users } from '../db/schema'
import { alias } from 'drizzle-orm/pg-core'

const creatorUser = alias(users, 'creator_user')
const assigneeUser = alias(users, 'assignee_user')

export async function getTicket(ticketId: string) {
  const rows = await db
    .select({
      ticket: tickets,
      creatorId: creatorUser.id,
      creatorFullName: creatorUser.fullName,
      creatorAvatarUrl: creatorUser.avatarUrl,
      assigneeId: assigneeUser.id,
      assigneeFullName: assigneeUser.fullName,
      assigneeAvatarUrl: assigneeUser.avatarUrl,
    })
    .from(tickets)
    .leftJoin(creatorUser, eq(creatorUser.id, tickets.creatorId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .where(eq(tickets.id, ticketId))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // FK-dangle guard (mirror boardService.ts:96-108): null joined user → null object
  const { ticket, ...joined } = row
  const labelMap = await hydrateLabelsForTickets([ticketId])
  return {
    ...ticket,
    creator:
      joined.creatorId === null
        ? null
        : { id: joined.creatorId, fullName: joined.creatorFullName ?? 'Unknown user', avatarUrl: joined.creatorAvatarUrl },
    assignee:
      joined.assigneeId === null
        ? null
        : { id: joined.assigneeId, fullName: joined.assigneeFullName ?? 'Unknown user', avatarUrl: joined.assigneeAvatarUrl },
    labels: labelMap.get(ticketId) ?? [],
  }
}
```

(Use Drizzle's `alias()` from `drizzle-orm/pg-core` for the second join — the pattern is standard Drizzle. Verify the exact alias import + the existing `hydrateLabelsForTickets` signature; preserve the existing labels hydration path.) Keep `creatorId`/`assigneeId` on the returned ticket row (`...ticket` carries them from the schema) for backwards compat (the board route still uses bare ids).

Add tests in `backend/src/services/ticketService.test.ts`:
- `getTicket` returns `creator { id, fullName, avatarUrl }` resolved from the joined user.
- `getTicket` returns `assignee` resolved (matching the existing `boardService` shape).
- FK-dangle: a ticket whose `creatorId` points at a deleted user → `creator: null` (not a crash, not a bare id). Same for `assigneeId`.
- Ticket not found → returns null (route maps to 404).
- Labels hydration unchanged.

**Acceptance Criteria:**
- [ ] `getTicket` left-joins `users` for both creator and assignee (via `alias()`).
- [ ] Returns `creator { id, fullName, avatarUrl } | null` and `assignee { id, fullName, avatarUrl } | null`.
- [ ] FK-dangle: deleted creator/assignee user → `null` object, no crash (mirrors `boardService.ts:96-108`).
- [ ] Ticket not found → returns null (route → 404).
- [ ] Labels hydration unchanged.
- [ ] `rtk tsc` (BE) passes.
- [ ] No `any`; no new migration; FK `creator_id` already exists.
- [ ] `GET /api/tickets/:id` route (`tickets.routes.ts:15-27`) still responds 200 with the widened payload.

**Dependencies:** F13–F15 (DONE). Decision D3 (creator+assignee join), D13 (no admin gate on read).

---

### T2 — FE type: `Ticket.creator`

**Batch:** 2 · **Depends on:** T1 (contract) · **Parallel with:** —

**Description:** Add the resolved `creator` object to the FE `Ticket` type so the modal header can render it. Mirror the existing `Assignee` shape (`types/ticket.ts`).

Modify `frontend/src/types/ticket.ts` (`:31-45`):

```typescript
export interface Creator {
    id: string
    fullName: string
    avatarUrl: string | null
}

export interface Ticket {
    id: string
    ticketNumber: number
    title: string
    description: string | null
    statusColumn: string
    position: number
    priority: Priority
    labels: Label[]
    checklist: ChecklistItem[]
    assignee: Assignee | null
    creator: Creator | null // NEW — F16 (resolved by getTicket)
    creatorId: string // retained for board-payload compatibility (bare id)
    createdAt: string
    updatedAt: string
}
```

(If `Assignee` and `Creator` are structurally identical, you may alias: `export type Creator = Assignee`. Prefer an explicit type for clarity unless they diverge.) Note: existing fixtures that build `Ticket` literals will need `creator: null` added — fold those test-fixture updates into this task (TS will flag them).

**Acceptance Criteria:**
- [ ] `types/ticket.ts` exports `Creator` (or alias) with `{ id, fullName, avatarUrl }`.
- [ ] `Ticket` includes `creator: Creator | null`.
- [ ] `creatorId` retained for board-payload compatibility.
- [ ] All existing `Ticket` fixtures updated to include `creator` (tsc-clean).
- [ ] `rtk tsc` (FE) passes.
- [ ] No `any`.

**Dependencies:** T1 (BE returns the resolved creator). Decision D4.

---

### T3 — FE a11y primitive: `useModalA11y` hook + `Modal` component

**Batch:** 1 · **Depends on:** F13–F15 (DONE) · **Parallel with:** T1

**Description:** The reusable accessible dialog primitive F16 (and later T6's modal ports) builds on. Hand-rolled, 0 new deps. Implements W3C APG Dialog Pattern: focus trap, initial focus, Esc handler, scroll lock (`body.overflow=hidden` + `inert` on app root), focus restore.

Create `frontend/src/hooks/useModalA11y.ts` (~60-80 lines):

```typescript
import { useCallback, useEffect, useRef } from 'react'

interface UseModalA11yOptions {
    isOpen: boolean
    onClose: () => void
    /** Called on Esc when the consumer wants a dirty-check before close */
    onEsc?: () => void
}

const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModalA11y({ isOpen, onClose, onEsc }: UseModalA11yOptions) {
    const dialogRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLElement | null>(null)
    const appRootRef = useRef<HTMLElement | null>(null)

    // Mount: capture trigger, focus first tabbable, lock scroll, inert app root
    useEffect(() => {
        if (!isOpen || !dialogRef.current) return
        triggerRef.current = document.activeElement as HTMLElement | null
        appRootRef.current = document.getElementById('app-root') // <main id="app-root">

        const first = dialogRef.current.querySelector<HTMLElement>(TABBABLE)
        ;(first ?? dialogRef.current).focus()

        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        if (appRootRef.current) appRootRef.current.inert = true

        // Cleanup: restore
        return () => {
            document.body.style.overflow = prevOverflow
            if (appRootRef.current) appRootRef.current.inert = false
            triggerRef.current?.focus()
        }
    }, [isOpen])

    // Tab wrap (first <-> last) + Esc
    const onKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (!isOpen || !dialogRef.current) return
            if (e.key === 'Escape') {
                e.stopPropagation()
                ;(onEsc ?? onClose)()
                return
            }
            if (e.key !== 'Tab') return
            const tabbables = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(TABBABLE),
            )
            if (tabbables.length === 0) return
            const first = tabbables[0]!
            const last = tabbables[tabbables.length - 1]!
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
            }
        },
        [isOpen, onClose, onEsc],
    )

    useEffect(() => {
        if (!isOpen) return
        document.addEventListener('keydown', onKeyDown, { capture: true })
        return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
    }, [isOpen, onKeyDown])

    return { dialogRef }
}
```

> **Prerequisite:** the app shell must wrap the routed UI in an element with `id="app-root"` (e.g. `<main id="app-root">`) so `inert` can be applied. Verify/apply this in `AppLayout`/router layout during T6 (add the id if missing). Without it, scroll-lock still works (`body.overflow`) but `inert` is a no-op.

Create `frontend/src/components/Modal.tsx`:

```tsx
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalA11y } from '../hooks/useModalA11y'

interface ModalProps {
    isOpen: boolean
    onClose: () => void
    onEsc?: () => void
    titleId: string
    title: string
    children: ReactNode
    /** When true, backdrop click is ignored (e.g. dirty form) */
    blockBackdropClose?: boolean
}

export function Modal({ isOpen, onClose, onEsc, titleId, title, children, blockBackdropClose }: ModalProps) {
    const { dialogRef } = useModalA11y({ isOpen, onClose, onEsc })
    if (!isOpen) return null

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !blockBackdropClose) onClose()
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl outline-none"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 id={titleId} className="text-lg font-semibold">
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="text-gray-500 hover:text-gray-700"
                    >
                        ×
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body,
    )
}
```

**Acceptance Criteria:**
- [ ] `useModalA11y` captures `document.activeElement` on open, restores focus on close.
- [ ] Initial focus lands on first tabbable element (fallback: the dialog container with `tabIndex={-1}`).
- [ ] Tab wraps first↔last tabbable; Shift+Tab wraps last↔first.
- [ ] Esc invokes `onEsc` if provided, else `onClose`.
- [ ] `document.body.style.overflow = 'hidden'` on open; restored on close.
- [ ] App root (`#app-root`) gets `inert = true` on open; restored on close.
- [ ] `Modal` renders via portal to `document.body`; `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`.
- [ ] Backdrop `onMouseDown` (only when `e.target === e.currentTarget`) closes — unless `blockBackdropClose`.
- [ ] No new dependency in `package.json`.
- [ ] No `any`; no inline styles (Tailwind only).
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** F13–F15 (DONE). Decision D1 (hand-rolled, 0 deps).

---

### T4 — BE tests: creator/assignee hydration + FK-dangle (consolidated into T1)

**Batch:** 1 · **Depends on:** T1 · **Parallel with:** —

**Description:** If the BE test changes from T1 are split out, this task owns `backend/src/services/ticketService.test.ts` exclusively: creator/assignee hydration, FK-dangle (null user), not-found return-null. In practice T1 and T4 are often one commit (disjoint only if the implementer prefers code-then-tests). See T1's test bullets.

**Acceptance Criteria:**
- [ ] `getTicket` test asserts resolved `creator { id, fullName, avatarUrl }`.
- [ ] FK-dangle test: deleted creator → `creator: null`; deleted assignee → `assignee: null`.
- [ ] Not-found test: missing ticket → returns null (route → 404).
- [ ] Coverage of `getTicket` > 80%.
- [ ] No `any`; `import type` for shared types.

**Dependencies:** T1.

---

### T5 — FE `ConfirmDiscardDialog` + date/id utils + `TicketDetailModal`

**Batch:** 2 · **Depends on:** T2, T3 · **Parallel with:** —

**Description:** The F16 feature surface. Three small utilities + the confirm dialog + the unified modal. `TicketDetailModal` renders a read-only view header (display ID, creator avatar+name, created/updated timestamps), embeds the reused `TicketAttributeForm` (F13/F14/F15) for inline editing, wires the `Modal` a11y primitive, and installs the unsaved-changes guard (RHF `isDirty` + react-router `useBlocker` + `ConfirmDiscardDialog`).

Create `frontend/src/utils/formatTicketId.ts`:

```typescript
export function formatTicketId(slug: string, ticketNumber: number): string {
    return `${slug.toUpperCase()}-${ticketNumber}`
}
```

(Refactor `TicketCard.tsx:39-40` to call it during T6/T8 if scope expands; keep T5 focused on the modal.)

Create `frontend/src/utils/formatDate.ts`:

```typescript
export function formatDate(iso: string): string {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(iso))
}
```

Create `frontend/src/components/ConfirmDiscardDialog.tsx`:

```tsx
import { Modal } from './Modal'

interface ConfirmDiscardDialogProps {
    isOpen: boolean
    onDiscard: () => void
    onCancel: () => void
}

export function ConfirmDiscardDialog({ isOpen, onDiscard, onCancel }: ConfirmDiscardDialogProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            titleId="discard-dialog-title"
            title="Discard changes?"
            blockBackdropClose
        >
            <p className="mb-4 text-sm text-gray-600">
                You have unsaved changes. Discard them and close?
            </p>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onDiscard}
                    className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
                >
                    Discard
                </button>
            </div>
        </Modal>
    )
}
```

Create `frontend/src/components/TicketDetailModal.tsx`:

```tsx
import { useState } from 'react'
import { useBlocker } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Modal } from './Modal'
import { ConfirmDiscardDialog } from './ConfirmDiscardDialog'
import { TicketAttributeForm } from './TicketAttributeForm'
import { fetchTicket } from '../api/tickets'
import { ticketKeys } from '../api/queryKeys'
import { formatTicketId } from '../utils/formatTicketId'
import { formatDate } from '../utils/formatDate'
import type { UpdateTicketDto } from '../types/ticket'

interface TicketDetailModalProps {
    slug: string
    ticketId: string
    onClose: () => void
    onSubmit: (dto: UpdateTicketDto) => Promise<void>
}

export function TicketDetailModal({ slug, ticketId, onClose, onSubmit }: TicketDetailModalProps) {
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [isDirty, setIsDirty] = useState(false)

    // Drift reconciliation: refetch while modal open (D7)
    const { data: ticket } = useQuery({
        queryKey: ticketKeys.detail(ticketId),
        queryFn: () => fetchTicket(ticketId),
        refetchInterval: 30_000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
    })

    // Unsaved guard: block route nav when dirty (D6)
    const blocker = useBlocker(isDirty)

    // Esc / backdrop / close-button dirty-check
    const requestClose = () => {
        if (isDirty) setConfirmOpen(true)
        else onClose()
    }

    // route-nav guard surfaced → open confirm
    if (blocker.state === 'blocked' && !confirmOpen) {
        setConfirmOpen(true)
    }

    const handleDiscard = () => {
        setConfirmOpen(false)
        if (blocker.state === 'blocked') blocker.proceed()
        onClose()
    }

    const handleCancelConfirm = () => {
        setConfirmOpen(false)
        if (blocker.state === 'blocked') blocker.reset()
    }

    if (!ticket) return null

    return (
        <>
            <Modal
                isOpen
                onClose={requestClose}
                onEsc={requestClose}
                titleId="ticket-detail-title"
                title={formatTicketId(slug, ticket.ticketNumber)}
                blockBackdropClose={isDirty}
            >
                {/* VIEW HEADER — display ID, creator, timestamps (read-only) */}
                <dl className="mb-4 space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                        {ticket.creator && (
                            <>
                                <img
                                    src={ticket.creator.avatarUrl ?? undefined}
                                    alt=""
                                    className="h-5 w-5 rounded-full"
                                />
                                <span>Created by {ticket.creator.fullName}</span>
                            </>
                        )}
                    </div>
                    <div>Created: {formatDate(ticket.createdAt)}</div>
                    <div>Updated: {formatDate(ticket.updatedAt)}</div>
                </dl>

                {/* EDIT BODY — reuse F13/F14/F15 form (D2) */}
                <TicketAttributeForm
                    mode="edit"
                    projectSlug={slug}
                    defaultValues={{
                        title: ticket.title,
                        description: ticket.description ?? '',
                        priority: ticket.priority,
                        assigneeId: ticket.assignee?.id ?? null,
                        labelIds: ticket.labels.map((l) => l.id),
                        checklist: ticket.checklist,
                    }}
                    onDirtyChange={setIsDirty}
                    onSubmit={async (values) => {
                        await onSubmit(values as UpdateTicketDto)
                        setIsDirty(false)
                        onClose()
                    }}
                    onCancel={requestClose}
                />

                {/* RESERVED SEAM: delete button (F17) — do NOT render in F16 */}
                {/* RESERVED SPACE: activity feed (F19) — do NOT build in F16 */}
            </Modal>

            <ConfirmDiscardDialog
                isOpen={confirmOpen}
                onDiscard={handleDiscard}
                onCancel={handleCancelConfirm}
            />
        </>
    )
}
```

Notes for the implementer:
- `TicketAttributeForm` currently destructures `formState: { errors, isSubmitting }` (`TicketAttributeForm.tsx:55`); **add an `onDirtyChange?: (dirty: boolean) => void` prop** that forwards `formState.isDirty` via a `useEffect` so the modal shell can drive `useBlocker` and the confirm dialog. This is a small additive change to the shared form — coordinate so it does not break F13/F14/F15 callers (the prop is optional).
- `defaultValues` are seeded ONCE (RHF semantics). Background `refetchInterval` updates the query cache but RHF does not re-seed → unsaved typing preserved (D7).
- Priority display via existing `PRIORITY_DISPLAY` (F09) where the header or select needs Title-case.
- `<img alt="">` for decorative avatars (the name is in the adjacent text).

**Acceptance Criteria:**
- [ ] `formatTicketId(slug, ticketNumber)` returns `SLUG-NNN` (uppercase slug).
- [ ] `formatDate(iso)` renders a human-readable timestamp via `Intl.DateTimeFormat`.
- [ ] `ConfirmDiscardDialog` renders inside `Modal` with Cancel + Discard; backdrop blocked.
- [ ] `TicketDetailModal` renders display ID (`SLYK-NNN`), creator (avatar + name), created/updated timestamps.
- [ ] Embeds `TicketAttributeForm mode="edit"` (no fork) — title/description/priority/assignee/labels/checklist editable.
- [ ] Esc / backdrop / close-button call `requestClose`; if `isDirty`, open `ConfirmDiscardDialog` instead of closing.
- [ ] `useBlocker(isDirty)` guards route nav (back/forward); `blocked` → confirm dialog → `proceed()` closes, `reset()` stays.
- [ ] Detail query uses `refetchInterval: 30000`, `refetchOnMount: true`, `refetchOnWindowFocus: true`.
- [ ] `TicketAttributeForm` gains an optional `onDirtyChange` prop (non-breaking).
- [ ] No delete button rendered (F17 seam reserved, commented).
- [ ] No activity feed built (F19 space reserved, commented).
- [ ] No `any`; no inline styles; `import type` for `Ticket`, `UpdateTicketDto`, `ReactNode`.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T2 (`Ticket.creator`), T3 (`Modal`/`useModalA11y`). Decisions D2, D5 (route), D6 (guard), D7 (drift), D8 (no delete), D9 (no activity), D12 (utils).

---

### T6 — FE wiring: nested route + BoardPage deep-link + port existing modals onto `Modal`

**Batch:** 3 · **Depends on:** T5 · **Parallel with:** —

**Description:** Wire the deep-link. Add a nested route `tickets/:ticketId` over the board `<Outlet>` so the board stays mounted (no refetch) and the URL is shareable. `BoardPage` reads `useParams().ticketId` and renders `TicketDetailModal` when present. Card click navigates to the nested URL (back closes). Port `EditTicketModal` (and optionally `CreateTicketModal`) onto the `Modal` primitive for shared a11y. Also ensure the app shell wraps routed UI in `<main id="app-root">` (T3 `inert` dependency).

Modify `frontend/src/routes/index.tsx` (`:34-68`) — add the nested child route:

```typescript
{
  path: '/projects/:slug',
  element: <BoardPage />,
  children: [
    {
      path: 'tickets/:ticketId',
      element: <BoardPage />, // same component; reads :ticketId to overlay the modal
    },
  ],
}
```

(Exact shape depends on the existing route config at `:50`; the key is that `tickets/:ticketId` renders over the board so the board element stays mounted. If the data router uses a layout route, nest under it.)

Modify `frontend/src/pages/BoardPage.tsx`:
- Read `const { ticketId } = useParams()` — when present, render `<TicketDetailModal slug={slug} ticketId={ticketId} onClose={() => navigate(\`/projects/${slug}\`)} onSubmit={(dto) => updateTicket.mutateAsync({ ticketId, dto, slug })} />` over the board.
- Card click (`handleEdit` at `BoardPage.tsx:38-41`) changes from local state to `navigate(\`/projects/${slug}/tickets/${ticket.id}\`)` so the URL updates and back closes.
- Remove the now-redundant local modal-open state if `EditTicketModal` was driven by it.

Modify `frontend/src/components/EditTicketModal.tsx`:
- **Option A (recommended):** replace its internals with `<TicketDetailModal>` (it becomes a thin forward), since `TicketDetailModal` is the unified surface.
- **Option B:** port its existing `<div role="dialog">` (`:31-36`) onto `<Modal>` so it gains a11y without becoming the detail modal. Choose based on whether `EditTicketModal` is still referenced elsewhere.

Modify `frontend/src/components/CreateTicketModal.tsx` (`:31-36`) — **optional** — port onto `<Modal>` for shared a11y. Defer if out of scope (owner sign-off §9f).

Also: ensure `AppLayout`/router layout wraps routed content in `<main id="app-root">` so `useModalA11y`'s `inert` applies (T3 prerequisite).

**Acceptance Criteria:**
- [ ] Route `/projects/:slug/tickets/:ticketId` renders `TicketDetailModal` over the mounted board.
- [ ] Board stays mounted when the modal opens (no board refetch; board cache + 30s poll continue).
- [ ] Card click navigates to the nested URL; browser Back closes the modal.
- [ ] Direct URL entry (`/projects/:slug/tickets/123`) opens the modal for that ticket.
- [ ] `onClose` navigates back to `/projects/:slug`.
- [ ] `EditTicketModal` either forwards to `TicketDetailModal` or is ported onto `<Modal>` (a11y gained).
- [ ] (Optional) `CreateTicketModal` ported onto `<Modal>`.
- [ ] App shell wraps routed content in `<main id="app-root">` (inert target).
- [ ] No `any`; no inline styles.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T5 (`TicketDetailModal`). Decision D5 (nested route), D10 (port modals).

---

### T7 — FE a11y primitive tests

**Batch:** 4 · **Depends on:** T3, T5 · **Parallel with:** T8, T9

**Description:** Vitest coverage for the a11y primitive and confirm dialog.

Create `frontend/src/hooks/useModalA11y.test.ts`:
- Esc key invokes `onClose` (or `onEsc` if provided).
- Tab wraps from last tabbable to first; Shift+Tab wraps first to last.
- On open: focus moves to first tabbable (fallback dialog container).
- On close: focus restored to the trigger (`document.activeElement` before open).
- `document.body.style.overflow === 'hidden'` while open; restored after.
- App root `inert === true` while open; `false` after.

Create `frontend/src/components/Modal.test.tsx`:
- Renders via portal to `document.body`.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` point at the title `<h2 id>`.
- Backdrop click closes (unless `blockBackdropClose`).
- Close button (`aria-label="Close dialog"`) closes.
- `isOpen={false}` renders nothing.

Create `frontend/src/components/ConfirmDiscardDialog.test.tsx`:
- Discard button calls `onDiscard`; Cancel calls `onCancel`.
- Backdrop blocked (`blockBackdropClose`).
- Accessible via `getByRole('button', { name: /Discard/ })` and `getByRole('button', { name: /Cancel/ })`.

**Acceptance Criteria:**
- [ ] `useModalA11y.test.ts` covers Esc, Tab wrap (both directions), initial focus, focus restore, scroll lock, inert.
- [ ] `Modal.test.tsx` covers portal, ARIA attributes, backdrop close (incl. blocked), close button, hidden-when-closed.
- [ ] `ConfirmDiscardDialog.test.tsx` covers Discard + Cancel + blocked backdrop.
- [ ] All queries use `getByRole`/`getByLabelText` priority (no `getByTestId` unless unavoidable).
- [ ] Coverage of new components > 70%.
- [ ] No `any`.

**Dependencies:** T3, T5.

---

### T8 — FE `TicketDetailModal` integration + deep-link tests

**Batch:** 4 · **Depends on:** T5, T6 · **Parallel with:** T7, T9

**Description:** End-to-end coverage of the feature surface.

Create `frontend/src/components/TicketDetailModal.test.tsx`:
- Renders display ID `SLYK-NNN` (via `formatTicketId`).
- Renders creator avatar + name from `ticket.creator`.
- Renders created/updated timestamps (formatted).
- Embeds `TicketAttributeForm` seeded from the fetched ticket.
- Submit calls `onSubmit` with the edited values, then `onClose`.
- Dirty form + Esc → `ConfirmDiscardDialog` opens (not closed).
- Dirty form + backdrop click → confirm opens (backdrop blocked).
- Dirty form + close button → confirm opens.
- Clean form + Esc → closes immediately.
- `useBlocker` route-nav scenario: dirty + back → confirm → Discard closes, Cancel stays.
- Drift: a background refetch (mock `fetchTicket` returning updated title) does NOT overwrite unsaved RHF input (assert the textarea still holds the user's typing).

Deep-link test (in `BoardPage` or a route test):
- `/projects/:slug/tickets/:ticketId` renders `TicketDetailModal` with the board still mounted.
- Back navigation closes the modal.

**Acceptance Criteria:**
- [ ] Display ID, creator, timestamps rendered.
- [ ] `TicketAttributeForm` seeded + submit wired.
- [ ] Dirty-guard covers Esc, backdrop, close button, and route-nav (useBlocker).
- [ ] Clean close works without confirm.
- [ ] Drift test: background refetch preserves unsaved RHF input.
- [ ] Deep-link test: nested route mounts modal over board; back closes.
- [ ] `getByRole`/`getByLabelText` priority.
- [ ] Coverage of `TicketDetailModal` > 70%.
- [ ] No `any`.

**Dependencies:** T5, T6.

---

### T9 — (Optional) FE assigneeId optimistic-write cleanup

**Batch:** 4 · **Depends on:** F13 · **Parallel with:** T7, T8

**Description:** Optional quality cleanup. Add `assigneeId` to the optimistic set in `useUpdateTicket` (`useUpdateTicket.ts:42-48`) and the per-field spread in `boardPatch.ts:24-29` so the avatar stops flickering stale between mutation and `onSettled` refetch. **Not required for F16 acceptance — defer if time-boxed (owner sign-off §9g).**

Modify `frontend/src/hooks/useUpdateTicket.ts` (`:42-48`) — add `assigneeId` to the optimistic patch. Note: because `assignee` is a resolved object (server join), the optimistic write can only patch `assigneeId`; the resolved `assignee { fullName, avatarUrl }` will still refresh on `onSettled`. Acceptable: the id updates instantly, the avatar/name hydrate on settle.

Modify `frontend/src/utils/boardPatch.ts` (`:24-29`) — add `if (patch.assigneeId !== undefined) next.assigneeId = patch.assigneeId`.

Extend `frontend/src/hooks/useUpdateTicket.test.ts` + `frontend/src/utils/boardPatch.test.ts` with assigneeId cases.

**Acceptance Criteria:**
- [ ] `useUpdateTicket` optimistic path includes `assigneeId`.
- [ ] `boardPatch.applyPatchToBoard` spreads `patch.assigneeId`.
- [ ] Tests cover the new branch.
- [ ] No `any`.

**Dependencies:** F13. Decision D11.

---

### T10 — Integration verification & sign-off

**Batch:** 5 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does.

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations (especially `no-explicit-any`).
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on new files >80% business / >70% components.
5. **Build:** `npm run build -w frontend` — FE production build succeeds.
6. **No migration:** confirm F16 added NO migration file and NO `schema.ts` change (the creator/assignee resolution is a query-shape change; FK `creator_id` already existed).
7. **Live browser smoke (manual):**
   - Start backend + frontend locally.
   - Log in, open a project board.
   - Click a ticket card → `TicketDetailModal` opens; URL is `/projects/:slug/tickets/:id`.
   - Header shows `SLYK-NNN`, creator avatar + name, created/updated timestamps.
   - Edit title → save → optimistic update on the board card; reload → persists.
   - Edit description / priority / assignee / labels / checklist → each saves; rollback on simulated error.
   - Make a dirty edit → press Esc → `ConfirmDiscardDialog` opens → Discard closes, Cancel stays.
   - Dirty edit → click backdrop → confirm opens (backdrop blocked).
   - Dirty edit → browser Back → confirm opens → Discard navigates back, Cancel stays.
   - Clean form → Esc → closes immediately.
   - Keyboard: Tab cycles within the modal (focus trap); focus returns to the card on close.
   - Deep-link: paste `/projects/:slug/tickets/:id` in a fresh tab → modal opens directly; board loads behind.
   - Drift: open the modal, then in a second tab edit the same ticket and save → within 30s the open modal's detail query refetches; the user's unsaved typing in the open modal is preserved.
   - As a member (non-admin): can open + edit (REQ-3.3 — no admin gate).
   - Confirm NO delete button is present (F17 owns).
   - Confirm NO activity feed is present (F19 owns).
8. **Verify `{ old, new }` seam preserved** in `updateTicket` (`ticketService.ts:239-294`) for F18 audit — no logging added in F16.
9. **Verify F13/F14/F15 inheritance:** `TicketAttributeForm` still renders all editors; `ChecklistEditor` still works; labels still save.
10. **Record proof:** fill the integration record below with commit SHAs, exit codes, and a smoke summary.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage on new files >80% / >70%.
- [ ] `npm run build -w frontend` exit 0.
- [ ] NO migration file added; NO `schema.ts` change.
- [ ] Live smoke: modal shows ID + creator + timestamps + all editable attributes.
- [ ] Live smoke: optimistic save + rollback on error.
- [ ] Live smoke: unsaved-confirm on Esc / backdrop / close / route-nav when dirty.
- [ ] Live smoke: Esc closes, focus trap wraps, scroll locked, focus restored.
- [ ] Live smoke: deep-link opens modal directly; board stays mounted; back closes.
- [ ] Live smoke: drift — external edit reconciles within 30s without losing unsaved input.
- [ ] Live smoke: member (non-admin) can edit (no 403).
- [ ] Live smoke: no delete button (F17), no activity feed (F19).
- [ ] F13/F14/F15 inherited flows still work.

**Dependencies:** all prior tasks merged.

---

## 7. Final F16 Acceptance Checklist

- [ ] Modal shows title, display ID (`SLYK-NNN`), description, assignee, priority, labels, checklist, creator (avatar + name), created/updated timestamps.
- [ ] Inline editing of each field with optimistic save + rollback on error (reuses F13 `useUpdateTicket`).
- [ ] Closes cleanly via Esc / backdrop / close button; unsaved-confirm guard (`isDirty` + `useBlocker` + `ConfirmDiscardDialog`) when mid-edit.
- [ ] Deep-link: nested route `/projects/:slug/tickets/:ticketId` opens modal directly; board stays mounted; back closes.
- [ ] Keyboard: Esc closes (dirty-guarded), focus trap (Tab wrap), scroll lock, focus restore.
- [ ] Board/modal drift: detail query `refetchInterval`/`refetchOnMount`/`refetchOnWindowFocus` reconciles external edits without losing user input.
- [ ] Backend `getTicket` returns resolved `creator` + `assignee` (left-join users, FK-dangle guard); FE `Ticket.creator` added.
- [ ] NO schema migration added (query-shape change only; FK `creator_id` pre-existed).
- [ ] NO delete button (F17 owns — seam reserved).
- [ ] NO activity feed (F19 owns — space reserved).
- [ ] NO audit logging added (F18 owns — `{ old, new }` seam preserved).
- [ ] Any authenticated user may edit (REQ-3.3 — `authenticate` only, no admin gate).
- [ ] No new FE/BE dependency.
- [ ] All tests pass (Vitest BE + FE); coverage on new files >80% / >70%.
- [ ] Typecheck / lint / format / build all green.

**Integration record (fill during T10):**
- Feature commit SHA: `________`
- `GET /api/tickets/:id` sample response (with resolved `creator` + `assignee`): `________`
- Deep-link URL sample: `/projects/slyk/tickets/________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`
- Live browser smoke: all-attrs-render OK / optimistic-save OK / rollback OK / unsaved-confirm OK / Esc+trap+scrolllock+restore OK / deep-link OK / drift OK / member-edit OK / no-delete OK / no-activity OK

---

## 8. Schema deltas owned by this feature

**F16 owns NO schema delta.** The creator/assignee resolution is a **query-shape change** (left-join `users` in `getTicket`), not a new column or table. The `creator_id` FK already exists (`backend/src/db/schema.ts:121-123`), and `assignee_id` is already a FK. **F16 adds NO migration, NO `schema.ts` change, and NO row in the `features.md` deltas table.**

| Change | Detail | Migration |
| --- | --- | --- |
| `getTicket` creator/assignee hydration | Left-join `users` twice; return `{ id, fullName, avatarUrl } \| null` with FK-dangle guard | **NONE** — no DDL; query-shape change only |

---

## 9. Cross-cutting decisions needing owner sign-off

1. **Deep-link mechanism: nested route vs query-param.** **Recommendation: nested route** `/projects/:slug/tickets/:ticketId` over the board `<Outlet>`. Board stays mounted (no refetch), back-button closes, URL shareable, idiomatic for react-router v7 data routers. Query-param (`?ticket=:id` via `useSearchParams`) is lighter but the nested route is cleaner and the codebase has no query-param precedent. **Deviate flag:** NEW routing pattern.
2. **Hand-roll modal a11y vs add Radix/Headless UI/react-focus-lock.** **Recommendation: hand-roll, 0 deps.** The app hand-rolls overlays and avoids heavy deps; trap/scroll/Esc/restore is ~60-80 lines vs Radix restyle cost. Project rules are silent on dialog a11y — cite W3C APG, not rules.
3. **Delete button — confirm F16 does NOT ship it.** **Recommendation: do NOT ship; reserve a seam only.** REQ-3.3 makes delete Admin-only and F17 owns it. F16 must not ship a delete control.
4. **Activity section — confirm F16 omits/reserves it.** **Recommendation: reserve structural space only.** User Journey 3 / REQ-5.1 activity feed = F19. F16 ships attributes only.
5. **Drift strategy: `refetchInterval`/`refetchOnWindowFocus` vs board-cache seed.** **Recommendation: refetchInterval (30s) + refetchOnMount + refetchOnWindowFocus on the detail query.** RHF form state seeded once (not re-seeded on refetch) → unsaved input preserved; in-flight optimistic edits reconcile via `onSettled` invalidation. Alternative (seed detail from board cache) couples the two queries and risks clobbering; refetchInterval is simpler.
6. **Port `CreateTicketModal` onto the new `Modal` primitive now or defer.** **Recommendation: port now if cheap, else defer.** Porting gains a11y (Esc/trap/scroll-lock) for the create flow too, but F16's acceptance is the detail modal. If time-boxed, defer to a follow-up.
7. **AssigneeId optimistic-write cleanup — in F16 or defer.** **Recommendation: defer (T9 optional).** Not required for F16 acceptance; `useUpdateTicket.ts:42-48` omits assigneeId → avatar flickers stale until `onSettled`, which is a pre-existing minor issue, not an F16 regression.

---

**Sources:**
- W3C APG Dialog Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- React Router `useBlocker`: https://reactrouter.com/api/hooks/useBlocker
- React Router Decision 0001 (unstable_usePrompt → useBlocker)
- WHATWG #7732 (`inert` / scroll-lock); `inert` Baseline 2022
- Grounding evidence file:line citations as enumerated in §2 (EditTicketModal, TicketAttributeForm, ticketService, boardService, useUpdateTicket, routes/index.tsx, schema.ts, types/ticket.ts, TicketCard.tsx).
