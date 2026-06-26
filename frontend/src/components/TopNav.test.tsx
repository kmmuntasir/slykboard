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
// F37 — return one project so ProjectPicker renders its <select aria-label="Select project">;
// an empty list renders the "No projects" placeholder span instead, which would break the
// picker-left assertion. None of the existing assertions query the picker, so this is safe.
vi.mock('@/hooks/useProjects', () => ({
    useProjects: () => ({
        data: [{ id: 'p1', slug: 'demo', name: 'Demo' }],
        isLoading: false,
    }),
}));

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
    blocked: false,
};

function renderTopNav() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <TopNav />
        </MemoryRouter>,
    );
}

// lucide icons render as <svg>; assert presence by querying the brand container.
function brandContainer() {
    return screen.getByText('Slykboard').parentElement as HTMLElement;
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

    it('clears local state + navigates even when logout rejects', async () => {
        logoutMock.mockRejectedValue(new Error('500'));
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

    it('renders the Layers brand mark before "Slykboard" (leftmost left cluster)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const brand = brandContainer();
        // The Layers svg is the first child (icon before the text span).
        const svg = brand.querySelector('svg');
        expect(svg).toBeInTheDocument();
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
        expect(brand.firstChild).toBe(svg);
        expect(screen.getByText('Slykboard')).toBeInTheDocument();
    });

    it('renders a single primary navigation landmark', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    });

    it('renders Board/Reports NavLinks with icons', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const board = screen.getByRole('link', { name: /Board/ });
        const reports = screen.getByRole('link', { name: /Reports/ });
        expect(board.querySelector('svg')).toBeInTheDocument();
        expect(reports.querySelector('svg')).toBeInTheDocument();
    });

    it('does NOT apply max-w-5xl to the nav (full-width gutter)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const nav = screen.getByRole('navigation', { name: 'Primary' });
        expect(nav.className).not.toContain('max-w-5xl');
        expect(nav.className).not.toContain('mx-auto');
    });

    it('ProjectPicker is in the left cluster (next to brand)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const picker = screen.getByLabelText('Select project');
        // The picker shares a parent (left cluster) with the brand container.
        const leftCluster = picker.parentElement;
        expect(leftCluster?.contains(brandContainer())).toBe(true);
    });

    it('mobile slide-down panel is hidden by default', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const panel = document.getElementById('mobile-nav-panel');
        expect(panel).not.toBeNull();
        expect(panel?.className).toContain('hidden');
    });

    it('mobile toggle opens the slide-down panel (aria-expanded)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const panel = document.getElementById('mobile-nav-panel');
        // Check class tokens exactly — open panel keeps the md:hidden modifier
        // (hide-on-desktop), which contains the substring "hidden" but is not the
        // base `hidden` class. The base `hidden` token must be absent when open.
        const classes = panel?.className.split(/\s+/) ?? [];
        expect(classes).toContain('block');
        expect(classes).not.toContain('hidden');
    });

    it('mobile panel closes on Escape and restores focus to the toggle', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
        toggle.focus();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        const panel = document.getElementById('mobile-nav-panel');
        expect(panel?.className).toContain('hidden');
        // Focus restored to the toggle.
        expect(document.activeElement).toBe(toggle);
    });

    it('mobile panel closes on outside pointerdown', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();
        const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        // pointerdown on the header (outside panel + outside toggle) closes.
        fireEvent.pointerDown(document.body);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });
});
