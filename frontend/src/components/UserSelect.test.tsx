import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useProjectMembers } from '@/hooks/useProjectMembers';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Member } from '@/types/member';
import { UserSelect } from './UserSelect';

vi.mock('@/hooks/useProjectMembers', () => ({
    useProjectMembers: vi.fn(),
}));

const PROJECT_SLUG = 'SLYK';

const membersFixture: Member[] = [
    {
        userId: 'u1',
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        displayName: null,
        avatarUrl: null,
        role: 'MEMBER',
        createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
        userId: 'u2',
        email: 'grace@example.com',
        fullName: 'Grace Hopper',
        displayName: null,
        avatarUrl: null,
        role: 'MEMBER',
        createdAt: '2026-01-01T00:00:00.000Z',
    },
];

function mockUseProjectMembers(
    overrides: Partial<UseQueryResult<Member[]>> = {},
): UseQueryResult<Member[]> {
    return {
        data: membersFixture,
        isLoading: false,
        error: null,
        ...overrides,
    } as unknown as UseQueryResult<Member[]>;
}

function openAssignee() {
    const trigger = screen.getByRole('button', { name: 'Assignee' });
    fireEvent.pointerDown(trigger, { button: 0 });
    return trigger;
}

describe('UserSelect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Unassigned plus member options', () => {
        vi.mocked(useProjectMembers).mockReturnValue(mockUseProjectMembers());
        render(<UserSelect projectSlug={PROJECT_SLUG} value={null} onChange={vi.fn()} />);

        openAssignee();
        expect(screen.getAllByRole('menuitem')).toHaveLength(3);
        expect(screen.getByRole('menuitem', { name: 'Unassigned' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Ada Lovelace' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Grace Hopper' })).toBeInTheDocument();
    });

    it('is accessible via button role with "Assignee" aria-label', () => {
        vi.mocked(useProjectMembers).mockReturnValue(mockUseProjectMembers());
        render(<UserSelect projectSlug={PROJECT_SLUG} value={null} onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Assignee' })).toBeInTheDocument();
    });

    it('selecting Unassigned fires onChange(null)', () => {
        const onChange = vi.fn();
        vi.mocked(useProjectMembers).mockReturnValue(mockUseProjectMembers());
        render(<UserSelect projectSlug={PROJECT_SLUG} value="u1" onChange={onChange} />);

        openAssignee();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Unassigned' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('selecting a member fires onChange(userId)', () => {
        const onChange = vi.fn();
        vi.mocked(useProjectMembers).mockReturnValue(mockUseProjectMembers());
        render(<UserSelect projectSlug={PROJECT_SLUG} value={null} onChange={onChange} />);

        openAssignee();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Grace Hopper' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('u2');
    });

    it('disables the select while members are loading', () => {
        vi.mocked(useProjectMembers).mockReturnValue(
            mockUseProjectMembers({ data: undefined, isLoading: true }),
        );
        render(<UserSelect projectSlug={PROJECT_SLUG} value={null} onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Assignee' })).toBeDisabled();
    });
});
