import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { Modal } from './Modal';

describe('Modal', () => {
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

    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <Modal isOpen={false} onClose={vi.fn()} titleId="t" title="T">
                body
            </Modal>,
        );
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders via portal into document.body (not the render container)', () => {
        const { container } = render(
            <Modal isOpen onClose={vi.fn()} titleId="t" title="My Title">
                body
            </Modal>,
        );
        // The render container is empty (the dialog is portalled to body).
        expect(container).toBeEmptyDOMElement();
        // ...but the dialog is reachable via the whole document.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('dialog has aria-modal=true and aria-labelledby pointing at the title h2', () => {
        render(
            <Modal isOpen onClose={vi.fn()} titleId="title-id" title="Hello">
                body
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'title-id');

        const heading = screen.getByRole('heading', { name: 'Hello' });
        expect(heading).toHaveAttribute('id', 'title-id');

        // Accessible name (via aria-labelledby) equals the title text.
        expect(screen.getByRole('dialog', { name: 'Hello' })).toBeInTheDocument();
    });

    it('backdrop mouseDown closes when the backdrop itself is the target', () => {
        const onClose = vi.fn();
        render(
            <Modal isOpen onClose={onClose} titleId="t" title="T">
                body
            </Modal>,
        );
        const dialog = screen.getByRole('dialog');
        const backdrop = dialog.parentElement!;
        fireEvent.mouseDown(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('backdrop mouseDown does NOT close when a child (the dialog) is the target', () => {
        const onClose = vi.fn();
        render(
            <Modal isOpen onClose={onClose} titleId="t" title="T">
                body
            </Modal>,
        );
        fireEvent.mouseDown(screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('backdrop mouseDown does NOT close when blockBackdropClose is set', () => {
        const onClose = vi.fn();
        render(
            <Modal
                isOpen
                onClose={onClose}
                titleId="t"
                title="T"
                blockBackdropClose
            >
                body
            </Modal>,
        );
        const backdrop = screen.getByRole('dialog').parentElement!;
        fireEvent.mouseDown(backdrop);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('close button (aria-label "Close dialog") calls onClose', () => {
        const onClose = vi.fn();
        render(
            <Modal isOpen onClose={onClose} titleId="t" title="T">
                body
            </Modal>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
