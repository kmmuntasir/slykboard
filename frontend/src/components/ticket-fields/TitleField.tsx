import { useFormContext } from 'react-hook-form';
import { AlignLeft } from 'lucide-react';

import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: title field bound via useFormContext so it works inside a
// <FormProvider>. Replicates the exact register('title') binding that lived
// inline in TicketAttributeForm. The aria-label is stable so tests
// (getByLabelText('Title')) keep resolving regardless of Field-wrapping.
interface TitleFieldProps {
    readOnly?: boolean;
    className?: string;
}

export function TitleField({ readOnly, className }: TitleFieldProps) {
    const {
        register,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    return (
        <Field
            label="Title"
            error={errors.title?.message}
            icon={<AlignLeft size={14} />}
            className={className}
        >
            <input
                type="text"
                aria-label="Title"
                {...register('title')}
                className="w-full rounded border border-border p-2"
                readOnly={readOnly}
            />
        </Field>
    );
}
