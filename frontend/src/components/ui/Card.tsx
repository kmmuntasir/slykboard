// F35 — Card primitive.
// Surface-only: bg-card border border-border rounded-lg. No default padding
// (consumers add p-*). Token-driven (auto theme-flip via F32).
import { type ReactNode } from 'react'
import { cn } from './cn'

export interface CardProps {
    children: ReactNode
    className?: string
}

export function Card({ children, className }: CardProps) {
    return (
        <div className={cn('bg-card border border-border rounded-lg', className)}>
            {children}
        </div>
    )
}
