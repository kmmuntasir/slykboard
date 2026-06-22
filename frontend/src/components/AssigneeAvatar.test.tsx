import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssigneeAvatar } from './AssigneeAvatar';
import type { Assignee } from '@/types/ticket';

describe('AssigneeAvatar', () => {
    it('renders the avatar image when avatarUrl is present', () => {
        const assignee: Assignee = {
            id: 'u1',
            fullName: 'Ada Lovelace',
            avatarUrl: 'https://example.com/ada.png',
        };
        render(<AssigneeAvatar assignee={assignee} />);
        const img = screen.getByRole('img', { name: 'Ada Lovelace' });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'https://example.com/ada.png');
    });

    it('renders initials when avatarUrl is absent', () => {
        const assignee: Assignee = { id: 'u2', fullName: 'Grace Hopper', avatarUrl: null };
        render(<AssigneeAvatar assignee={assignee} />);
        // initials = first letters of name parts, sliced to 2, uppercased -> "GH"
        expect(screen.getByText('GH')).toBeInTheDocument();
        expect(screen.getByTitle('Grace Hopper')).toBeInTheDocument();
    });

    it('renders Unassigned placeholder when assignee is null', () => {
        render(<AssigneeAvatar assignee={null} />);
        expect(screen.getByLabelText('Unassigned')).toBeInTheDocument();
        expect(screen.getByTitle('Unassigned')).toBeInTheDocument();
    });
});
