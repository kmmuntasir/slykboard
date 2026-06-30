// SLYK-02 Task T5 — MemberTable tests.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { MemberTable } from './MemberTable';
import type { Member } from '@/types/member';

function makeMember(overrides: Partial<Member> = {}): Member {
    return {
        userId: 'u-1',
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        displayName: null,
        avatarUrl: null,
        role: 'MEMBER',
        createdAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

const baseProps = {
    canManage: true,
    currentUserId: 'u-self',
    onRoleChange: vi.fn(),
    onRemove: vi.fn(),
};

describe('MemberTable', () => {
    it('renders nothing when members is empty', () => {
        const { container } = render(<MemberTable {...baseProps} members={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders one row per member with avatar/name/email', () => {
        const members = [
            makeMember({ userId: 'u-1', email: 'ada@example.com', fullName: 'Ada Lovelace' }),
            makeMember({ userId: 'u-2', email: 'bo@example.com', fullName: 'Bo' }),
        ];
        render(<MemberTable {...baseProps} members={members} />);

        const rows = screen.getAllByRole('row');
        // 1 header row + 2 member rows.
        expect(rows).toHaveLength(3);
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('Bo')).toBeInTheDocument();
        expect(screen.getByText('ada@example.com')).toBeInTheDocument();
        expect(screen.getByText('bo@example.com')).toBeInTheDocument();
    });

    it('renders the You badge for the current user row', () => {
        const members = [makeMember({ userId: 'u-self', email: 'me@example.com' })];
        render(<MemberTable {...baseProps} members={members} currentUserId="u-self" />);
        expect(screen.getByText('You')).toBeInTheDocument();
    });

    it('renders the derived Active status badge (no schema change)', () => {
        const members = [makeMember()];
        render(<MemberTable {...baseProps} members={members} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    describe('canManage = false (read-only)', () => {
        it('renders role Badge, no select, no Remove button', () => {
            const members = [
                makeMember({ userId: 'u-1', role: 'PROJECT_ADMIN' }),
                makeMember({ userId: 'u-2', email: 'bo@example.com', role: 'MEMBER' }),
            ];
            render(<MemberTable {...baseProps} members={members} canManage={false} />);

            // Role rendered as badges.
            expect(screen.getByText('Project Admin')).toBeInTheDocument();
            expect(screen.getByText('Member')).toBeInTheDocument();

            // No select triggers, no remove buttons.
            expect(screen.queryAllByRole('button', { name: /Role for /i })).toHaveLength(0);
            expect(screen.queryByRole('button')).toBeNull();
            // Actions column header is omitted when canManage=false.
            expect(screen.queryByText('Actions')).toBeNull();
        });
    });

    describe('canManage = true (admin)', () => {
        it('renders the role Select and Remove button for each row', () => {
            const members = [
                makeMember({ userId: 'u-1', email: 'ada@example.com', role: 'MEMBER' }),
                makeMember({ userId: 'u-2', email: 'bo@example.com', role: 'MEMBER' }),
            ];
            render(<MemberTable {...baseProps} members={members} canManage={true} />);

            expect(screen.getAllByRole('button', { name: /Role for /i })).toHaveLength(2);
            expect(screen.getAllByRole('button', { name: /Remove /i })).toHaveLength(2);
            // aria-labels are descriptive per-row.
            expect(
                screen.getByRole('button', { name: 'Remove ada@example.com' }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole('button', { name: 'Role for ada@example.com' }),
            ).toBeInTheDocument();
        });

        it('fires onRoleChange with (userId, role) when an admin picks a role via the menu', () => {
            const onRoleChange = vi.fn();
            const members = [
                makeMember({ userId: 'u-1', email: 'ada@example.com', role: 'MEMBER' }),
            ];
            render(
                <MemberTable
                    {...baseProps}
                    members={members}
                    canManage={true}
                    currentUserId="u-self"
                    onRoleChange={onRoleChange}
                />,
            );

            const trigger = screen.getByRole('button', { name: 'Role for ada@example.com' });
            // Radix dropdown-menu opens on pointerDown.
            fireEvent.pointerDown(trigger, { button: 0 });
            fireEvent.click(screen.getByRole('menuitem', { name: 'Project Admin' }));
            expect(onRoleChange).toHaveBeenCalledWith('u-1', 'PROJECT_ADMIN');
        });

        it('fires onRemove with userId when an admin clicks Remove on a non-self row', () => {
            const onRemove = vi.fn();
            const members = [
                makeMember({ userId: 'u-1', email: 'ada@example.com', role: 'MEMBER' }),
            ];
            render(
                <MemberTable
                    {...baseProps}
                    members={members}
                    canManage={true}
                    currentUserId="u-self"
                    onRemove={onRemove}
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: 'Remove ada@example.com' }));
            expect(onRemove).toHaveBeenCalledWith('u-1');
        });

        it('self-lock: disables the select (when PROJECT_ADMIN) AND Remove button for the self row', () => {
            const members = [
                makeMember({
                    userId: 'u-self',
                    email: 'me@example.com',
                    role: 'PROJECT_ADMIN',
                }),
            ];
            render(
                <MemberTable
                    {...baseProps}
                    members={members}
                    canManage={true}
                    currentUserId="u-self"
                />,
            );

            const select = screen.getByRole('button', { name: 'Role for me@example.com' });
            const remove = screen.getByRole('button', { name: 'Remove me@example.com' });
            expect(select).toBeDisabled();
            expect(remove).toBeDisabled();
        });

        it('self-lock: a self row that is MEMBER has an enabled select (can promote) but disabled Remove', () => {
            const members = [
                makeMember({
                    userId: 'u-self',
                    email: 'me@example.com',
                    role: 'MEMBER',
                }),
            ];
            render(
                <MemberTable
                    {...baseProps}
                    members={members}
                    canManage={true}
                    currentUserId="u-self"
                />,
            );

            const select = screen.getByRole('button', { name: 'Role for me@example.com' });
            const remove = screen.getByRole('button', { name: 'Remove me@example.com' });
            expect(select).not.toBeDisabled();
            expect(remove).toBeDisabled();
        });

        it('non-self PROJECT_ADMIN row has an enabled select and enabled Remove', () => {
            const members = [
                makeMember({
                    userId: 'u-other',
                    email: 'other@example.com',
                    role: 'PROJECT_ADMIN',
                }),
            ];
            render(
                <MemberTable
                    {...baseProps}
                    members={members}
                    canManage={true}
                    currentUserId="u-self"
                />,
            );

            const select = screen.getByRole('button', { name: 'Role for other@example.com' });
            const remove = screen.getByRole('button', { name: 'Remove other@example.com' });
            expect(select).not.toBeDisabled();
            expect(remove).not.toBeDisabled();
        });
    });

    describe('a11y', () => {
        it('uses table/thead/tbody with scope attributes', () => {
            const members = [makeMember()];
            const { container } = render(<MemberTable {...baseProps} members={members} />);

            expect(container.querySelector('table')).toBeInTheDocument();
            expect(container.querySelector('thead')).toBeInTheDocument();
            expect(container.querySelector('tbody')).toBeInTheDocument();
            const colHeaders = container.querySelectorAll('thead th[scope="col"]');
            expect(colHeaders.length).toBeGreaterThanOrEqual(3);
            const rowHeaders = container.querySelectorAll('tbody th[scope="row"]');
            expect(rowHeaders).toHaveLength(1);
        });

        it('each Remove button has a descriptive aria-label using the email', () => {
            const members = [
                makeMember({ userId: 'u-1', email: 'ada@example.com' }),
                makeMember({ userId: 'u-2', email: 'bo@example.com' }),
            ];
            render(<MemberTable {...baseProps} members={members} canManage={true} />);
            expect(screen.getByRole('button', { name: 'Remove ada@example.com' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Remove bo@example.com' })).toBeInTheDocument();
        });

        it('each role select has a descriptive aria-label using the email', () => {
            const members = [
                makeMember({ userId: 'u-1', email: 'ada@example.com' }),
                makeMember({ userId: 'u-2', email: 'bo@example.com' }),
            ];
            render(<MemberTable {...baseProps} members={members} canManage={true} />);
            expect(
                screen.getByRole('button', { name: 'Role for ada@example.com' }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole('button', { name: 'Role for bo@example.com' }),
            ).toBeInTheDocument();
        });
    });
});
