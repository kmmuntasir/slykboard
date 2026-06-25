// F35 — Field primitive.
// Unifies label/error markup drift (TicketAttributeForm vs ManualEntryForm).
// <label> + <span> label + child input + <p role="alert"> error (only when present).
// Closes the §2.5 ManualEntryForm role="alert" a11y gap.
import { createElement, type ReactNode } from 'react'
import { cn } from './cn'

export interface FieldProps {
    /** Label text (rendered inside a <span>). */
    label: string
    /** Optional id to associate the label with a control via htmlFor. */
    htmlFor?: string
    /** The control (TextInput, SelectInput, etc.). */
    children: ReactNode
    /** Error message; when present, rendered as <p role="alert">. */
    error?: string
    /** Optional className for the wrapping <label>. */
    className?: string
}

export function Field({ label, htmlFor, children, error, className }: FieldProps) {
    return (
        <label htmlFor={htmlFor} className={cn('block', className)}>
            <span className="mb-1 block text-sm font-medium">{label}</span>
            {children}
            {error ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                    {error}
                </p>
            ) : null}
        </label>
    )
}
