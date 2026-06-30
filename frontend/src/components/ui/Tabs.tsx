// SLYK-11 — Tabs primitive (Radix Tabs wrapper).
// Compound named exports. A11y (roving focus, ArrowLeft/Right/Home/End cycling,
// aria-selected, aria-controls/aria-labelledby pairing, automatic/manual
// activation) delegated to Radix. forwardRef + rest-spread so consumers can pass
// native attrs. Tokens from F32 (no raw hex colors — semantic tokens only).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

// --- Root -------------------------------------------------------------------
// Forwards value, defaultValue, onValueChange, orientation, dir, activationMode.
export const Tabs = TabsPrimitive.Root;

// --- List -------------------------------------------------------------------
export const TabsList = forwardRef<
    ElementRef<typeof TabsPrimitive.List>,
    ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...rest }, ref) {
    return (
        <TabsPrimitive.List
            ref={ref}
            className={cn(
                'inline-flex h-10 items-center justify-center gap-1 rounded-md',
                'bg-muted/60 p-1 text-muted-foreground',
                'border border-border',
                className,
            )}
            {...rest}
        />
    );
});

// --- Trigger ----------------------------------------------------------------
export const TabsTrigger = forwardRef<
    ElementRef<typeof TabsPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...rest }, ref) {
    return (
        <TabsPrimitive.Trigger
            ref={ref}
            className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm',
                'px-3 py-1.5 text-sm font-medium',
                'text-muted-foreground transition-colors',
                // focus ring identical to Button.tsx:27-28.
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'focus-visible:ring-offset-2',
                'disabled:pointer-events-none disabled:opacity-50',
                'data-[state=active]:bg-accent data-[state=active]:text-accent-foreground',
                className,
            )}
            {...rest}
        />
    );
});

// --- Content ----------------------------------------------------------------
// Forwards forceMount so consumers can keep a panel mounted (e.g. to preserve
// scroll/state) even when its tab is inactive.
export const TabsContent = forwardRef<
    ElementRef<typeof TabsPrimitive.Content>,
    ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...rest }, ref) {
    return (
        <TabsPrimitive.Content
            ref={ref}
            className={cn(
                'mt-2 focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-ring focus-visible:ring-offset-2',
                className,
            )}
            {...rest}
        />
    );
});
