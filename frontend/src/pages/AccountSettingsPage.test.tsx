// KMM-5: AccountSettingsPage test. The page reads from useAuthStore (zustand —
// no provider needed) and useTheme (requires ThemeProvider). Covers section
// navigation, field presence, role badge for admin vs member, and the
// delete-account confirm flow. Edits are UI-only (no backend), so tests assert
// markup/behavior, not network calls.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';
import { AccountSettingsPage } from './AccountSettingsPage';

const MEMBER_USER: AuthUser = {
    token: 'tok',
    id: 'user-123',
    email: 'member@example.com',
    name: 'Munna Member',
    isPlatformAdmin: false,
    displayName: 'munna',
    avatarUrl: null,
    blocked: false,
};

const ADMIN_USER: AuthUser = {
    ...MEMBER_USER,
    id: 'admin-456',
    email: 'admin@example.com',
    name: 'Ada Admin',
    isPlatformAdmin: true,
    displayName: null,
};

function renderPage() {
    return render(
        <ThemeProvider>
            <AccountSettingsPage />
        </ThemeProvider>,
    );
}

beforeEach(() => {
    useAuthStore.setState({ user: MEMBER_USER });
});

afterEach(() => {
    useAuthStore.setState({ user: null });
    localStorage.clear();
    cleanup();
});

describe('AccountSettingsPage', () => {
    it('renders the heading and the section sidebar', () => {
        renderPage();

        expect(
            screen.getByRole('heading', { name: 'Account Settings' }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('navigation', { name: 'Account settings sections' }),
        ).toBeInTheDocument();
        // All four sections are listed in the sidebar.
        expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Danger Zone' })).toBeInTheDocument();
    });

    it('shows the Profile section by default with name + avatar fields', () => {
        renderPage();

        // Profile is the default active section.
        expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
        expect(screen.getByLabelText('Full name')).toHaveValue('Munna Member');
        expect(screen.getByLabelText('Display name')).toHaveValue('munna');
        expect(screen.getByLabelText('Avatar URL')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change avatar' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    });

    it('disables Save until the full-name draft changes', () => {
        renderPage();

        const nameInput = screen.getByLabelText('Full name');
        // Two "Save" buttons exist (full name + display name); both disabled while clean.
        const saveButtons = screen.getAllByRole('button', { name: 'Save' });
        expect(saveButtons.every((b) => b)).toBe(true);
        const allDisabled = saveButtons.every((b) => (b as HTMLButtonElement).disabled);
        expect(allDisabled).toBe(true);

        fireEvent.change(nameInput, { target: { value: 'Munna Renamed' } });
        const afterChange = screen.getAllByRole('button', { name: 'Save' });
        // Full-name Save (first) now enabled; display-name Save (second) still disabled.
        expect(afterChange[0]).not.toBeDisabled();
        expect(afterChange[1]).toBeDisabled();
    });

    it('enables Change avatar / Remove when an avatar URL is entered', () => {
        renderPage();

        const urlInput = screen.getByLabelText('Avatar URL');
        fireEvent.change(urlInput, { target: { value: 'https://img.example/x.png' } });

        expect(screen.getByRole('button', { name: 'Change avatar' })).toBeEnabled();
        // Applying the URL enables Remove (an avatar is now set locally).
        fireEvent.click(screen.getByRole('button', { name: 'Change avatar' }));
        expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    });

    it('shows the Account section with read-only email, role badge, and user id', () => {
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));

        expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toHaveValue('member@example.com');
        expect(screen.getByText('Member')).toBeInTheDocument();
        expect(screen.getByText('user-123')).toBeInTheDocument();
    });

    it('renders the Platform Admin role badge for an admin', () => {
        useAuthStore.setState({ user: ADMIN_USER });
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        expect(screen.getByText('Platform Admin')).toBeInTheDocument();
        expect(screen.queryByText('Member')).toBeNull();
    });

    it('renders the theme control in Preferences and applies the choice', () => {
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
        expect(screen.getByRole('heading', { name: 'Preferences' })).toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();

        // Selecting Dark toggles the .dark class on <html> (ThemeProvider effect).
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        // Selecting Light removes it.
        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('opens the delete-account confirm dialog from the Danger Zone', () => {
        renderPage();

        fireEvent.click(screen.getByRole('button', { name: 'Danger Zone' }));
        expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
        expect(
            screen.getByRole('heading', { name: 'Delete account?' }),
        ).toBeInTheDocument();
        // Confirm closes the dialog (UI-only no-op). The dialog confirm shares the
        // page button's accessible name, so disambiguate by clicking the last match
        // (the dialog renders in a portal appended to <body>).
        const deleteButtons = screen.getAllByRole('button', { name: 'Delete account' });
        fireEvent.click(deleteButtons[deleteButtons.length - 1]!);
        expect(
            screen.queryByRole('heading', { name: 'Delete account?' }),
        ).toBeNull();
    });
});
