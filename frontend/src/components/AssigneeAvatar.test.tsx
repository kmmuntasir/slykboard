import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssigneeAvatar } from './AssigneeAvatar';
import { TooltipProvider } from '@/components/ui/Tooltip';
import type { Assignee } from '@/types/ticket';

// TooltipProvider is mounted app-wide in main.tsx (production). Tests render an
// isolated subtree, so mount it here too — Radix Tooltip throws without it.
function renderAvatar(assignee: Assignee | null) {
    return render(
        <TooltipProvider>
            <AssigneeAvatar assignee={assignee} />
        </TooltipProvider>,
    );
}

describe('AssigneeAvatar', () => {
    it('renders the avatar image when avatarUrl is present', () => {
        const assignee: Assignee = {
            id: 'u1',
            fullName: 'Ada Lovelace',
            avatarUrl: 'https://example.com/ada.png',
        };
        renderAvatar(assignee);
        const img = screen.getByRole('img', { name: 'Ada Lovelace' });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/ada.png');
    });

    it('renders initials when avatarUrl is absent', () => {
        const assignee: Assignee = { id: 'u2', fullName: 'Grace Hopper', avatarUrl: null };
        renderAvatar(assignee);
        // initials = first letters of name parts, sliced to 2, uppercased -> "GH"
        expect(screen.getByText('GH')).toBeInTheDocument();
        // T6 a11y fix: the initials span now carries aria-label (was title-only).
        expect(screen.getByLabelText('Grace Hopper')).toBeInTheDocument();
    });

    it('renders Unassigned placeholder when assignee is null', () => {
        renderAvatar(null);
        expect(screen.getByLabelText('Unassigned')).toBeInTheDocument();
    });
});
