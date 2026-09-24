import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DeleteTicketConfirm } from './DeleteTicketConfirm';
import { makeTicket } from '@/test/makeTicket';

describe('DeleteTicketConfirm', () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
        // Modal's useModalA11y inert-mutes #app-root if present.
        appRoot = document.createElement('main');
        appRoot.id = 'app-root';
        document.body.appendChild(appRoot);
    });

    afterEach(() => {
        appRoot.remove();
        cleanup();
    });

    it('renders the title "Delete ticket?" when open', () => {
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('dialog', { name: 'Delete ticket?' })).toBeInTheDocument();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen={false}
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('calls onCancel when the Cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm when the Delete button is clicked', () => {
        const onConfirm = vi.fn();
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen
                onConfirm={onConfirm}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('disables both buttons and shows "Deleting…" while isDeleting', () => {
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen
                isDeleting
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const cancel = screen.getByRole('button', { name: /Cancel/ });
        const del = screen.getByRole('button', { name: /Deleting/ });
        expect(cancel).toBeDisabled();
        expect(del).toBeDisabled();
        expect(del.textContent).toBe('Deleting…');
    });

    // ---- CR-03: cascade delete confirmation --------------------------------

    it('CR-03: a leaf ticket keeps the simple confirmation', () => {
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('dialog', { name: 'Delete ticket?' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('CR-03: a parent lists its descendant tree and requires a SECOND confirmation', () => {
        const onConfirm = vi.fn();
        const descendants = [
            {
                ticket: makeTicket({
                    id: 's1',
                    ticketNumber: 2,
                    title: 'Child story ticket',
                    type: 'STORY',
                }),
                children: [
                    {
                        ticket: makeTicket({
                            id: 'b1',
                            ticketNumber: 3,
                            title: 'Nested subtask',
                            type: 'SUBTASK',
                        }),
                        children: [],
                    },
                ],
            },
        ];
        render(
            <DeleteTicketConfirm
                projectSlug="SLYK"
                isOpen
                descendants={descendants}
                onConfirm={onConfirm}
                onCancel={vi.fn()}
            />,
        );

        // Tree is shown with ids + titles; first-step button only ARMS the confirm.
        expect(screen.getByRole('dialog', { name: 'Delete ticket + 2 more?' })).toBeInTheDocument();
        expect(screen.getByText('Child story ticket')).toBeInTheDocument();
        expect(screen.getByText('Nested subtask')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Delete 3 tickets/ }));
        expect(onConfirm).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Yes, delete all 3 tickets/ }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
