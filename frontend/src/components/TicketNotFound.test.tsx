import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketNotFound } from './TicketNotFound';

describe('TicketNotFound', () => {
    it('renders the not-found heading, message, and Back-to-board button', () => {
        const onClose = vi.fn();
        render(<TicketNotFound onClose={onClose} />);

        // Modal renders exactly one heading via its `title` prop.
        expect(
            screen.getByRole('heading', { name: /ticket not found/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/may have been deleted, or the link is invalid/i),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /back to board/i }),
        ).toBeInTheDocument();
    });

    it('calls onClose when the Back-to-board button is clicked', () => {
        const onClose = vi.fn();
        render(<TicketNotFound onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: /back to board/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
