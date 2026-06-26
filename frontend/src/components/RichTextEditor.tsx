import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

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

    return (
        // D1: focus-within (not focus) — the editable surface is the inner EditorContent;
        // the ring must fire when it OR a toolbar button is focused. border-input + the
        // family ring tokens (ring-ring / border-primary) make the editor read as a
        // TextInput/Textarea family member. bg-card retained (editor ≠ plain input).
        <div className="rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-primary">
            <div className="mb-2 flex gap-2 text-sm" role="toolbar" aria-label="Formatting">
                <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleBold().run()}
                    className="rounded px-2 py-1 hover:bg-secondary"
                    aria-label="Bold"
                >
                    <span className="font-semibold">B</span>
                </button>
                <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleItalic().run()}
                    className="rounded px-2 py-1 hover:bg-secondary"
                    aria-label="Italic"
                >
                    <span className="italic">I</span>
                </button>
                <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
                    className="rounded px-2 py-1 hover:bg-secondary"
                    aria-label="Heading 3"
                >
                    H3
                </button>
                <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleBulletList().run()}
                    className="rounded px-2 py-1 hover:bg-secondary"
                    aria-label="Bullet list"
                >
                    • List
                </button>
                <button
                    type="button"
                    onClick={() => editor?.chain().focus().toggleCode().run()}
                    className="rounded px-2 py-1 font-mono hover:bg-secondary"
                    aria-label="Inline code"
                >
                    {'</>'}
                </button>
            </div>
            <EditorContent editor={editor} />
            {placeholder && !value && <p className="text-xs text-muted-foreground">{placeholder}</p>}
        </div>
    );
}
