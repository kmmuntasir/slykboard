import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/useAuthStore';

export function LoginPage() {
    const setUser = useAuthStore((s) => s.setUser);
    const navigate = useNavigate();

    const handlePlaceholderLogin = () => {
        setUser({
            token: 'placeholder-token',
            email: 'demo@slykboard.local',
            name: 'Demo User',
        });
        navigate('/', { replace: true });
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
            <h1 className="text-2xl font-semibold">Sign in to Slykboard</h1>
            <p className="text-sm text-muted">
                Google SSO arrives in F05. Use the button below to enter the app.
            </p>
            <button
                type="button"
                onClick={handlePlaceholderLogin}
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-background"
            >
                Continue (demo)
            </button>
        </div>
    );
}
