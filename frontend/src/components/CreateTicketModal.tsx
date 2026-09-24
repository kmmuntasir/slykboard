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

    const handleSubmit = async (values: UpdateTicketDto) => {
        await createTicket.mutateAsync({
            title: values.title as string,
            // CR-10: description, priority and the window are required — the
            // mode-aware form schema blocks submit until they are set.
            description: values.description as string,
            priority: values.priority!,
            assigneeId: values.assigneeId ?? undefined,
            labelIds: values.labelIds,
            statusColumn: columnId,
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
