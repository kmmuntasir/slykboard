// DEL-02 — Checkbox primitive (Radix Checkbox wrapper).
// Single named export. A11y (role=checkbox, aria-checked, keyboard toggle,
// focus-visible) delegated to Radix.
// API note: Radix Checkbox uses `checked` (boolean | 'indeterminate') +
// `onCheckedChange(checked: boolean)`. Callers migrate from native
// <input type="checkbox"> ChangeEvents to this boolean API.
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from './cn';

export const Checkbox = forwardRef<
    ElementRef<typeof CheckboxPrimitive.Root>,
    ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...rest }, ref) {
    return (
        <CheckboxPrimitive.Root
            ref={ref}
            className={cn(
                'peer h-4 w-4 shrink-0 rounded-sm border border-input bg-background',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary',
                'data-[state=disabled]:cursor-not-allowed data-[state=disabled]:opacity-50',
                className,
            )}
            {...rest}
        >
            <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
                <Check className="h-3 w-3" />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
});
