import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRequireRole } from '@/hooks/useRequireRole';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

function Probe({ allowed }: { allowed: boolean }) {
    return <span data-testid="probe">{String(allowed)}</span>;
}

function ProbeRole({ roles }: { roles: Parameters<typeof useRequireRole> }) {
    const allowed = useRequireRole(...roles);
    return <Probe allowed={allowed} />;
}

const baseUser: AuthUser = {
    token: 'tok-123',
    id: 'user-1',
    email: 'demo@slykboard.local',
    name: 'Demo User',
    role: 'ADMIN',
    avatarUrl: null,
    blocked: false,
};

describe('useRequireRole', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
    });

    const cases: Array<{
        name: string;
        user: AuthUser | null;
        roles: Parameters<typeof useRequireRole>;
        expected: boolean;
    }> = [
        {
            name: 'returns true when role allowed',
            user: { ...baseUser, role: 'ADMIN' },
            roles: ['ADMIN'],
            expected: true,
        },
        {
            name: 'returns false when role not allowed',
            user: { ...baseUser, role: 'MEMBER' },
            roles: ['ADMIN'],
            expected: false,
        },
        {
            name: 'returns false when no user',
            user: null,
            roles: ['ADMIN'],
            expected: false,
        },
        {
            name: 'allows multiple roles',
            user: { ...baseUser, role: 'MEMBER' },
            roles: ['ADMIN', 'MEMBER'],
            expected: true,
        },
    ];

    cases.forEach(({ name, user, roles, expected }) => {
        it(name, () => {
            if (user) {
                useAuthStore.getState().setUser(user);
            }
            render(<ProbeRole roles={roles} />);
            expect(screen.getByTestId('probe').textContent).toBe(String(expected));
        });
    });
});
