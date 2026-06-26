import { Modal } from './Modal';
import { Button } from './ui/Button';

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
            <p className="mb-4 text-sm text-gray-600">{/* F46: raw gray-600 → token */}
                You have unsaved changes. Discard them and close?
            </p>
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={onDiscard}>
                    Discard
                </Button>
            </div>
        </Modal>
    );
}
