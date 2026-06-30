import { Moon, Monitor, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ThemePreference } from '@/utils/theme';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/components/ui/cn';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';

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
 *
 * DEL-02 — migrated from hand-rolled segmented control to ui/ToggleGroup
 * (Radix). Single mode CAN deselect to '' on click of the active item; themes
 * must always be set, so `onValueChange` guards falsy values. Each item is also
 * wrapped in a ui/Tooltip (belt-and-suspenders label hint) with aria-label kept
 * for SR users.
 */
export function ThemeToggle({ className }: { className?: string }) {
    const { theme, setTheme } = useTheme();

    return (
        <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(value) => {
                // Radix single-mode allows deselect → ''. Theme must ALWAYS be set;
                // ignore the empty value so setTheme('') is never called. Radix types
                // value as `string`; narrow to ThemePreference before calling setTheme.
                if (value === 'light' || value === 'system' || value === 'dark') {
                    setTheme(value);
                }
            }}
            aria-label="Theme"
            className={className}
        >
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <Tooltip key={value}>
                    <TooltipTrigger asChild>
                        <ToggleGroupItem value={value} aria-label={label}>
                            <Icon className="h-4 w-4" aria-hidden="true" />
                        </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                </Tooltip>
            ))}
        </ToggleGroup>
    );
}
