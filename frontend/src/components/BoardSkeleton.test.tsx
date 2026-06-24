import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BoardSkeleton } from './BoardSkeleton';

describe('BoardSkeleton', () => {
    it('renders 3 column placeholders by default', () => {
        const { container } = render(<BoardSkeleton />);
        const columns = container.querySelectorAll('[data-testid="board-skeleton-column"]');
        expect(columns).toHaveLength(3);
    });

    it('respects columnCount prop', () => {
        const { container } = render(<BoardSkeleton columnCount={2} />);
        const columns = container.querySelectorAll('[data-testid="board-skeleton-column"]');
        expect(columns).toHaveLength(2);
    });

    it('marks every column as aria-hidden', () => {
        const { container } = render(<BoardSkeleton />);
        const columns = container.querySelectorAll('[data-testid="board-skeleton-column"]');
        columns.forEach((col) => {
            expect(col.getAttribute('aria-hidden')).toBe('true');
        });
    });
});
