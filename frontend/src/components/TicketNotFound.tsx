import { Modal } from './Modal';

// F30 T4: not-found UX for ticket deep-links. When fetchTicketByRef rejects
// (malformed SLYK-NNN, prefix mismatch, nonexistent ref, or legacy UUID
// deep-link that no longer resolves), the backend returns HTTP 404 and the
// detail-route query flips to isError — we surface this single, consistent
// state. The Modal primitive renders the visible <h2> title (aria-labelled-by
// via titleId), so TicketNotFound renders exactly ONE heading.
interface TicketNotFoundProps {
    onClose: () => void;
}

export function TicketNotFound({ onClose }: TicketNotFoundProps) {
    return (
        <Modal isOpen onClose={onClose} titleId="ticket-not-found-title" title="Ticket not found">
            <div className="flex flex-col items-center gap-4 p-8 text-center">
                <p className="text-sm text-muted">
                    This ticket may have been deleted, or the link is invalid.
                </p>
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    Back to board
                </button>
            </div>
        </Modal>
    );
}
