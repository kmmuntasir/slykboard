import { Modal } from './Modal';
import { Button } from './ui/Button';

interface DeleteTicketConfirmProps {
    isOpen: boolean;
    isDeleting?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function DeleteTicketConfirm({
    isOpen,
    isDeleting = false,
    onConfirm,
    onCancel,
}: DeleteTicketConfirmProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            titleId="delete-ticket-dialog-title"
            title="Delete ticket?"
            blockBackdropClose
        >
            <p className="mb-4 text-sm text-muted-foreground">
                This removes the ticket from the board. Its activity history and label links are archived and the ticket number is not reused. This cannot be undone from the UI.
            </p>
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isDeleting}>
                    Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={isDeleting}>
                    {isDeleting ? 'Deleting…' : 'Delete'}
                </Button>
            </div>
        </Modal>
    );
}
