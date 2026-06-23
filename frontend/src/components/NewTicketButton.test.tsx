import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewTicketButton } from './NewTicketButton';

describe('NewTicketButton', () => {
    it('renders the trigger button by default', () => {
        render(<NewTicketButton onCreate={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Ticket title')).not.toBeInTheDocument();
    });

    it('clicking the trigger opens the title input and Create button', () => {
        render(<NewTicketButton onCreate={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
        expect(screen.getByLabelText('Ticket title')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('submitting with an empty title is a no-op', () => {
        const onCreate = vi.fn();
        render(<NewTicketButton onCreate={onCreate} />);
        fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(onCreate).not.toHaveBeenCalled();
        // form still open
        expect(screen.getByLabelText('Ticket title')).toBeInTheDocument();
    });

    it('submitting a title calls onCreate with the trimmed title and resets', () => {
        const onCreate = vi.fn();
        render(<NewTicketButton onCreate={onCreate} />);
        fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
        const input = screen.getByLabelText('Ticket title');
        fireEvent.change(input, { target: { value: 'New feature' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create' }));
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(onCreate).toHaveBeenCalledWith({ title: 'New feature' });
        // form closed back to trigger
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Ticket title')).not.toBeInTheDocument();
    });

    it('Cancel closes the form without calling onCreate', () => {
        const onCreate = vi.fn();
        render(<NewTicketButton onCreate={onCreate} />);
        fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
        fireEvent.change(screen.getByLabelText('Ticket title'), { target: { value: 'ignored' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCreate).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Ticket title')).not.toBeInTheDocument();
    });
});
