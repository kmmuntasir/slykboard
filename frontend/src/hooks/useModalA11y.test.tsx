import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { useModalA11y } from './useModalA11y';

// Host component that wires the hook's dialogRef to a container holding two
// tabbable buttons — exercises focus-trap, initial-focus, and restore paths.
interface HostProps {
    isOpen: boolean;
    onClose: () => void;
    onEsc?: () => void;
}

function ModalHost({ isOpen, onClose, onEsc }: HostProps) {
    const { dialogRef } = useModalA11y({ isOpen, onClose, onEsc });
    return (
        <div ref={dialogRef} tabIndex={-1}>
            <button type="button">A</button>
            <button type="button">B</button>
        </div>
    );
}

// A separate host whose dialog has NO tabbable children — exercises the
// container fallback for initial focus.
function EmptyHost({ isOpen, onClose }: HostProps) {
    const { dialogRef } = useModalA11y({ isOpen, onClose });
    return <div ref={dialogRef} tabIndex={-1} />;
}

function dispatchKey(key: string, shiftKey = false) {
    fireEvent.keyDown(document, { key, shiftKey });
}

describe('useModalA11y', () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
        // Mirror the app shell: routed content lives in <main id="app-root">.
        appRoot = document.createElement('main');
        appRoot.id = 'app-root';
        document.body.appendChild(appRoot);
        document.body.style.overflow = '';
    });

    afterEach(() => {
        appRoot.remove();
        cleanup();
    });

    it('moves focus into the dialog (first tabbable) on open', () => {
        const { getByText } = render(<ModalHost isOpen onClose={vi.fn()} />);
        expect(document.activeElement).toBe(getByText('A'));
    });

    it('falls back to focusing the dialog container when no tabbable exists', () => {
        render(<EmptyHost isOpen onClose={vi.fn()} />);
        const dialog = document.querySelector('div[tabindex="-1"]');
        expect(dialog).not.toBeNull();
        expect(document.activeElement).toBe(dialog);
    });

    it('calls onClose on Escape', () => {
        const onClose = vi.fn();
        render(<ModalHost isOpen onClose={onClose} />);
        dispatchKey('Escape');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('prefers onEsc over onClose when provided', () => {
        const onClose = vi.fn();
        const onEsc = vi.fn();
        render(<ModalHost isOpen onClose={onClose} onEsc={onEsc} />);
        dispatchKey('Escape');
        expect(onEsc).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('wraps Tab from the last tabbable to the first', () => {
        const { getByText } = render(<ModalHost isOpen onClose={vi.fn()} />);
        // Move focus to the last tabbable (B), then Tab should wrap to A.
        getByText('B').focus();
        expect(document.activeElement).toBe(getByText('B'));
        dispatchKey('Tab');
        expect(document.activeElement).toBe(getByText('A'));
    });

    it('wraps Shift+Tab from the first tabbable to the last', () => {
        const { getByText } = render(<ModalHost isOpen onClose={vi.fn()} />);
        // Focus starts on A (first tabbable); Shift+Tab wraps to B.
        expect(document.activeElement).toBe(getByText('A'));
        dispatchKey('Tab', true);
        expect(document.activeElement).toBe(getByText('B'));
    });

    it('locks body scroll while open and restores the prior value on close', () => {
        document.body.style.overflow = 'auto';
        const { rerender } = render(<ModalHost isOpen onClose={vi.fn()} />);
        expect(document.body.style.overflow).toBe('hidden');

        rerender(<ModalHost isOpen={false} onClose={vi.fn()} />);
        expect(document.body.style.overflow).toBe('auto');
    });

    it('sets inert on #app-root while open and clears it on close', () => {
        const { rerender } = render(<ModalHost isOpen onClose={vi.fn()} />);
        // jsdom supports the `inert` IDL property (set by the hook) but does not
        // always reflect it to an attribute, so assert the property directly.
        expect(appRoot.inert).toBe(true);

        rerender(<ModalHost isOpen={false} onClose={vi.fn()} />);
        expect(appRoot.inert).toBe(false);
    });

    it('restores focus to the trigger element on close', () => {
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.textContent = 'open';
        document.body.appendChild(trigger);
        trigger.focus();
        expect(document.activeElement).toBe(trigger);

        const { rerender } = render(<ModalHost isOpen onClose={vi.fn()} />);
        // Focus moved into the dialog on open.
        expect(document.activeElement).not.toBe(trigger);

        rerender(<ModalHost isOpen={false} onClose={vi.fn()} />);
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('does not capture the trigger from #app-root itself being inert', () => {
        // Sanity: the trigger is captured before inert is applied, so a button
        // living outside #app-root is restored regardless.
        const outside = document.createElement('button');
        outside.type = 'button';
        document.body.appendChild(outside);
        outside.focus();

        const { unmount } = render(<ModalHost isOpen onClose={vi.fn()} />);
        unmount();
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });
});
