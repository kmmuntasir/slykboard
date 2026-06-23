import { TicketAttributeForm } from './TicketAttributeForm';
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

    if (!open) return null;

    const handleSubmit = async (values: UpdateTicketDto) => {
        await createTicket.mutateAsync({
            title: values.title as string,
            description: values.description ?? undefined,
            priority: values.priority,
            assigneeId: values.assigneeId ?? undefined,
            labelIds: values.labelIds,
            statusColumn: columnId,
        });
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            role="dialog"
            aria-modal="true"
            aria-label="Create ticket"
        >
            <div className="w-full max-w-lg rounded bg-white p-6">
                <h2 className="mb-4 text-lg font-semibold">Create ticket</h2>
                <TicketAttributeForm
                    mode="create"
                    projectSlug={slug}
                    defaultValues={{
                        title: '',
                        description: '',
                        priority: 'MEDIUM',
                        assigneeId: null,
                        labelIds: [],
                    }}
                    onSubmit={handleSubmit}
                    onCancel={onClose}
                />
            </div>
        </div>
    );
}
