// F36 — Dropdown primitive (Radix DropdownMenu wrapper).
// Compound named exports. A11y (focus trap, outside-click, Esc, aria-expanded) from Radix.
// Portal-dark: renders via Radix Portal to document.body; resolves bg-popover because
// .dark lives on <html> (F33/F34 invariant). If anyone moves .dark to a wrapper div,
// portals break silently — flagged for F51 visual QA.
import {
    forwardRef,
    type ComponentPropsWithoutRef,
    type ElementRef,
} from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from './cn'

// --- Root -------------------------------------------------------------------
export const Dropdown = DropdownMenuPrimitive.Root

// --- Trigger ----------------------------------------------------------------
export const DropdownTrigger = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function DropdownTrigger({ ...rest }, ref) {
    return <DropdownMenuPrimitive.Trigger ref={ref} {...rest} />
})

// --- Content (wraps Portal + Content internally) ----------------------------
export interface DropdownContentProps
    extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
    /** Side offset in px (Radix default 0; F36 default 4 for a small gap). */
    sideOffset?: number
}

export const DropdownContent = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Content>,
    DropdownContentProps
>(function DropdownContent({ className, sideOffset = 4, ...rest }, ref) {
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
            />
        </DropdownMenuPrimitive.Portal>
    )
})

// --- Item -------------------------------------------------------------------
export type DropdownItemVariant = 'default' | 'destructive'

export interface DropdownItemProps
    extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
    variant?: DropdownItemVariant
}

const ITEM_VARIANT_CLASSES: Record<DropdownItemVariant, string> = {
    default: 'focus:bg-accent focus:text-accent-foreground',
    destructive:
        'text-destructive focus:bg-accent focus:text-accent-foreground data-[disabled]:opacity-50',
}

export const DropdownItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Item>,
    DropdownItemProps
>(function DropdownItem({ variant = 'default', className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Item
            ref={ref}
            className={cn(
                'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5',
                'text-sm outline-none transition-colors',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                ITEM_VARIANT_CLASSES[variant],
                className,
            )}
            {...rest}
        />
    )
})

// --- Separator --------------------------------------------------------------
export const DropdownSeparator = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownSeparator({ className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Separator
            ref={ref}
            className={cn('-mx-1 my-1 h-px bg-border', className)}
            {...rest}
        />
    )
})

// --- Label ------------------------------------------------------------------
export const DropdownLabel = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Label>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function DropdownLabel({ className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Label
            ref={ref}
            className={cn(
                'px-2 py-1.5 text-sm font-semibold text-muted-foreground',
                className,
            )}
            {...rest}
        />
    )
})

// --- Group ------------------------------------------------------------------
export const DropdownGroup = DropdownMenuPrimitive.Group
