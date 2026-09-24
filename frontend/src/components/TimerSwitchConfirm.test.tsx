import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TimerSwitchConfirm } from './TimerSwitchConfirm';

// CR-09: the switch confirmation names the currently-tracked ticket and
// requires an explicit choice before the server auto-stops it.

const PENDING = { ticketId: 'other', title: 'Nightly export', displayId: 'SLYK-7' };

describe('TimerSwitchConfirm (CR-09)', () => {
    it('renders nothing when no switch is pending', () => {
        render(<TimerSwitchConfirm pending={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        // Closed state — ConfirmDialog renders nothing.
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByText('Stop the current timer?')).not.toBeInTheDocument();
    });

    it('names the running ticket and calls onConfirm on confirm', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(<TimerSwitchConfirm pending={PENDING} onConfirm={onConfirm} onCancel={onCancel} />);
        expect(screen.getByRole('dialog', { name: 'Stop the current timer?' })).toBeInTheDocument();
        expect(screen.getByText('SLYK-7')).toBeInTheDocument();
        expect(screen.getByText('Nightly export')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Stop it and start' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel and leaves the timer alone on cancel', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(<TimerSwitchConfirm pending={PENDING} onConfirm={onConfirm} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Keep tracking' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
