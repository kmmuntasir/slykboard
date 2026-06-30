// DEL-02 — ToggleGroup primitive (Radix ToggleGroup wrapper).
// Compound named exports. A11y (roving focus, aria-pressed, data-state=on|off,
// ArrowLeft/Right/Home/End cycling, disabled semantics) delegated to Radix —
// do not add aria-pressed/data-state by hand, Radix injects them automatically.
// Root requires type="single" | type="multiple"; in single mode value/onValueChange
// use string (CAN deselect to '' — consumers guard), in multiple mode string[].
// All such props pass through via {...rest}. Tokens from F32 (semantic tokens only).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from './cn';

// --- Root -------------------------------------------------------------------
// Forwards type, value, defaultValue, onValueChange, disabled, rovingFocus, dir.
export const ToggleGroup = forwardRef<
    ElementRef<typeof ToggleGroupPrimitive.Root>,
    ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(function ToggleGroup({ className, ...rest }, ref) {
    return (
        <ToggleGroupPrimitive.Root
            ref={ref}
            className={cn(
                'flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5',
                className,
            )}
            {...rest}
        />
    );
});

// --- Item -------------------------------------------------------------------
// Forwards value, disabled. Radix renders a <button> with aria-pressed +
// data-state="on|off". Focus ring mirrors Tabs.tsx:46-47 standard.
export const ToggleGroupItem = forwardRef<
    ElementRef<typeof ToggleGroupPrimitive.Item>,
    ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(function ToggleGroupItem({ className, ...rest }, ref) {
    return (
        <ToggleGroupPrimitive.Item
            ref={ref}
            className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
                'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'focus-visible:ring-offset-2',
                'data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
                'aria-[checked=true]:bg-accent aria-[checked=true]:text-accent-foreground',
                'data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-50',
                className,
            )}
            {...rest}
        />
    );
});
