// DatePicker primitive — compound named exports.
// Uses Radix Popover + react-day-picker v10 for the calendar grid.
// Portal renders to document.body. Matches Dropdown.tsx pattern.
import {
    forwardRef,
    useState,
    useCallback,
    useMemo,
    createContext,
    useContext,
    type ComponentPropsWithoutRef,
    type ElementRef,
} from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { DayPicker, UI, SelectionState, DayFlag, type DayPickerProps } from 'react-day-picker';
import 'react-day-picker/style.css';
import { CalendarIcon, XIcon } from 'lucide-react';
import { cn } from './cn';

// --- Helpers ----------------------------------------------------------------

function formatDisplayDate(date: Date): string {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

// --- Types ------------------------------------------------------------------

export interface QuickPick {
    label: string;
    date: Date | null;
}

// --- Context ----------------------------------------------------------------

interface DatePickerContextValue {
    value: Date | null;
    onChange: (date: Date | null) => void;
    placeholder: string;
    clearable: boolean;
    disabled: boolean;
    view: 'quick' | 'calendar';
    setView: (view: 'quick' | 'calendar') => void;
    setOpen: (open: boolean) => void;
    picks: QuickPick[];
}

const DatePickerContext = createContext<DatePickerContextValue | null>(null);

function useDatePickerContext(): DatePickerContextValue {
    const ctx = useContext(DatePickerContext);
    if (!ctx) throw new Error('DatePicker compound components must be used within <DatePicker>');
    return ctx;
}

// --- Default quick picks ----------------------------------------------------

function getDefaultQuickPicks(): QuickPick[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    return [
        { label: 'Today', date: today },
        { label: 'Tomorrow', date: tomorrow },
        { label: 'Next week', date: nextWeek },
        { label: 'Next month', date: nextMonth },
        { label: 'No date', date: null },
    ];
}

// --- Trigger styling (matches TextInput.tsx BASE_CLASSES) -------------------

const TRIGGER_BASE =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary';

// --- Trigger ----------------------------------------------------------------

export interface DatePickerTriggerProps
    extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger> {}

export const DatePickerTrigger = forwardRef<
    ElementRef<typeof PopoverPrimitive.Trigger>,
    DatePickerTriggerProps
>(function DatePickerTrigger({ className, children, ...rest }, ref) {
    const { value, placeholder, clearable, disabled, onChange } = useDatePickerContext();

    return (
        <PopoverPrimitive.Trigger
            ref={ref}
            disabled={disabled}
            className={cn(TRIGGER_BASE, 'w-full inline-flex items-center justify-between', className)}
            {...rest}
        >
            <span className={cn(!value && 'text-muted-foreground')}>
                {value ? formatDisplayDate(value) : placeholder}
            </span>
            {clearable && value !== null ? (
                <XIcon
                    className="h-4 w-4 text-muted-foreground hover:text-foreground shrink-0"
                    onClick={(e) => {
                        e.stopPropagation();
                        onChange(null);
                    }}
                />
            ) : (
                <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
        </PopoverPrimitive.Trigger>
    );
});

// --- Content (Portal + Content) --------------------------------------------

export interface DatePickerContentProps
    extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
    sideOffset?: number;
}

export const DatePickerContent = forwardRef<
    ElementRef<typeof PopoverPrimitive.Content>,
    DatePickerContentProps
>(function DatePickerContent({ className, sideOffset = 4, ...rest }, ref) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                align="start"
                className={cn(
                    'bg-popover text-popover-foreground border border-border rounded-md shadow-md',
                    'z-50 p-0',
                    className,
                )}
                {...rest}
            />
        </PopoverPrimitive.Portal>
    );
});

// --- Quick Pick button ------------------------------------------------------

export interface DatePickerQuickPickProps
    extends ComponentPropsWithoutRef<'button'> {
    active?: boolean;
}

export const DatePickerQuickPick = forwardRef<HTMLButtonElement, DatePickerQuickPickProps>(
    function DatePickerQuickPick({ className, active, ...rest }, ref) {
        return (
            <button
                ref={ref}
                role="menuitem"
                className={cn(
                    'w-full px-3 py-2 text-sm text-left',
                    'hover:bg-accent hover:text-accent-foreground transition-colors',
                    active && 'bg-accent text-accent-foreground',
                    className,
                )}
                {...rest}
            />
        );
    },
);

// --- Calendar view ----------------------------------------------------------

const DAY_PICKER_CLASSNAMES: DayPickerProps['classNames'] = {
    [UI.Root]: 'p-1',
    [UI.Chevron]: 'h-4 w-4 text-foreground dark:text-gray-200',
    [UI.Day]: 'flex items-center justify-center',
    [UI.DayButton]: 'w-9 h-9 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors',
    [UI.CaptionLabel]: 'flex items-center justify-center py-2 font-medium text-sm',
    [UI.Dropdowns]: '',
    [UI.Dropdown]: '',
    [UI.DropdownRoot]: '',
    [UI.Footer]: '',
    [UI.MonthGrid]: 'w-full border-collapse',
    [UI.MonthCaption]: 'flex items-center justify-center py-2 font-medium text-sm',
    [UI.MonthsDropdown]: '',
    [UI.Month]: '',
    [UI.Months]: '',
    [UI.Nav]: 'flex items-center justify-between px-1',
    [UI.NextMonthButton]:
        'p-1 rounded-md text-gray-900 dark:text-gray-100 hover:bg-accent hover:text-accent-foreground transition-colors',
    [UI.PreviousMonthButton]:
        'p-1 rounded-md text-gray-900 dark:text-gray-100 hover:bg-accent hover:text-accent-foreground transition-colors',
    [UI.Week]: 'flex',
    [UI.Weeks]: '',
    [UI.Weekday]: 'flex items-center justify-center w-9 h-9 text-muted-foreground text-xs font-medium',
    [UI.Weekdays]: 'flex',
    [UI.WeekNumber]: '',
    [UI.WeekNumberHeader]: '',
    [UI.YearsDropdown]: '',
    [SelectionState.selected]:
        'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
    [DayFlag.today]: 'font-bold',
    [DayFlag.disabled]: 'opacity-50',
    [DayFlag.hidden]: 'hidden',
    [DayFlag.outside]: 'opacity-50',
    [DayFlag.focused]: '',
};

export interface DatePickerCalendarProps
    extends Omit<DayPickerProps, 'mode' | 'selected' | 'onSelect'> {
    value: Date | null;
    onDaySelect: (date: Date) => void;
}

export const DatePickerCalendar = forwardRef<HTMLDivElement, DatePickerCalendarProps>(
    function DatePickerCalendar({ value, onDaySelect, className, ...rest }, ref) {
        return (
            <div ref={ref} className={cn('p-2', className)}>
                <DayPicker
                    mode="single"
                    selected={value ?? undefined}
                    onSelect={(day) => {
                        if (day) onDaySelect(day);
                    }}
                    defaultMonth={value ?? new Date()}
                    classNames={DAY_PICKER_CLASSNAMES}
                    {...rest}
                />
            </div>
        );
    },
);

// --- Root (state manager) ---------------------------------------------------

export interface DatePickerProps {
    value: Date | null;
    onChange: (date: Date | null) => void;
    placeholder?: string;
    clearable?: boolean;
    quickPicks?: QuickPick[];
    disabled?: boolean;
    'aria-label'?: string;
    children: React.ReactNode;
}

export function DatePicker({
    value,
    onChange,
    placeholder = 'Pick a date…',
    clearable = false,
    quickPicks,
    disabled = false,
    'aria-label': ariaLabel,
    children,
}: DatePickerProps) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'quick' | 'calendar'>('quick');

    const picks = useMemo(() => quickPicks ?? getDefaultQuickPicks(), [quickPicks]);

    const handleDaySelect = useCallback(
        (date: Date) => {
            onChange(date);
            setOpen(false);
            setView('quick');
        },
        [onChange],
    );

    const handleQuickPick = useCallback(
        (date: Date | null) => {
            onChange(date);
            setOpen(false);
            setView('quick');
        },
        [onChange],
    );

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) setView('quick');
    }, []);

    const ctx = useMemo<DatePickerContextValue>(
        () => ({
            value,
            onChange,
            placeholder,
            clearable,
            disabled,
            view,
            setView,
            setOpen,
            picks,
        }),
        [value, onChange, placeholder, clearable, disabled, view, picks],
    );

    return (
        <DatePickerContext.Provider value={ctx}>
            <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
                {children}
                {open && (
                    <DatePickerContent>
                        {view === 'quick' ? (
                            <div className="min-w-[200px] p-1">
                                {picks.map((pick) => (
                                    <DatePickerQuickPick
                                        key={pick.label}
                                        active={
                                            pick.date === null
                                                ? value === null
                                                : value !== null &&
                                                  pick.date !== null &&
                                                  isSameDay(pick.date, value)
                                        }
                                        onClick={() => handleQuickPick(pick.date)}
                                    >
                                        {pick.label}
                                    </DatePickerQuickPick>
                                ))}
                                <div className="border-t border-border" />
                                <DatePickerQuickPick onClick={() => setView('calendar')}>
                                    <span className="inline-flex items-center gap-2">
                                        <CalendarIcon className="h-4 w-4" />
                                        {placeholder}
                                    </span>
                                </DatePickerQuickPick>
                            </div>
                        ) : (
                            <DatePickerCalendar
                                value={value}
                                onDaySelect={handleDaySelect}
                            />
                        )}
                    </DatePickerContent>
                )}
            </PopoverPrimitive.Root>
        </DatePickerContext.Provider>
    );
}
