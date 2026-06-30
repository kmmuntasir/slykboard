// F35 — Button primitive.
// Collapses the 59-<button> drift (3 sizes, divergent bg/text, missing focus rings)
// into one variant+size layer. forwardRef + rest-spread so Modal/forms can pass
// native button attrs (type, disabled, form). Tokens from F32 (no raw colors).
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'destructive'
    | 'destructive-outline'
    | 'outline';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    'destructive-outline':
        'border border-destructive bg-background text-destructive hover:bg-destructive/10',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    outline: 'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
};

const BASE_CLASSES =
    'inline-flex items-center justify-center rounded-md font-medium ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ' +
    'transition-colors';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', type = 'button', className, ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
            {...rest}
        />
    );
});
