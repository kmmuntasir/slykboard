import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HealthBadge } from './HealthBadge';

function renderWithClient() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
        <QueryClientProvider client={client}>
            <HealthBadge />
        </QueryClientProvider>,
    );
}

describe('HealthBadge', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows Healthy when /health returns status ok', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
                status: 200,
            }),
        );
        renderWithClient();
        expect(await screen.findByText('Healthy')).toBeInTheDocument();
    });

    it('shows Unhealthy when fetch rejects', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
        renderWithClient();
        expect(await screen.findByText('Unhealthy')).toBeInTheDocument();
    });
});
