import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge, type BadgeVariant } from './Badge'

describe('Badge', () => {
    const variants: BadgeVariant[] = [
        'default',
        'secondary',
        'outline',
        'destructive',
        'danger',
        'success',
        'warning',
    ]

    // Table-driven variants → className assertions (jsdom can't compute color).
    const expectedToken: Record<BadgeVariant, string> = {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        outline: 'border-border',
        destructive: 'bg-destructive',
        danger: 'bg-destructive', // aliases destructive
        success: 'bg-success',
        warning: 'bg-warning',
    }

    for (const variant of variants) {
        it(`variant=${variant} applies token ${expectedToken[variant]}`, () => {
            render(<Badge variant={variant}>x</Badge>)
            // Badge is a <span> with no implicit role; query by text.
            const badge = screen.getByText('x')
            expect(badge.className).toContain(expectedToken[variant])
            expect(badge.className).toContain('rounded-full')
        })
    }

    it('defaults to variant=default', () => {
        render(<Badge>x</Badge>)
        expect(screen.getByText('x').className).toContain('bg-primary')
    })

    it('applies style passthrough', () => {
        render(
            <Badge style={{ backgroundColor: '#abcdef' }}>x</Badge>,
        )
        expect((screen.getByText('x') as HTMLElement).style.backgroundColor).toBe('rgb(171, 205, 239)')
    })
})
