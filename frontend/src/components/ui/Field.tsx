// F35 — Field primitive.
// Unifies label/error markup drift (TicketAttributeForm vs ManualEntryForm).
// <label> + <span> label + child input + <p role="alert"> error (only when present).
// Closes the §2.5 ManualEntryForm role="alert" a11y gap.
import { type ReactNode } from 'react';
import { cn } from './cn';

export interface FieldProps {
    /** Label text (rendered inside a <span>). */
    label: string;
    /** Optional id to associate the label with a control via htmlFor. */
    htmlFor?: string;
    /** The control (TextInput, Select, etc.). */
    children: ReactNode;
    /** Error message; when present, rendered as <p role="alert">. */
    error?: string;
    /** Optional className for the wrapping <label>. */
    className?: string;
    /** Optional icon rendered inline-left of the label text (on the same line). */
    icon?: ReactNode;
    /**
     * Optional action node rendered right-aligned in the label row
     * (e.g. an "Edit" button). See render-site comment for the a11y
     * constraint on why this is a sibling rather than nested in <label>.
     */
    action?: ReactNode;
}

export function Field({ label, htmlFor, children, error, className, icon, action }: FieldProps) {
    // No action: keep the historical byte-identical structure (root <label> wrapping
    // the text span + children + error) so every existing consumer is unaffected.
    if (!action) {
        return (
            <label htmlFor={htmlFor} className={cn('block', className)}>
                {icon ? (
                    <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                        {icon}
                        {label}
                    </span>
                ) : (
                    <span className="mb-1 block text-sm font-medium">{label}</span>
                )}
                {children}
                {error ? (
                    <p role="alert" className="mt-1 text-sm text-destructive">
                        {error}
                    </p>
                ) : null}
            </label>
        );
    }

    // An action is provided. The action is typically an interactive control (e.g. a
    // Button) and MUST NOT be nested inside the <label> element: a <label> implicitly
    // associates every descendant with the field, so an interactive action inside it
    // would be bound to the input and break the label-input association. We therefore
    // render the label row as a flex container where <label> wraps only the icon +
    // label text, and the action renders as a right-aligned (ml-auto) flex sibling
    // that is outside the <label>.
    return (
        <div className={cn('block', className)}>
            <div className="mb-1 flex items-center gap-1.5">
                <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium">
                    {icon}
                    {label}
                </label>
                <div className="ml-auto">{action}</div>
            </div>
            {children}
            {error ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
