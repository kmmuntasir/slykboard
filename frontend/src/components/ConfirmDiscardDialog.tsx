import { Modal } from './Modal';

// F16 D6: confirm dialog shown when a user attempts to discard a dirty
// ticket-detail form — triggered by Esc, backdrop click, close button, or a
// blocked route navigation (back/forward). Backdrop is blocked so the user must
// pick an explicit action.
interface ConfirmDiscardDialogProps {
    isOpen: boolean;
    onDiscard: () => void;
    onCancel: () => void;
}

export function ConfirmDiscardDialog({ isOpen, onDiscard, onCancel }: ConfirmDiscardDialogProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            titleId="discard-dialog-title"
            title="Discard changes?"
            blockBackdropClose
        >
            <p className="mb-4 text-sm text-gray-600">
                You have unsaved changes. Discard them and close?
            </p>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onDiscard}
                    className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
                >
                    Discard
                </button>
            </div>
        </Modal>
    );
}
