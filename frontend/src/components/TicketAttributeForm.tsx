import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { RichTextEditor } from './RichTextEditor';
import { PrioritySelect } from './PrioritySelect';
import { UserSelect } from './UserSelect';
import type { Priority, UpdateTicketDto } from '@/types/ticket';

const schema = z.object({
    title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 chars or fewer'),
    description: z.string().max(5000, 'Description must be 5000 chars or fewer'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
    assigneeId: z.string().uuid().nullable(),
});
type FormValues = z.infer<typeof schema>;

interface TicketAttributeFormProps {
    mode: 'create' | 'edit';
    defaultValues: FormValues;
    onSubmit: (values: UpdateTicketDto) => void | Promise<void>;
    onCancel: () => void;
}

export function TicketAttributeForm({
    mode,
    defaultValues,
    onSubmit,
    onCancel,
}: TicketAttributeFormProps) {
    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({
        // zod@3.25 output widened; resolver lib expects narrower shape. Cast bridges gap.
        resolver: zodResolver(schema as never),
        defaultValues,
    });

    const submitLabel = mode === 'create' ? 'Create ticket' : 'Save changes';

    return (
        <form
            onSubmit={handleSubmit((values) => onSubmit(values as UpdateTicketDto))}
            className="space-y-4"
            noValidate
        >
            <div>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">Title</span>
                    <input
                        type="text"
                        aria-label="Title"
                        {...register('title')}
                        className="w-full rounded border border-gray-300 p-2"
                    />
                </label>
                {errors.title?.message && (
                    <p role="alert" className="mt-1 text-sm text-red-600">
                        {errors.title.message}
                    </p>
                )}
            </div>

            <div>
                <span className="mb-1 block text-sm font-medium">Description</span>
                <RichTextEditor
                    value={watch('description') ?? ''}
                    onChange={(html) => setValue('description', html)}
                />
                {errors.description?.message && (
                    <p role="alert" className="mt-1 text-sm text-red-600">
                        {errors.description.message}
                    </p>
                )}
            </div>

            <div>
                <PrioritySelect
                    value={watch('priority')}
                    onChange={(p: Priority) => setValue('priority', p)}
                />
                {errors.priority?.message && (
                    <p role="alert" className="mt-1 text-sm text-red-600">
                        {errors.priority.message}
                    </p>
                )}
            </div>

            <div>
                <UserSelect
                    value={watch('assigneeId') ?? null}
                    onChange={(id) => setValue('assigneeId', id)}
                />
                {errors.assigneeId?.message && (
                    <p role="alert" className="mt-1 text-sm text-red-600">
                        {errors.assigneeId.message}
                    </p>
                )}
            </div>

            <div className="flex gap-2">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    {submitLabel}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded border bg-background px-4 py-2 text-sm hover:bg-secondary"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
