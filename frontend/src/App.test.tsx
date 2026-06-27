import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { BoardPage } from '@/pages/BoardPage';
import { LoginPage } from '@/pages/LoginPage';
import { useAuthStore } from '@/stores/useAuthStore';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/Tooltip';

vi.mock('@react-oauth/google', () => ({
    useGoogleLogin: vi.fn(() => () => {}),
}));

// F09: BoardPage now reads :slug + calls useBoard. The shell test renders a
// real board, so mock the hook and route at /projects/:slug to exercise the
// success path (heading = project name "Board").
const { mockBoardValue } = vi.hoisted(() => ({
    mockBoardValue: {
        data: {
            project: { id: 'p1', name: 'Board', slug: 'SLYK' },
            columns: [],
        },
        isLoading: false,
    },
}));

vi.mock('@/hooks/useBoard', () => ({
    useBoard: () => mockBoardValue,
}));

function renderShell(initialEntry = '/') {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
        <QueryClientProvider client={client}>
            <ThemeProvider>
                <TooltipProvider>
                    <MemoryRouter initialEntries={[initialEntry]}>
                        <Routes>
                            <Route path="/login" element={<LoginPage />} />
                            <Route element={<RequireAuth />}>
                                <Route element={<AppLayout />}>
                                    <Route path="/" element={<BoardPage />} />
                                    <Route path="/projects/:slug" element={<BoardPage />} />
                                </Route>
                            </Route>
                        </Routes>
                    </MemoryRouter>
                </TooltipProvider>
            </ThemeProvider>
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
        // Valid decodable JWT with far-future exp so RequireAuth's isTokenExpired passes.
        const validJwt = 'eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.';
        useAuthStore.getState().setUser({
            token: validJwt,
            id: 'u1',
            email: 'e@x',
            name: 'Test',
            role: 'MEMBER',
            avatarUrl: null,
            blocked: false,
        });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/projects')) {
                return new Response(JSON.stringify({ data: [] }), { status: 200 });
            }
            return new Response(JSON.stringify({ status: 'ok', service: 'x' }), { status: 200 });
        });
        renderShell('/projects/SLYK');
        expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
    });
});
