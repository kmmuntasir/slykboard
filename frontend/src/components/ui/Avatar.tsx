// F35 — Avatar primitive.
// Consolidates AssigneeAvatar + TopNav initials/img logic into one source of truth.
// Fallback chain: src img → initials (per-word, "Ada Lovelace"→"AL") → lucide User icon.
// size prop sm/md/lg (h-6/h-8/h-10). bg-primary text-primary-foreground for initials.
import { User } from 'lucide-react'
import { cn } from './cn'

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps {
    /** Image URL; if provided and loads, renders as <img>. */
    src?: string | null
    /** Display name; used for initials fallback + alt text. */
    name?: string | null
    /** Size token. */
    size?: AvatarSize
    /** Optional className override. */
    className?: string
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
    sm: 'h-6 w-6 text-xs',
    md: 'h-8 w-8 text-sm',
    lg: 'h-10 w-10 text-base',
}

const ICON_SIZE: Record<AvatarSize, number> = {
    sm: 14,
    md: 16,
    lg: 20,
}

/** Per-word initials: "Ada Lovelace" → "AL", "munna" → "M". Caps, slice(0,2). */
function getInitials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase()
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
    const sizeClass = SIZE_CLASSES[size]
    const ringClass = 'rounded-full inline-flex items-center justify-center overflow-hidden'

    if (src) {
        return (
            <img
                src={src}
                alt={name ?? 'avatar'}
                className={cn(sizeClass, ringClass, className)}
            />
        )
    }

    if (name) {
        return (
            <span
                className={cn(
                    sizeClass,
                    ringClass,
                    'bg-primary text-primary-foreground font-medium',
                    className,
                )}
                aria-label={name}
            >
                {getInitials(name)}
            </span>
        )
    }

    // Generic fallback (no src, no name).
    return (
        <span
            className={cn(
                sizeClass,
                ringClass,
                'bg-muted text-muted-foreground',
                className,
            )}
            aria-label="Unassigned"
        >
            <User size={ICON_SIZE[size]} aria-hidden="true" />
        </span>
    )
}
