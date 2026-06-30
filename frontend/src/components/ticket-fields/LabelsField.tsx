import { useFormContext } from 'react-hook-form';
import { Tags } from 'lucide-react';

import { LabelMultiSelect } from '@/components/LabelMultiSelect';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: labels field bound via useFormContext. Replicates the exact
// <LabelMultiSelect projectSlug value={watch('labelIds')} onChange=...> binding
// that lived inline in TicketAttributeForm.
interface LabelsFieldProps {
    projectSlug: string;
}

export function LabelsField({ projectSlug }: LabelsFieldProps) {
    const {
        watch,
        setValue,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const labelIds = watch('labelIds') ?? [];

    return (
        <Field label="Labels" icon={<Tags size={14} />} error={errors.labelIds?.message}>
            <LabelMultiSelect
                projectSlug={projectSlug}
                value={labelIds}
                onChange={(ids: string[]) => setValue('labelIds', ids)}
            />
        </Field>
    );
}
