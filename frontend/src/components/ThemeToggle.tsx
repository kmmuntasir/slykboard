import { Moon, Monitor, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/components/ui/cn';

type ThemeValue = 'light' | 'system' | 'dark';

interface ThemeOption {
    value: ThemeValue;
    label: string;
    Icon: LucideIcon;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'system', label: 'System', Icon: Monitor },
    { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

/**
 * F40 — 3-way theme segmented control (Sun / Monitor / Moon). Wired to F34
 * useTheme: active segment reflects `theme`, click calls `setTheme`. F34 owns
 * .dark + localStorage + matchMedia side effects; this component is a pure
 * consumer (no local state, no direct DOM).
 */
export function ThemeToggle({ className }: { className?: string }) {
    const { theme, setTheme } = useTheme();

    return (
        <div
            role="group"
            aria-label="Theme"
            className={cn(
                'flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5',
                className,
            )}
        >
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
                const isActive = theme === value;
                return (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={isActive}
                        aria-label={label}
                        title={label}
                        onClick={() => setTheme(value)}
                        className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                        )}
                    >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                    </button>
                );
            })}
        </div>
    );
}
