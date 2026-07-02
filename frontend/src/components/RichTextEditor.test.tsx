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

// Helper: place a live DOM selection over the editor's content so ProseMirror's
// view.state.selection syncs before a toolbar click. TipTap's toggle chains call
// .focus(); in jsdom the chain short-circuits unless the contenteditable holds a
// live selection.
async function selectEditorContent() {
    const editorEl = document.querySelector('.ProseMirror') as HTMLElement;
    await act(async () => {
        editorEl.focus();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    });
    return editorEl;
}

describe('RichTextEditor', () => {
    it('renders all toolbar buttons with accessible names', () => {
        render(<RichTextEditor value="" onChange={vi.fn()} />);
        // Existing actions.
        expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 3' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Inline code' })).toBeInTheDocument();
        // T4: new actions.
        expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Underline' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 1' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 2' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Heading 4' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Numbered list' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Blockquote' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Code block' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
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

        await selectEditorContent();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Heading 3' }));
        });

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('<h3>');
        expect(lastCall).toContain('turn me into a heading');
    });

    it('emits <strong> when Bold is toggled', async () => {
        const onChange = vi.fn();
        render(<RichTextEditor value="<p>bold me</p>" onChange={onChange} />);

        await selectEditorContent();
        const boldBtn = screen.getByRole('button', { name: 'Bold' });
        // Inline marks need pointerDown before click in jsdom (see bold
        // active-state test comment for the same workaround).
        await act(async () => {
            fireEvent.pointerDown(boldBtn);
        });
        await act(async () => {
            fireEvent.click(boldBtn);
        });

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('<strong>');
        expect(lastCall).toContain('bold me');
    });

    it('emits <s> when Strikethrough is toggled', async () => {
        const onChange = vi.fn();
        render(<RichTextEditor value="<p>strike me</p>" onChange={onChange} />);

        await selectEditorContent();
        const strikeBtn = screen.getByRole('button', { name: 'Strikethrough' });
        await act(async () => {
            fireEvent.pointerDown(strikeBtn);
        });
        await act(async () => {
            fireEvent.click(strikeBtn);
        });

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('<s>');
        expect(lastCall).toContain('strike me');
    });

    // T7: pressed-state contract. The toolbar is a Radix ToggleGroup (type="multiple")
    // whose controlled `value` is derived from editor.isActive(...). Activating a mark
    // must flip the corresponding item's data-state to "on" AND apply the bg-accent
    // token (the F32 token the ToggleGroupItem uses for its on-state). This is the
    // behavior that was entirely missing before the migration (plain buttons, no
    // active state at all).
    it('reflects the active mark as data-state=on with the bg-accent token after toggle', async () => {
        render(<RichTextEditor value="<p>make me bold</p>" onChange={vi.fn()} />);

        // ToggleGroup multiple-mode items render as <button aria-pressed>; accessible
        // name still resolves from aria-label, so getByRole('button') keeps working.
        const boldBtn = screen.getByRole('button', { name: 'Bold' });
        // Before activation the item is off.
        expect(boldBtn.getAttribute('data-state')).toBe('off');

        await selectEditorContent();
        // Radix Toggle/ToggleGroupItem drives its onPressedChange from a native
        // click, but the button's onPointerDown calls preventDefault to keep focus
        // on the contenteditable. fireEvent.click alone in jsdom skips the pointer
        // phase, so the toggle mark (which needs the editor's selection intact AND
        // the composed onClick to fire) does not apply. Drive a pointerDown first
        // to mirror a real user interaction. (Block transforms like toggleHeading
        // are tolerant of a missing pointer phase; inline marks like bold are not.)
        await act(async () => {
            fireEvent.pointerDown(boldBtn);
        });
        await act(async () => {
            fireEvent.click(boldBtn);
        });

        // After the toggle, editor.isActive('bold') is true → activeMarks includes
        // 'bold' → Radix sets data-state="on" + the ToggleGroupItem on-state token.
        await waitFor(() => {
            expect(boldBtn.getAttribute('data-state')).toBe('on');
        });
        expect(boldBtn.className).toContain('bg-accent');
        expect(boldBtn.getAttribute('aria-pressed')).toBe('true');
    });

    // T4: active-state coverage for the new toggles. Each must reflect data-state="on"
    // + aria-pressed=true + the bg-accent token once its mark/node is applied.
    it.each([
        { label: 'Strikethrough', id: 'strikethrough' },
        { label: 'Underline', id: 'underline' },
        { label: 'Heading 1', id: 'heading-1' },
        { label: 'Numbered list', id: 'ordered-list' },
        { label: 'Blockquote', id: 'blockquote' },
        { label: 'Code block', id: 'code-block' },
    ] as const)('reflects active state for $label after toggle', async ({ label }) => {
        render(<RichTextEditor value="<p>target text</p>" onChange={vi.fn()} />);

        const btn = screen.getByRole('button', { name: label });
        expect(btn.getAttribute('data-state')).toBe('off');

        await selectEditorContent();
        await act(async () => {
            fireEvent.pointerDown(btn);
        });
        await act(async () => {
            fireEvent.click(btn);
        });

        await waitFor(() => {
            expect(btn.getAttribute('data-state')).toBe('on');
        });
        expect(btn.className).toContain('bg-accent');
        expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    it('inserts a link over a selection via prompt and emits an <a> with target/rel', async () => {
        const onChange = vi.fn();
        const promptSpy = vi
            .spyOn(window, 'prompt')
            .mockReturnValue('https://example.com/page');
        render(<RichTextEditor value="<p>link me</p>" onChange={onChange} />);

        await selectEditorContent();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Link' }));
        });

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('href="https://example.com/page"');
        expect(lastCall).toContain('target="_blank"');
        expect(lastCall).toContain('rel="noopener noreferrer nofollow"');
        expect(promptSpy).toHaveBeenCalledWith('Link URL');
        promptSpy.mockRestore();
    });

    it('inserts an image via prompt and emits an <img> with the src', async () => {
        const onChange = vi.fn();
        const promptSpy = vi
            .spyOn(window, 'prompt')
            .mockReturnValue('https://example.com/logo.png');
        render(<RichTextEditor value="<p>image target</p>" onChange={onChange} />);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Image' }));
        });

        await waitFor(() => expect(onChange).toHaveBeenCalled());
        const lastCall = onChange.mock.calls.at(-1)?.[0] ?? '';
        expect(lastCall).toContain('<img');
        expect(lastCall).toContain('src="https://example.com/logo.png"');
        expect(promptSpy).toHaveBeenCalledWith('Image URL');
        promptSpy.mockRestore();
    });

    it('renders the placeholder when value is empty', () => {
        render(<RichTextEditor value="" onChange={vi.fn()} placeholder="Describe the ticket" />);
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
