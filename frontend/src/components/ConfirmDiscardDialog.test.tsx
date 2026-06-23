import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { ConfirmDiscardDialog } from './ConfirmDiscardDialog';

describe('ConfirmDiscardDialog', () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
        appRoot = document.createElement('main');
        appRoot.id = 'app-root';
        document.body.appendChild(appRoot);
    });

    afterEach(() => {
        appRoot.remove();
        cleanup();
    });

    it('renders nothing when closed', () => {
        render(<ConfirmDiscardDialog isOpen={false} onDiscard={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders the title "Discard changes?" when open', () => {
        render(<ConfirmDiscardDialog isOpen onDiscard={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    });

    it('Cancel button calls onCancel', () => {
        const onCancel = vi.fn();
        const onDiscard = vi.fn();
        render(<ConfirmDiscardDialog isOpen onDiscard={onDiscard} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onDiscard).not.toHaveBeenCalled();
    });

    it('Discard button calls onDiscard', () => {
        const onCancel = vi.fn();
        const onDiscard = vi.fn();
        render(<ConfirmDiscardDialog isOpen onDiscard={onDiscard} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
        expect(onDiscard).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('backdrop is blocked: clicking it calls neither handler', () => {
        const onCancel = vi.fn();
        const onDiscard = vi.fn();
        render(<ConfirmDiscardDialog isOpen onDiscard={onDiscard} onCancel={onCancel} />);
        const backdrop = screen.getByRole('dialog').parentElement!;
        fireEvent.mouseDown(backdrop);
        expect(onCancel).not.toHaveBeenCalled();
        expect(onDiscard).not.toHaveBeenCalled();
    });
});
