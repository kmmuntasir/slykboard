import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/useAuthStore';
import { logout } from '@/api/auth';
import { useRequireRole } from '@/hooks/useRequireRole';
import { broadcastLogout } from '@/hooks/useCrossTabLogout';

const PUBLIC_NAV_LINKS = [
    { to: '/', label: 'Board', end: true },
    { to: '/reports', label: 'Reports', end: false },
] as const;

const ADMIN_NAV_LINKS = [{ to: '/settings', label: 'Settings', end: false }] as const;

function getInitials(name: string, email: string): string {
    const source = name || email.split('@')[0] || '?';
    return source.slice(0, 2).toUpperCase();
}

export function TopNav() {
    const [open, setOpen] = useState(false);
    const user = useAuthStore((s) => s.user);
    const clear = useAuthStore((s) => s.clear);
    const isAdmin = useRequireRole('ADMIN');
    const navigate = useNavigate();

    const handleSignOut = async () => {
        try {
            await logout();
        } catch {
            // /logout 401/500 === already logged out; clear locally regardless.
        }
        clear();
        broadcastLogout();
        navigate('/login', { replace: true });
    };

    return (
        <header className="border-b border-border bg-background">
            <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <span className="text-lg font-semibold">Slykboard</span>
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        className="md:hidden"
                        aria-expanded={open}
                        aria-label="Toggle navigation"
                        onClick={() => setOpen((v) => !v)}
                    >
                        <span aria-hidden="true">{open ? 'Close' : 'Menu'}</span>
                    </button>
                    <ul
                        className={`${
                            open ? 'flex' : 'hidden'
                        } flex-col gap-2 md:flex md:flex-row md:items-center md:gap-6`}
                    >
                        {PUBLIC_NAV_LINKS.map((link) => (
                            <li key={link.to}>
                                <NavLink
                                    to={link.to}
                                    end={link.end}
                                    onClick={() => setOpen(false)}
                                    className={({ isActive }) =>
                                        `text-sm ${isActive ? 'text-primary' : 'text-muted'}`
                                    }
                                >
                                    {link.label}
                                </NavLink>
                            </li>
                        ))}
                        {isAdmin &&
                            ADMIN_NAV_LINKS.map((link) => (
                                <li key={link.to}>
                                    <NavLink
                                        to={link.to}
                                        end={link.end}
                                        onClick={() => setOpen(false)}
                                        className={({ isActive }) =>
                                            `text-sm ${isActive ? 'text-primary' : 'text-muted'}`
                                        }
                                    >
                                        {link.label}
                                    </NavLink>
                                </li>
                            ))}
                    </ul>
                    {user && (
                        <div className="flex items-center gap-3">
                            {user.avatarUrl ? (
                                <img
                                    src={user.avatarUrl}
                                    alt={user.name}
                                    className="h-8 w-8 rounded-full"
                                />
                            ) : (
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-background">
                                    {getInitials(user.name, user.email)}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="text-sm text-muted hover:text-foreground"
                            >
                                Sign out
                            </button>
                        </div>
                    )}
                </div>
            </nav>
        </header>
    );
}
