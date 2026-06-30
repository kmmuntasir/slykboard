// DEL-02 — Select primitive (Radix DropdownMenu wrapper).
// This is a compound Select built on @radix-ui/react-dropdown-menu — NOT
// @radix-ui/react-select (deliberate, locked decision: avoid a second Radix
// dependency; DropdownMenu already covers the a11y surface we need — focus trap,
// outside-click, Esc, aria-expanded, roving focus). A11y is delegated to Radix.
//
// Compound named exports only (no default export).
//
// Portal-dark: renders via Radix Portal to document.body; resolves bg-popover
// because .dark lives on <html> (F33/F34 invariant copied from Dropdown.tsx).
// If anyone moves .dark to a wrapper div, portals break silently — flagged for
// F51 visual QA.
import {
    createContext,
    forwardRef,
    useContext,
    useMemo,
    useState,
    type ComponentPropsWithoutRef,
    type ElementRef,
    type ReactNode,
} from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { TextInput } from './TextInput';

// --- Context -----------------------------------------------------------------
export interface SelectContextValue {
    value: string;
    onValueChange: (value: string) => void;
    search: string;
    onSearchChange: (value: string) => void;
}

const SelectContext = createContext<SelectContextValue | null>(null);

/**
 * Internal hook consumed by SelectItem / SelectContent. Throws if used outside a
 * `<Select>` so mis-wiring fails loudly.
 */
export function useSelectContext(): SelectContextValue {
    const ctx = useContext(SelectContext);
    if (!ctx) {
        throw new Error('Select compound components must be rendered inside <Select>.');
    }
    return ctx;
}

// --- Root --------------------------------------------------------------------
export interface SelectProps extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root> {
    /** Controlled selected value. */
    value?: string;
    /** Initial value when uncontrolled. */
    defaultValue?: string;
    /** Called with the new value whenever a SelectItem is chosen. */
    onValueChange?: (value: string) => void;
}

export function Select({
    value: valueProp,
    defaultValue = '',
    onValueChange,
    onOpenChange,
    children,
    ...rest
}: SelectProps) {
    const [internalValue, setInternalValue] = useState(defaultValue);
    const [search, setSearch] = useState('');

    const isControlled = valueProp !== undefined;
    const value = isControlled ? (valueProp as string) : internalValue;

    const handleValueChange = (next: string) => {
        if (!isControlled) {
            setInternalValue(next);
        }
        onValueChange?.(next);
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            // Reset the filter whenever the menu closes so reopening starts clean.
            setSearch('');
        }
        onOpenChange?.(open);
    };

    const ctx = useMemo<SelectContextValue>(
        () => ({
            value,
            onValueChange: handleValueChange,
            search,
            onSearchChange: setSearch,
        }),
        [value, search],
    );

    return (
        <SelectContext.Provider value={ctx}>
            <DropdownMenuPrimitive.Root onOpenChange={handleOpenChange} {...rest}>
                {children}
            </DropdownMenuPrimitive.Root>
        </SelectContext.Provider>
    );
}

// --- Trigger -----------------------------------------------------------------
export interface SelectTriggerProps
    extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger> {}

export const SelectTrigger = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Trigger>,
    SelectTriggerProps
>(function SelectTrigger({ className, children, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Trigger
            ref={ref}
            className={cn(
                'group flex items-center justify-between gap-2',
                'border border-input bg-background text-foreground',
                'rounded-md px-3 py-2 text-sm',
                // House-standard focus ring (mirrors Tabs.tsx:46-47).
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'focus-visible:ring-offset-2',
                'data-[state=open]:ring-2 data-[state=open]:ring-ring',
                className,
            )}
            {...rest}
        >
            <span className="flex-1 text-left truncate">{children}</span>
            {/* `data-state` lives on the trigger button; the chevron is a
                descendant, so flip it via the parent using `group` +
                `group-data-[state=open]:`. */}
            <ChevronDown
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
            />
        </DropdownMenuPrimitive.Trigger>
    );
});

// --- Value (presentational) --------------------------------------------------
export interface SelectValueProps {
    /** Shown when no children/value present. */
    placeholder?: string;
    /** Caller-resolved label for the current value (preferred over placeholder). */
    children?: ReactNode;
}

export function SelectValue({ placeholder, children }: SelectValueProps) {
    if (children !== undefined && children !== null && children !== '') {
        return <>{children}</>;
    }
    return <span className="text-muted-foreground">{placeholder}</span>;
}

// --- Content (wraps Portal + Content internally) ----------------------------
export interface SelectContentProps
    extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
    /** Side offset in px (Radix default 0; we default to 4 for a small gap). */
    sideOffset?: number;
    /** When true, renders a filter input at the top of the content. */
    searchable?: boolean;
}

export const SelectContent = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Content>,
    SelectContentProps
>(function SelectContent(
    { className, sideOffset = 4, searchable = false, children, ...rest },
    ref,
) {
    const ctx = useSelectContext();

    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    'bg-popover text-popover-foreground border border-border rounded-md shadow-md',
                    'z-50 min-w-[8rem] overflow-hidden p-1',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    className,
                )}
                {...rest}
            >
                {searchable ? (
                    <>
                        <div className="p-1">
                            <TextInput
                                // autoFocus so opening + typing filters immediately.
                                autoFocus
                                aria-label="Search"
                                placeholder="Search…"
                                value={ctx.search}
                                onChange={(e) => ctx.onSearchChange(e.target.value)}
                                className="w-full"
                            />
                        </div>
                        <SelectSeparator />
                    </>
                ) : null}
                {children}
                {/*
                  "No matches" rendering: SelectItem self-filters via
                  `return null` when its textValue doesn't include ctx.search,
                  which correctly removes the menuitem from the DOM. Rendering an
                  "No matches" placeholder when ALL items are filtered out
                  requires counting visible items across the component boundary
                  (SelectItem → SelectContent); React does not run child function
                  bodies during the parent's JSX construction, so a synchronous
                  render-phase counter is unreliable here. Per DEL-02 spec, this
                  is the documented simpler behaviour: callers may include their
                  own <div>No matches</div> sibling if they need the message.
                */}
            </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
    );
});

// --- Separator ---------------------------------------------------------------
export const SelectSeparator = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function SelectSeparator({ className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Separator
            ref={ref}
            className={cn('-mx-1 my-1 h-px bg-border', className)}
            {...rest}
        />
    );
});

// --- Item --------------------------------------------------------------------
export interface SelectItemProps
    extends Omit<ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>, 'onSelect'> {
    /** Value emitted to onValueChange when this item is chosen. */
    value: string;
    /** Plain-text label used for both rendering (default children) and search matching. */
    textValue: string;
    /** Optional custom label node (defaults to textValue). */
    children?: ReactNode;
}

export const SelectItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Item>,
    SelectItemProps
>(function SelectItem({ value, textValue, children, className, ...rest }, ref) {
    const ctx = useSelectContext();

    // Type-to-search: hide self when the filter excludes textValue.
    if (ctx.search) {
        const haystack = textValue.toLowerCase();
        const needle = ctx.search.toLowerCase();
        if (!haystack.includes(needle)) {
            return null;
        }
    }

    const isSelected = ctx.value === value;

    return (
        <DropdownMenuPrimitive.Item
            ref={ref}
            // onSelect fires on Enter/Space/click; route it to onValueChange.
            onSelect={() => ctx.onValueChange(value)}
            className={cn(
                'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2',
                'text-sm outline-none',
                'focus:bg-accent focus:text-accent-foreground',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className,
            )}
            {...rest}
        >
            {/* Leading check indicator — absolutely positioned in the pl-8 gutter. */}
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {isSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            </span>
            {children ?? textValue}
        </DropdownMenuPrimitive.Item>
    );
});

// --- Group -------------------------------------------------------------------
export const SelectGroup = DropdownMenuPrimitive.Group;

// --- Label -------------------------------------------------------------------
export const SelectLabel = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Label>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function SelectLabel({ className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Label
            ref={ref}
            className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
            {...rest}
        />
    );
});
