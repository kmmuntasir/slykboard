import { useFormContext } from 'react-hook-form';
import { AlignLeft } from 'lucide-react';

import { RichTextEditor } from '@/components/RichTextEditor';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: description field bound via useFormContext. Replicates the exact
// readOnly vs editable binding that lived inline in TicketAttributeForm:
//   readOnly  -> sanitized HTML via dangerouslySetInnerHTML
//   editable  -> <RichTextEditor value=... onChange=(html)=>setValue('description', html)>
// watch('description') is hoisted out of JSX so it runs once per render.
interface DescriptionFieldProps {
    readOnly?: boolean;
}

export function DescriptionField({ readOnly }: DescriptionFieldProps) {
    const {
        watch,
        setValue,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const descriptionValue = watch('description') ?? '';

    return (
        <Field
            label="Description"
            error={errors.description?.message}
            icon={<AlignLeft size={14} />}
        >
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
    );
}
