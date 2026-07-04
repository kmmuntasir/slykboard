import { useEffect, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { AlignLeft, Pencil } from 'lucide-react';

import { RichTextEditor } from '@/components/RichTextEditor';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { type TicketFormValues, TICKET_DESCRIPTION_MAX_LENGTH } from '@/hooks/useTicketForm';
import { sanitizeDescription } from '@/utils/sanitizeHtml';

// DEL-02: description field is now read-first with edit-on-demand. The
// sanitized-HTML view is mounted by default for editable tickets; a low-
// emphasis "Edit" button (rendered via Field's `action` slot, NOT inside
// <label>) reveals the <RichTextEditor>. There is NO per-field Save/Cancel
// and NO auto-save — exiting the editor happens only via the global form
// Save. On a successful global submit (isSubmitSuccessful flips true) the
// field reverts to read-only. `readOnly` always wins (no editor, no button).
interface DescriptionFieldProps {
    readOnly?: boolean;
    // When provided, the parent owns the edit session (controlled). When
    // omitted, the component falls back to its own internal state so the
    // create-form usage (and its tests) keep behaving exactly as before.
    isEditing?: boolean;
    // Invoked when the user clicks the Edit button. Lets a controlled parent
    // snapshot the pre-edit value before flipping its edit state.
    onStartEdit?: () => void;
}

export function DescriptionField({ readOnly, isEditing, onStartEdit }: DescriptionFieldProps) {
    const [internalEditing, setInternalEditing] = useState(false);
    const controlled = isEditing !== undefined;
    const editing = controlled ? isEditing : internalEditing;

    const {
        watch,
        setValue,
        formState: { errors, isSubmitSuccessful },
    } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const descriptionValue = watch('description') ?? '';

    // Revert to read-only after a successful global Save. RHF flips
    // isSubmitSuccessful true on success and resets it to false at the start
    // of the next submit — a host-agnostic robust mechanism. Only the
    // uncontrolled (internal) mode reverts here: a controlled parent manages
    // its own edit state (the modal's Cancel path does its own revert).
    useEffect(() => {
        if (!controlled && isSubmitSuccessful) {
            setInternalEditing(false);
        }
    }, [controlled, isSubmitSuccessful]);

    // Show the editor only when actively editing an editable ticket. `readOnly`
    // always wins (no editor, no Edit button).
    const showEditor = editing && !readOnly;
    // Render the Edit button only for editable tickets that are not currently
    // editing (exit only via the global Save).
    const showEditButton = !readOnly && !editing;

    // labelWrap={!showEditor}: never wrap the CKEditor in a <label>. Per the HTML
    // spec, a <label> with no `for` forwards a native click to its first labelable
    // descendant — the editor's first toolbar button (Bold) — so every click in the
    // content would toggle Bold. The read-only view (a non-labelable <div>) is
    // unaffected and keeps its historical wrapping structure.
    return (
        <Field
            label="Description"
            error={errors.description?.message}
            icon={<AlignLeft size={14} />}
            labelWrap={!showEditor}
            action={
                showEditButton ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            onStartEdit?.();
                            if (!controlled) setInternalEditing(true);
                        }}
                        aria-label="Edit description"
                    >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        <span className="ml-1">Edit</span>
                    </Button>
                ) : null
            }
        >
            {showEditor ? (
                <>
                    <RichTextEditor
                        value={descriptionValue}
                        onChange={(html) => setValue('description', html)}
                    />
                    <p
                        className={`mt-1 text-right text-xs ${
                            descriptionValue.length > TICKET_DESCRIPTION_MAX_LENGTH
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                        }`}
                    >
                        {descriptionValue.length} / {TICKET_DESCRIPTION_MAX_LENGTH}
                    </p>
                </>
            ) : (
                // F17: read-only view of the (sanitized) description.
                <div
                    className="rich-text max-w-none rounded border border-border bg-muted p-2 text-sm"
                    dangerouslySetInnerHTML={{
                        __html: sanitizeDescription(descriptionValue),
                    }}
                />
            )}
        </Field>
    );
}
