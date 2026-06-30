import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { render, screen } from '@testing-library/react';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuthStore } from '@/stores/useAuthStore';

// Build a structurally-valid JWT (header.payload.signature, base64url).
// `jose`'s `decodeJwt` (used by RequireAuth) only decodes the payload without
// verifying the signature, so a synthetic signature is sufficient here.
function signToken(expSecondsFromNow: number): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
    const payload = { exp };
    const b64u = (obj: unknown) =>
        btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64u(header)}.${b64u(payload)}.signature`;
}

function setUserWithToken(token: string) {
    useAuthStore.getState().setUser({
        token,
        id: 'u1',
        email: 'user@example.com',
        name: 'Test User',
        isPlatformAdmin: false,
        displayName: null,
        avatarUrl: null,
        blocked: false,
    });
}

function LoginProbe() {
    const loc = useLocation();
    return <div data-testid="login">{JSON.stringify(loc.state)}</div>;
}

function renderProtected() {
    render(
        <MemoryRouter initialEntries={['/protected']}>
            <Routes>
                <Route path="/protected" element={<RequireAuth />}>
                    <Route index element={<div data-testid="outlet">OUTLET</div>} />
                </Route>
                <Route path="/login" element={<LoginProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('RequireAuth', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
    });

    it('redirects to /login when user is null', () => {
        renderProtected();
        expect(screen.queryByTestId('outlet')).toBeNull();
        expect(screen.getByTestId('login')).toBeInTheDocument();
    });

    it('renders Outlet when user has valid (non-expired) token', () => {
        const token = signToken(3600);
        setUserWithToken(token);
        renderProtected();
        expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });

    it('clears + redirects when token is expired', () => {
        const token = signToken(-60);
        setUserWithToken(token);
        renderProtected();
        expect(useAuthStore.getState().user).toBeNull();
        expect(screen.queryByTestId('outlet')).toBeNull();
    });

    it('clears + redirects when token is malformed', () => {
        setUserWithToken('not-a-jwt');
        renderProtected();
        expect(useAuthStore.getState().user).toBeNull();
        expect(screen.queryByTestId('outlet')).toBeNull();
        expect(screen.getByTestId('login')).toBeInTheDocument();
    });

    it('preserves from: location in navigate state', () => {
        renderProtected();
        expect(screen.getByTestId('login').textContent).toContain('/protected');
    });
});
