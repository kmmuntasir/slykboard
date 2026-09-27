import { TicketAttributeForm } from './TicketAttributeForm';
import { Modal } from './Modal';
import { useCreateTicket } from '@/hooks/useCreateTicket';
import type { UpdateTicketDto } from '@/types/ticket';

interface CreateTicketModalProps {
    open: boolean;
    onClose: () => void;
    slug: string;
    columnId?: string;
}

export function CreateTicketModal({ open, onClose, slug, columnId }: CreateTicketModalProps) {
    const createTicket = useCreateTicket(slug);
    // CR-10: status is REQUIRED (no server default). The host passes the
    // column context (the board seeds its first real column), and the form's
    // StatusField still lets the member change it before submitting.
    const resolvedColumnId = columnId ?? '';

    const handleSubmit = async (values: UpdateTicketDto & { statusColumn?: string }) => {
        await createTicket.mutateAsync({
            title: values.title as string,
            // CR-10: description, priority and the window are required — the
            // mode-aware form schema blocks submit until they are set.
            description: values.description as string,
            priority: values.priority!,
            assigneeId: values.assigneeId ?? undefined,
            labelIds: values.labelIds,
            // The form's StatusField wins; the prop/first column is the fallback.
            statusColumn: values.statusColumn || resolvedColumnId,
            checklist: values.checklist,
            type: values.type,
            parentId: values.parentId,
            startDate: values.startDate!,
            endDate: values.endDate!,
        });
        onClose();
    };

    // F16: ported onto the shared <Modal> primitive (Esc, focus trap, scroll lock).
    return (
        <Modal
            isOpen={open}
            onClose={onClose}
            titleId="create-ticket-title"
            title="Create ticket"
            size="xl"
        >
            <TicketAttributeForm
                mode="create"
                projectSlug={slug}
                defaultValues={{
                    statusColumn: resolvedColumnId,
                    title: '',
                    description: '',
                    // CR-10: no priority default — the user picks explicitly.
                    priority: null,
                    assigneeId: null,
                    labelIds: [],
                    // F15: checklist is edit-only at runtime; present for the shared schema.
                    checklist: [],
                    // CR-03: hierarchy defaults — a plain root TASK.
                    type: 'TASK',
                    parentId: null,
                    // CR-10: Start defaults to "right now"; End must be picked.
                    startDate: new Date().toISOString(),
                    endDate: null,
                }}
                onSubmit={handleSubmit}
                onCancel={onClose}
            />
        </Modal>
    );
}
