import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouteErrorBoundary } from './RouteErrorBoundary';

function renderWithClient(ui: React.ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

let shouldThrow = false;

function ToggleChild() {
    if (shouldThrow) throw new Error('boom');
    return <div>child content</div>;
}

describe('RouteErrorBoundary', () => {
    afterEach(() => {
        shouldThrow = false;
    });

    it('renders children when no error', () => {
        renderWithClient(
            <RouteErrorBoundary>
                <ToggleChild />
            </RouteErrorBoundary>,
        );

        expect(screen.getByText('child content')).toBeInTheDocument();
    });

    it('renders fallback on throw and resets to children', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        shouldThrow = true;

        renderWithClient(
            <RouteErrorBoundary>
                <ToggleChild />
            </RouteErrorBoundary>,
        );

        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

        // clear the throw condition, then reset
        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));

        expect(screen.getByText('child content')).toBeInTheDocument();

        spy.mockRestore();
    });
});
