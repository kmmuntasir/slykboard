import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { render, screen } from '@testing-library/react';
import { RequirePlatformAdmin } from '@/components/RequirePlatformAdmin';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

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

function setUserAdmin(isPlatformAdmin: boolean) {
    useAuthStore.getState().setUser({ ...baseUser, isPlatformAdmin });
}

function HomeProbe() {
    const loc = useLocation();
    return <div data-testid="home">{JSON.stringify(loc.state)}</div>;
}

function renderGuarded(initialPath = '/settings') {
    render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/settings" element={<RequirePlatformAdmin />}>
                    <Route index element={<div data-testid="outlet">OUTLET</div>} />
                </Route>
                <Route path="/" element={<HomeProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('RequirePlatformAdmin', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
    });

    it('renders Outlet (child) when the user is a platform admin', () => {
        setUserAdmin(true);
        renderGuarded();
        expect(screen.getByTestId('outlet')).toBeInTheDocument();
        expect(screen.queryByTestId('home')).toBeNull();
    });

    it('renders the 403 page when the user is not a platform admin', () => {
        setUserAdmin(false);
        renderGuarded();
        expect(screen.queryByTestId('outlet')).toBeNull();
        // SLYK-F28: deny renders ForbiddenPage instead of redirecting.
        expect(screen.getByRole('heading', { name: /403/i })).toBeInTheDocument();
        expect(screen.queryByTestId('home')).toBeNull();
    });

    it('renders the 403 page when no user', () => {
        renderGuarded();
        expect(screen.queryByTestId('outlet')).toBeNull();
        expect(screen.getByRole('heading', { name: /403/i })).toBeInTheDocument();
        expect(screen.queryByTestId('home')).toBeNull();
    });
});
