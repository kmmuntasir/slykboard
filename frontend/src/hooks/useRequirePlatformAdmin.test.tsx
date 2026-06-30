import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

function Probe({ allowed }: { allowed: boolean }) {
    return <span data-testid="probe">{String(allowed)}</span>;
}

function ProbePlatformAdmin() {
    const allowed = useRequirePlatformAdmin();
    return <Probe allowed={allowed} />;
}

const baseUser: AuthUser = {
    token: 'tok-123',
    id: 'user-1',
    email: 'demo@slykboard.local',
    name: 'Demo User',
    isPlatformAdmin: true,
    displayName: null,
    avatarUrl: null,
    blocked: false,
};

describe('useRequirePlatformAdmin', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
    });

    const cases: Array<{
        name: string;
        user: AuthUser | null;
        expected: boolean;
    }> = [
        {
            name: 'returns true when the user is a platform admin',
            user: { ...baseUser, isPlatformAdmin: true },
            expected: true,
        },
        {
            name: 'returns false when the user is not a platform admin',
            user: { ...baseUser, isPlatformAdmin: false },
            expected: false,
        },
        {
            name: 'returns false when there is no user',
            user: null,
            expected: false,
        },
    ];

    cases.forEach(({ name, user, expected }) => {
        it(name, () => {
            if (user) {
                useAuthStore.getState().setUser(user);
            }
            render(<ProbePlatformAdmin />);
            expect(screen.getByTestId('probe').textContent).toBe(String(expected));
        });
    });
});
