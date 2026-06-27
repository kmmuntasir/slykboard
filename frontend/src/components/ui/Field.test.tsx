import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field';

describe('Field', () => {
    it('renders the label text', () => {
        render(
            <Field label="Title">
                <input />
            </Field>,
        );
        expect(screen.getByText('Title')).toBeInTheDocument();
    });

    it('renders role=alert when error is present', () => {
        render(
            <Field label="Title" error="Required">
                <input />
            </Field>,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Required');
    });

    it('does NOT render role=alert when error is absent', () => {
        render(
            <Field label="Title">
                <input />
            </Field>,
        );
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('associates label with control via htmlFor', () => {
        render(
            <Field label="Title" htmlFor="title-input">
                <input id="title-input" />
            </Field>,
        );
        const label = screen.getByText('Title').closest('label');
        expect(label?.getAttribute('for')).toBe('title-input');
    });

    it('renders children', () => {
        render(
            <Field label="Title">
                <input data-testid="child-input" />
            </Field>,
        );
        expect(screen.getByTestId('child-input')).toBeInTheDocument();
    });
});
