import { useFormContext } from 'react-hook-form';

import { ChecklistEditor } from '@/components/ChecklistEditor';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: checklist field bound via useFormContext. The ChecklistEditor owns
// its single-line label row ("Checklist <done>/<total>" + progress bar), so we
// do NOT wrap it in an outer <Field> and do NOT pass hideLabel — that would
// orphan the count (DEL-01 change 6). The dense variant is kept so repeating
// rows stay compact in the narrow sidebar.
//
// Replicates the exact value={watch('checklist')} onChange=(items)=>setValue
// ('checklist', items) binding that lived inline in TicketAttributeForm.
export function ChecklistField() {
    const { watch, setValue } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const checklist = watch('checklist') ?? [];

    return (
        <ChecklistEditor
            dense
            value={checklist}
            onChange={(items) => setValue('checklist', items)}
        />
    );
}
