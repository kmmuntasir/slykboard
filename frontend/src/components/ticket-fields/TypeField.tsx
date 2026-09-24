import { useFormContext } from 'react-hook-form';
import { Layers } from 'lucide-react';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';
import { TICKET_TYPE_DISPLAY, type TicketType } from '@/types/ticket';

// CR-03: hierarchy type selector bound via useFormContext (PriorityField
// pattern). TASK is the unremarkable default; EPIC/STORY/SUBTASK change where
// the ticket may sit in the tree. Changing the type can invalidate the selected
// parent — ParentField derives its options from the same watched value, and a
// stale pairing is cleared here + blocked by the schema's superRefine.
const TYPE_OPTIONS: TicketType[] = ['EPIC', 'STORY', 'TASK', 'SUBTASK'];

export function TypeField({ readOnly }: { readOnly?: boolean }) {
    const {
        watch,
        setValue,
        getValues,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    const type = watch('type');

    const handleChange = (next: TicketType) => {
        setValue('type', next, { shouldDirty: true });
        // Drop a parent that no longer outranks the new type (schema still
        // backstops the SUBTASK-needs-parent rule on submit).
        const currentParent = getValues('parentId');
        if (currentParent && next !== 'SUBTASK') {
            setValue('parentId', null, { shouldDirty: true });
        }
    };

    return (
        <Field label="Type" error={errors.type?.message} icon={<Layers size={14} />}>
            <Select value={type} onValueChange={(v) => handleChange(v as TicketType)}>
                <SelectTrigger className="w-full" aria-label="Ticket type" disabled={readOnly}>
                    <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                    {TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option} textValue={option}>
                            {TICKET_TYPE_DISPLAY[option]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    );
}
