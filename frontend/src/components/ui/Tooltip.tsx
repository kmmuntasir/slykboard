// F36 — Tooltip primitive (Radix Tooltip wrapper).
// Compound named exports. Required so the disabled-nav 'Select a project first'
// hint (F42) is focus-reachable: disabled buttons aren't tooltip-reachable without
// a wrapper span (D5). Trigger asChild wraps the disabled button in a span that
// receives pointerenter/focus while the button stays inert.
//
// Portal-dark: TooltipContent wraps <Tooltip.Portal> (NOT auto-portalled in Radix)
// and renders to document.body; resolves bg-primary because .dark lives on <html>
// (F33/F34 invariant). If anyone moves .dark to a wrapper div, portals break
// silently — flagged for F51 visual QA.
//
// Provider is MANDATORY (Radix v1.2.10): wrap the app root once. F36 EXPORTS
// TooltipProvider; mounting it in main.tsx is F37's job (F36 ships primitive only).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn';

// --- Provider (MANDATORY app-root mount — F37 wires it) ----------------------
export type TooltipProviderProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>;

export function TooltipProvider({
    delayDuration = 300,
    skipDelayDuration = 300,
    ...rest
}: TooltipProviderProps) {
    // delayDuration=300: sane non-twitchy default (Radix default 700 too slow,
    // shadcn default 0 too twitchy). Per-tooltip override via <Tooltip delayDuration>.
    return (
        <TooltipPrimitive.Provider
            delayDuration={delayDuration}
            skipDelayDuration={skipDelayDuration}
            {...rest}
        />
    );
}

// --- Root -------------------------------------------------------------------
export type TooltipProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

export const Tooltip = TooltipPrimitive.Root;

// --- Trigger ----------------------------------------------------------------
export const TooltipTrigger = forwardRef<
    ElementRef<typeof TooltipPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(function TooltipTrigger({ ...rest }, ref) {
    return <TooltipPrimitive.Trigger ref={ref} {...rest} />;
});

// --- Content (wraps Portal + Content + Arrow internally) --------------------
export interface TooltipContentProps extends ComponentPropsWithoutRef<
    typeof TooltipPrimitive.Content
> {
    /** Side offset in px (Tooltip default 0 — sits flush to the trigger). */
    sideOffset?: number;
}

export const TooltipContent = forwardRef<
    ElementRef<typeof TooltipPrimitive.Content>,
    TooltipContentProps
>(function TooltipContent({ className, sideOffset = 0, children, ...rest }, ref) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    'bg-primary text-primary-foreground',
                    'z-50 overflow-hidden rounded-md px-3 py-1.5 text-xs',
                    'shadow-md',
                    'data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in',
                    'data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0',
                    'data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0',
                    'data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95',
                    'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
                    'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
                    className,
                )}
                {...rest}
            >
                {children}
                <TooltipPrimitive.Arrow className="bg-primary fill-primary" offset={5} />
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    );
});
