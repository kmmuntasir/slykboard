// F35 — TextInput primitive.
// PRD §3.4 verbatim focus-ring classes. Fixes ManualEntryForm focus: → focus-visible:ring-2 gap (§2.5).
// forwardRef + rest-spread so Field/forms can wire native attrs.
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from './cn'

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>

const BASE_CLASSES =
    'border border-input rounded-md px-3 py-2 bg-background text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
    'focus-visible:border-primary'

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
    function TextInput({ className, ...rest }, ref) {
        return <input ref={ref} className={cn(BASE_CLASSES, className)} {...rest} />
    },
)
