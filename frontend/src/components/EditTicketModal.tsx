import { useQuery } from '@tanstack/react-query';
import { TicketAttributeForm } from './TicketAttributeForm';
import { fetchTicket } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { useUpdateTicket } from '@/hooks/useUpdateTicket';
import type { UpdateTicketDto } from '@/types/ticket';

interface EditTicketModalProps {
    open: boolean;
    onClose: () => void;
    ticketId: string | null;
    slug: string;
}

export function EditTicketModal({ open, onClose, ticketId, slug }: EditTicketModalProps) {
    const updateTicket = useUpdateTicket();
    const { data: ticket, isLoading } = useQuery({
        queryKey: ticketId ? ticketKeys.detail(ticketId) : ['tickets', 'detail', 'none'],
        queryFn: () => fetchTicket(ticketId as string),
        enabled: open && ticketId !== null,
    });

    if (!open || !ticketId) return null;

    const handleSubmit = async (values: UpdateTicketDto) => {
        await updateTicket.mutateAsync({ ticketId, dto: values, slug });
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            role="dialog"
            aria-modal="true"
            aria-label="Edit ticket"
        >
            <div className="w-full max-w-lg rounded bg-white p-6">
                <h2 className="mb-4 text-lg font-semibold">Edit ticket</h2>
                {isLoading || !ticket ? (
                    <p>Loading…</p>
                ) : (
                    <TicketAttributeForm
                        mode="edit"
                        defaultValues={{
                            title: ticket.title,
                            description: ticket.description ?? '',
                            priority: ticket.priority,
                            assigneeId: ticket.assignee?.id ?? null,
                        }}
                        onSubmit={handleSubmit}
                        onCancel={onClose}
                    />
                )}
            </div>
        </div>
    );
}
