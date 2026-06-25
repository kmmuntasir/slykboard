import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Retry } from './Retry';

describe('Retry', () => {
    it('renders default message, role=alert, and a Retry button', () => {
        render(<Retry onRetry={vi.fn()} />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    it('renders a custom message when provided', () => {
        render(<Retry message="Failed to load board" onRetry={vi.fn()} />);

        expect(screen.getByText('Failed to load board')).toBeInTheDocument();
    });

    it('fires onRetry when the Retry button is clicked', () => {
        const onRetry = vi.fn();
        render(<Retry onRetry={onRetry} />);

        fireEvent.click(screen.getByRole('button', { name: /retry/i }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});
