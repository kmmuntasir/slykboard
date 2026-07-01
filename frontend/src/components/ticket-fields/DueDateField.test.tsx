import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { DueDateField } from './DueDateField';
import { ticketFormSchema, type TicketFormValues } from '@/hooks/useTicketForm';

// Shared ref so each test can inspect the live form value after interactions.
let formMethods: ReturnType<typeof useForm<TicketFormValues>>;

function Wrapper({ defaults }: { defaults?: Partial<TicketFormValues> }) {
    formMethods = useForm<TicketFormValues>({
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
        <FormProvider {...formMethods}>
            <DueDateField />
        </FormProvider>
    );
}

function renderDueDateField(defaults?: Partial<TicketFormValues>) {
    render(<Wrapper defaults={defaults} />);
}

/**
 * The DatePickerTrigger is inside a <label> rendered by Field("Due date", ...),
 * so the button's accessible name is "Due date" regardless of the trigger text.
 */
function getTrigger(): HTMLElement {
    return screen.getByRole('button', { name: 'Due date' });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DueDateField', () => {
    it('renders the field label with CalendarClock icon', () => {
        renderDueDateField();
        expect(screen.getByText('Due date')).toBeInTheDocument();
        const label = screen.getByText('Due date').closest('label') ?? screen.getByText('Due date').parentElement;
        expect(label).toBeTruthy();
        const svg = label!.querySelector('svg');
        expect(svg).toBeInTheDocument();
    });

    it('renders trigger with placeholder when dueDate is null', () => {
        renderDueDateField({ dueDate: null });
        expect(screen.getByText('Pick a date…')).toBeInTheDocument();
    });

    it('renders trigger with formatted date when dueDate is set', () => {
        const isoDate = '2026-07-15T00:00:00.000Z';
        renderDueDateField({ dueDate: isoDate });
        // formatDisplayDate produces locale-dependent string like "Jul 15, 2026"
        const formatted = new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(new Date(isoDate));
        expect(screen.getByText(formatted)).toBeInTheDocument();
    });

    it('opens popover on click — quick picks are visible', () => {
        renderDueDateField();
        const trigger = getTrigger();
        fireEvent.click(trigger);
        // Quick picks render as role="menuitem" buttons
        expect(screen.getByRole('menuitem', { name: 'Today' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Tomorrow' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Next week' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Next month' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'No date' })).toBeInTheDocument();
    });

    it('quick-pick "Today" sets dueDate to ISO datetime at UTC midnight', () => {
        // Capture 'today' at the same local date the quick picks use (new Date() in DueDateField)
        const renderNow = new Date();
        renderDueDateField({ dueDate: null });
        const trigger = getTrigger();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Today' }));

        const value = formMethods!.getValues('dueDate');
        expect(typeof value).toBe('string');
        // Must match YYYY-MM-DDT00:00:00.000Z
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);

        // The date portion must match today's local date converted to UTC midnight
        const todayUtc = `${renderNow.getFullYear()}-${String(renderNow.getMonth() + 1).padStart(2, '0')}-${String(renderNow.getDate()).padStart(2, '0')}`;
        expect(value).toBe(`${todayUtc}T00:00:00.000Z`);
    });

    it('quick-pick "No date" clears dueDate to null', () => {
        renderDueDateField({ dueDate: '2026-07-15T00:00:00.000Z' });
        const trigger = getTrigger();
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('menuitem', { name: 'No date' }));

        expect(formMethods!.getValues('dueDate')).toBeNull();
    });

    it('clearable button clears the value to null', () => {
        renderDueDateField({ dueDate: '2026-07-15T00:00:00.000Z' });
        const trigger = getTrigger();
        // XIcon renders as an SVG; find it inside the trigger button
        const clearButton = trigger.querySelector('svg.lucide-x');
        expect(clearButton).toBeInTheDocument();

        fireEvent.click(clearButton!);

        expect(formMethods!.getValues('dueDate')).toBeNull();
    });

    it('ISO string contract — form value matches YYYY-MM-DDT00:00:00.000Z after day selection', () => {
        renderDueDateField({ dueDate: null });
        const trigger = getTrigger();
        fireEvent.click(trigger);

        // Open calendar view by clicking the "Pick a date…" quick-pick at the bottom
        fireEvent.click(screen.getByRole('menuitem', { name: /Pick a date/i }));

        // Click "15" day button in the calendar (or any available day)
        const dayButtons = screen.getAllByRole('gridcell');
        // Pick a day that's not disabled/outside — find one with a button inside
        const clickableDay = dayButtons.find((cell) => {
            const btn = cell.querySelector('button');
            return btn && !btn.disabled && !cell.className.includes('outside');
        });
        expect(clickableDay).toBeDefined();
        fireEvent.click(clickableDay!.querySelector('button')!);

        const value = formMethods!.getValues('dueDate');
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);

        // Parse and verify the date is valid
        const parsed = new Date(value as string);
        expect(parsed.toISOString()).toBe(value);
    });
});
