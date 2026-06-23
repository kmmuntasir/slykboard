import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useUsers } from '@/hooks/useUsers';
import type { UseQueryResult } from '@tanstack/react-query';
import type { UserOption } from '@/api/users';
import { UserSelect } from './UserSelect';

vi.mock('@/hooks/useUsers', () => ({
    useUsers: vi.fn(),
}));

const usersFixture: UserOption[] = [
    { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
    { id: 'u2', fullName: 'Grace Hopper', avatarUrl: null },
];

function mockUseUsers(
    overrides: Partial<UseQueryResult<UserOption[]>> = {},
): UseQueryResult<UserOption[]> {
    return {
        data: usersFixture,
        isLoading: false,
        error: null,
        ...overrides,
    } as unknown as UseQueryResult<UserOption[]>;
}

describe('UserSelect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders Unassigned plus user options', () => {
        vi.mocked(useUsers).mockReturnValue(mockUseUsers());
        render(<UserSelect value={null} onChange={vi.fn()} />);

        expect(screen.getAllByRole('option')).toHaveLength(3);
        expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Grace Hopper' })).toBeInTheDocument();
    });

    it('is accessible via combobox role with "Assignee" name', () => {
        vi.mocked(useUsers).mockReturnValue(mockUseUsers());
        render(<UserSelect value={null} onChange={vi.fn()} />);
        expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    });

    it('selecting Unassigned fires onChange(null)', () => {
        const onChange = vi.fn();
        vi.mocked(useUsers).mockReturnValue(mockUseUsers());
        render(<UserSelect value="u1" onChange={onChange} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), {
            target: { value: '' },
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('selecting a user fires onChange(userId)', () => {
        const onChange = vi.fn();
        vi.mocked(useUsers).mockReturnValue(mockUseUsers());
        render(<UserSelect value={null} onChange={onChange} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), {
            target: { value: 'u2' },
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('u2');
    });

    it('disables the select while users are loading', () => {
        vi.mocked(useUsers).mockReturnValue(mockUseUsers({ data: undefined, isLoading: true }));
        render(<UserSelect value={null} onChange={vi.fn()} />);

        expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeDisabled();
    });
});
