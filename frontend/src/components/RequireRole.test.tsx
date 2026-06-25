import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { render, screen } from '@testing-library/react';
import { RequireRole } from '@/components/RequireRole';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

const baseUser: AuthUser = {
    token: 'tok-123',
    id: 'user-1',
    email: 'demo@slykboard.local',
    name: 'Demo User',
    role: 'ADMIN',
    avatarUrl: null,
    blocked: false,
};

function setUserWithRole(role: AuthUser['role']) {
    useAuthStore.getState().setUser({ ...baseUser, role });
}

function HomeProbe() {
    const loc = useLocation();
    return <div data-testid="home">{JSON.stringify(loc.state)}</div>;
}

function renderGuarded(initialPath = '/settings') {
    render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/settings" element={<RequireRole role="ADMIN" />}>
                    <Route index element={<div data-testid="outlet">OUTLET</div>} />
                </Route>
                <Route path="/" element={<HomeProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('RequireRole', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
    });

    it('renders Outlet (child) when role matches', () => {
        setUserWithRole('ADMIN');
        renderGuarded();
        expect(screen.getByTestId('outlet')).toBeInTheDocument();
        expect(screen.queryByTestId('home')).toBeNull();
    });

    it('renders the 403 page when role mismatch', () => {
        setUserWithRole('MEMBER');
        renderGuarded();
        expect(screen.queryByTestId('outlet')).toBeNull();
        // SLYK-F28: deny now renders ForbiddenPage instead of redirecting
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
