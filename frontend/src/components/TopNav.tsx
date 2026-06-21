import { useState } from 'react';
import { NavLink } from 'react-router';

const NAV_LINKS = [
    { to: '/', label: 'Board', end: true },
    { to: '/reports', label: 'Reports', end: false },
    { to: '/settings', label: 'Settings', end: false },
] as const;

export function TopNav() {
    const [open, setOpen] = useState(false);

    return (
        <header className="border-b border-border bg-background">
            <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <span className="text-lg font-semibold">Slykboard</span>
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
                    {NAV_LINKS.map((link) => (
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
            </nav>
        </header>
    );
}
