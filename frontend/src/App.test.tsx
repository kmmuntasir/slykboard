import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { BoardPage } from '@/pages/BoardPage';
import { LoginPage } from '@/pages/LoginPage';
import { useAuthStore } from '@/stores/useAuthStore';

function renderShell(initialEntry = '/') {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[initialEntry]}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route element={<RequireAuth />}>
                        <Route element={<AppLayout />}>
                            <Route path="/" element={<BoardPage />} />
                        </Route>
                    </Route>
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('App shell', () => {
    beforeEach(() => {
        useAuthStore.getState().clear();
        vi.restoreAllMocks();
    });

    it('redirects unauthenticated user to /login', () => {
        renderShell('/');
        expect(screen.getByRole('heading', { name: /sign in to slykboard/i })).toBeInTheDocument();
    });

    it('renders top nav and board page when authenticated', () => {
        useAuthStore.getState().setUser({
            token: 't',
            email: 'e@x',
            name: 'Test',
        });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: 'ok', service: 'x' }), {
                status: 200,
            }),
        );
        renderShell('/');
        expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
    });
});
