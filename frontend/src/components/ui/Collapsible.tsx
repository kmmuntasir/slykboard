// DEL-01 — Collapsible primitive (Radix Collapsible wrapper).
// Compound named exports. A11y (aria-expanded/aria-controls pairing, keyboard
// activation, disabled state) delegated to Radix. forwardRef + rest-spread so
// consumers can pass native attrs. Tokens only (no raw hex). Animation classes
// follow the F36 Dropdown Content pattern (data-[state=open|closed] fade).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { cn } from './cn';

// --- Root -------------------------------------------------------------------
// Forwards open, defaultOpen, onOpenChange, disabled, dir.
export const Collapsible = CollapsiblePrimitive.Root;

// --- Trigger ----------------------------------------------------------------
export const CollapsibleTrigger = forwardRef<
    ElementRef<typeof CollapsiblePrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>(function CollapsibleTrigger({ className, ...rest }, ref) {
    return (
        <CollapsiblePrimitive.Trigger
            ref={ref}
            className={cn(className)}
            {...rest}
        />
    );
});

// --- Content ----------------------------------------------------------------
export const CollapsibleContent = forwardRef<
    ElementRef<typeof CollapsiblePrimitive.Content>,
    ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(function CollapsibleContent({ className, ...rest }, ref) {
    return (
        <CollapsiblePrimitive.Content
            ref={ref}
            className={cn(
                'overflow-hidden text-foreground',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                className,
            )}
            {...rest}
        />
    );
});
