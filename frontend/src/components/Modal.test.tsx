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
            <Modal isOpen onClose={onClose} titleId="t" title="T" blockBackdropClose>
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

    // Table-driven: F43 size prop → panel max-w-* class.
    describe('Modal size prop', () => {
        const sizeCases = [
            { size: 'sm', expected: 'max-w-md' },
            { size: 'md', expected: 'max-w-lg' },
            { size: 'lg', expected: 'max-w-2xl' },
            { size: 'xl', expected: 'max-w-4xl' },
        ] as const;

        sizeCases.forEach(({ size, expected }) => {
            it(`applies ${expected} for size='${size}'`, () => {
                render(
                    <Modal isOpen onClose={vi.fn()} titleId="t1" title="Size test" size={size}>
                        body
                    </Modal>,
                );
                const dialog = screen.getByRole('dialog');
                expect(dialog.className).toContain(expected);
            });
        });

        it('defaults to max-w-lg when size is omitted (backward compatible)', () => {
            render(
                <Modal isOpen onClose={vi.fn()} titleId="t1" title="Default size">
                    body
                </Modal>,
            );
            expect(screen.getByRole('dialog').className).toContain('max-w-lg');
        });
    });

    // F43: Esc still closes (useModalA11y untouched — regression guard).
    it('calls onClose when Escape is pressed', () => {
        const onClose = vi.fn();
        render(
            <Modal isOpen onClose={onClose} titleId="t1" title="Esc test">
                body
            </Modal>,
        );
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // F43: X icon replaced the × glyph; the button is still reachable via its
    // stable aria-label, now renders an SVG, and the × text is gone.
    it('renders the X icon inside the close button', () => {
        render(
            <Modal isOpen onClose={vi.fn()} titleId="t1" title="Icon test">
                body
            </Modal>,
        );
        const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
        expect(closeBtn.querySelector('svg')).toBeInTheDocument();
        expect(screen.queryByText('×')).toBeNull();
    });
});
