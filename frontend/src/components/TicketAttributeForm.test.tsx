import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./RichTextEditor', () => ({
    RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea
            aria-label="Description"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));
vi.mock('./PrioritySelect', () => ({
    PrioritySelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <select aria-label="Priority" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
            <option value="CRITICAL">Critical</option>
        </select>
    ),
}));
vi.mock('./UserSelect', () => ({
    UserSelect: ({
        value,
        onChange,
    }: {
        value: string | null;
        onChange: (v: string | null) => void;
    }) => (
        <select
            aria-label="Assignee"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
        >
            <option value="">Unassigned</option>
            <option value="11111111-1111-1111-1111-111111111111">Alice</option>
        </select>
    ),
}));
vi.mock('./LabelMultiSelect', () => ({
    LabelMultiSelect: ({
        value,
        onChange,
    }: {
        projectSlug: string;
        value: string[];
        onChange: (ids: string[]) => void;
    }) => (
        <div aria-label="Labels">
            <span data-testid="label-value">{value.join(',')}</span>
            <button
                type="button"
                aria-label="Select bug"
                onClick={() => onChange(['11111111-1111-1111-1111-111111111111'])}
            >
                Select bug
            </button>
            <button type="button" aria-label="Clear" onClick={() => onChange([])}>
                Clear
            </button>
        </div>
    ),
}));

import { TicketAttributeForm } from './TicketAttributeForm';
import type { UpdateTicketDto } from '@/types/ticket';

const PROJECT_SLUG = 'SLYK';
const baseDefaults = {
    title: '',
    description: '',
    priority: 'MEDIUM' as const,
    assigneeId: null,
    labelIds: [] as string[],
    checklist: [],
};

describe('TicketAttributeForm', () => {
    it('create mode renders all controls + Create ticket button', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByLabelText('Title')).toBeInTheDocument();
        expect(screen.getByLabelText('Description')).toBeInTheDocument();
        expect(screen.getByLabelText('Priority')).toBeInTheDocument();
        expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
        expect(screen.getByTestId('label-value')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
    });

    it('edit mode renders Save changes button + prefilled defaults', () => {
        const defaults = {
            title: 'Existing ticket',
            description: '<p>prefilled</p>',
            priority: 'HIGH' as const,
            assigneeId: '11111111-1111-1111-1111-111111111111',
            labelIds: ['22222222-2222-2222-2222-222222222222'],
            checklist: [],
        };
        render(
            <TicketAttributeForm
                mode="edit"
                projectSlug={PROJECT_SLUG}
                defaultValues={defaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Existing ticket');
        expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
            '<p>prefilled</p>',
        );
        expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('HIGH');
        expect((screen.getByLabelText('Assignee') as HTMLSelectElement).value).toBe(
            '11111111-1111-1111-1111-111111111111',
        );
    });

    it('empty title blocks submit + shows validation error', async () => {
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(screen.getByText('Title is required')).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('title > 200 chars blocks submit + shows error', async () => {
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        const long = 'a'.repeat(201);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: long } });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(screen.getByText('Title must be 200 chars or fewer')).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('description > 5000 chars blocks submit + shows error', async () => {
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Valid title' } });
        const long = 'a'.repeat(5001);
        fireEvent.change(screen.getByLabelText('Description'), {
            target: { value: long },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(screen.getByText('Description must be 5000 chars or fewer')).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('valid submit calls onSubmit with assembled UpdateTicketDto', async () => {
        const onSubmit = vi.fn<(dto: UpdateTicketDto) => void>();
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New bug' } });
        fireEvent.change(screen.getByLabelText('Description'), {
            target: { value: '<p>steps</p>' },
        });
        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'HIGH' } });
        fireEvent.change(screen.getByLabelText('Assignee'), {
            target: { value: '11111111-1111-1111-1111-111111111111' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        expect(onSubmit).toHaveBeenCalledWith({
            title: 'New bug',
            description: '<p>steps</p>',
            priority: 'HIGH',
            assigneeId: '11111111-1111-1111-1111-111111111111',
            labelIds: [],
            checklist: [],
        });
    });

    it('label select renders + selecting/deselecting updates the form value', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        // Initially no labels selected.
        expect(screen.getByTestId('label-value').textContent).toBe('');

        // Selecting a label via the mocked multi-select fires onChange.
        fireEvent.click(screen.getByRole('button', { name: 'Select bug' }));
        expect(screen.getByTestId('label-value').textContent).toBe(
            '11111111-1111-1111-1111-111111111111',
        );

        // Deselecting clears the value.
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(screen.getByTestId('label-value').textContent).toBe('');
    });

    it('submit includes labelIds when labels are selected', async () => {
        const onSubmit = vi.fn<(dto: UpdateTicketDto) => void>();
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New bug' } });
        fireEvent.click(screen.getByRole('button', { name: 'Select bug' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        expect(onSubmit).toHaveBeenCalledWith({
            title: 'New bug',
            description: '',
            priority: 'MEDIUM',
            assigneeId: null,
            labelIds: ['11111111-1111-1111-1111-111111111111'],
            checklist: [],
        });
    });

    it('cancel button calls onCancel', () => {
        const onCancel = vi.fn();
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('edit mode renders the ChecklistEditor seeded from defaults', () => {
        render(
            <TicketAttributeForm
                mode="edit"
                projectSlug={PROJECT_SLUG}
                defaultValues={{
                    ...baseDefaults,
                    checklist: [
                        { id: '11111111-1111-4111-8111-111111111111', text: 'Design', done: true },
                        { id: '22222222-2222-4222-8222-222222222222', text: 'Build', done: false },
                    ],
                }}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByRole('checkbox', { name: 'Toggle "Design"' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Toggle "Build"' })).not.toBeChecked();
        expect(screen.getByLabelText('Checklist progress: 1 of 2 done')).toBeInTheDocument();
    });

    it('edit mode submit includes the (edited) checklist', async () => {
        const onSubmit = vi.fn<(dto: UpdateTicketDto) => void>();
        render(
            <TicketAttributeForm
                mode="edit"
                projectSlug={PROJECT_SLUG}
                defaultValues={{
                    ...baseDefaults,
                    title: 'Existing',
                    checklist: [
                        { id: '11111111-1111-4111-8111-111111111111', text: 'Design', done: false },
                    ],
                }}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        // Toggle the item done before saving.
        fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle "Design"' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                checklist: [
                    { id: '11111111-1111-4111-8111-111111111111', text: 'Design', done: true },
                ],
            }),
        );
    });

    it('F17 readOnly: hides Save + shows Close (deleted ticket)', () => {
        render(
            <TicketAttributeForm
                mode="edit"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                readOnly
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
});

describe('F44 two-column layout', () => {
    it('renders the two-column grid (lg:grid-cols-3) at the form root', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const fieldset = document.querySelector('fieldset');
        expect(fieldset?.className).toContain('lg:grid-cols-3');
        expect(fieldset?.className).toContain('grid');
    });

    it('left column spans 2 tracks; right column spans 1 (lg)', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const fieldset = document.querySelector('fieldset')!;
        const left = fieldset.querySelector('.lg\\:col-span-2');
        const right = fieldset.querySelector('.lg\\:col-span-1');
        expect(left).toBeInTheDocument();
        expect(right).toBeInTheDocument();
    });

    it('right column scrolls independently (lg:max-h + lg:overflow-y-auto)', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const rightCol = document.querySelector('fieldset .lg\\:col-span-1');
        expect(rightCol?.className).toContain('lg:max-h-[70vh]');
        expect(rightCol?.className).toContain('lg:overflow-y-auto');
    });

    // SLYK-15: footer is NON-STICKY (no sticky/edge/bottom/padding classes),
    // right-aligned, lives outside the disabled <fieldset>, and stays the
    // last child of <form>. Table-driven across the three render modes.
    it.each([
        {
            name: 'create',
            mode: 'create' as const,
            readOnly: false,
            submitLabel: 'Create ticket',
            secondaryLabel: 'Cancel',
        },
        {
            name: 'edit',
            mode: 'edit' as const,
            readOnly: false,
            submitLabel: 'Save changes',
            secondaryLabel: 'Cancel',
        },
        {
            name: 'edit + readOnly',
            mode: 'edit' as const,
            readOnly: true,
            submitLabel: null as string | null,
            secondaryLabel: 'Close',
        },
    ])(
        '$name: footer is non-sticky and right-aligned',
        ({ mode, readOnly, submitLabel, secondaryLabel }) => {
            render(
                <TicketAttributeForm
                    mode={mode}
                    projectSlug={PROJECT_SLUG}
                    defaultValues={baseDefaults}
                    readOnly={readOnly}
                    onSubmit={vi.fn()}
                    onCancel={vi.fn()}
                />,
            );
            const form = document.querySelector('form')!;
            const fieldset = form.querySelector('fieldset')!;

            // (6) The footer is the LAST child of <form>.
            const footer = form.lastElementChild as HTMLElement;
            expect(footer.tagName).toBe('DIV');
            expect(footer).not.toBe(fieldset);

            const cls = footer.className;
            // (3) Footer LACKS sticky / edge-bleed / bottom / padding classes.
            expect(cls).not.toContain('sticky');
            expect(cls).not.toContain('-mx-6');
            expect(cls).not.toContain('-mb-6');
            expect(cls).not.toContain('bottom-0');
            expect(cls).not.toContain('px-6');
            expect(cls).not.toContain('py-3');
            // (4) Footer IS right-aligned.
            expect(cls).toContain('justify-end');

            // (5) Submit button presence matches the mode.
            if (submitLabel) {
                expect(screen.getByRole('button', { name: submitLabel })).toBeInTheDocument();
            } else {
                expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
                expect(screen.queryByRole('button', { name: 'Create ticket' })).not.toBeInTheDocument();
            }

            // (7) Cancel/Close sits OUTSIDE the disabled <fieldset> and stays
            // enabled even when readOnly.
            const secondary = screen.getByRole('button', { name: secondaryLabel });
            expect(fieldset.contains(secondary)).toBe(false);
            expect(footer.contains(secondary)).toBe(true);
            expect(secondary).not.toBeDisabled();
        },
    );

    it('readOnly still hides Save and shows Close (regression)', () => {
        render(
            <TicketAttributeForm
                mode="edit"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                readOnly
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
});

describe('SLYK-14 label row', () => {
    const LABELS = ['Title', 'Description', 'Priority', 'Assignee', 'Labels', 'Checklist'] as const;

    function renderForm() {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
    }

    // Behavior A — each field renders exactly one caption.
    it.each(LABELS)('each field renders exactly one caption for %s', (label) => {
        renderForm();
        expect(screen.getAllByText(label).length).toBe(1);
    });

    // Behavior B — the icon shares the label row inline-left of the caption.
    it.each(LABELS)(
        'the icon shares the label row inline-left of the caption for %s',
        (label) => {
            renderForm();
            // The caption span is the label-bearing element rendered by Field.
            const caption = screen.getByText(label);
            const span = caption.closest('span')!;

            // Caption span carries the Field label-row classes.
            expect(span.classList.contains('flex')).toBe(true);
            expect(span.classList.contains('items-center')).toBe(true);

            // Exactly one lucide <svg> sits on the label row.
            const svgs = span.querySelectorAll('svg');
            expect(svgs.length).toBe(1);

            // The <svg> PRECEDES the caption text node in DOM order.
            const svg = svgs[0]!;
            const textNode = Array.from(span.childNodes).find(
                (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(label),
            );
            expect(textNode).toBeTruthy();
            // DOCUMENT_POSITION_FOLLOWING => textNode follows svg (svg precedes text).
            const position = svg.compareDocumentPosition(textNode!);
            expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        },
    );
});
