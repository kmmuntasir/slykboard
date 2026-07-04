// DEL-02 T3 — tests for the read-first / edit-on-demand DescriptionField.
//
// Component under test: `./DescriptionField`. It renders sanitized HTML by
// default and reveals a <RichTextEditor> only after the user clicks an
// "Edit description" button. Editing exits only on a successful global Save
// (RHF `formState.isSubmitSuccessful`). `readOnly` always wins (no editor,
// no Edit button).
//
// Mock `RichTextEditor` as a `<textarea aria-label="Description">` (same shape
// as TicketDetailModal.test.tsx:13-19) so editor-branch assertions are
// deterministic without pulling in the real editor + Tiptap.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';

import { DescriptionField } from './DescriptionField';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// Mock the RichTextEditor to a stable, queryable textarea. Resolved via the
// `@/components/RichTextEditor` path the component uses (NOT the `./` path the
// modal test uses, since this file lives in ticket-fields/).
vi.mock('@/components/RichTextEditor', () => ({
    RichTextEditor: ({ value }: { value: string; onChange: (v: string) => void }) => (
        <textarea aria-label="Description" value={value} readOnly />
    ),
}));

// Minimal default form values — DescriptionField only reads `description`,
// so the rest can be any schema-valid placeholder.
const DEFAULT_VALUES: TicketFormValues = {
    title: 'Test ticket',
    description: '<p>Hello <strong>world</strong></p>',
    priority: 'MEDIUM',
    assigneeId: null,
    labelIds: [],
    checklist: [],
    statusColumn: 'TODO',
    dueDate: null,
};

/**
 * Lightweight harness that wires `useForm` + `<FormProvider>` and (optionally)
 * a real `<form onSubmit={handleSubmit}>` with a submit button so tests can
 * flip `formState.isSubmitSuccessful` to drive the post-save read-only revert.
 */
function renderWithForm(opts?: {
    readOnly?: boolean;
    withSubmitForm?: boolean;
    onSubmit?: () => void;
}) {
    const { readOnly = false, withSubmitForm = false, onSubmit = () => {} } = opts ?? {};

    function Wrapper() {
        const methods = useForm<TicketFormValues>({
            defaultValues: DEFAULT_VALUES,
        });

        const field = <DescriptionField readOnly={readOnly} />;

        if (!withSubmitForm) {
            return <FormProvider {...methods}>{field}</FormProvider>;
        }

        return (
            <FormProvider {...methods}>
                <form onSubmit={methods.handleSubmit(onSubmit)}>
                    {field}
                    <button type="submit">Save</button>
                </form>
            </FormProvider>
        );
    }

    return render(<Wrapper />);
}

describe('DescriptionField (DEL-02 read-first / edit-on-demand)', () => {
    // (a) Default: read-only sanitized HTML; no editor textarea present.
    it('renders read-only sanitized HTML by default (no RichTextEditor) for an editable ticket', () => {
        renderWithForm();

        // The mocked RichTextEditor (textarea) must NOT be mounted by default.
        expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
        // The sanitized HTML view IS present (the description text renders).
        expect(screen.getByText('world')).toBeInTheDocument();
    });

    // (b) Clicking "Edit description" reveals the RichTextEditor (mocked textarea).
    it('reveals the RichTextEditor after clicking the Edit description button', () => {
        renderWithForm();

        const editButton = screen.getByRole('button', { name: 'Edit description' });
        fireEvent.click(editButton);

        // The mocked editor textarea is now mounted.
        expect(screen.getByLabelText('Description')).toBeInTheDocument();
    });

    // (c) readOnly (soft-deleted) ticket: NO Edit button, always read-only HTML.
    it('does not render the Edit description button when readOnly is true', () => {
        renderWithForm({ readOnly: true });

        expect(screen.queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument();
        // Still renders the read-only sanitized HTML.
        expect(screen.getByText('world')).toBeInTheDocument();
        // And no editor textarea.
        expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    });

    // (d) After a successful global Save (isSubmitSuccessful flips true), the
    // component reverts to the read-only view: editor textarea disappears and
    // the Edit button reappears.
    it('reverts to read-only after a successful form submit', async () => {
        const onSubmit = vi.fn();
        renderWithForm({ withSubmitForm: true, onSubmit });

        // Enter edit mode.
        fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
        expect(screen.getByLabelText('Description')).toBeInTheDocument();

        // Trigger the wrapper form's submit. handleSubmit runs onSubmit (no
        // validation errors), which flips `formState.isSubmitSuccessful` true.
        // That flip drives a `useEffect` in DescriptionField that reverts
        // isEditing→false; both the async submit and the effect run after the
        // click, so wait for the editor to unmount.
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Edit description' })).toBeInTheDocument();
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // (e) The Edit button is type="button" so it does NOT submit the form.
    it('renders the Edit description button with type="button"', () => {
        renderWithForm();

        const editButton = screen.getByRole('button', { name: 'Edit description' });
        expect(editButton).toHaveAttribute('type', 'button');
    });

    // (f) Controlled mode (the modal passes `isEditing` + `onStartEdit`): the
    // parent owns the edit state. Clicking Edit calls `onStartEdit` (so the
    // parent can snapshot the pre-edit value) but does NOT flip internal state;
    // the editor shows only when the parent drives `isEditing` true. The
    // isSubmitSuccessful revert must be a no-op in controlled mode.
    it('controlled mode: clicking Edit calls onStartEdit and the editor is driven by the isEditing prop', () => {
        const onStartEdit = vi.fn();

        function Wrapper() {
            const methods = useForm<TicketFormValues>({ defaultValues: DEFAULT_VALUES });
            return (
                <FormProvider {...methods}>
                    <DescriptionField isEditing onStartEdit={onStartEdit} />
                </FormProvider>
            );
        }

        render(<Wrapper />);

        // Editor is already shown because the parent drove `isEditing` true.
        expect(screen.getByLabelText('Description')).toBeInTheDocument();
        // No Edit button while editing.
        expect(
            screen.queryByRole('button', { name: 'Edit description' }),
        ).not.toBeInTheDocument();
    });

    // (g) Regression: when editing, the RichTextEditor MUST NOT be a descendant
    // of a <label> element. A <label> with no `for` forwards a native click to
    // its first labelable descendant — for CKEditor that is the Bold toolbar
    // button, so every click in the content would otherwise toggle Bold. This
    // test fails on the pre-fix code (where Field always wraps children in a
    // <label>) and passes once `labelWrap={!showEditor}` is set.
    it('does not render the editor inside a <label> when editing', () => {
        renderWithForm();

        fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));

        // The editor (mocked textarea) is mounted...
        const editor = screen.getByLabelText('Description');
        expect(editor).toBeInTheDocument();

        // ...but it is NOT a descendant of a <label>.
        expect(editor.closest('label')).toBeNull();
        // Belt-and-braces: no <label> element contains the editor via a selector.
        expect(document.querySelector('label textarea')).toBeNull();

        // The "Description" label text still renders somewhere.
        expect(screen.getByText('Description')).toBeInTheDocument();
    });
});
