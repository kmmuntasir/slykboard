import type { ReactNode } from 'react';

import { Modal } from './Modal';
import { Button } from './ui/Button';

// SLYK-02 T3: generic confirm-dialog primitive built on the shared Modal.
// Folds the hand-rolled shapes in DeleteTicketConfirm / ConfirmDiscardDialog
// into one parameterized component. Defaults match those two: 'Confirm'/'Cancel',
// variant 'default', blockBackdropClose true (the user must pick an action).
export interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    /** Caller-supplied, unique per dialog (used for aria-labelledby). */
    titleId: string;
    /** Body copy. Omit to use `children` for richer bodies. */
    message?: ReactNode;
    /** Alternative to `message` for rich bodies. */
    children?: ReactNode;
    /** Default 'Confirm'. */
    confirmLabel?: string;
    /** Default 'Cancel'. */
    cancelLabel?: string;
    /** destructive → Button variant="destructive"; otherwise "primary". */
    variant?: 'default' | 'destructive';
    /** Disables both buttons and appends '…' to the confirm label. */
    pending?: boolean;
    onConfirm: () => void;
    /** Also wired to Modal onClose + Esc. */
    onCancel: () => void;
    /** Passed through to Modal. Defaults to true (confirms require a choice). */
    blockBackdropClose?: boolean;
}

export function ConfirmDialog({
    isOpen,
    title,
    titleId,
    message,
    children,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    pending = false,
    onConfirm,
    onCancel,
    blockBackdropClose = true,
}: ConfirmDialogProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            onEsc={onCancel}
            titleId={titleId}
            title={title}
            blockBackdropClose={blockBackdropClose}
        >
            {message ? (
                <p className="mb-4 text-sm text-muted-foreground">{message}</p>
            ) : (
                children
            )}
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    disabled={pending}
                >
                    {cancelLabel}
                </Button>
                <Button
                    type="button"
                    variant={variant === 'destructive' ? 'destructive' : 'primary'}
                    size="sm"
                    onClick={onConfirm}
                    disabled={pending}
                >
                    {pending ? `${confirmLabel}…` : confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}
