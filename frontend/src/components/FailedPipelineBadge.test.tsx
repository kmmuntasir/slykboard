import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FailedPipelineBadge } from './FailedPipelineBadge';
import type { PipelineState } from '@/constants/pipelineStates';

// SLYK-0310 — badge gating per 06-frontend-ui.md: FAILED_* renders the
// failure message + remaining-retries line; BLOCKED_HUMAN renders the
// "Needs human help" variant with the disabled escalation button
// (SLYK-0400); healthy states render nothing.

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

    it('BLOCKED_HUMAN: needs-human-help variant + disabled button (SLYK-0400 stub)', () => {
        render(<FailedPipelineBadge state="BLOCKED_HUMAN" attempts={3} />);
        expect(screen.getByLabelText('Pipeline blocked: needs human help')).toBeInTheDocument();
        const button = screen.getByRole('button', { name: 'Need human help' });
        expect(button).toBeDisabled();
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
