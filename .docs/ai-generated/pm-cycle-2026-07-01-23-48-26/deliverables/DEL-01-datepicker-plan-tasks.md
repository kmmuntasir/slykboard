# Task Breakdown — DEL-01: Reusable DatePicker Primitive + DueDateField Replacement

**Plan:** `DEL-01-datepicker-plan.md`
**Generated:** 2026-07-02

---

## Parallelization Strategy

### Batch Diagram

```
Batch 1: [Task 1: Install Radix Popover + Calendar deps]
              │
              ▼
Batch 2: [Task 2: Create DatePicker.tsx]
           ╱           ╲
          ▼             ▼
Batch 3: [Task 3:       [Task 4:
          DatePicker     Replace native
          .test.tsx]    input in
                        DueDateField.tsx]
           ╲             ╱
            ▼           ▼
Batch 4: [Task 5: Create DueDateField.test.tsx]
```

### Merge-Order Rules

1. **Batch 1** must merge before Batch 2 starts (dependency install is a prerequisite).
2. **Batch 2** must merge before Batch 3 starts (both Task 3 and Task 4 import/use the new `DatePicker`).
3. **Batch 3** tasks (Task 3, Task 4) can merge in any order — they touch independent files.
4. **Batch 4** must merge after Task 4 (it tests the updated `DueDateField` with the real `DatePicker`).

### Summary Table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| 1 | 1 | `frontend/package.json` | None | — |
| 2 | 2 | `frontend/src/components/ui/DatePicker.tsx` | 1 | — |
| 3 | 3 | `frontend/src/components/ui/DatePicker.test.tsx` | 2 | Task 4 |
| 4 | 3 | `frontend/src/components/ticket-fields/DueDateField.tsx` | 2 | Task 3 |
| 5 | 4 | `frontend/src/components/ticket-fields/DueDateField.test.tsx` | 2, 4 | — |

### Developer Assignment Tracks

| Developer | Track | Tasks | Notes |
|-----------|-------|-------|-------|
| **Dev 1** (DatePicker specialist) | Full primitive creation | 1 → 2 → 3 | Owns the new UI primitive end-to-end: install, implement, unit test. |
| **Dev 2** (Integration specialist) | Consumer wiring | 4 → 5 (starts after Task 2 merges) | Updates DueDateField + integration tests. Can review Task 3 output while waiting. |

---

## Tasks

---

### Task 1: Install Radix Popover and Calendar Dependencies

**Batch:** 1
**Target:** `frontend/package.json` (and `pnpm-lock.yaml`)

**Description:**

Install two new Radix UI packages into the frontend workspace. These provide the dropdown container (`react-popover`) and month-grid calendar (`react-calendar`) for the new `DatePicker` primitive.

Run from the repository root:

```bash
cd frontend && pnpm add @radix-ui/react-popover @radix-ui/react-calendar
```

**Context:**
- The frontend already uses `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-tabs`, etc. — the Radix ecosystem is well-established.
- No other dependencies are needed. No date library (date-fns, dayjs, etc.) is required — the DatePicker will use plain `Date` objects and `Intl.DateTimeFormat`.
- After install, verify the new entries appear in `frontend/package.json` under `"dependencies"`.

**Acceptance Criteria:**

- [ ] `@radix-ui/react-popover` appears in `frontend/package.json` dependencies.
- [ ] `@radix-ui/react-calendar` appears in `frontend/package.json` dependencies.
- [ ] `pnpm-lock.yaml` is updated (no integrity errors).
- [ ] `cd frontend && pnpm install` completes without errors.

**Dependencies:** None

---

### Task 2: Create DatePicker Primitive Component

**Batch:** 2
**Target:** `frontend/src/components/ui/DatePicker.tsx` (NEW file)

**Description:**

Create a reusable `DatePicker` component following the established `ui/` primitive pattern (see `Dropdown.tsx`, `Select.tsx`, `Tooltip.tsx`). The component uses `@radix-ui/react-popover` for the dropdown container and `@radix-ui/react-calendar` for the month-grid calendar.

**File to create:** `frontend/src/components/ui/DatePicker.tsx`

**Key implementation details:**

1. **Compound named exports** (no default export): `DatePicker`, `DatePickerTrigger`, `DatePickerContent`, `DatePickerQuickPick`, `DatePickerCalendar`. Follow the same `forwardRef` + `cn()` pattern as `Dropdown.tsx:27-43` and `Select.tsx:101-130`.

2. **Imports:**
   ```tsx
   import { forwardRef, useState, useCallback, useMemo, type ComponentPropsWithoutRef, type ElementRef } from 'react';
   import * as PopoverPrimitive from '@radix-ui/react-popover';
   import { Calendar } from '@radix-ui/react-calendar';
   import { CalendarIcon } from 'lucide-react';
   import { cn } from './cn';
   ```

3. **Interfaces:**
   ```tsx
   export interface DatePickerProps {
     value: Date | null;
     onChange: (date: Date | null) => void;
     placeholder?: string;       // default: "Pick a date…"
     clearable?: boolean;        // default: false
     quickPicks?: QuickPick[];   // default: Today, Tomorrow, Next week, Next month, No date
     className?: string;
     disabled?: boolean;
     'aria-label'?: string;
   }

   export interface QuickPick {
     label: string;
     date: Date | null;
   }
   ```

4. **Trigger button styling** — must be visually indistinguishable from `TextInput`. Copy the `BASE_CLASSES` from `TextInput.tsx:17-19`:
   ```
   border border-input rounded-md px-3 py-2 bg-background text-foreground
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
   focus-visible:border-primary
   ```
   Plus `w-full inline-flex items-center justify-between`. When `clearable && value != null`, render a trailing `×` button with `onClick={(e) => { e.stopPropagation(); onChange(null); }}`.

5. **Popover content** uses `PopoverPrimitive.Portal` + `PopoverPrimitive.Content` with:
   ```
   sideOffset={4}
   className="bg-popover text-popover-foreground border border-border rounded-md shadow-md z-50 p-0"
   align="start"
   ```

6. **Layer 1 — Quick picks** (default view each time popover opens):
   - Vertical list of `<button>` elements, each `role="menuitem"`.
   - Classes: `w-full px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors`.
   - Click fires `onChange(quickPick.date)` and closes the popover.
   - Default quick picks: Today, Tomorrow, Next week, Next month, No date (null).
   - Below quick picks: a `<div className="border-t border-border" />` separator, then a "Pick a date…" row with `<CalendarIcon>` that transitions `view` to `'calendar'`.

7. **Layer 2 — Calendar grid** (when view is `'calendar'`):
   - Use `Calendar` from `@radix-ui/react-calendar`: `mode="single"`, `selected={value}`, `onSelect` calls `onChange(day)` and closes.
   - Month navigation via prev/next buttons styled with ghost button pattern.
   - Calendar day styling: use Radix Calendar's built-in styling tokens.

8. **Internal state:**
   - `view: 'quick' | 'calendar'` — starts on `'quick'` each popover open.
   - Popover open/close: use Radix Popover's controlled or uncontrolled mode. After a selection (quick pick or day), programmatically close.

9. **Closing behavior:** Escape and outside click handled by Radix Popover defaults. After selection, close via controlled `open` state.

10. **Date formatting helpers** (inline, no external lib):
    ```tsx
    function formatDisplayDate(date: Date): string {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', year: 'numeric'
      }).format(date);
    }
    function isSameDay(a: Date, b: Date): boolean {
      return a.getFullYear() === b.getFullYear() &&
             a.getMonth() === b.getMonth() &&
             a.getDate() === b.getDate();
    }
    function isToday(date: Date): boolean { return isSameDay(date, new Date()); }
    ```

11. **Portal-dark convention:** Follow `Dropdown.tsx:21-23` and `Select.tsx:71-74` — render via `PopoverPrimitive.Portal` to `document.body`; `bg-popover` resolves because `.dark` lives on `<html>`.

12. **Export barrel:** Add to `frontend/src/components/ui/index.ts` if one exists. Currently the `ui/` components are imported directly (no barrel), so just ensure the named exports are correct.

**Source references:**
- `Dropdown.tsx` — Portal pattern, compound export pattern, `forwardRef` pattern
- `Select.tsx:101-130` — Trigger styling with `border-input bg-background text-foreground` + focus ring
- `TextInput.tsx:17-19` — `BASE_CLASSES` to copy for trigger
- `cn.ts` — `cn()` class merge helper
- `index.css` — design tokens (no raw hex, use tokens only)

**Acceptance Criteria:**

- [ ] `DatePicker.tsx` exists at `frontend/src/components/ui/DatePicker.tsx`.
- [ ] Exports: `DatePicker`, `DatePickerTrigger`, `DatePickerContent`, `DatePickerQuickPick`, `DatePickerCalendar`.
- [ ] Trigger button uses identical classes to `TextInput` (same border, padding, bg, text, focus ring).
- [ ] Popover renders quick-pick options (default: Today, Tomorrow, Next week, Next month, No date).
- [ ] Clicking a quick pick calls `onChange` with the correct `Date | null` value.
- [ ] "Pick a date…" transitions the popover to a calendar month grid.
- [ ] Calendar grid supports prev/next month navigation.
- [ ] Selecting a day calls `onChange` with that date and closes the popover.
- [ ] `clearable` prop shows/hides the `×` button; clicking it calls `onChange(null)`.
- [ ] `disabled` prop disables the trigger button and prevents popover opening.
- [ ] Uses tokens only (no raw hex colors) — matches house design system.
- [ ] Portal renders to `document.body` via Radix Popover Portal.
- [ ] `forwardRef` used on all interactive sub-components.
- [ ] `cn()` used for all class merging.

**Dependencies:** 1

---

### Task 3: Create DatePicker Unit Tests

**Batch:** 3
**Target:** `frontend/src/components/ui/DatePicker.test.tsx` (NEW file)

**Description:**

Write unit tests for the `DatePicker` primitive following the established test pattern (`Dropdown.test.tsx`, `Select.test.tsx`, `Collapsible.test.tsx`).

**File to create:** `frontend/src/components/ui/DatePicker.test.tsx`

**Key test conventions (from existing tests):**
- `describe('DatePicker', ...)` block with `render*` helper functions.
- Open popover via `fireEvent.pointerDown(trigger, { button: 0 })` — Radix opens on pointerDown (jsdom PointerEvent polyfill already in `test-setup.ts:14-17`).
- Close via `fireEvent.keyDown(document.body, { key: 'Escape'})`.
- Assertions use `getByRole`, `getByText`, `queryByText` — no `data-testid`.
- Token assertions via `className.toContain(...)`.

**Test cases (13 total):**

1. **Renders trigger button** — shows placeholder text "Pick a date…" when `value={null}`.
2. **Renders formatted date** — shows "Jul 15, 2026" (via `Intl.DateTimeFormat`) when `value={new Date(2026, 6, 15)}`.
3. **Opens popover on pointerDown** — quick picks appear (assert for "Today", "Tomorrow", "Next week", "Next month", "No date").
4. **Quick-pick "Today" selects today** — `onChange` called with a date that `isSameDay(date, new Date())`; popover closes.
5. **Quick-pick "No date" clears** — `onChange(null)` called.
6. **"Pick a date…" transitions to calendar** — clicking the calendar row shows the calendar grid (assert for "Previous" and "Next" month navigation buttons, or `role="grid"`).
7. **Day selection** — clicking a day cell calls `onChange` with that date and closes popover.
8. **Calendar navigation** — prev/next month buttons change the displayed month (assert month label text changes).
9. **Clearable button** — when `clearable={true}` and `value={new Date(...)}`, a `×` (or "Clear") button appears; clicking it calls `onChange(null)`.
10. **Clearable not shown when `clearable={false}`** — `×` button absent.
11. **Disabled state** — trigger button is disabled, popover does not open on pointerDown.
12. **Custom placeholder** — passed `placeholder="Select due date"` renders on trigger.
13. **Keyboard: Escape closes popover** — open popover, press Escape, popover closes.

**Example render helper:**
```tsx
function renderDatePicker(overrides?: {
  value?: Date | null;
  onChange?: (date: Date | null) => void;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const onChange = overrides?.onChange ?? vi.fn();
  render(
    <DatePicker
      value={overrides?.value ?? null}
      onChange={onChange}
      clearable={overrides?.clearable}
      disabled={overrides?.disabled}
      placeholder={overrides?.placeholder}
      aria-label="Test date"
    />,
  );
  return { onChange };
}
```

**Source references:**
- `Dropdown.test.tsx` — pointerDown open pattern, Escape close pattern, className assertions
- `Select.test.tsx` — trigger render + open + close pattern
- `Collapsible.test.tsx` — Radix data-state assertion pattern
- `Tabs.test.tsx:1-15` — keyboard test pattern (trust Radix for arrow navigation, test Escape only)

**Acceptance Criteria:**

- [ ] `DatePicker.test.tsx` exists at `frontend/src/components/ui/DatePicker.test.tsx`.
- [ ] All 13 test cases pass (`pnpm test` from `frontend/`).
- [ ] Uses `getByRole`/`queryByText` queries (no `data-testid`).
- [ ] Uses `fireEvent.pointerDown` for opening (not `fireEvent.click`).
- [ ] `onChange` mock assertions verify correct `Date` or `null` argument.
- [ ] Token assertions verify trigger carries `border-input`, `bg-background` classes.

**Dependencies:** 2

---

### Task 4: Replace Native Date Input in DueDateField

**Batch:** 3
**Target:** `frontend/src/components/ticket-fields/DueDateField.tsx` (MODIFY existing file)

**Description:**

Replace the native `<input type="date">` in `DueDateField` with the new `DatePicker` primitive. The `<Field>` wrapper remains unchanged. The form contract (`TicketFormValues.dueDate` = ISO datetime string or `null`) is preserved.

**File to modify:** `frontend/src/components/ticket-fields/DueDateField.tsx`

**Changes:**

1. **Update imports:** Remove the existing helpers at the top. Add:
   ```tsx
   import { useMemo } from 'react';
   import { DatePicker } from '@/components/ui/DatePicker';
   ```
   Keep: `useFormContext`, `CalendarClock`, `Field`, `TicketFormValues`.

2. **Remove old helpers:** Delete `UTC_MIDNIGHT`, `ISO_DATE_LENGTH`, and `toDateInput()` — they are no longer needed.

3. **Add quick picks computation** (after the `watch`/`setValue` destructuring):
   ```tsx
   const dueDateQuickPicks = useMemo(() => {
     const today = new Date();
     const tomorrow = new Date(today);
     tomorrow.setDate(today.getDate() + 1);
     const nextWeek = new Date(today);
     nextWeek.setDate(today.getDate() + 7);
     const nextMonth = new Date(today);
     nextMonth.setMonth(today.getMonth() + 1);
     return [
       { label: 'Today', date: today },
       { label: 'Tomorrow', date: tomorrow },
       { label: 'Next week', date: nextWeek },
       { label: 'Next month', date: nextMonth },
       { label: 'No date', date: null },
     ];
   }, []);
   ```

4. **Replace the `<input>` JSX** inside `<Field>`:
   ```tsx
   <Field label="Due date" icon={<CalendarClock size={14} />}>
     <DatePicker
       value={dueDate ? new Date(dueDate) : null}
       onChange={(date) => {
         if (date) {
           const utc = new Date(Date.UTC(
             date.getFullYear(), date.getMonth(), date.getDate()
           ));
           setValue('dueDate', utc.toISOString());
         } else {
           setValue('dueDate', null);
         }
       }}
       clearable
       quickPicks={dueDateQuickPicks}
       aria-label="Due date"
     />
   </Field>
   ```

5. **Date conversion contract (unchanged):**
   - Form stores `"2026-07-15T00:00:00.000Z"` (full ISO, UTC midnight) or `null`.
   - DatePicker receives `Date | null`. On change, converts back to UTC midnight ISO string using `Date.UTC()` + `toISOString()`.
   - This replaces the old `UTC_MIDNIGHT` + `ISO_DATE_LENGTH` approach with a cleaner, timezone-safe method.

**Why `Date.UTC()` instead of the old slice approach:**
The old approach (`iso.slice(0, 10)` + string concatenation) was brittle around timezone edges. `Date.UTC()` constructs the correct UTC midnight explicitly and `toISOString()` serializes it. The plan flags this as a correctness improvement.

**Source references:**
- Current file: `DueDateField.tsx` — existing implementation with native input
- `useTicketForm.ts:42` — `dueDate: z.string().datetime().nullable().optional()` (form schema, unchanged)
- `Field.tsx` — `<Field>` wrapper (unchanged)
- `TicketAttributeForm.tsx:88` — consumer (renders `<DueDateField />` with no props)
- `TicketDetailModal.tsx:348` — consumer (renders `<DueDateField />` with no props)

**Acceptance Criteria:**

- [ ] `DueDateField.tsx` no longer imports or renders `<input type="date">`.
- [ ] `DueDateField.tsx` imports `DatePicker` from `@/components/ui/DatePicker`.
- [ ] The `<DatePicker>` receives `value={dueDate ? new Date(dueDate) : null}`.
- [ ] The `onChange` handler produces ISO datetime strings (`"2026-07-15T00:00:00.000Z"`) or `null`.
- [ ] `clearable` prop is set on the DatePicker.
- [ ] Custom `quickPicks` array is provided (Today, Tomorrow, Next week, Next month, No date).
- [ ] `UTC_MIDNIGHT`, `ISO_DATE_LENGTH`, and `toDateInput()` are removed.
- [ ] The `<Field>` wrapper with `label="Due date"` and `icon={<CalendarClock size={14} />}` is preserved.
- [ ] The `aria-label="Due date"` is preserved on the DatePicker.
- [ ] `pnpm typecheck` passes (no type errors).
- [ ] Existing consumers (`TicketAttributeForm.tsx`, `TicketDetailModal.tsx`) require no changes — the component interface is unchanged.

**Dependencies:** 2

---

### Task 5: Create DueDateField Integration Tests

**Batch:** 4
**Target:** `frontend/src/components/ticket-fields/DueDateField.test.tsx` (NEW file)

**Description:**

Create a test file for `DueDateField` that verifies the integration between the field component, the `DatePicker` primitive, and the React Hook Form context. This test file does not exist yet.

**File to create:** `frontend/src/components/ticket-fields/DueDateField.test.tsx`

**Key testing pattern (from `TicketAttributeForm.test.tsx`):**
- The field uses `useFormContext<TicketFormValues>()`, so tests must wrap in `<FormProvider>` from `react-hook-form`.
- Use `useForm` with the same `ticketFormSchema` and `defaultValues` to create a realistic form context.

**Setup:**
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { DueDateField } from './DueDateField';
import { ticketFormSchema, type TicketFormValues } from '@/hooks/useTicketForm';

function renderDueDateField(defaults?: Partial<TicketFormValues>) {
  const onSubmit = vi.fn();
  function Wrapper() {
    const methods = useForm<TicketFormValues>({
      defaultValues: {
        title: '',
        description: '',
        priority: 'MEDIUM',
        assigneeId: null,
        labelIds: [],
        checklist: [],
        statusColumn: '',
        dueDate: null,
        ...defaults,
      },
    });
    return (
      <FormProvider {...methods}>
        <DueDateField />
      </FormProvider>
    );
  }
  render(<Wrapper />);
}
```

**Test cases:**

1. **Renders the Field label** — "Due date" text is present with CalendarClock icon.
2. **Renders trigger with placeholder** — When `dueDate: null`, the trigger shows "Pick a date…".
3. **Renders trigger with formatted date** — When `dueDate: "2026-07-15T00:00:00.000Z"`, the trigger shows the formatted date.
4. **Opens popover on pointerDown** — Quick picks are visible.
5. **Quick-pick selection updates form value** — Selecting "Today" produces a valid ISO datetime string matching today's date at UTC midnight (assert the form value via a hidden display or `watch`).
6. **Quick-pick "No date" clears form value to null** — Selecting "No date" produces `null`.
7. **Clearable button clears the value** — When a date is set and `clearable` is true, clicking `×` clears the form value to `null`.
8. **ISO string contract** — After selecting a day, the form's `dueDate` value is a string matching the pattern `"YYYY-MM-DDT00:00:00.000Z"`.

**Source references:**
- `TicketAttributeForm.test.tsx` — FormProvider wrapper pattern, form value assertions
- `Dropdown.test.tsx` — pointerDown open, Escape close patterns
- `useTicketForm.ts:30-43` — `ticketFormSchema` and `TicketFormValues` type (import for test setup)
- `DueDateField.tsx` — the component under test (post-Task 4 changes)

**Acceptance Criteria:**

- [ ] `DueDateField.test.tsx` exists at `frontend/src/components/ticket-fields/DueDateField.test.tsx`.
- [ ] All test cases pass (`pnpm test` from `frontend/`).
- [ ] Tests wrap `DueDateField` in `FormProvider` with a valid form context.
- [ ] ISO string contract is verified: `dueDate` value matches `"YYYY-MM-DDT00:00:00.000Z"` pattern after date selection.
- [ ] No mocks for `DueDateField` or `DatePicker` — tests exercise the real components.
- [ ] Tests do not conflict with `TicketAttributeForm.test.tsx` (that file renders DueDateField inside the full form without interacting with it — no changes needed there).

**Dependencies:** 2, 4

---

## Verification

After all tasks merge, run the full verification suite:

```bash
cd frontend && pnpm test && pnpm typecheck
```

**Expected results:**
- All `DatePicker.test.tsx` tests pass (13 cases).
- All `DueDateField.test.tsx` tests pass (8 cases).
- All existing tests pass unchanged (`Dropdown.test.tsx`, `Select.test.tsx`, `TicketAttributeForm.test.tsx`, `TicketDetailModal.test.tsx`).
- No TypeScript errors from `tsc --noEmit`.
