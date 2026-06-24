import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton, SkeletonCard, SkeletonLine, SkeletonBlock } from './Skeleton';

describe('Skeleton', () => {
    it('renders and is hidden from assistive tech', () => {
        const { container } = render(<Skeleton />);
        const node = container.firstChild as HTMLElement;
        expect(node).toBeTruthy();
        expect(node.getAttribute('aria-hidden')).toBe('true');
    });

    it('passes className through while keeping animate-pulse', () => {
        const { container } = render(<Skeleton className="h-4 w-20" />);
        const node = container.firstChild as HTMLElement;
        expect(node.className).toContain('h-4');
        expect(node.className).toContain('w-20');
        expect(node.className).toContain('animate-pulse');
    });
});

describe('Skeleton variants', () => {
    const variants = [
        { name: 'SkeletonCard', Component: SkeletonCard },
        { name: 'SkeletonLine', Component: SkeletonLine },
        { name: 'SkeletonBlock', Component: SkeletonBlock },
    ];

    variants.forEach(({ name, Component }) => {
        it(`${name} renders and is aria-hidden`, () => {
            const { container } = render(<Component />);
            const node = container.firstChild as HTMLElement;
            expect(node).toBeTruthy();
            expect(node.getAttribute('aria-hidden')).toBe('true');
        });
    });
});
