import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useGoogleLogin } from '@react-oauth/google';
import { LoginPage } from './LoginPage';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useAuthStore } from '@/stores/useAuthStore';
import { ApiClientError } from '@/api/client';
import type { AuthResponse } from '@/api/auth';

const { loginWithGoogleMock, navigateMock } = vi.hoisted(() => ({
    loginWithGoogleMock: vi.fn(),
    navigateMock: vi.fn(),
}));

vi.mock('@/api/auth', () => ({ loginWithGoogle: loginWithGoogleMock }));

vi.mock('react-router', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router')>();
    return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@react-oauth/google', () => ({
    useGoogleLogin: vi.fn(),
}));

const defaultAuthResponse: AuthResponse = {
    token: 'jwt',
    user: {
        id: 'u1',
        email: 'user@slykboard.local',
        fullName: 'Jane Doe',
        avatarUrl: null,
        role: 'MEMBER',
    },
};

interface GoogleLoginOpts {
    flow?: string;
    onSuccess?: (resp: { code?: string }) => void | Promise<void>;
    onError?: () => void;
}

function readGoogleLoginOpts(): GoogleLoginOpts {
    const opts = vi.mocked(useGoogleLogin).mock.calls.at(-1)?.[0];
    return (opts ?? {}) as GoogleLoginOpts;
}

function renderLogin(initialEntries: Parameters<typeof MemoryRouter>[0]['initialEntries']) {
    return render(
        // F40 — LoginPage now mounts <ThemeToggle /> (calls useTheme); must be inside
        // <ThemeProvider> or every test throws "must be used within ThemeProvider".
        <ThemeProvider>
            <MemoryRouter initialEntries={initialEntries}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/" element={<div>home</div>} />
                    <Route path="/reports" element={<div>reports</div>} />
                </Routes>
            </MemoryRouter>
        </ThemeProvider>,
    );
}

describe('LoginPage', () => {
    beforeEach(() => {
        useAuthStore.getState().clear();
        navigateMock.mockClear();
        loginWithGoogleMock.mockReset();
        loginWithGoogleMock.mockResolvedValue(defaultAuthResponse);
        vi.mocked(useGoogleLogin).mockReset();
        vi.mocked(useGoogleLogin).mockImplementation(
            () => (() => {}) as unknown as ReturnType<typeof useGoogleLogin>,
        );
    });

    it('renders Sign in with Google button', () => {
        renderLogin(['/login']);
        expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    });

    it('calls loginWithGoogle with the auth code on success', async () => {
        renderLogin(['/login']);
        // LoginPage invoked useGoogleLogin at render; capture its opts and
        // simulate the GIS success callback the button click would trigger.
        const opts = readGoogleLoginOpts();
        fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }));
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        expect(loginWithGoogleMock).toHaveBeenCalledWith('test-code');
    });

    it('sets user and navigates on success', async () => {
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        const user = useAuthStore.getState().user;
        expect(user).not.toBeNull();
        expect(user?.token).toBe('jwt');
        expect(user?.id).toBe('u1');
        expect(user?.email).toBe('user@slykboard.local');
        expect(user?.name).toBe('Jane Doe');
        expect(user?.role).toBe('MEMBER');
        expect(user?.avatarUrl).toBeNull();
        expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });

    it('shows error on ApiClientError', async () => {
        loginWithGoogleMock.mockRejectedValueOnce(new ApiClientError('boom', 500, 'NETWORK_ERROR'));
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('boom');
        expect(useAuthStore.getState().user).toBeNull();
    });

    it('shows specialized workspace message on FORBIDDEN', async () => {
        loginWithGoogleMock.mockRejectedValueOnce(
            new ApiClientError(
                'Your Google account is not in the allowed workspace',
                403,
                'FORBIDDEN',
            ),
        );
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Your Google account is not in the allowed workspace. Sign in with your workspace email',
        );
    });

    it('shows generic message on UNAUTHENTICATED (unverified email)', async () => {
        loginWithGoogleMock.mockRejectedValueOnce(
            new ApiClientError('Email not verified by Google', 401, 'UNAUTHENTICATED'),
        );
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Email not verified by Google');
        expect(alert).not.toHaveTextContent('allowed workspace');
    });

    it('shows generic message on INTERNAL_ERROR', async () => {
        loginWithGoogleMock.mockRejectedValueOnce(
            new ApiClientError('Authentication failed', 500, 'INTERNAL_ERROR'),
        );
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Authentication failed');
    });

    it('shows "Login failed" on non-ApiClientError', async () => {
        loginWithGoogleMock.mockRejectedValueOnce(new Error('network'));
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Login failed');
    });

    it('shows error on GIS onError', async () => {
        renderLogin(['/login']);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            opts.onError?.();
        });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/cancelled or failed/i);
    });

    it('respects from: location state', async () => {
        renderLogin([
            {
                pathname: '/login',
                state: { from: { pathname: '/reports' } },
            },
        ]);
        const opts = readGoogleLoginOpts();
        await act(async () => {
            await opts.onSuccess?.({ code: 'test-code' });
        });
        expect(navigateMock).toHaveBeenCalledWith('/reports', { replace: true });
    });
});
