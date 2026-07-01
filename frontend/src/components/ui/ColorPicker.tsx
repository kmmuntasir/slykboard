// DEL-01 — ColorPicker primitive.
// Controlled swatch <button> (Radix Popover Trigger) filled with `value` that
// opens a react-colorful square picker + hex field, both bound to value/onChange.
// Collapses the ad-hoc HexColorPicker + static swatch in LabelManager.tsx into
// one reusable, theme-consistent control. Not wired into LabelManager (DEL-02).
//
// Controlled color (no internal default), UNCONTROLLED open state (no
// open/onOpenChange — Radix manages open/close). onChange always emits #RRGGBB
// regardless of `prefixed` (prefixed affects hex-field display only).
//
// Portal renders to document.body so content renders above the settings layout
// and inherits .dark from <html> (Tooltip.tsx portal-dark invariant).
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { cn } from './cn';

// --- Style constants (token-only chrome; raw inline style for the fill) ------

const SWATCH_BASE =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border ' +
    'cursor-pointer transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

const CONTENT_BASE =
    'z-50 flex w-auto flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md';

const INPUT_BASE =
    'w-40 rounded border border-input bg-background px-2 py-1 text-sm text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const DEFAULT_SWATCH_LABEL = 'Color';

// --- Props ------------------------------------------------------------------

export interface ColorPickerProps
    extends Omit<
        ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>,
        'defaultOpen' | 'open' | 'onOpenChange' | 'modal' | 'children'
    > {
    /** Controlled color value, a #RRGGBB hex string. */
    value: string;
    /** Emitted with the new #RRGGBB hex whenever the picker or input changes it. */
    onChange: (hex: string) => void;
    /** Accessible name for the swatch trigger button. */
    'aria-label'?: string;
    /** Optional id forwarded onto the hex <input> for external label association. */
    id?: string;
    /** Show the leading '#' in the hex field (display only). Default: true. */
    prefixed?: boolean;
    /** Classes applied to the swatch trigger (merged after defaults so caller wins). */
    className?: string;
    /** Classes applied to the popover content panel (merged after defaults). */
    contentClassName?: string;
}

// --- Component ---------------------------------------------------------------

export const ColorPicker = forwardRef<
    ElementRef<typeof PopoverPrimitive.Trigger>,
    ColorPickerProps
>(function ColorPicker(
    {
        value,
        onChange,
        'aria-label': ariaLabel = DEFAULT_SWATCH_LABEL,
        id,
        prefixed = true,
        className,
        contentClassName,
    },
    ref,
) {
    return (
        <PopoverPrimitive.Root>
            {/* The swatch IS the trigger: a real <button>, keyboard-activatable,
                filled with the raw value via inline style (not a token). */}
            <PopoverPrimitive.Trigger
                ref={ref}
                aria-label={ariaLabel}
                style={{ backgroundColor: value }}
                className={cn(SWATCH_BASE, className)}
            />
            {/* Portal to document.body so it renders above the settings layout and
                inherits .dark from <html>. */}
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    sideOffset={4}
                    align="start"
                    className={cn(CONTENT_BASE, contentClassName)}
                >
                    <HexColorPicker color={value} onChange={onChange} className="size-44" />
                    <HexColorInput
                        id={id}
                        color={value}
                        onChange={onChange}
                        prefixed={prefixed}
                        aria-label="Hex color"
                        spellCheck={false}
                        className={cn(INPUT_BASE)}
                    />
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
});
