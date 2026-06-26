import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { RichTextEditor } from './RichTextEditor';

// jsdom does not implement geometry methods on Range/Element, so ProseMirror's
// scrollToSelection (called inside dispatchTransaction when the editor is
// focused) throws mid-dispatch and onUpdate never fires. Polyfill the rect
// methods to return empty values so toolbar clicks can drive real
// transactions in the test environment.
const emptyRectList = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
        // empty iterator
    },
});
const emptyRect = () => ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
});

beforeAll(() => {
    if (!Range.prototype.getClientRects) {
        Range.prototype.getClientRects = emptyRectList as never;
    }
    if (!Range.prototype.getBoundingClientRect) {
        Range.prototype.getBoundingClientRect = emptyRect as never;
    }
    if (!Element.prototype.getClientRects) {
        Element.prototype.getClientRects = emptyRectList as never;
    }
    if (!Element.prototype.getBoundingClientRect) {
        Element.prototype.getBoundingClientRect = emptyRect as never;
    }
});

describe('RichTextEditor', () => {
    it('renders all toolbar buttons with accessible names', () => {
        render(<RichTextEditor value="" onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 3' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Inline code' })).toBeInTheDocument();
        expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    });

    it('applies the focus-within ring family classes to the editor wrapper', () => {
        const { container } = render(<RichTextEditor value="" onChange={vi.fn()} />);
        // The outer wrapper is the div carrying the border-input + focus-within ring.
        const wrapper = container.querySelector('[class*="border-input"]') as HTMLElement;
        expect(wrapper.className).toContain('border-input');
        expect(wrapper.className).toContain('focus-within:ring-2');
        expect(wrapper.className).toContain('focus-within:ring-ring');
        expect(wrapper.className).toContain('focus-within:border-primary');
    });

    it('populates the editor with the initial value on mount', () => {
        render(<RichTextEditor value="<p>hello world</p>" onChange={vi.fn()} />);
        const editor = document.querySelector('.ProseMirror');
        expect(editor?.textContent).toBe('hello world');
    });

    it('syncs external value prop changes into the editor', () => {
        const { rerender } = render(<RichTextEditor value="<p>first</p>" onChange={vi.fn()} />);
        expect(document.querySelector('.ProseMirror')?.textContent).toBe('first');

        rerender(<RichTextEditor value="<p>second</p>" onChange={vi.fn()} />);
        expect(document.querySelector('.ProseMirror')?.textContent).toBe('second');
    });

    it('does not loop infinitely when value prop matches current editor HTML', () => {
        const onChange = vi.fn();
        // Initial render populates editor with "<p>stable</p>". onUpdate does not
        // fire on initial setContent — and the useEffect guard prevents re-emitting
        // the same value back into the editor. If the guard were broken, React
        // would throw "Maximum update depth exceeded".
        const { rerender } = render(<RichTextEditor value="<p>stable</p>" onChange={onChange} />);
        // Re-render with identical value — guard must skip setContent.
        rerender(<RichTextEditor value="<p>stable</p>" onChange={onChange} />);
        expect(document.querySelector('.ProseMirror')?.textContent).toBe('stable');
    });

    it('fires onChange with HTML output when a block transform is toggled', async () => {
        const onChange = vi.fn();
        render(<RichTextEditor value="<p>turn me into a heading</p>" onChange={onChange} />);

        // TipTap's toggleHeading chain calls .focus() — in jsdom, view.hasFocus()
        // returns false unless the contenteditable has a live DOM selection, which
        // short-circuits the chain. Place a real Range selection inside the
        // paragraph before clicking so ProseMirror's view.state.selection syncs.
        const editorEl = document.querySelector('.ProseMirror') as HTMLElement;
        await act(async () => {
            editorEl.focus();
            const range = document.createRange();
            range.selectNodeContents(editorEl);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Heading 3' }));
        });

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('<h3>');
        expect(lastCall).toContain('turn me into a heading');
    });

    it('renders the placeholder when value is empty', () => {
        render(
            <RichTextEditor value="" onChange={vi.fn()} placeholder="Describe the ticket" />,
        );
        expect(screen.getByText('Describe the ticket')).toBeInTheDocument();
    });

    it('does not render the placeholder once value is populated', () => {
        render(
            <RichTextEditor
                value="<p>has content</p>"
                onChange={vi.fn()}
                placeholder="Describe the ticket"
            />,
        );
        expect(screen.queryByText('Describe the ticket')).not.toBeInTheDocument();
    });
});
