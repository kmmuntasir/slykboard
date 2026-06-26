import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TopNav } from './TopNav';
import { ThemeProvider } from '@/components/ThemeProvider';
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
        // F40 — TopNav now calls useTheme via <ThemeToggle />; must be inside
        // <ThemeProvider> or every test throws "must be used within ThemeProvider".
        <ThemeProvider>
            <MemoryRouter initialEntries={['/']}>
                <TopNav />
            </MemoryRouter>
        </ThemeProvider>,
    );
}

// lucide icons render as <svg>; assert presence by querying the brand container.
function brandContainer() {
    return screen.getByText('Slykboard').parentElement as HTMLElement;
}

describe('TopNav', () => {
    beforeEach(() => {
        localStorage.clear();
        // F40 — reset .dark on <html> so F40 toggle tests don't leak theme state
        // into the F37/F39 DOM assertions (localStorage.clear() alone won't clear it).
        document.documentElement.classList.remove('dark');
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

        // F39 — F35 Avatar per-word algo: single-word "Alice" → "A" (was per-name-char "AL").
        expect(screen.getByText('A')).toBeInTheDocument();
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

        // F39 — D1: F35 Avatar has no email param; TopNav passes name={user.name||user.email},
        // so "bob@x.com" becomes the initials source. Per-word algo → "B" (was per-name-char "BO").
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('Sign out menu item calls logout + clear + navigate', async () => {
        logoutMock.mockResolvedValue(undefined);
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // F39 — Sign out is now a DropdownItem (role="menuitem") inside a Radix menu.
        // Radix opens on pointerDown (jsdom + PointerEvent polyfill at test-setup.ts:10).
        const trigger = screen.getByRole('button', { name: 'Account menu' });
        await act(async () => {
            fireEvent.pointerDown(trigger, { button: 0 });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
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

        const trigger = screen.getByRole('button', { name: 'Account menu' });
        await act(async () => {
            fireEvent.pointerDown(trigger, { button: 0 });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
        });

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().user).toBeNull();
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    // --- F39 profile-menu coverage (PRD §8) ------------------------------------

    it('profile menu opens on avatar trigger pointerDown (menu role appears)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        const trigger = screen.getByRole('button', { name: 'Account menu' });
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        fireEvent.pointerDown(trigger, { button: 0 });

        expect(screen.getByRole('menu')).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('profile menu header shows "Signed in as" + name + email', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        expect(screen.getByText('Signed in as')).toBeInTheDocument();
        expect(screen.getByText(fullUser.name)).toBeInTheDocument();
        expect(screen.getByText(fullUser.email)).toBeInTheDocument();
    });

    it('Sign out menu item invokes handleSignOut (logout + clear + broadcast + navigate)', async () => {
        logoutMock.mockResolvedValue(undefined);
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
        });

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().user).toBeNull();
        expect(broadcastLogoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
    });

    it('Sign out menu item uses the destructive variant (text-destructive)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        const signOutItem = screen.getByRole('menuitem', { name: /Sign out/ });
        expect(signOutItem.className).toContain('text-destructive');
    });

    it('does NOT render the floating "Sign out" button (replaced by the menu)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // Menu is closed → the only "Sign out" affordance is inside the closed menu
        // (not queryable as a button). The old flat <button> is gone.
        expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });

    // --- F40 theme-toggle coverage (navbar segmented control + profile mirror) ----

    it('renders the theme segmented control (role="group" labelled "Theme")', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    });

    it('clicking the Dark segment adds .dark to <html>', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('profile-menu mirror: Theme items appear and invoke setTheme', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        // Three theme menuitems appear (D5 mirror).
        fireEvent.click(screen.getByRole('menuitem', { name: /Dark/ }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('profile-menu mirror marks the active theme with a Check', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // Set dark via the navbar segment, open the menu, assert the Dark item is checked.
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        const darkItem = screen.getByRole('menuitem', { name: /Dark/ });
        expect(darkItem.querySelector('[aria-hidden="true"]')).toBeInTheDocument(); // Check icon
    });

    it('avatar trigger has aria-label="Account menu" (a11y + test contract)', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
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
