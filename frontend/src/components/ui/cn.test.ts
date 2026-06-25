import { describe, it, expect } from 'vitest'
import type { ClassValue } from 'clsx'
import { cn } from './cn'

describe('cn', () => {
    const mergeCases = [
        { name: 'concatenates classes', input: ['a', 'b'], expected: 'a b' },
        { name: 'skips falsy', input: ['a', false, null, undefined, 'b'], expected: 'a b' },
        { name: 'handles object form', input: ['a', { b: true, c: false }], expected: 'a b' },
    ]
    mergeCases.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(cn(...(input as ClassValue[]))).toBe(expected)
        })
    })

    const dedupeCases = [
        { name: 'dedupes conflicting px-*', input: ['px-2', 'px-4'], expected: 'px-4' },
        { name: 'dedupes conflicting bg-*', input: ['bg-primary', 'bg-secondary'], expected: 'bg-secondary' },
        { name: 'keeps non-conflicting', input: ['px-2', 'py-1'], expected: 'px-2 py-1' },
    ]
    dedupeCases.forEach(({ name, input, expected }) => {
        it(name, () => {
            expect(cn(...input)).toBe(expected)
        })
    })
})
