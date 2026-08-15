import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FailedPipelineBadge } from './FailedPipelineBadge';
import type { PipelineState } from '@/constants/pipelineStates';
import { ApiClientError } from '@/api/client';

// SLYK-0310/0400 — badge gating per 06-frontend-ui.md: FAILED_* renders the
// failure message + remaining-retries line; BLOCKED_HUMAN renders the
// "Needs human help" variant. SLYK-0400 wires the escalation button: enabled
// when onEscalate is provided, hidden when not; success/409-debounce →
// "Escalated"; other errors re-enable the button.

describe('FailedPipelineBadge', () => {
    it('FAILED_CI: failure label + remaining-retries line', () => {
        render(<FailedPipelineBadge state="FAILED_CI" attempts={1} />);
        expect(
            screen.getByLabelText('Pipeline failed: Automated tests failed'),
        ).toBeInTheDocument();
        expect(screen.getByText('Failed: Automated tests failed')).toBeInTheDocument();
        expect(screen.getByText('Agent will retry up to 2 more times')).toBeInTheDocument();
    });

    it('singular retry line at 2 attempts', () => {
        render(<FailedPipelineBadge state="FAILED_AGENT" attempts={2} />);
        expect(screen.getByText('Agent will retry up to 1 more time')).toBeInTheDocument();
    });

    it('exhausted retries: escalation-pending copy', () => {
        render(<FailedPipelineBadge state="FAILED_DEPLOY" attempts={3} />);
        expect(screen.getByText('No auto-retries left — awaiting escalation')).toBeInTheDocument();
    });

    it('BLOCKED_HUMAN without onEscalate: badge renders, button stays hidden (06 hidden-when-unconfigured rule)', () => {
        render(<FailedPipelineBadge state="BLOCKED_HUMAN" attempts={3} />);
        expect(screen.getByLabelText('Pipeline blocked: needs human help')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Need human help/i })).toBeNull();
    });

    it('BLOCKED_HUMAN + onEscalate success → button flips to disabled "Escalated"', async () => {
        const onEscalate = vi.fn().mockResolvedValue(undefined);
        render(<FailedPipelineBadge state="BLOCKED_HUMAN" attempts={3} onEscalate={onEscalate} />);

        const button = screen.getByRole('button', { name: 'Need human help' });
        expect(button).not.toBeDisabled();

        fireEvent.click(button);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Escalated' })).toBeDisabled();
        });
        expect(onEscalate).toHaveBeenCalledTimes(1);
    });

    it('BLOCKED_HUMAN + 409 debounce → treated as already-escalated', async () => {
        const onEscalate = vi.fn().mockRejectedValue(
            new ApiClientError(
                'Escalation already sent within the last 60 seconds',
                409,
                'CONFLICT',
            ),
        );
        render(<FailedPipelineBadge state="BLOCKED_HUMAN" attempts={3} onEscalate={onEscalate} />);

        fireEvent.click(screen.getByRole('button', { name: 'Need human help' }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Escalated' })).toBeDisabled();
        });
    });

    it('BLOCKED_HUMAN + 502 dispatcher failure → button re-enables for retry', async () => {
        const onEscalate = vi.fn().mockRejectedValue(
            new ApiClientError('Dispatcher escalation failed', 502, 'UPSTREAM_FAILED'),
        );
        render(<FailedPipelineBadge state="BLOCKED_HUMAN" attempts={3} onEscalate={onEscalate} />);

        fireEvent.click(screen.getByRole('button', { name: 'Need human help' }));
        // The re-thrown error is the caller's to toast; the button must be
        // re-enabled either way.
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Need human help' })).not.toBeDisabled();
        });
    });

    it('renders nothing for healthy/terminal-success states', () => {
        const healthy: PipelineState[] = ['BACKLOG', 'QUEUED', 'AGENT_RUNNING', 'DONE'];
        for (const state of healthy) {
            const { container, unmount } = render(
                <FailedPipelineBadge state={state} attempts={0} />,
            );
            expect(container).toBeEmptyDOMElement();
            unmount();
        }
    });
});
