// F35 — Textarea primitive.
// Sibling to TextInput (shared focus-ring classes). Adds resize + rows defaults.
// PRD §3.4 verbatim focus-ring classes.
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const BASE_CLASSES =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary resize-y';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
    { className, ...rest },
    ref,
) {
    return <textarea ref={ref} className={cn(BASE_CLASSES, className)} {...rest} />;
});
