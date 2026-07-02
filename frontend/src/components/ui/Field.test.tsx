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

    it('with an icon renders icon inline-left of label in a flex row', () => {
        render(
            <Field label="Title" icon={<span data-testid="field-icon">info</span>}>
                <input />
            </Field>,
        );
        const labelSpan = screen.getByText('Title');
        expect(labelSpan.classList.contains('flex')).toBe(true);
        expect(labelSpan.classList.contains('items-center')).toBe(true);

        const iconEl = screen.getByTestId('field-icon');
        // Icon is a child of the SAME label span.
        expect(labelSpan.contains(iconEl)).toBe(true);

        // The label text node must FOLLOW the icon in DOM order.
        const textNode = Array.from(labelSpan.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('Title'),
        );
        expect(textNode).toBeDefined();
        expect(iconEl.compareDocumentPosition(textNode as Text) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('without an icon keeps the block label span (no flex)', () => {
        render(
            <Field label="Title">
                <input />
            </Field>,
        );
        const labelSpan = screen.getByText('Title');
        expect(labelSpan.classList.contains('block')).toBe(true);
        expect(labelSpan.classList.contains('flex')).toBe(false);
        expect(screen.queryByTestId('field-icon')).toBeNull();
    });

    it('renders the action node in the label row, right-aligned, when provided', () => {
        render(
            <Field label="Title" action={<button type="button">Edit</button>}>
                <input />
            </Field>,
        );
        const actionButton = screen.getByRole('button', { name: 'Edit' });
        expect(actionButton).toBeInTheDocument();

        // The action sits in a right-aligned (ml-auto) wrapper.
        const actionWrapper = actionButton.parentElement;
        expect(actionWrapper?.classList.contains('ml-auto')).toBe(true);

        // The label row (flex container) holds both the label text and the action.
        const labelRow = actionWrapper?.parentElement;
        expect(labelRow?.classList.contains('flex')).toBe(true);
        expect(labelRow?.contains(screen.getByText('Title'))).toBe(true);

        // a11y: the interactive action must NOT be nested inside a <label>.
        expect(actionButton.closest('label')).toBeNull();
    });

    it('does not render an action slot by default', () => {
        render(
            <Field label="Title">
                <input />
            </Field>,
        );
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText('Edit')).toBeNull();
    });
});
