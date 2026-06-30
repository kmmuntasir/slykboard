import { useFormContext } from 'react-hook-form';
import { UserCircle } from 'lucide-react';

import { UserSelect } from '@/components/UserSelect';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: assignee field bound via useFormContext. Replicates the exact
// <UserSelect hideLabel value={watch('assigneeId') ?? null} onChange=...> binding
// that lived inline in TicketAttributeForm. projectSlug is threaded so UserSelect
// sources the project roster (not the workspace-wide /users).
interface AssigneeFieldProps {
    projectSlug: string;
}

export function AssigneeField({ projectSlug }: AssigneeFieldProps) {
    const {
        watch,
        setValue,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const assigneeId = watch('assigneeId');

    return (
        <Field label="Assignee" error={errors.assigneeId?.message} icon={<UserCircle size={14} />}>
            <UserSelect
                hideLabel
                projectSlug={projectSlug}
                value={assigneeId ?? null}
                onChange={(id) => setValue('assigneeId', id)}
            />
        </Field>
    );
}
