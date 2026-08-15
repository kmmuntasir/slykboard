// SLYK-0390 — <NotificationPreferences> test suite.
//
// Mocking strategy: api/notificationPreferences is mocked so a REAL React
// Query drives the component (load → draft sync → save round-trip runs
// through real query/mutation internals, per the OnboardingTimeline
// precedent). The runtime-config store is driven through the real Zustand
// store (setState), and toasts through the real useToast surface.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useRuntimeConfigStore } from '@/stores/useRuntimeConfigStore';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        get: vi.fn(),
        save: vi.fn(),
    },
}));

vi.mock('@/api/notificationPreferences', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/api/notificationPreferences')>();
    return {
        ...actual,
        notificationPreferenceApi: {
            get: (...args: unknown[]) => mocks.get(...args),
            save: (...args: unknown[]) => mocks.save(...args),
        },
    };
});

import { NotificationPreferences } from './NotificationPreferences';

const toastCalls: { message: string; kind: string }[] = [];
vi.mock('@/hooks/useToast', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/hooks/useToast')>();
    return {
        ...actual,
        useToast: () => ({
            success: (message: string) => toastCalls.push({ message, kind: 'success' }),
            error: (message: string) => toastCalls.push({ message, kind: 'error' }),
        }),
    };
});

let queryClient: QueryClient;

function renderPreferences(slug = 'inventory-tracker') {
    return render(
        <QueryClientProvider client={queryClient}>
            <NotificationPreferences projectSlug={slug} />
        </QueryClientProvider>,
    );
}

function defaults() {
    return { notifyOnDone: true, notifyOnBlockedHuman: true, notifyOnAgentWaiting: true };
}

beforeEach(() => {
    vi.clearAllMocks();
    toastCalls.length = 0;
    useRuntimeConfigStore.setState({ agentMode: true, dispatcherUrl: null });
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
});

afterEach(() => {
    cleanup();
    queryClient.clear();
    useRuntimeConfigStore.setState({ agentMode: false, dispatcherUrl: null });
});

describe('NotificationPreferences — render', () => {
    it('loads via GET and renders the three toggles from the response', async () => {
        mocks.get.mockResolvedValue(defaults());

        renderPreferences();

        expect(mocks.get).toHaveBeenCalledWith('inventory-tracker');
        for (const label of [
            'Ticket deployed',
            'Blocked — needs human help',
            'Agent has a question',
        ]) {
            expect(await screen.findByRole('checkbox', { name: label })).toBeChecked();
        }
    });

    it('renders unchecked for flags the server reports false', async () => {
        mocks.get.mockResolvedValue({
            notifyOnDone: false,
            notifyOnBlockedHuman: false,
            notifyOnAgentWaiting: false,
        });

        renderPreferences();

        expect(await screen.findByRole('checkbox', { name: 'Ticket deployed' })).not.toBeChecked();
        expect(
            screen.getByRole('checkbox', { name: 'Blocked — needs human help' }),
        ).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Agent has a question' })).not.toBeChecked();
    });

    it('renders nothing in plain mode (agentMode=false)', () => {
        useRuntimeConfigStore.setState({ agentMode: false, dispatcherUrl: null });
        mocks.get.mockResolvedValue(defaults());

        const { container } = renderPreferences();

        expect(container.querySelector('section')).toBeNull();
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it('query error renders the failure note, not a crash', async () => {
        mocks.get.mockRejectedValue(new Error('network down'));

        renderPreferences();

        expect(await screen.findByText(/Failed to load notification preferences/i)).toBeTruthy();
    });
});

describe('NotificationPreferences — save round-trip', () => {
    it('toggling + Save PUTs the full trio and toasts on success', async () => {
        mocks.get.mockResolvedValue(defaults());
        mocks.save.mockResolvedValue({
            notifyOnDone: false,
            notifyOnBlockedHuman: true,
            notifyOnAgentWaiting: true,
        });

        renderPreferences();

        // Wait for the loaded (non-disabled) checkbox before toggling.
        const done = await waitFor(() => {
            const box = screen.getByRole('checkbox', { name: 'Ticket deployed' });
            expect(box).toBeEnabled();
            return box;
        });
        fireEvent.click(done);

        const save = screen.getByRole('button', { name: 'Save preferences' });
        await waitFor(() => expect(save).toBeEnabled());
        fireEvent.click(save);

        await waitFor(() => {
            expect(mocks.save).toHaveBeenCalledTimes(1);
        });
        expect(mocks.save).toHaveBeenCalledWith('inventory-tracker', {
            notifyOnDone: false,
            notifyOnBlockedHuman: true,
            notifyOnAgentWaiting: true,
        });
        expect(toastCalls).toContainEqual({
            message: 'Notification preferences saved',
            kind: 'success',
        });
    });

    it('no toggles → Save stays disabled (nothing dirty)', async () => {
        mocks.get.mockResolvedValue(defaults());

        renderPreferences();

        await screen.findByRole('checkbox', { name: 'Ticket deployed' });

        expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it('toggling twice restores the saved state → Save disabled again', async () => {
        mocks.get.mockResolvedValue(defaults());

        renderPreferences();

        const done = await screen.findByRole('checkbox', { name: 'Ticket deployed' });
        fireEvent.click(done);
        expect(screen.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
        fireEvent.click(done);

        expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    });
});
