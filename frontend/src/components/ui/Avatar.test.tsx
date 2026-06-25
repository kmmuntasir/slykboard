import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from './Avatar'

describe('Avatar', () => {
    it('renders img when src is provided', () => {
        render(<Avatar src="https://example.com/a.png" name="Ada" />)
        const img = screen.getByRole('img', { name: 'Ada' })
        expect(img.getAttribute('src')).toBe('https://example.com/a.png')
    })

    const initialsCases = [
        { name: 'two words', input: 'Ada Lovelace', expected: 'AL' },
        { name: 'one word', input: 'munna', expected: 'M' },
        { name: 'three words takes first two', input: 'Ada Blue Lovelace', expected: 'AB' },
    ]
    initialsCases.forEach(({ name: caseName, input, expected }) => {
        it(`initials fallback: ${caseName} ("${input}" → "${expected}")`, () => {
            render(<Avatar name={input} />)
            expect(screen.getByLabelText(input)).toHaveTextContent(expected)
        })
    })

    it('renders generic User icon fallback when no src/name', () => {
        render(<Avatar />)
        // No img, no initials span — just the aria-label="Unassigned" wrapper.
        expect(screen.getByLabelText('Unassigned')).toBeInTheDocument()
    })

    it('applies size class', () => {
        const { rerender } = render(<Avatar name="Ada" size="sm" />)
        expect(screen.getByLabelText('Ada').className).toContain('h-6 w-6')
        rerender(<Avatar name="Ada" size="lg" />)
        expect(screen.getByLabelText('Ada').className).toContain('h-10 w-10')
    })
})
