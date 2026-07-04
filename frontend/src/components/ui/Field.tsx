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
    /**
     * Whether the children should be wrapped inside the <label> (true) or
     * rendered as a sibling of it (false). Defaults to true for full
     * backward compatibility with every existing consumer.
     *
     * Set to false when the child is a rich-text editor (e.g. CKEditor) or
     * any control whose own interactive descendants must NOT receive a
     * forwarded native click from the <label>: per the HTML spec a
     * <label> with no `for` attribute forwards a click to its first
     * labelable descendant, which for a toolbar-wrapping editor is its
     * first toolbar button (Bold) — every click in the content would
     * then toggle Bold. Render such children outside the <label>.
     */
    labelWrap?: boolean;
}

export function Field({
    label,
    htmlFor,
    children,
    error,
    className,
    icon,
    action,
    labelWrap = true,
}: FieldProps) {
    // Single structural decision: should the children live INSIDE the <label>?
    // Historical behavior = yes (labelWrap defaults true) AND no action present
    // (the action branch has never wrapped children in <label>). When false, we
    // render the <label> wrapping only icon + label text, with children + error
    // as siblings — the same non-wrapping structure the action branch uses.
    const wrapChildren = labelWrap && !action;

    // Historical byte-identical structure: root <label> wrapping the text span +
    // children + error. Every default consumer is unaffected.
    if (wrapChildren) {
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

    // Non-wrapping structure. <label> wraps ONLY the icon + label text; the
    // optional action renders in the same label row as a right-aligned sibling,
    // and children + error render as siblings of the entire label row — all
    // outside the <label>. This is required for the action path (an interactive
    // action must not be nested in <label>) and for any child whose own
    // descendants must not receive a forwarded click (e.g. a rich-text editor).
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
