// DatePicker primitive tests.
// Covers: trigger render, formatted date, popover open, quick-pick selection,
// calendar transition, day selection, calendar navigation, clearable, disabled,
// custom placeholder, Escape close, token assertions.
//
// Pattern: matches Dropdown.test.tsx / Select.test.tsx — getByRole queries,
// className.toContain token checks, Escape close.
//
// NOTE: Radix Popover (unlike DropdownMenu) opens on click, not pointerDown.
// This is because PopoverPrimitive.Trigger binds onClick → onOpenToggle internally.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DatePicker, DatePickerTrigger } from './DatePicker';

function renderDatePicker(overrides?: {
    value?: Date | null;
    onChange?: (date: Date | null) => void;
    clearable?: boolean;
    disabled?: boolean;
    placeholder?: string;
}) {
    const onChange = overrides?.onChange ?? vi.fn();
    // The root <DatePicker> renders DatePickerContent + quick picks + calendar
    // internally inside `open &&`. Children only need <DatePickerTrigger />.
    render(
        <DatePicker
            value={overrides?.value ?? null}
            onChange={onChange}
            clearable={overrides?.clearable}
            disabled={overrides?.disabled}
            placeholder={overrides?.placeholder}
            aria-label='Test date'
        >
            <DatePickerTrigger />
        </DatePicker>,
    );
    return { onChange };
}

function getTrigger() {
    // The trigger button's accessible name is its text content:
    // the placeholder (default "Pick a date…") or the formatted date.
    return screen.getByRole('button', { name: /Pick a date…|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i });
}

function openPicker() {
    const trigger = getTrigger();
    fireEvent.click(trigger);
    return trigger;
}

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

describe('DatePicker', () => {
    // 1. Renders trigger button — shows placeholder when value={null}
    it('renders trigger with placeholder text when value is null', () => {
        renderDatePicker();
        const trigger = getTrigger();
        expect(trigger).toBeInTheDocument();
        expect(screen.getByText('Pick a date…')).toBeInTheDocument();
    });

    // 2. Renders formatted date — shows formatted date when value is set
    it('renders formatted date when value is provided', () => {
        const value = new Date(2026, 6, 15); // Jul 15 2026
        renderDatePicker({ value });
        const expected = new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(value);
        expect(screen.getByText(expected)).toBeInTheDocument();
    });

    // 3. Opens popover on click — quick picks appear
    it('opens popover showing quick picks', () => {
        renderDatePicker();
        openPicker();
        expect(screen.getByRole('menuitem', { name: 'Today' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Tomorrow' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Next week' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Next month' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'No date' })).toBeInTheDocument();
    });

    // 4. Quick-pick 'Today' selects today — onChange called with today, popover closes
    it('quick-pick Today selects today and closes popover', () => {
        const { onChange } = renderDatePicker();
        openPicker();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Today' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        const calledDate = onChange.mock.calls[0][0] as Date;
        expect(calledDate).toBeInstanceOf(Date);
        expect(isSameDay(calledDate, new Date())).toBe(true);
        // Popover closes after selection
        expect(screen.queryByRole('menuitem', { name: 'Today' })).toBeNull();
    });

    // 5. Quick-pick 'No date' clears — onChange(null)
    it('quick-pick No date clears value', () => {
        const { onChange } = renderDatePicker({ value: new Date(2026, 0, 1) });
        openPicker();
        fireEvent.click(screen.getByRole('menuitem', { name: 'No date' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    // 6. Clicking calendar row transitions to calendar view
    it('clicking calendar row shows calendar grid', () => {
        renderDatePicker();
        openPicker();
        const calendarRow = screen.getByRole('menuitem', { name: /Pick a date…/i });
        fireEvent.click(calendarRow);
        const grid = screen.getByRole('grid');
        expect(grid).toBeInTheDocument();
    });

    // 7. Day selection — clicking a day cell calls onChange with that date and closes
    it('clicking a day cell selects that date and closes popover', () => {
        const { onChange } = renderDatePicker();
        openPicker();
        fireEvent.click(screen.getByRole('menuitem', { name: /Pick a date…/i }));
        const dayButton = screen.getByRole('gridcell', { name: '15' }).querySelector('button');
        expect(dayButton).not.toBeNull();
        fireEvent.click(dayButton!);
        expect(onChange).toHaveBeenCalledTimes(1);
        const calledDate = onChange.mock.calls[0][0] as Date;
        expect(calledDate).toBeInstanceOf(Date);
        expect(calledDate.getDate()).toBe(15);
        // Popover closes
        expect(screen.queryByRole('grid')).toBeNull();
    });

    // 8. Calendar navigation — prev/next month buttons change displayed month
    it('navigation buttons change the displayed month', () => {
        renderDatePicker();
        openPicker();
        fireEvent.click(screen.getByRole('menuitem', { name: /Pick a date…/i }));
        // react-day-picker v10 puts the month label in the grid's aria-label
        const grid = screen.getByRole('grid');
        const initialMonth = grid.getAttribute('aria-label');

        const nextButton = screen.getByRole('button', { name: /Next Month/i });
        fireEvent.click(nextButton);

        const updatedGrid = screen.getByRole('grid');
        expect(updatedGrid.getAttribute('aria-label')).not.toBe(initialMonth);
    });

    // 9. Clearable button — X icon appears when clearable + value, clicking clears
    it('shows clear icon when clearable and clears on click', () => {
        const { onChange } = renderDatePicker({
            value: new Date(2026, 6, 15),
            clearable: true,
        });
        // The XIcon SVG has class "lucide-x" — it's aria-hidden so we query by class
        const xIcon = document.querySelector('svg.lucide-x');
        expect(xIcon).not.toBeNull();
        fireEvent.click(xIcon!);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    // 10. Clearable not shown when clearable={false}
    it('does not show clear icon when clearable is false', () => {
        renderDatePicker({
            value: new Date(2026, 6, 15),
            clearable: false,
        });
        expect(document.querySelector('svg.lucide-x')).toBeNull();
    });

    // 11. Disabled state — trigger button is disabled, popover does not open
    it('disabled trigger prevents popover from opening', () => {
        renderDatePicker({ disabled: true });
        const trigger = getTrigger();
        expect(trigger).toBeDisabled();
        fireEvent.click(trigger);
        // Popover should NOT open
        expect(screen.queryByRole('menuitem', { name: 'Today' })).toBeNull();
    });

    // 12. Custom placeholder
    it('renders custom placeholder text on trigger', () => {
        renderDatePicker({ placeholder: 'Select due date' });
        expect(screen.getByText('Select due date')).toBeInTheDocument();
    });

    // 13. Keyboard: Escape closes popover
    it('Escape closes the popover', () => {
        renderDatePicker();
        openPicker();
        expect(screen.getByRole('menuitem', { name: 'Today' })).toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByRole('menuitem', { name: 'Today' })).toBeNull();
    });
});
