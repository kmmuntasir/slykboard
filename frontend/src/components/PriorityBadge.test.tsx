import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityBadge } from './PriorityBadge';
import { PRIORITY_DISPLAY } from '@/types/ticket';

describe('PriorityBadge', () => {
    const cases: Array<{ priority: keyof typeof PRIORITY_DISPLAY; label: string }> = [
        { priority: 'LOW', label: 'Low' },
        { priority: 'MEDIUM', label: 'Medium' },
        { priority: 'HIGH', label: 'High' },
        { priority: 'URGENT', label: 'Urgent' },
        { priority: 'CRITICAL', label: 'Critical' },
    ];

    cases.forEach(({ priority, label }) => {
        it(`renders ${label} label for ${priority} priority`, () => {
            render(<PriorityBadge priority={priority} />);
            expect(screen.getByLabelText(`Priority: ${label}`)).toBeInTheDocument();
            expect(screen.getByText(label)).toBeInTheDocument();
        });
    });
});
