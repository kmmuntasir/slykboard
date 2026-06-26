import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import {
    Layers,
    LayoutGrid,
    BarChart3,
    Settings,
    LogOut,
    Sun,
    Monitor,
    Moon,
    Check,
} from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { logout } from '@/api/auth';
import { useRequireRole } from '@/hooks/useRequireRole';
import { broadcastLogout } from '@/hooks/useCrossTabLogout';
import { cn } from '@/components/ui/cn';
import { Avatar } from '@/components/ui/Avatar';
import {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownLabel,
    DropdownSeparator,
    DropdownItem,
} from '@/components/ui/Dropdown';
import { ProjectPicker } from './ProjectPicker';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/hooks/useTheme';

// F37 — Full-width navbar: shared px-4 md:px-6 gutter, Layers brand mark,
// left/center/right clusters, lucide nav icons, ProjectPicker moved left,
// inline avatar + Sign out kept right (F39 swaps). Mobile: nav collapses into a
// slide-down panel with a hand-rolled focus trap (D11). Board keeps its own
// internal horizontal scroll; the gutter governs chrome only (PRD §4.1).

interface NavLinkItem {
    to: string;
    label: string;
    end: boolean;
    icon: typeof LayoutGrid;
}

const PUBLIC_NAV_LINKS: readonly NavLinkItem[] = [
    { to: '/', label: 'Board', end: true, icon: LayoutGrid },
    { to: '/reports', label: 'Reports', end: false, icon: BarChart3 },
] as const;

const ADMIN_NAV_LINKS: readonly NavLinkItem[] = [
    { to: '/settings', label: 'Settings', end: false, icon: Settings },
] as const;

// D11 — visible focusable selector (borrows the pattern from useModalA11y.ts:20-21).
// Hand-rolled (NOT useModalA11y — that hook inerts #app-root + scroll-locks body,
// which is too heavy for a nav slide-down panel).
const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TopNav() {
    const [open, setOpen] = useState(false);
    const user = useAuthStore((s) => s.user);
    const clear = useAuthStore((s) => s.clear);
    const isAdmin = useRequireRole('ADMIN');
    const navigate = useNavigate();
    // F40 — single source of truth for theme. Both the navbar segmented control
    // and the profile-menu mirror read this same Context (D3/D5: no local state).
    const { theme, setTheme } = useTheme();

    // D11 — slide-down panel refs + trap state.
    const panelRef = useRef<HTMLDivElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const lastFocusedRef = useRef<HTMLElement | null>(null);

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

    const closePanel = () => setOpen(false);

    // D11 — when the panel opens: remember the trigger, no scroll-lock (nav panel
    // must not freeze the page). When it closes: restore focus to the trigger.
    // Tab wrap (first <-> last) + Esc + outside-click are handled in the keydown
    // and pointerdown effects below.
    useEffect(() => {
        if (!open) return;
        lastFocusedRef.current = document.activeElement as HTMLElement | null;

        const onKeyDown = (e: KeyboardEvent) => {
            const panel = panelRef.current;
            if (!panel) return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                closePanel();
                return;
            }
            if (e.key !== 'Tab') return;
            const tabbables = Array.from(
                panel.querySelectorAll<HTMLElement>(TABBABLE),
            );
            if (tabbables.length === 0) return;
            const first = tabbables[0]!;
            const last = tabbables[tabbables.length - 1]!;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        const onPointerDown = (e: MouseEvent) => {
            const panel = panelRef.current;
            const toggle = toggleRef.current;
            if (!panel) return;
            if (panel.contains(e.target as Node)) return;
            if (toggle?.contains(e.target as Node)) return;
            closePanel();
        };

        document.addEventListener('keydown', onKeyDown, { capture: true });
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown, { capture: true });
            document.removeEventListener('pointerdown', onPointerDown);
            // Restore focus to the toggle when the panel closes.
            lastFocusedRef.current?.focus();
        };
    }, [open]);

    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        cn(
            'flex items-center gap-1.5 text-sm',
            isActive ? 'text-primary' : 'text-muted hover:text-foreground',
        );

    const navItems = (
        <ul className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
            {PUBLIC_NAV_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                    <li key={link.to}>
                        <NavLink
                            to={link.to}
                            end={link.end}
                            onClick={() => setOpen(false)}
                            className={navLinkClass}
                        >
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            <span>{link.label}</span>
                        </NavLink>
                    </li>
                );
            })}
            {isAdmin &&
                ADMIN_NAV_LINKS.map((link) => {
                    const Icon = link.icon;
                    return (
                        <li key={link.to}>
                            <NavLink
                                to={link.to}
                                end={link.end}
                                onClick={() => setOpen(false)}
                                className={navLinkClass}
                            >
                                <Icon className="h-4 w-4" aria-hidden="true" />
                                <span>{link.label}</span>
                            </NavLink>
                        </li>
                    );
                })}
        </ul>
    );

    const brand = (
        <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">Slykboard</span>
        </div>
    );

    // F39 — Avatar → profile Dropdown. The inline img/initials + flat "Sign out"
    // button (F37) is replaced by an F36 Dropdown whose trigger is an F35 Avatar
    // (md, D4). Header: "Signed in as" + name + email. Sign out is a destructive
    // DropdownItem (D3) calling the existing handleSignOut VERBATIM (§10 untouched).
    // Theme toggle OMITTED (D2 — F40 owns the navbar toggle; PRD §4.4 permits).
    const avatarBlock = user && (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    aria-label="Account menu"
                    aria-haspopup="menu"
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Avatar
                        src={user.avatarUrl}
                        name={user.name || user.email}
                        size="md"
                    />
                </button>
            </DropdownTrigger>
            <DropdownContent align="end" className="min-w-[14rem]">
                <DropdownLabel>
                    <div className="flex items-center gap-2">
                        <Avatar
                            src={user.avatarUrl}
                            name={user.name || user.email}
                            size="sm"
                        />
                        <div className="flex flex-col">
                            <span className="text-xs font-normal text-muted-foreground">
                                Signed in as
                            </span>
                            <span className="text-sm font-semibold text-foreground">
                                {user.name || user.email}
                            </span>
                            <span className="truncate text-xs font-normal text-muted-foreground">
                                {user.email}
                            </span>
                        </div>
                    </div>
                </DropdownLabel>
                <DropdownSeparator />
                {/* F40 (D5) — profile-menu mirror. Same useTheme Context as the navbar
                    segmented control (no divergent state). Check icon marks the active theme. */}
                <DropdownLabel>Theme</DropdownLabel>
                <DropdownItem onSelect={() => setTheme('light')}>
                    <Sun className="h-4 w-4" aria-hidden="true" />
                    <span>Light</span>
                    {theme === 'light' && (
                        <Check className="ml-auto h-4 w-4" aria-hidden="true" />
                    )}
                </DropdownItem>
                <DropdownItem onSelect={() => setTheme('system')}>
                    <Monitor className="h-4 w-4" aria-hidden="true" />
                    <span>System</span>
                    {theme === 'system' && (
                        <Check className="ml-auto h-4 w-4" aria-hidden="true" />
                    )}
                </DropdownItem>
                <DropdownItem onSelect={() => setTheme('dark')}>
                    <Moon className="h-4 w-4" aria-hidden="true" />
                    <span>Dark</span>
                    {theme === 'dark' && (
                        <Check className="ml-auto h-4 w-4" aria-hidden="true" />
                    )}
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem variant="destructive" onSelect={handleSignOut}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    <span>Sign out</span>
                </DropdownItem>
            </DropdownContent>
        </Dropdown>
    );

    return (
        <header className="border-b border-border bg-background">
            <div className="px-4 py-3 md:px-6">
                {/* Desktop: 3 clusters in one row, brand left / nav center / actions right. */}
                <nav
                    aria-label="Primary"
                    className="flex items-center justify-between gap-4"
                >
                    {/* Left cluster: brand + ProjectPicker (moved from right per §4.2). */}
                    <div className="flex items-center gap-4">
                        {brand}
                        <ProjectPicker />
                    </div>

                    {/* Center cluster: primary nav (desktop). */}
                    <div className="hidden md:flex">{navItems}</div>

                    {/* Right cluster: theme slot (F40) + avatar (F39 swaps). */}
                    <div className="flex items-center gap-3">
                        {/* F40 — fill the F37 theme slot with the reusable segmented control. */}
                        <ThemeToggle />
                        {avatarBlock}
                        <button
                            ref={toggleRef}
                            type="button"
                            className="md:hidden"
                            aria-expanded={open}
                            aria-controls="mobile-nav-panel"
                            aria-label="Toggle navigation"
                            onClick={() => setOpen((v) => !v)}
                        >
                            <span aria-hidden="true">{open ? 'Close' : 'Menu'}</span>
                        </button>
                    </div>
                </nav>

                {/* Mobile slide-down panel (D11 focus trap). The panel shell always */}
                {/* exists so aria-controls resolves; the links mount only when open so a */}
                {/* closed panel contributes no focusable/queryable links (the D11 intent: */}
                {/* when closed, links are out of tab order). When open they are trapped. */}
                <div
                    ref={panelRef}
                    id="mobile-nav-panel"
                    className={cn(
                        open ? 'block' : 'hidden',
                        'md:hidden',
                    )}
                >
                    {open && navItems}
                </div>
            </div>
        </header>
    );
}
