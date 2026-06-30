import { useFormContext } from 'react-hook-form';
import { Flag } from 'lucide-react';

import { PrioritySelect } from '@/components/PrioritySelect';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';
import type { Priority } from '@/types/ticket';

// DEL-01 T6: priority field bound via useFormContext. Replicates the exact
// <PrioritySelect hideLabel value={watch('priority')} onChange=...> binding that
// lived inline in TicketAttributeForm (hideLabel = the surrounding <Field>
// supplies the label/icon).
export function PriorityField() {
    const {
        watch,
        setValue,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const priority = watch('priority');

    return (
        <Field label="Priority" error={errors.priority?.message} icon={<Flag size={14} />}>
            <PrioritySelect
                hideLabel
                value={priority}
                onChange={(p: Priority) => setValue('priority', p)}
            />
        </Field>
    );
}
