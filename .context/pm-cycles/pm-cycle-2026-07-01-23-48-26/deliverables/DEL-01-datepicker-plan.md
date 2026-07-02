# Implementation Plan — DEL-01

**Ticket:** `.docs/ai-generated/pm-cycle-2026-07-01-23-48-26/deliverables/DEL-01-datepicker.md`
**Type:** Enhancement
**Title:** Reusable DatePicker Primitive + DueDateField Replacement
**Generated:** 2026-07-02

---

## Summary

Replace the native `<input type="date">` in `DueDateField` with a polished, Radix-backed `DatePicker` primitive that matches the house `TextInput` visual style, provides quick-pick shortcuts (Today, Tomorrow, etc.), and serves as a reusable `ui/` component. The DatePicker uses `@radix-ui/react-popover` for the dropdown container and `@radix-ui/react-calendar` for the month-grid calendar. A two-layer popover content (quick picks → calendar) provides both fast and precise date selection.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| New UI primitive | `frontend/src/components/ui/DatePicker.tsx` | New reusable DatePicker component (the primary deliverable) |
| New test | `frontend/src/components/ui/DatePicker.test.tsx` | Unit tests for the DatePicker primitive |
| Existing field | `frontend/src/components/ticket-fields/DueDateField.tsx` | Replace native `<input type="date">` with the new DatePicker |
| Existing test | `frontend/src/components/ticket-fields/DueDateField.test.tsx` (if exists) | Update tests to use DatePicker instead of native input mocks |
| Package manifest | `frontend/package.json` | Install `@radix-ui/react-popover` and `@radix-ui/react-calendar` |
| Test setup | `frontend/src/test-setup.ts` | Already has PointerEvent + ResizeObserver polyfills; may need minor additions for Radix Popover tests |

## Proposed Implementation

### Step 0: Install Dependencies

```bash
cd frontend && pnpm add @radix-ui/react-popover @radix-ui/react-calendar
```

No other dependencies needed. No date library is required — the DatePicker will use plain `Date` objects and minimal helper functions (start-of-month, add-months, format-display) implemented inline.

### Step 1: Create `DatePicker.tsx` (`frontend/src/components/ui/DatePicker.tsx`)

Follow the established `ui/` primitive pattern (see `Dropdown.tsx`, `Select.tsx`, `Tooltip.tsx`):
- Compound named exports: `DatePicker`, `DatePickerTrigger`, `DatePickerContent`, `DatePickerQuickPick`, `DatePickerCalendar`.
- `forwardRef` on interactive sub-components.
- `cn()` for class merging.
- Tokens only (no raw hex) — matches the design system defined in `frontend/src/index.css`.
- Portal to `document.body` via Radix Popover Portal (follows the `Dropdown.tsx:30-31` Portal-dark pattern, resolving `bg-popover` because `.dark` lives on `<html>`).

**Component API:**

```tsx
export interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;          // default: "Pick a date…"
  clearable?: boolean;           // default: false
  quickPicks?: QuickPick[];      // default: Today, Tomorrow, Next week, Next month, No date
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export interface QuickPick {
  label: string;
  date: Date | null;
}
```

**Internal state:**

- `view: 'quick' | 'calendar'` — tracks which layer the popover shows. Starts on `'quick'` each open.
- Popover open/close handled entirely by Radix Popover's controlled or uncontrolled mode.

**Trigger button styling (must be visually indistinguishable from `TextInput`):**

Copy the `BASE_CLASSES` from `TextInput.tsx:17-19`:
```
border border-input rounded-md px-3 py-2 bg-background text-foreground
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
focus-visible:border-primary
```

Plus:
- `w-full` (full-width to match TextInput in the form sidebar).
- `inline-flex items-center justify-between` (for the clear button).
- When no date: placeholder text in `text-muted-foreground`.
- When date selected: formatted date string (e.g. `"Jul 15, 2026"`) via `Intl.DateTimeFormat`.
- When `clearable && value != null`: trailing `×` button (an `<span>` or `<button>` with `onClick` calling `e.stopPropagation(); onChange(null)`).

**Popover content (`PopoverContent`):**

```tsx
<PopoverContent
  sideOffset={4}
  className="bg-popover text-popover-foreground border border-border rounded-md shadow-md z-50 p-0"
  align="start"
>
```

**Layer 1 — Quick picks (default view):**

A vertical list of clickable rows. Each row is a `<button>` with:
- `role="menuitem"` semantics (or simple `role="option"` inside a `role="listbox"` — keep it simple).
- Classes: `w-full px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors`.
- Clicking fires `onChange(quickPick.date)` and closes the popover.

Below the quick picks, a separator (`<div className="border-t border-border" />`), then a "Pick a date…" row with a calendar icon, clicking which transitions `view` to `'calendar'`.

**Layer 2 — Calendar grid:**

Use `@radix-ui/react-calendar` `<Calendar>` component:
- `mode="single"` — single date selection.
- `selected={value}` — highlights the currently selected date.
- `onSelect={(day) => { onChange(day); /* Radix Popover auto-closes via onCloseAutoFocus or we call setOpen(false) */ }}` — fires onChange and closes.
- Navigation: prev/next month via `<CalendarPrev />` / `<CalendarNext />` buttons styled with the ghost button pattern.
- `today` is visually distinguished (ring/bold per Radix Calendar default styling or via custom Tailwind).
- `onDayFocus` / keyboard nav delegated to Radix Calendar (which already supports arrow keys, Enter to select).

**Closing behavior:**

Handled by Radix Popover defaults: Escape, outside click. Additionally, after a day click or quick-pick click, programmatically close via controlled `open` state or Radix's internal close.

**Date formatting helpers (inline, no external lib):**

```tsx
function formatDisplayDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function startOfMonth(date: Date): Date { /* returns first day of month */ }
function addMonths(date: Date, n: number): Date { /* adds n months */ }
function isSameDay(a: Date, b: Date): boolean { /* compares year/month/day */ }
function isToday(date: Date): boolean { return isSameDay(date, new Date()); }
```

These are simple pure functions — no external dependency needed.

### Step 2: Create `DatePicker.test.tsx` (`frontend/src/components/ui/DatePicker.test.tsx`)

Follow the established test pattern (`Dropdown.test.tsx`, `Select.test.tsx`, `Collapsible.test.tsx`):

- `describe('DatePicker', ...)` block.
- Use `@testing-library/react`: `render`, `screen`, `fireEvent`.
- Radix Popover opens on pointerDown — use `fireEvent.pointerDown(trigger, { button: 0 })` (PointerEvent polyfill in `test-setup.ts:14-17` handles this).
- Assertions use `getByRole`, `getByText`, `queryByText` — no `data-testid`.

**Test cases:**

1. **Renders trigger button** — shows placeholder text "Pick a date…" when value is null.
2. **Renders formatted date** — shows "Jul 15, 2026" when value is `new Date(2026, 6, 15)`.
3. **Opens popover on pointerDown** — quick picks appear (Today, Tomorrow, Next week, Next month, No date).
4. **Quick-pick "Today" selects today** — `onChange` called with today's date; popover closes.
5. **Quick-pick "No date" clears** — `onChange(null)` called.
6. **"Pick a date…" transitions to calendar** — calendar grid appears with month navigation.
7. **Day selection** — clicking a day calls `onChange` with that date and closes popover.
8. **Calendar navigation** — prev/next month buttons change the displayed month.
9. **Clearable button** — when `clearable={true}` and value is set, `×` button appears; clicking it calls `onChange(null)`.
10. **Clearable not shown when `clearable={false}`** — `×` button absent.
11. **Disabled state** — trigger is disabled, popover does not open.
12. **Custom placeholder** — passed placeholder text renders on trigger.
13. **Keyboard: Escape closes popover** — open popover, press Escape, popover closes.

### Step 3: Update `DueDateField.tsx`

Replace the `<input type="date">` with the new `DatePicker`. Keep the `<Field>` wrapper unchanged.

**Before (current):**
```tsx
<Field label="Due date" icon={<CalendarClock size={14} />}>
  <input type="date" aria-label="Due date" value={...} onChange={...} className="..." />
</Field>
```

**After:**
```tsx
<Field label="Due date" icon={<CalendarClock size={14} />}>
  <DatePicker
    value={dueDate ? new Date(dueDate) : null}
    onChange={(date) => {
      if (date) {
        const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        setValue('dueDate', utc.toISOString()); // "2026-07-15T00:00:00.000Z"
      } else {
        setValue('dueDate', null);
      }
    }}
    clearable
    aria-label="Due date"
  />
</Field>
```

**Date conversion logic (unchanged contract):**
- Form stores `"2026-07-15T00:00:00.000Z"` (full ISO, UTC midnight) or `null`.
- DatePicker receives `Date | null`. On change, converts back to UTC midnight ISO string.
- The `UTC_MIDNIGHT` and `ISO_DATE_LENGTH` helpers are removed — replaced by `Date.UTC()` + `toISOString()` which is cleaner and handles edge cases (timezone shifts) correctly.

**Add quick picks for due dates:**

```tsx
const dueDateQuickPicks = useMemo(() => {
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  const nextMonth = new Date(today); nextMonth.setMonth(today.getMonth() + 1);
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: tomorrow },
    { label: 'Next week', date: nextWeek },
    { label: 'Next month', date: nextMonth },
    { label: 'No date', date: null },
  ];
}, []); // intentionally [] — computed once; Date objects are relative to mount, acceptable for due dates
```

### Step 4: Update DueDateField Tests

If `DueDateField.test.tsx` exists, update it to:
- Remove native `<input type="date">` mocks.
- Use `fireEvent.pointerDown` to open the DatePicker popover.
- Assert quick-pick and calendar interactions.
- Assert the ISO datetime string contract (`"2026-07-15T00:00:00.000Z"`) via `waitFor` or `act`.

If no test file exists, create `frontend/src/components/ticket-fields/DueDateField.test.tsx` following the same pattern as `TicketAttributeForm.test.tsx:230-232` (wraps in `FormProvider` with `useTicketForm` defaults).

## Edge Cases & Risks

- **Portal dark mode**: The Popover portal renders to `document.body`. The existing `Dropdown.tsx` comment (line 21-23) notes this depends on `.dark` being on `<html>`. The DatePicker follows the same pattern — flagged for visual QA in dark mode.
- **PointerEvent polyfill**: `test-setup.ts` already polyfills `PointerEvent` and `ResizeObserver` for Radix. No additional polyfills needed.
- **Quick-pick dates are computed once** (empty deps `useMemo`). This means "Today" is relative to component mount, not current time. This is acceptable for due-date selection (users don't hold the picker open past midnight).
- **No date library needed**: The DatePicker uses `Intl.DateTimeFormat` (already used in `formatDate.ts`) and plain `Date` methods. This avoids adding a dependency for simple calendar operations.
- **Calendar keyboard navigation**: Radix `react-calendar` delegates arrow-key / Enter / Escape to Radix internals. jsdom doesn't exercise these well, so keyboard tests should use `fireEvent.keyDown` for Escape only and trust Radix for the rest (same approach as `Tabs.test.tsx:1-15`).
- **DueDateField consumers**: `DueDateField` is used in `TicketAttributeForm.tsx:88` and `TicketDetailModal.tsx:348`. Both just render `<DueDateField />` with no props — the replacement is transparent.
- **Form contract unchanged**: `TicketFormValues.dueDate` remains `z.string().datetime().nullable().optional()` (from `useTicketForm.ts:42`). The DatePicker works with `Date` objects internally; conversion to/from ISO strings happens in `DueDateField`.

## Testing

- **Unit tests (DatePicker.test.tsx):** Render, quick-pick selection, calendar navigation, day selection, clear, disabled state, placeholder, Escape to close — 13 test cases.
- **Unit tests (DueDateField.test.tsx):** Integration with FormProvider, ISO string conversion contract, clearable behavior, quick picks.
- **No HTTP tests needed:** This is a pure frontend component change.
- **No integration tests needed:** The DatePicker is a UI primitive; integration is covered by the DueDateField tests.
- **Manual verification:** Open a ticket modal in both light and dark themes, verify DatePicker trigger matches TextInput styling, test all quick picks and calendar day selection, verify clearable `×` button, verify the saved `dueDate` ISO string on the backend.

## Acceptance Criteria

- [ ] `DatePicker` is exported from `frontend/src/components/ui/DatePicker.tsx` and follows the house `ui/` pattern (`forwardRef`, `cn()`, Tailwind tokens, compound named exports).
- [ ] The trigger (closed state) is visually indistinguishable from `TextInput` — same `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary` classes.
- [ ] Clicking the trigger opens a popover with quick-pick options and a "Pick a date…" item.
- [ ] Clicking a quick-pick option selects that date (or null) and closes the popover.
- [ ] Clicking "Pick a date…" transitions the popover content to a calendar month grid with prev/next navigation.
- [ ] Clicking a day in the calendar grid selects that date and closes the popover.
- [ ] When `clearable` is true and a date is selected, a `×` button appears on the trigger; clicking it clears the date.
- [ ] `DueDateField` uses the new `DatePicker` instead of native `<input type="date">`. The form contract is unchanged: ISO datetime strings or `null`.
- [ ] The DatePicker works correctly in both light and dark themes.
- [ ] The DatePicker is keyboard-accessible: Escape closes, Tab/arrow navigation through quick picks and calendar, Enter to select.
- [ ] Unit tests cover: rendering, quick-pick selection, calendar navigation, day selection, clear, keyboard interaction, and `clearable` prop behavior.
- [ ] DueDateField tests are updated to use the new component (no native input mocks).

## Out of Scope

- Date range selection (single date only for this deliverable).
- Time-of-day picker (due dates are date-only, stored as UTC midnight).
- Internationalization beyond `Intl.DateTimeFormat` (no i18n library).
- Backend changes (schema already supports nullable ISO datetime).
- Adding a date utility library (date-fns, dayjs, etc.) — plain `Date` suffices.
