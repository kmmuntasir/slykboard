// F35 — Badge primitive.
// Unifies PriorityBadge + label/status badges. Variant map → F32 semantic tokens.
// No bg-info/bg-critical (those don't exist); danger aliases destructive (--danger==--destructive).
// Optional style passthrough for LabelChip's future (F46); LabelChip itself stays separate.
import { type CSSProperties, type ReactNode } from 'react'
import { cn } from './cn'

export type BadgeVariant =
    | 'default'
    | 'secondary'
    | 'outline'
    | 'destructive'
    | 'danger'
    | 'success'
    | 'warning'

export interface BadgeProps {
    children: ReactNode
    variant?: BadgeVariant
    /** Optional style passthrough (for LabelChip's runtime-hex future — F46). */
    style?: CSSProperties
    className?: string
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border text-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
    // danger aliases destructive (--danger aliases --destructive in F32).
    danger: 'bg-destructive text-destructive-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
}

const BASE_CLASSES = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'

export function Badge({ children, variant = 'default', style, className }: BadgeProps) {
    return (
        <span className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], className)} style={style}>
            {children}
        </span>
    )
}
