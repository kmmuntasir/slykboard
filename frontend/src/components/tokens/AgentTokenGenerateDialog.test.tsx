// SLYK-0380 — <AgentTokenGenerateDialog> test suite.
//
// Mocking strategy (mirrors DecommissionDialog.test.tsx): api/agentTokens is
// mocked so a real React Query mutation runs; useToast is mocked to keep
// sonner out of jsdom.
//
// Coverage per the ticket: show-once gate (Close disabled until the
// acknowledgement is checked, acknowledgement disabled until copied), copy
// button flip, generate payload, error rendering, reset on reopen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        generate: vi.fn(),
        toastSuccess: vi.fn(),
        toastError: vi.fn(),
    },
}));

vi.mock('@/api/agentTokens', () => ({
    agentTokenApi: {
        generate: mocks.generate,
        list: vi.fn(),
        revoke: vi.fn(),
    },
    agentTokenKeys: { all: ['agent-tokens'] },
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
    toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { AgentTokenGenerateDialog } from './AgentTokenGenerateDialog';

// Fresh client per test — invalidation assertions must not leak cache state.
let queryClient: QueryClient;

function renderDialog(props: Partial<{ isOpen: boolean; onClose: () => void }> = {}) {
    return render(
        <QueryClientProvider client={queryClient}>
            <AgentTokenGenerateDialog
                isOpen={props.isOpen ?? true}
                onClose={props.onClose ?? vi.fn()}
                projects={[]}
            />
        </QueryClientProvider>,
    );
}

function nameInput(): HTMLInputElement {
    return screen.getByLabelText(/Name/i) as HTMLInputElement;
}

beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
});

afterEach(() => cleanup());

describe('AgentTokenGenerateDialog', () => {
    it('generate is disabled until a name is entered', () => {
        renderDialog();

        const submit = screen.getByRole('button', { name: /Generate token/i }) as HTMLButtonElement;
        expect(submit).toBeDisabled();

        fireEvent.change(nameInput(), { target: { value: 'dispatcher-prod' } });
        expect(submit).not.toBeDisabled();
    });

    it('posts the trimmed name and renders the raw token exactly once', async () => {
        mocks.generate.mockResolvedValue({
            token: 'a'.repeat(64),
            id: 'tok-1',
            name: 'dispatcher-prod',
        });
        renderDialog();

        fireEvent.change(nameInput(), { target: { value: '  dispatcher-prod  ' } });
        fireEvent.click(screen.getByRole('button', { name: /Generate token/i }));

        await waitFor(() => {
            expect(screen.getByTestId('generated-token')).toHaveTextContent('a'.repeat(64));
        });
        expect(mocks.generate).toHaveBeenCalledWith({ name: 'dispatcher-prod', projectId: null });
        // The form step is gone — no way to regenerate the same reveal.
        expect(screen.queryByLabelText(/Name/i)).toBeNull();
    });

    it('Close stays disabled until the token is copied and acknowledged', async () => {
        mocks.generate.mockResolvedValue({
            token: 'b'.repeat(64),
            id: 'tok-2',
            name: 't2',
        });
        renderDialog();
        fireEvent.change(nameInput(), { target: { value: 't2' } });
        fireEvent.click(screen.getByRole('button', { name: /Generate token/i }));
        await waitFor(() => screen.getByTestId('generated-token'));

        const close = screen.getByRole('button', { name: /^Close$/i }) as HTMLButtonElement;
        const ack = screen.getByRole('checkbox') as HTMLInputElement;
        expect(close).toBeDisabled();
        // Acknowledgement itself is gated on the copy having happened.
        expect(ack).toBeDisabled();

        // Clipboard is unavailable in jsdom → the fallback selection path
        // still flips `copied`.
        fireEvent.click(screen.getByRole('button', { name: /Copy token/i }));
        await waitFor(() => expect(ack).not.toBeDisabled());
        expect(close).toBeDisabled();

        fireEvent.click(ack);
        expect(close).not.toBeDisabled();
    });

    it('generate error renders inline and keeps the form open', async () => {
        mocks.generate.mockRejectedValue(new Error('Name already used'));
        renderDialog();

        fireEvent.change(nameInput(), { target: { value: 'dup' } });
        fireEvent.click(screen.getByRole('button', { name: /Generate token/i }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Name already used');
        });
        expect(screen.getByLabelText(/Name/i)).toBeTruthy();
    });

    it('reopening resets both steps', async () => {
        mocks.generate.mockResolvedValue({
            token: 'c'.repeat(64),
            id: 'tok-3',
            name: 't3',
        });
        const onClose = vi.fn();
        const { rerender } = renderDialog({ onClose });

        fireEvent.change(nameInput(), { target: { value: 't3' } });
        fireEvent.click(screen.getByRole('button', { name: /Generate token/i }));
        await waitFor(() => screen.getByTestId('generated-token'));

        // Close → reopen: back to a blank form.
        rerender(
            <QueryClientProvider client={queryClient}>
                <AgentTokenGenerateDialog isOpen={false} onClose={onClose} projects={[]} />
            </QueryClientProvider>,
        );
        rerender(
            <QueryClientProvider client={queryClient}>
                <AgentTokenGenerateDialog isOpen projects={[]} onClose={onClose} />
            </QueryClientProvider>,
        );

        expect(nameInput().value).toBe('');
        expect(screen.queryByTestId('generated-token')).toBeNull();
    });
});
