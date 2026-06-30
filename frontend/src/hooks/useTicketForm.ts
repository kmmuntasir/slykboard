import { useEffect } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// DEL-01 T6: shared React Hook Form instance for the ticket attributes form.
// Owns the single RHF setup (zodResolver + schema + defaultValues + dirty-hoist)
// so both the create flow (TicketAttributeForm) and the edit flow
// (TicketDetailModal, next task) compose the SAME field components inside one
// <FormProvider>. Mirrors the setup that lived inline in TicketAttributeForm.
//
// Schema is FROZEN (PRD §10) for title/description/priority/assigneeId/labelIds/
// checklist, with statusColumn + dueDate added for DEL-01 (Status is expose-only
// on the existing tickets.statusColumn; dueDate is the net-new full-stack slice).

export const ticketFormSchema = z.object({
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
    // DEL-01: status bound to the project's columns (expose-only; routed via
    // moveTicket in the edit modal, persisted directly at create).
    statusColumn: z.string(),
    // DEL-01: nullable ISO datetime (backend z.string().datetime().nullable()).
    dueDate: z.string().datetime().nullable().optional(),
});

export type TicketFormValues = z.infer<typeof ticketFormSchema>;

export interface UseTicketFormArgs {
    defaultValues: TicketFormValues;
    /**
     * Submit handler. Hosts bind it via the returned `methods.handleSubmit(onSubmit)`
     * so the RHF validation gate (zodResolver) runs before values reach the host.
     * Kept in the signature so the host passes it once and threads it into
     * handleSubmit at the <form> site.
     */
    onSubmit: (values: TicketFormValues) => void | Promise<void>;
    /** F16: surface dirty state to the host so it can guard close/navigation. */
    onDirtyChange?: (dirty: boolean) => void;
}

export function useTicketForm({
    defaultValues,
    onDirtyChange,
}: UseTicketFormArgs): UseFormReturn<TicketFormValues> {
    const methods = useForm<TicketFormValues>({
        // zod@3.25 output widened; resolver lib expects narrower shape. Cast bridges gap.
        resolver: zodResolver(ticketFormSchema as never),
        defaultValues,
    });

    // F16: hoist dirty state so the host can guard close/navigation.
    const isDirty = methods.formState.isDirty;
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    return methods;
}
