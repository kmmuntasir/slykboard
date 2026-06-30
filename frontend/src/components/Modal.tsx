import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useModalA11y } from '../hooks/useModalA11y';
import { cn } from './ui/cn';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

// F43: size → panel width. 'md' default preserves the prior max-w-lg for all
// existing consumers (none pass size today → backward compatible).
const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[min(95vw,1400px)]',
};

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
    /** Panel width preset. Defaults to 'md' (max-w-lg, backward-compatible). */
    size?: ModalSize;
}

export function Modal({
    isOpen,
    onClose,
    onEsc,
    titleId,
    title,
    children,
    blockBackdropClose,
    size = 'md',
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
                className={cn(
                    'max-h-[90vh] w-full overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl outline-none',
                    MODAL_SIZE_CLASS[size],
                )}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 id={titleId} className="text-lg font-semibold">
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <X size={20} />
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body,
    );
}
