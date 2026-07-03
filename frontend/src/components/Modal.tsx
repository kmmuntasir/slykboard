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
//
// DEL-01: optional `footer` prop. When provided, the panel becomes a flex
// column — a fixed header, a single scrollable body (the children), and a
// pinned footer slot — so the body scrolls while the footer stays visible
// (the ticket-detail modal's Save/Cancel/Delete stay reachable on long
// tickets). Backward compatible: when omitted/null the panel keeps its legacy
// single-scroll layout (`overflow-y-auto p-6`) byte-for-byte, so the seven
// other consumers are untouched. The size `max-w-*` class and the a11y
// `dialogRef` stay on the panel div in BOTH branches.
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
    /**
     * Optional pinned footer. When provided, the panel switches to a flex
     * column with a scrollable body and a pinned footer slot. Omitted (or null)
     * keeps the legacy single-scroll layout — fully backward compatible.
     */
    footer?: ReactNode;
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
    footer,
}: ModalProps) {
    const { dialogRef } = useModalA11y({ isOpen, onClose, onEsc });
    if (!isOpen) return null;

    // Footer mode = pinned footer slot. Omitted (or null) → legacy single-scroll.
    const hasFooter = footer !== undefined && footer !== null;

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
                    'max-h-[90vh] w-full rounded-lg border border-border bg-background text-foreground shadow-xl outline-none',
                    // DEL-01: footer mode restructures the panel into a flex
                    // column (no panel-level scroll); legacy mode scrolls the
                    // whole panel exactly as before.
                    hasFooter ? 'flex flex-col overflow-hidden' : 'overflow-y-auto p-6',
                    MODAL_SIZE_CLASS[size],
                )}
            >
                <div
                    className={cn(
                        'flex items-center justify-between',
                        hasFooter ? 'shrink-0 px-6 pt-6 pb-4' : 'mb-4',
                    )}
                >
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
                {hasFooter ? (
                    <>
                        {/* Single scroll region — the body scrolls while the
                            footer below stays pinned inside the panel. */}
                        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
                        <div className="shrink-0 border-t border-border bg-background px-6 py-4">
                            {footer}
                        </div>
                    </>
                ) : (
                    children
                )}
            </div>
        </div>,
        document.body,
    );
}
