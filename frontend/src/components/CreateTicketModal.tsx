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
            description: values.description ?? undefined,
            priority: values.priority,
            assigneeId: values.assigneeId ?? undefined,
            labelIds: values.labelIds,
            statusColumn: columnId,
            checklist: values.checklist,
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
                    priority: 'MEDIUM',
                    assigneeId: null,
                    labelIds: [],
                    // F15: checklist is edit-only at runtime; present for the shared schema.
                    checklist: [],
                }}
                onSubmit={handleSubmit}
                onCancel={onClose}
            />
        </Modal>
    );
}
