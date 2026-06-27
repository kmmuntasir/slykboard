// F35 — SelectInput primitive.
// Native <select> wrapper (themeable, dark-able via tokens). Reuses TextInput-family
// focus-ring classes for visual consistency. forwardRef + rest-spread.
// Options passed as <option> children — keeps native form API intact.
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';

export type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement>;

const BASE_CLASSES =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary';

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput(
    { className, children, ...rest },
    ref,
) {
    return (
        <select ref={ref} className={cn(BASE_CLASSES, className)} {...rest}>
            {children}
        </select>
    );
});
