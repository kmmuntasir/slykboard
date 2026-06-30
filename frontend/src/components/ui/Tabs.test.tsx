// SLYK-11 — Tabs primitive tests.
// Covers the 7 Radix a11y guarantees (roving roles, aria-selected, aria pairing,
// ArrowLeft/Right/Home/End, controlled onValueChange) plus forceMount persistence.
// Uses getByRole/getAllByRole (no data-testid); keyboard via fireEvent.keyDown.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

function renderTabs() {
    render(
        <Tabs defaultValue="account">
            <TabsList>
                <TabsTrigger value="account">Account</TabsTrigger>
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="account">Account panel</TabsContent>
            <TabsContent value="password">Password panel</TabsContent>
            <TabsContent value="settings">Settings panel</TabsContent>
        </Tabs>,
    );
}

describe('Tabs', () => {
    it('exposes a tablist with tab roles (one per trigger)', () => {
        renderTabs();
        expect(screen.getByRole('tablist')).toBeInTheDocument();
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);
        expect(screen.getByRole('tab', { name: 'Account' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Password' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    });

    it('marks the active tab aria-selected=true (inactive false)', () => {
        renderTabs();
        // defaultValue="account" → Account is selected first.
        const account = screen.getByRole('tab', { name: 'Account' });
        const password = screen.getByRole('tab', { name: 'Password' });
        expect(account.getAttribute('aria-selected')).toBe('true');
        expect(password.getAttribute('aria-selected')).toBe('false');
    });

    it('pairs tab ↔ tabpanel via aria-controls / aria-labelledby', () => {
        renderTabs();
        const accountTab = screen.getByRole('tab', { name: 'Account' });
        const accountPanel = screen.getByRole('tabpanel', { name: 'Account' });

        // Tab points at the panel (aria-controls == panel id).
        expect(accountTab.getAttribute('aria-controls')).toBe(accountPanel.getAttribute('id'));
        // Panel points back at the tab (aria-labelledby == tab id).
        expect(accountPanel.getAttribute('aria-labelledby')).toBe(accountTab.getAttribute('id'));
        // Radix only renders the active panel by default.
        expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    });

    it('ArrowRight moves focus to (and selects) the next tab', async () => {
        renderTabs();
        const account = screen.getByRole('tab', { name: 'Account' });
        const password = screen.getByRole('tab', { name: 'Password' });
        // Radix RovingFocus defers the focus move to a setTimeout; wrap the event
        // + flush in act() so the resulting state update is captured cleanly.
        await act(async () => {
            account.focus();
            fireEvent.keyDown(account, { key: 'ArrowRight' });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        // Focus moved + Password became active (automatic activation on focus).
        expect(password).toHaveFocus();
        expect(password.getAttribute('aria-selected')).toBe('true');
        expect(account.getAttribute('aria-selected')).toBe('false');
    });

    it('ArrowLeft moves focus to (and selects) the previous tab', async () => {
        renderTabs();
        const account = screen.getByRole('tab', { name: 'Account' });
        const password = screen.getByRole('tab', { name: 'Password' });
        const settings = screen.getByRole('tab', { name: 'Settings' });
        // Move focus to Settings (last) so ArrowLeft has somewhere to go.
        await act(async () => {
            settings.focus();
            fireEvent.keyDown(settings, { key: 'ArrowLeft' });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(password).toHaveFocus();
        expect(password.getAttribute('aria-selected')).toBe('true');
        expect(account.getAttribute('aria-selected')).toBe('false');
    });

    it('Home jumps to the first tab, End to the last', async () => {
        renderTabs();
        const account = screen.getByRole('tab', { name: 'Account' });
        const settings = screen.getByRole('tab', { name: 'Settings' });

        // From the last tab, Home → first.
        await act(async () => {
            settings.focus();
            fireEvent.keyDown(settings, { key: 'Home' });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(account).toHaveFocus();
        expect(account.getAttribute('aria-selected')).toBe('true');

        // From the first tab, End → last.
        await act(async () => {
            fireEvent.keyDown(account, { key: 'End' });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(settings).toHaveFocus();
        expect(settings.getAttribute('aria-selected')).toBe('true');
    });

    it('fires onValueChange in controlled mode', () => {
        const onValueChange = vi.fn();
        render(
            <Tabs value="account" onValueChange={onValueChange}>
                <TabsList>
                    <TabsTrigger value="account">Account</TabsTrigger>
                    <TabsTrigger value="password">Password</TabsTrigger>
                </TabsList>
                <TabsContent value="account">Account panel</TabsContent>
                <TabsContent value="password">Password panel</TabsContent>
            </Tabs>,
        );
        // value is controlled ("account"); activating Password (via mousedown, per
        // Radix Tabs Trigger) must fire onValueChange.
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Password' }));
        expect(onValueChange).toHaveBeenCalledTimes(1);
        expect(onValueChange).toHaveBeenCalledWith('password');
        // Selection stays on account (controlled — we never applied the state).
        expect(screen.getByRole('tab', { name: 'Account' }).getAttribute('aria-selected')).toBe(
            'true',
        );
    });

    it('forceMount keeps an inactive panel in the DOM', () => {
        render(
            <Tabs defaultValue="account">
                <TabsList>
                    <TabsTrigger value="account">Account</TabsTrigger>
                    <TabsTrigger value="password">Password</TabsTrigger>
                </TabsList>
                {/* forceMount: Password panel stays mounted even though inactive. */}
                <TabsContent value="account">Account panel</TabsContent>
                <TabsContent value="password" forceMount>
                    Password panel
                </TabsContent>
            </Tabs>,
        );

        // Password is NOT selected, but its forceMount panel is still present.
        expect(screen.getByRole('tab', { name: 'Password' }).getAttribute('aria-selected')).toBe(
            'false',
        );
        expect(screen.getByText('Password panel')).toBeInTheDocument();

        // With forceMount, both panels exist in the DOM (the inactive one is hidden).
        expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2);
    });
});
