import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '@/stores/useAuthStore';
import { loginWithGoogle } from '@/api/auth';
import type { AuthResponse } from '@/api/auth';
import { ApiClientError } from '@/api/client';

export function LoginPage() {
    const setUser = useAuthStore((s) => s.setUser);
    const navigate = useNavigate();
    const location = useLocation();
    const [error, setError] = useState<string | null>(null);

    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

    const handleLogin = useGoogleLogin({
        flow: 'auth-code',
        onSuccess: async ({ code }) => {
            try {
                const { token, user }: AuthResponse = await loginWithGoogle(code);
                setUser({
                    token,
                    id: user.id,
                    email: user.email,
                    name: user.fullName,
                    role: user.role,
                    avatarUrl: user.avatarUrl,
                    blocked: false,
                });
                navigate(from, { replace: true });
            } catch (err) {
                if (err instanceof ApiClientError) {
                    if (err.code === 'FORBIDDEN') {
                        // F06 D8: domain restriction. Specialized message — actionable for the user.
                        setError(
                            'Your Google account is not in the allowed workspace. ' +
                                'Sign in with your workspace email or contact your administrator.',
                        );
                    } else {
                        setError(err.message);
                    }
                } else {
                    setError('Login failed');
                }
            }
        },
        onError: () => setError('Google sign-in was cancelled or failed'),
    });

    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
            <h1 className="text-2xl font-semibold text-foreground">Sign in to Slykboard</h1>
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
            <button
                type="button"
                onClick={() => handleLogin()}
                className="rounded bg-primary px-6 py-3 text-sm font-medium text-background"
            >
                Sign in with Google
            </button>
        </div>
    );
}
