import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
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
            <ConfirmDialog
                isOpen={false}
                title="T"
                titleId="t"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders title + message when isOpen', () => {
        render(
            <ConfirmDialog
                isOpen
                title="Delete ticket?"
                titleId="delete-title"
                message="This cannot be undone."
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Delete ticket?' })).toBeInTheDocument();
        expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    });

    it('renders children as the body when message is omitted', () => {
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            >
                <span data-testid="rich-body">rich</span>
            </ConfirmDialog>,
        );
        expect(screen.getByTestId('rich-body')).toBeInTheDocument();
    });

    // Table-driven: default vs overridden labels.
    describe('labels', () => {
        const labelCases = [
            {
                name: 'defaults to Confirm / Cancel',
                props: {} as const,
                expectedConfirm: 'Confirm',
                expectedCancel: 'Cancel',
            },
            {
                name: 'honors custom confirmLabel / cancelLabel',
                props: { confirmLabel: 'Delete', cancelLabel: 'Keep' } as const,
                expectedConfirm: 'Delete',
                expectedCancel: 'Keep',
            },
        ];

        labelCases.forEach(({ name, props, expectedConfirm, expectedCancel }) => {
            it(name, () => {
                render(
                    <ConfirmDialog
                        isOpen
                        title="T"
                        titleId="t"
                        onConfirm={vi.fn()}
                        onCancel={vi.fn()}
                        {...props}
                    />,
                );
                expect(screen.getByRole('button', { name: expectedConfirm })).toBeInTheDocument();
                expect(screen.getByRole('button', { name: expectedCancel })).toBeInTheDocument();
            });
        });
    });

    it('clicking Confirm fires onConfirm and clicking Cancel fires onCancel', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('pending disables both buttons and appends … to the confirm label', () => {
        const onConfirm = vi.fn();
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                confirmLabel="Delete"
                pending
                onConfirm={onConfirm}
                onCancel={vi.fn()}
            />,
        );
        const confirm = screen.getByRole('button', { name: 'Delete…' });
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(confirm).toBeDisabled();
        expect(cancel).toBeDisabled();

        fireEvent.click(confirm);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("variant='destructive' renders a destructive confirm button", () => {
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                variant="destructive"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const confirm = screen.getByRole('button', { name: 'Confirm' });
        // VARIANT_CLASSES.destructive → bg-destructive token class.
        expect(confirm.className).toContain('bg-destructive');
        // Non-destructive cancel stays outline.
        expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('border');
    });

    it("variant='default' renders a primary confirm button", () => {
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Confirm' }).className).toContain('bg-primary');
    });

    it('Esc fires onCancel', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />,
        );
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('backdrop click does NOT call onCancel when blockBackdropClose (default true)', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />,
        );
        const backdrop = screen.getByRole('dialog').parentElement!;
        fireEvent.mouseDown(backdrop);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('backdrop click calls onCancel when blockBackdropClose is false', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen
                title="T"
                titleId="t"
                blockBackdropClose={false}
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />,
        );
        const backdrop = screen.getByRole('dialog').parentElement!;
        fireEvent.mouseDown(backdrop);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('titleId is set as aria-labelledby on the dialog', () => {
        render(
            <ConfirmDialog
                isOpen
                title="My Title"
                titleId="unique-title-id"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'unique-title-id');
    });
});
