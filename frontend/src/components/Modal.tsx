import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useModalA11y } from '../hooks/useModalA11y';

// F16 D1: reusable accessible dialog shell (0 deps). Renders into a portal at
// document.body, wires the useModalA11y hook (focus trap, Esc, scroll lock,
// focus restore), and exposes backdrop-click + a labelled close button.
// `blockBackdropClose` disables backdrop-click close (e.g. for a dirty form).
interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Intercept Esc (e.g. dirty-confirm). Falls back to onClose. */
    onEsc?: () => void;
    titleId: string;
    title: string;
    children: ReactNode;
    /** When true, a backdrop click does NOT close (e.g. dirty form). */
    blockBackdropClose?: boolean;
}

export function Modal({
    isOpen,
    onClose,
    onEsc,
    titleId,
    title,
    children,
    blockBackdropClose,
}: ModalProps) {
    const { dialogRef } = useModalA11y({ isOpen, onClose, onEsc });
    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onMouseDown={(e) => {
                // Only close when the backdrop itself (not a child) is clicked.
                if (e.target === e.currentTarget && !blockBackdropClose) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl outline-none"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 id={titleId} className="text-lg font-semibold">
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="text-2xl leading-none text-gray-500 hover:text-gray-700"
                    >
                        ×
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body,
    );
}
