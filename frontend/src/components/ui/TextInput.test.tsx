import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { TextInput } from './TextInput'
import { Textarea } from './Textarea'

describe('TextInput', () => {
    it('renders as textbox with focus-ring token classes', () => {
        render(<TextInput placeholder="Title" />)
        const input = screen.getByRole('textbox')
        expect(input.className).toContain('border-input')
        expect(input.className).toContain('focus-visible:ring-2')
        expect(input.className).toContain('focus-visible:ring-ring')
        expect(input.className).toContain('focus-visible:border-primary')
    })

    it('forwards ref', () => {
        const ref = createRef<HTMLInputElement>()
        render(<TextInput ref={ref} />)
        expect(ref.current).toBeInstanceOf(HTMLInputElement)
    })

    it('spreads rest props (placeholder, type)', () => {
        render(<TextInput placeholder="Email" type="email" />)
        const input = screen.getByRole('textbox') as HTMLInputElement
        expect(input.placeholder).toBe('Email')
        expect(input.type).toBe('email')
    })
})

describe('Textarea', () => {
    it('renders as textbox with focus-ring token classes', () => {
        render(<Textarea placeholder="Notes" />)
        const ta = screen.getByRole('textbox')
        expect(ta.className).toContain('border-input')
        expect(ta.className).toContain('focus-visible:ring-2')
        expect(ta.className).toContain('resize-y')
    })

    it('forwards rows rest prop', () => {
        render(<Textarea rows={5} />)
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).rows).toBe(5)
    })
})
