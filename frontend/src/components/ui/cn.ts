// F35 — Shared className-merge helper.
// Variant primitives (Button, Badge) merge base + variant + size + className;
// tailwind-merge dedupes Tailwind conflicts (e.g. 'px-2' + 'px-4' → 'px-4').
// shadcn convention.
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs))
}
