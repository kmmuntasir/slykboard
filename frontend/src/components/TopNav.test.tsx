import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TopNav } from './TopNav';
import { useAuthStore } from '@/stores/useAuthStore';
import type { AuthUser } from '@/stores/useAuthStore';

const { logoutMock, navigateMock, broadcastLogoutMock } = vi.hoisted(() => ({
    logoutMock: vi.fn(),
    navigateMock: vi.fn(),
    broadcastLogoutMock: vi.fn(),
}));

vi.mock('@/api/auth', () => ({ logout: logoutMock }));
vi.mock('@/hooks/useCrossTabLogout', () => ({ broadcastLogout: broadcastLogoutMock }));

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, useNavigate: () => navigateMock };
});

const fullUser: AuthUser = {
    token: 'tok-123',
    id: 'user-1',
    email: 'demo@slykboard.local',
    name: 'Demo User',
    role: 'ADMIN',
    avatarUrl: 'https://example.com/a.png',
};

function renderTopNav() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <TopNav />
        </MemoryRouter>,
    );
}

describe('TopNav', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.getState().clear();
        logoutMock.mockReset();
        navigateMock.mockReset();
        broadcastLogoutMock.mockReset();
    });

    it('renders avatar img when avatarUrl is set', () => {
        useAuthStore.getState().setUser({ ...fullUser, avatarUrl: 'http://img/url' });
        renderTopNav();

        expect(screen.getByRole('img', { name: fullUser.name })).toBeInTheDocument();
    });

    it('renders initials when avatarUrl is null', () => {
        useAuthStore.getState().setUser({ ...fullUser, avatarUrl: null, name: 'Alice' });
        renderTopNav();

        expect(screen.getByText('AL')).toBeInTheDocument();
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('initials fall back to email local-part when name empty', () => {
        useAuthStore.getState().setUser({
            ...fullUser,
            name: '',
            email: 'bob@x.com',
            avatarUrl: null,
        });
        renderTopNav();

        expect(screen.getByText('BO')).toBeInTheDocument();
    });

    it('Sign out button calls logout + clear + navigate', async () => {
        logoutMock.mockResolvedValue(undefined);
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        });

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().user).toBeNull();
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('renders Settings link when role is ADMIN', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    });

    it('hides Settings link when role is MEMBER', () => {
        useAuthStore.getState().setUser({ ...fullUser, role: 'MEMBER' });
        renderTopNav();

        expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    });

    it('always renders Board + Reports for ADMIN', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href');
        expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href');
    });

    it('always renders Board + Reports for MEMBER', () => {
        useAuthStore.getState().setUser({ ...fullUser, role: 'MEMBER' });
        renderTopNav();

        expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href');
        expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href');
        expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    });
});
