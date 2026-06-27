import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlignLeft, Flag, UserCircle, Tags, ListChecks } from 'lucide-react';

import { ChecklistEditor } from './ChecklistEditor';
import { LabelMultiSelect } from './LabelMultiSelect';
import { RichTextEditor } from './RichTextEditor';
import { PrioritySelect } from './PrioritySelect';
import { UserSelect } from './UserSelect';
import { Field } from './ui/Field';
import { Button } from './ui/Button';
import type { ChecklistItem, Priority, UpdateTicketDto } from '@/types/ticket';

// F44: schema + form state FROZEN (PRD §10). Only the JSX layout, the Field
// wrapping, and the footer buttons changed vs. the single-column form.
const schema = z.object({
    title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 chars or fewer'),
    description: z.string().max(5000, 'Description must be 5000 chars or fewer'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
    assigneeId: z.string().uuid().nullable(),
    labelIds: z.array(z.string().uuid()).default([]),
    checklist: z
        .array(
            z.object({
                id: z.string().uuid(),
                text: z.string().min(1).max(200),
                done: z.boolean(),
            }),
        )
        .max(50)
        .default([]),
});
type FormValues = z.infer<typeof schema>;

interface TicketAttributeFormProps {
    mode: 'create' | 'edit';
    projectSlug: string;
    defaultValues: FormValues;
    onSubmit: (values: UpdateTicketDto) => void | Promise<void>;
    onCancel: () => void;
    onDirtyChange?: (dirty: boolean) => void;
    readOnly?: boolean;
}

export function TicketAttributeForm({
    mode,
    projectSlug,
    defaultValues,
    onSubmit,
    onCancel,
    onDirtyChange,
    readOnly,
}: TicketAttributeFormProps) {
    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isSubmitting, isDirty },
    } = useForm<FormValues>({
        // zod@3.25 output widened; resolver lib expects narrower shape. Cast bridges gap.
        resolver: zodResolver(schema as never),
        defaultValues,
    });

    // F16: surface dirty state to the host so it can guard close/navigation.
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const submitLabel = mode === 'create' ? 'Create ticket' : 'Save changes';

    // Hoist the watched description out of JSX so watch() is called once per render.
    // react-hooks/incompatible-library flags RHF's watch() unconditionally — it is an
    // accepted RHF ↔ React Compiler limitation, suppressed at the single call site.
    // eslint-disable-next-line react-hooks/incompatible-library
    const descriptionValue = watch('description') ?? '';

    return (
        <form
            onSubmit={handleSubmit((values) => onSubmit(values as UpdateTicketDto))}
            className="space-y-6"
            noValidate
        >
            {/* F17: <fieldset disabled> wraps BOTH columns so readOnly disables
                every editable field at once. The footer lives outside it so
                Cancel/Close stay clickable while disabled. */}
            <fieldset
                disabled={readOnly}
                className="grid grid-cols-1 gap-6 border-0 p-0 m-0 lg:grid-cols-3"
            >
                {/* LEFT 2/3 — Title + Description (+ optional Activity). */}
                <div className="space-y-4 lg:col-span-2">
                    <Field label="Title" error={errors.title?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <AlignLeft size={14} />
                        </span>
                        <input
                            type="text"
                            aria-label="Title"
                            {...register('title')}
                            className="w-full rounded border border-border p-2"
                        />
                    </Field>

                    <Field label="Description" error={errors.description?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <AlignLeft size={14} />
                        </span>
                        {readOnly ? (
                            // F17: read-only view of the archived (sanitized) description.
                            <div
                                className="max-w-none rounded border border-border bg-muted p-2 text-sm"
                                dangerouslySetInnerHTML={{ __html: descriptionValue }}
                            />
                        ) : (
                            <RichTextEditor
                                value={descriptionValue}
                                onChange={(html) => setValue('description', html)}
                            />
                        )}
                    </Field>
                </div>

                {/* RIGHT 1/3 — Priority / Assignee / Labels / Checklist.
                    Scrolls independently for long checklists (PRD edge case). */}
                <div className="space-y-4 lg:col-span-1 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
                    <Field label="Priority" error={errors.priority?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <Flag size={14} />
                        </span>
                        <PrioritySelect
                            hideLabel
                            value={watch('priority')}
                            onChange={(p: Priority) => setValue('priority', p)}
                        />
                    </Field>

                    <Field label="Assignee" error={errors.assigneeId?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <UserCircle size={14} />
                        </span>
                        <UserSelect
                            hideLabel
                            value={watch('assigneeId') ?? null}
                            onChange={(id) => setValue('assigneeId', id)}
                        />
                    </Field>

                    <Field label="Labels">
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <Tags size={14} />
                        </span>
                        <LabelMultiSelect
                            projectSlug={projectSlug}
                            value={watch('labelIds')}
                            onChange={(ids: string[]) => setValue('labelIds', ids)}
                        />
                    </Field>

                    <Field label="Checklist">
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <ListChecks size={14} />
                        </span>
                        <ChecklistEditor
                            hideLabel
                            dense // D2: compact rows for the narrow right-column sidebar
                            value={watch('checklist')}
                            onChange={(items: ChecklistItem[]) => setValue('checklist', items)}
                        />
                    </Field>
                </div>
            </fieldset>

            {/* F44: sticky footer, right-aligned, single Button size. Lives
                outside <fieldset disabled> so Cancel/Close remain clickable. */}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-3">
                {!readOnly && (
                    <Button type="submit" variant="primary" size="md" disabled={isSubmitting}>
                        {submitLabel}
                    </Button>
                )}
                <Button type="button" variant="outline" size="md" onClick={onCancel}>
                    {readOnly ? 'Close' : 'Cancel'}
                </Button>
            </div>
        </form>
    );
}
