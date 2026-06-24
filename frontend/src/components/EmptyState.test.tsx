import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
    it('renders title and description when provided', () => {
        render(<EmptyState title="No tickets yet" description="Create one to get started." />);

        expect(screen.getByText('No tickets yet')).toBeInTheDocument();
        expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
    });

    it('renders icon node when provided', () => {
        render(<EmptyState title="Empty" icon={<span data-testid="icon">🗂️</span>} />);

        expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('renders a button for an action object and fires onClick', () => {
        const onClick = vi.fn();
        render(<EmptyState title="No results" action={{ label: 'Clear filters', onClick }} />);

        const button = screen.getByRole('button', { name: /Clear filters/ });
        fireEvent.click(button);

        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders a ReactNode action as-is', () => {
        render(
            <EmptyState
                title="No projects yet"
                action={
                    <a href="/projects/new" data-testid="link">
                        Create project
                    </a>
                }
            />,
        );

        expect(screen.getByRole('link')).toBeInTheDocument();
        expect(screen.getByText('Create project')).toBeInTheDocument();
    });

    it('omits action button when no action is provided', () => {
        render(<EmptyState title="Nothing here" />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
