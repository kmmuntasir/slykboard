import { FormProvider } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';

import { Button } from './ui/Button';
import { TitleField } from './ticket-fields/TitleField';
import { DescriptionField } from './ticket-fields/DescriptionField';
import { PriorityField } from './ticket-fields/PriorityField';
import { AssigneeField } from './ticket-fields/AssigneeField';
import { LabelsField } from './ticket-fields/LabelsField';
import { ChecklistField } from './ticket-fields/ChecklistField';
import { StatusField } from './ticket-fields/StatusField';
import { StartEndDateFields } from './ticket-fields/StartEndDateFields';
import { TypeField } from './ticket-fields/TypeField';
import { ParentField } from './ticket-fields/ParentField';
import { useTicketForm, type TicketFormValues } from '@/hooks/useTicketForm';
import type { UpdateTicketDto } from '@/types/ticket';

// DEL-01 T6: the form now composes the extracted useTicketForm instance + the
// ticket-fields components inside one <FormProvider>. The 2-col grid + footer
// markup is preserved verbatim (F44 two-column layout + non-sticky footer).
// Status + Due date fields added to the right column (DTO supports them now).
//
// The defaultValues prop widens statusColumn/dueDate to optional so existing
// callers (CreateTicketModal, TicketDetailModal) keep their unchanged props
// contract — they're merged with sane defaults here.
export type TicketAttributeFormDefaultValues = Partial<Pick<TicketFormValues, 'statusColumn'>> &
    Omit<TicketFormValues, 'statusColumn'>;

interface TicketAttributeFormProps {
    mode: 'create' | 'edit';
    projectSlug: string;
    defaultValues: TicketAttributeFormDefaultValues;
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
    const methods = useTicketForm({
        defaultValues: {
            statusColumn: '',
            ...defaultValues,
        },
        onSubmit: (values) => onSubmit(values as UpdateTicketDto),
        onDirtyChange,
        // CR-10: the CREATE flow is strict (description + explicit priority);
        // the EDIT flow (modal) seeds stored values and stays lenient.
        requireDescription: mode === 'create',
        requirePriority: mode === 'create',
    });

    const { handleSubmit, formState } = methods;
    const submitLabel = mode === 'create' ? 'Create ticket' : 'Save changes';

    return (
        <FormProvider {...methods}>
            {/* useTicketForm owns the RHF setup; the host binds onSubmit through
                handleSubmit so the zodResolver validation gate runs first. */}
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
                        <TitleField readOnly={readOnly} />
                        <DescriptionField readOnly={readOnly} />
                    </div>

                    {/* RIGHT 1/3 — Status / Type / Parent / Priority / Assignee /
                        Due date / Labels / Checklist. Scrolls independently. */}
                    <div className="space-y-4 lg:col-span-1 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
                        <StatusField projectSlug={projectSlug} />
                        <TypeField readOnly={readOnly} />
                        <ParentField projectSlug={projectSlug} readOnly={readOnly} />
                        <PriorityField />
                        <AssigneeField projectSlug={projectSlug} />
                        <StartEndDateFields readOnly={readOnly} />
                        <LabelsField projectSlug={projectSlug} />
                        <ChecklistField />
                    </div>
                </fieldset>

                {/* F44: footer, right-aligned, single Button size. Lives
                    outside <fieldset disabled> so Cancel/Close remain clickable. */}
                <div className="mt-6 flex justify-end gap-2 border-t border-border bg-background pt-6">
                    {!readOnly && (
                        <Button
                            type="submit"
                            variant="primary"
                            size="md"
                            disabled={formState.isSubmitting}
                        >
                            {submitLabel}
                        </Button>
                    )}
                    <Button type="button" variant="outline" size="md" onClick={onCancel}>
                        {readOnly ? 'Close' : 'Cancel'}
                    </Button>
                </div>
            </form>
        </FormProvider>
    );
}
