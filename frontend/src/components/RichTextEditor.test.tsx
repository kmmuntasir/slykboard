// DEL-02 T4 — tests for the CKEditor 5 backed RichTextEditor.
//
// The real CKEditor 5 engine cannot initialize in jsdom (it needs a real DOM +
// layout), so the @ckeditor/ckeditor5-react wrapper is mocked with a lightweight
// stand-in that mirrors the exact surface the component relies on:
//   - onReady fired once on mount, handing back a fake editor whose getData/
//     setData are bound to a contenteditable div (the mock's editable).
//   - onChange fired on `input` in the editable, passing the fake editor so the
//     component's onChange reads editor.getData().
//   - a toolbar region rendered from config.toolbar.items (one button per item,
//     accessible name = the item string) so getByRole('button', { name }) works.
//
// The mock factory is ASYNC and dynamically imports React hooks because vi.mock
// factories are hoisted above the file's imports — outer-scope hook imports are
// not reachable at hoist time. (Consumer mocks in this repo that use JSX without
// a React import also work, but an onReady-once + onInput stand-in needs hooks,
// hence the dynamic-import pattern.)
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RichTextEditor, isValidImageUrl } from './RichTextEditor';

vi.mock('@ckeditor/ckeditor5-react', async () => {
    const { useEffect, useRef, createElement } = await import('react');

    interface EditorLike {
        getData: () => string;
        setData: (value: string) => void;
    }

    interface MockCKEditorProps {
        config?: {
            toolbar?: { items?: readonly string[] };
            placeholder?: string;
        };
        data?: string;
        onChange?: (event: unknown, editor: EditorLike) => void;
        onReady?: (editor: EditorLike) => void;
    }

    function CKEditor({ config, data, onChange, onReady }: MockCKEditorProps) {
        const editableRef = useRef<HTMLDivElement | null>(null);
        const editorRef = useRef<EditorLike | null>(null);

        // Mount-only: populate the editable with the initial `data`, build the
        // fake editor bound to the editable's DOM, and hand it back via onReady.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        useEffect(() => {
            const el = editableRef.current;
            if (!el) return;
            el.innerHTML = data ?? '';
            const editor: EditorLike = {
                getData: () => el.innerHTML,
                setData: (value: string) => {
                    el.innerHTML = value;
                },
            };
            editorRef.current = editor;
            onReady?.(editor);
        }, []);

        const items = config?.toolbar?.items ?? [];

        return createElement(
            'div',
            null,
            // Toolbar: one accessible button per non-separator item.
            createElement(
                'div',
                { role: 'toolbar', 'aria-label': 'Formatting' },
                ...items
                    .filter((item) => item !== '|')
                    .map((item) =>
                        createElement(
                            'button',
                            { key: item, type: 'button', 'aria-label': item },
                            item,
                        ),
                    ),
            ),
            // Editable surface. data-placeholder echoes config.placeholder so
            // tests can assert the placeholder prop reached the editor config.
            createElement('div', {
                ref: editableRef,
                contentEditable: true,
                suppressContentEditableWarning: true,
                'data-testid': 'ck-editable',
                'data-placeholder': config?.placeholder ?? '',
                onInput: () => {
                    const editor = editorRef.current;
                    if (editor) {
                        onChange?.({}, editor);
                    }
                },
            }),
        );
    }

    return { CKEditor };
});

describe('RichTextEditor', () => {
    it('renders the wrapper with the rich-text + focus-ring family classes', () => {
        const { container } = render(<RichTextEditor value="" onChange={vi.fn()} />);
        // The outer wrapper carries `.rich-text` (shared content stylesheet) and
        // the original focus-ring family tokens.
        const wrapper = container.firstElementChild as HTMLElement;
        expect(wrapper.className).toContain('rich-text');
        expect(wrapper.className).toContain('focus-within:ring-2');
        expect(wrapper.className).toContain('focus-within:ring-ring');
        expect(wrapper.className).toContain('focus-within:border-primary');
    });

    it('renders toolbar buttons for the configured items', () => {
        render(<RichTextEditor value="" onChange={vi.fn()} />);
        // A representative subset of formatting commands.
        expect(screen.getByRole('button', { name: 'bold' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'italic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'underline' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'link' })).toBeInTheDocument();
        // The custom prompt-based image insert item.
        expect(screen.getByRole('button', { name: 'promptImageInsert' })).toBeInTheDocument();
        // The toolbar renders many buttons, not just one.
        expect(screen.getAllByRole('button').length).toBeGreaterThan(5);
    });

    it('passes the initial value prop through to the editable', () => {
        render(<RichTextEditor value="<p>hello world</p>" onChange={vi.fn()} />);
        const editable = screen.getByTestId('ck-editable');
        expect(editable.textContent).toBe('hello world');
    });

    it('propagates editor.getData() to onChange when the editable receives input', () => {
        const onChange = vi.fn();
        render(<RichTextEditor value="<p>start</p>" onChange={onChange} />);

        const editable = screen.getByTestId('ck-editable');
        // Simulate a user edit: mutate the editable, then dispatch an input event.
        editable.innerHTML = '<p>edited content</p>';
        fireEvent.input(editable);

        expect(onChange).toHaveBeenCalled();
        // The component's onChange reads editor.getData() (the editable's HTML).
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('edited content');
    });

    it('passes the placeholder prop into the editor config', () => {
        render(
            <RichTextEditor value="" onChange={vi.fn()} placeholder="Describe the ticket" />,
        );
        // The mock echoes config.placeholder onto the editable's data-placeholder.
        expect(screen.getByTestId('ck-editable').getAttribute('data-placeholder')).toBe(
            'Describe the ticket',
        );
    });

    it('syncs an external value change into the editor (and does not loop)', () => {
        const { rerender } = render(<RichTextEditor value="<p>first</p>" onChange={vi.fn()} />);
        const editable = screen.getByTestId('ck-editable');
        expect(editable.textContent).toBe('first');

        // Re-render with a new external value. The controlled-value effect must
        // call editor.setData(...) so the editable updates. If the loop guard
        // were broken this would re-feed setData -> onChange -> setValue forever
        // and React would throw "Maximum update depth exceeded".
        rerender(<RichTextEditor value="<p>second</p>" onChange={vi.fn()} />);
        expect(editable.textContent).toBe('second');

        // Re-render with the SAME value the editor already holds — the equality
        // guard must skip setData (no re-emit, no loop).
        rerender(<RichTextEditor value="<p>second</p>" onChange={vi.fn()} />);
        expect(editable.textContent).toBe('second');
    });
});

// Isolated unit test of the pure validation helper exported from the component.
// No editor instance involved.
describe('isValidImageUrl', () => {
    it.each([
        { url: 'https://example.com/a.png', expected: true },
        { url: 'http://example.com/a.png', expected: true },
        { url: 'javascript:alert(1)', expected: false },
        { url: 'data:image/png;base64,abc', expected: false },
        { url: '', expected: false },
        { url: 'ftp://example.com/a.png', expected: false },
    ])('returns $expected for $url', ({ url, expected }) => {
        expect(isValidImageUrl(url)).toBe(expected);
    });
});
