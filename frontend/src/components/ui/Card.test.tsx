import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
    it('renders children', () => {
        render(
            <Card>
                <span>content</span>
            </Card>,
        )
        expect(screen.getByText('content')).toBeInTheDocument()
    })

    it('applies token surface classes', () => {
        render(
            <Card>
                <span>x</span>
            </Card>,
        )
        const card = screen.getByText('x').parentElement
        expect(card?.className).toContain('bg-card')
        expect(card?.className).toContain('border-border')
        expect(card?.className).toContain('rounded-lg')
    })

    it('merges consumer className', () => {
        render(
            <Card className="p-4">
                <span>x</span>
            </Card>,
        )
        expect(screen.getByText('x').parentElement?.className).toContain('p-4')
    })
})
