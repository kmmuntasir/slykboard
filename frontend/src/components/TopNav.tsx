import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import {
    Activity,
    Layers,
    LayoutGrid,
    BarChart3,
    Settings,
    User,
    LogOut,
    Sun,
    Monitor,
    Moon,
    Check,
} from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { logout } from '@/api/auth';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useCurrentProjectMembership } from '@/hooks/useProjectMembers';
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
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/Tooltip';
import { ProjectPicker } from './ProjectPicker';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/hooks/useTheme';
import { useHealth } from '@/hooks/useHealth';

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
    // F49: Reports target is project-scoped; the `to` here is nominal — the
    // render loop builds the real href from the resolved projectSlug.
    { to: '/projects/:slug/reports', label: 'Reports', end: false, icon: BarChart3 },
] as const;

// D11 — visible focusable selector (borrows the pattern from useModalA11y.ts:20-21).
// Hand-rolled (NOT useModalA11y — that hook inerts #app-root + scroll-locks body,
// which is too heavy for a nav slide-down panel).
const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// F42 — D2/D5: disabled nav renders as <span role="link" aria-disabled> (NOT a native
// <button disabled>, which Radix Tooltip cannot wrap focus onto). The span is focusable
// via the Radix asChild wrapper, so the tooltip fires on focus + hover; pointer-events-none
// blocks click navigation.
function DisabledNavItem({
    label,
    icon: Icon,
    hint,
}: {
    label: string;
    icon: typeof LayoutGrid;
    hint: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    role="link"
                    aria-disabled="true"
                    tabIndex={-1}
                    className={cn(
                        'flex cursor-not-allowed items-center gap-1.5 text-sm',
                        'text-muted-foreground/60 pointer-events-none',
                    )}
                >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{label}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
    );
}

export function TopNav() {
    const [open, setOpen] = useState(false);
    const user = useAuthStore((s) => s.user);
    const clear = useAuthStore((s) => s.clear);
    const isAdmin = useRequirePlatformAdmin();
    const navigate = useNavigate();
    // F42 — D1: URL param is primary, persisted store is the fallback.
    // Non-null slug ⇒ a project is selected ⇒ Board routes to its board.
    const params = useParams<{ slug: string }>();
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    const projectSlug = params.slug ?? lastSelectedSlug;
    const hasProject = projectSlug != null;
    // SLYK-03 T4 — Project Admin gate for the project-scoped 'Project Settings'
    // nav item. useCurrentProjectMembership requires a slug; guard the call so it
    // is never invoked with undefined (React hooks can't be conditional, so pass
    // a stable empty-string fallback when no project is selected — the render
    // gate below hides the item entirely in that case).
    const { isProjectAdmin } = useCurrentProjectMembership(projectSlug ?? '');
    // F40 — single source of truth for theme. Both the navbar segmented control
    // and the profile-menu mirror read this same Context (D3/D5: no local state).
    const { theme, setTheme } = useTheme();
    // F41 — server-state for the health indicator. Single source of truth;
    // this component is a pure consumer. ok===undefined while loading (3-state).
    const health = useHealth();

    type HealthState = 'healthy' | 'unhealthy' | 'loading';
    const healthState: HealthState = health.isLoading
        ? 'loading'
        : health.ok === false || health.isError
          ? 'unhealthy'
          : 'healthy';

    const HEALTH_INDICATOR: Record<HealthState, { dot: string; label: string }> = {
        healthy: { dot: 'bg-success', label: 'Healthy' },
        unhealthy: { dot: 'bg-danger', label: `Unhealthy — ${health.detail}` },
        loading: { dot: 'bg-muted-foreground', label: 'Checking…' },
    };
    const indicator = HEALTH_INDICATOR[healthState];

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
            const tabbables = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE));
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
            isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        );

    const navItems = (
        <ul className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
            {PUBLIC_NAV_LINKS.map((link) => {
                const Icon = link.icon;
                const isReports = link.label === 'Reports';
                // F49: Reports is enabled when a project is selected (was
                // always-disabled in F42). Both Board and Reports require a
                // project; the scoped href is built from projectSlug.
                const disabled = !hasProject;
                const href = isReports
                    ? `/projects/${projectSlug}/reports`
                    : `/projects/${projectSlug}`;
                const hint = 'Select a project first';
                return (
                    <li key={link.label}>
                        {disabled ? (
                            <DisabledNavItem label={link.label} icon={Icon} hint={hint} />
                        ) : (
                            <NavLink
                                to={href}
                                end={link.end}
                                onClick={() => setOpen(false)}
                                className={navLinkClass}
                            >
                                <Icon className="h-4 w-4" aria-hidden="true" />
                                <span>{link.label}</span>
                            </NavLink>
                        )}
                    </li>
                );
            })}
            {/* SLYK-03 T4 — project-scoped 'Project Settings' nav item.
                Visibility gate: Platform Admin OR Project Admin of the selected
                project. No-project decision: Project Admin is meaningless without
                a project context, so HIDE entirely (no disabled affordance) when
                no project is selected. Flash-avoidance: useCurrentProjectMembership
                exposes no loading flag — isProjectAdmin is false until the roster
                resolves. Default-HIDE: render ONLY for Platform Admins (sync, via
                useRequirePlatformAdmin) OR an explicitly-resolved Project Admin.
                Never render on the unresolved/undefined state. */}
            {(() => {
                if (!hasProject) return null;
                if (!isAdmin && isProjectAdmin !== true) return null;
                return (
                    <li>
                        <NavLink
                            to={`/projects/${projectSlug}/settings`}
                            onClick={() => setOpen(false)}
                            className={navLinkClass}
                        >
                            <Settings className="h-4 w-4" aria-hidden="true" />
                            <span>Project Settings</span>
                        </NavLink>
                    </li>
                );
            })()}
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
                    <Avatar src={user.avatarUrl} name={user.name || user.email} size="md" />
                </button>
            </DropdownTrigger>
            <DropdownContent align="end" className="min-w-[14rem]">
                <DropdownLabel>
                    <div className="flex items-center gap-2">
                        <Avatar src={user.avatarUrl} name={user.name || user.email} size="sm" />
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
                    {theme === 'light' && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
                </DropdownItem>
                <DropdownItem onSelect={() => setTheme('system')}>
                    <Monitor className="h-4 w-4" aria-hidden="true" />
                    <span>System</span>
                    {theme === 'system' && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
                </DropdownItem>
                <DropdownItem onSelect={() => setTheme('dark')}>
                    <Moon className="h-4 w-4" aria-hidden="true" />
                    <span>Dark</span>
                    {theme === 'dark' && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
                </DropdownItem>
                <DropdownSeparator />
                {/* SLYK-03 T4 — platform-admin-only entry to global /settings. */}
                {isAdmin && (
                    <DropdownItem onSelect={() => navigate('/settings')}>
                        <Settings className="h-4 w-4" aria-hidden="true" />
                        <span>Settings</span>
                    </DropdownItem>
                )}
                <DropdownSeparator />
                {/* SLYK-03 T4 — per-user Account Settings (everyone). */}
                <DropdownItem onSelect={() => navigate('/account')}>
                    <User className="h-4 w-4" aria-hidden="true" />
                    <span>Account Settings</span>
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
                <nav aria-label="Primary" className="flex items-center justify-between gap-4">
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
                        {/* F41 (D2) — health indicator folded into the navbar (PRD §4.2). Activity
                            icon + colored status dot (3-state) with an F36 Tooltip. Fixed-size
                            trigger (h-9 w-9) + dot (h-2 w-2) → no layout shift on state flip. */}
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label="Health"
                                        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <Activity className="h-4 w-4" aria-hidden="true" />
                                        <span
                                            className={cn(
                                                'absolute right-1.5 top-1.5 h-2 w-2 rounded-full',
                                                indicator.dot,
                                            )}
                                            aria-hidden="true"
                                        />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>{indicator.label}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
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
                    className={cn(open ? 'block' : 'hidden', 'md:hidden')}
                >
                    {open && navItems}
                </div>
            </div>
        </header>
    );
}
