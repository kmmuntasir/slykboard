import { Modal } from './Modal';

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
            <p className="mb-4 text-sm text-gray-600">
                This removes the ticket from the board. Its activity history and label links are archived and the ticket number is not reused. This cannot be undone from the UI.
            </p>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isDeleting}
                    className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isDeleting}
                    className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
            </div>
        </Modal>
    );
}
