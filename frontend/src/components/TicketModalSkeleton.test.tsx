import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TicketModalSkeleton } from './TicketModalSkeleton';

describe('TicketModalSkeleton', () => {
    it('renders without crashing and root is aria-hidden', () => {
        const { container } = render(<TicketModalSkeleton />);
        const root = container.firstChild as HTMLElement;
        expect(root).toBeTruthy();
        expect(root.getAttribute('aria-hidden')).toBe('true');
    });

    it('renders skeleton primitives for title, meta, and body', () => {
        const { container } = render(<TicketModalSkeleton />);
        // Every skeleton primitive carries the animate-pulse class.
        const pulses = container.querySelectorAll('.animate-pulse');
        // title (1) + meta (2) + 2 labels + input block + description block = 7
        expect(pulses.length).toBeGreaterThanOrEqual(6);
    });
});
