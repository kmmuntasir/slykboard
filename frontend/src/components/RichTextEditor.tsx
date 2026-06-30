import { useEffect } from 'react';
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ToggleGroup, ToggleGroupItem } from './ui/ToggleGroup';

interface RichTextEditorProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [StarterKit],
        content: value,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            attributes: { class: 'prose min-h-[120px] focus:outline-none' },
        },
    });

    // Sync external value changes (form reset, programmatic update) into the editor.
    // Guard prevents infinite loop: only write if external value differs from current content.
    useEffect(() => {
        if (editor && value !== editor.getHTML()) {
            editor.commands.setContent(value || '');
        }
    }, [value, editor]);

    // T7: derive the pressed/active set from the tiptap editor's live mark/node
    // state. Radix ToggleGroup (type="multiple") reflects `data-state="on" | "off"`
    // + aria-pressed off this controlled `value` array — no manual aria wiring.
    // Each item's onClick fires the matching idempotent tiptap toggle command.
    //
    // useEditorState subscribes to editor transactions (selection/mark changes) and
    // triggers a React re-render so the derived activeMarks — and thus the toolbar's
    // pressed state — stay in sync with the editor. Without it the editor's own view
    // updates on a toggle but this component never recomputes activeMarks, so the
    // pressed state would lag. The selector returns a stable string array compared
    // by deep-equal (the hook default) so unrelated transactions don't over-render.
    const activeMarks = useEditorState({
        editor,
        selector: ({ editor }) => {
            if (!editor) return [];
            const marks: string[] = [];
            if (editor.isActive('bold')) marks.push('bold');
            if (editor.isActive('italic')) marks.push('italic');
            if (editor.isActive('heading', { level: 3 })) marks.push('heading');
            if (editor.isActive('bulletList')) marks.push('list');
            if (editor.isActive('code')) marks.push('code');
            return marks;
        },
    });

    return (
        // D1: focus-within (not focus) — the editable surface is the inner EditorContent;
        // the ring must fire when it OR a toolbar button is focused. border-input + the
        // family ring tokens (ring-ring / border-primary) make the editor read as a
        // TextInput/Textarea family member. bg-card retained (editor ≠ plain input).
        <div className="rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-primary">
            <ToggleGroup
                type="multiple"
                value={activeMarks}
                aria-label="Formatting"
                className="mb-2 gap-2 text-sm"
            >
                <ToggleGroupItem
                    value="bold"
                    aria-label="Bold"
                    onClick={() => editor?.chain().focus().toggleBold().run()}
                >
                    <span className="font-semibold">B</span>
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="italic"
                    aria-label="Italic"
                    onClick={() => editor?.chain().focus().toggleItalic().run()}
                >
                    <span className="italic">I</span>
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="heading"
                    aria-label="Heading 3"
                    onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
                >
                    H3
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="list"
                    aria-label="Bullet list"
                    onClick={() => editor?.chain().focus().toggleBulletList().run()}
                >
                    • List
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="code"
                    aria-label="Inline code"
                    onClick={() => editor?.chain().focus().toggleCode().run()}
                    className="font-mono"
                >
                    {'</>'}
                </ToggleGroupItem>
            </ToggleGroup>
            <EditorContent editor={editor} />
            {placeholder && !value && (
                <p className="text-xs text-muted-foreground">{placeholder}</p>
            )}
        </div>
    );
}
