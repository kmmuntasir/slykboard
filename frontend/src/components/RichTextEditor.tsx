import { useEffect } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import {
    Bold,
    Italic,
    Strikethrough,
    Underline as UnderlineIcon,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    List,
    ListOrdered,
    Quote,
    Code,
    CodeXml,
    Link as LinkIcon,
    Image as ImageIcon,
    type LucideIcon,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from './ui/ToggleGroup';

interface RichTextEditorProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
}

// T4: array-driven toolbar config. Replaces ~90% duplicated ToggleGroupItem
// blocks (AGENTS.md reusability rule) with a single parameterized structure.
// Each entry knows its id, accessible label, lucide glyph, how to read its
// active state from the editor, and how to run its command/handler. The
// render path maps this array, so adding a new action is a one-line append.
//
// `id` is the value pushed into the Radix ToggleGroup (type="multiple") value
// array when `isActive(editor)` is true — that drives data-state="on" +
// aria-pressed automatically. Image is insert-only (isActive always false).
interface ToolbarAction {
    id: string;
    label: string;
    Icon: LucideIcon;
    isActive: (editor: Editor) => boolean;
    run: (editor: Editor) => void;
}

// URL allow-lists for the Link/Image prompt handlers. http(s) and mailto (link
// only); anything else — especially `javascript:` and `data:` — is rejected
// client-side before being handed to the editor (defense against XSS injection
// via the prompt surface). Reinforces the no-upload / no-base64 policy.
const HTTP_OR_MAILTO = /^(https?:\/\/|mailto:)/i;
const HTTP_ONLY = /^https?:\/\//i;
const REJECT_SCHEMES = /javascript:|data:/i;

const TOOLBAR_ACTIONS: ToolbarAction[] = [
    // --- text marks ---
    {
        id: 'bold',
        label: 'Bold',
        Icon: Bold,
        isActive: (editor) => editor.isActive('bold'),
        run: (editor) => editor.chain().focus().toggleBold().run(),
    },
    {
        id: 'italic',
        label: 'Italic',
        Icon: Italic,
        isActive: (editor) => editor.isActive('italic'),
        run: (editor) => editor.chain().focus().toggleItalic().run(),
    },
    {
        id: 'strikethrough',
        label: 'Strikethrough',
        Icon: Strikethrough,
        isActive: (editor) => editor.isActive('strike'),
        run: (editor) => editor.chain().focus().toggleStrike().run(),
    },
    {
        id: 'underline',
        label: 'Underline',
        Icon: UnderlineIcon,
        isActive: (editor) => editor.isActive('underline'),
        run: (editor) => editor.chain().focus().toggleUnderline().run(),
    },
    {
        id: 'inline-code',
        label: 'Inline code',
        Icon: Code,
        isActive: (editor) => editor.isActive('code'),
        run: (editor) => editor.chain().focus().toggleCode().run(),
    },
    // --- headings ---
    {
        id: 'heading-1',
        label: 'Heading 1',
        Icon: Heading1,
        isActive: (editor) => editor.isActive('heading', { level: 1 }),
        run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
        id: 'heading-2',
        label: 'Heading 2',
        Icon: Heading2,
        isActive: (editor) => editor.isActive('heading', { level: 2 }),
        run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
        id: 'heading-3',
        label: 'Heading 3',
        Icon: Heading3,
        isActive: (editor) => editor.isActive('heading', { level: 3 }),
        run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
        id: 'heading-4',
        label: 'Heading 4',
        Icon: Heading4,
        isActive: (editor) => editor.isActive('heading', { level: 4 }),
        run: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
    },
    // --- lists ---
    {
        id: 'bullet-list',
        label: 'Bullet list',
        Icon: List,
        isActive: (editor) => editor.isActive('bulletList'),
        run: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
        id: 'ordered-list',
        label: 'Numbered list',
        Icon: ListOrdered,
        isActive: (editor) => editor.isActive('orderedList'),
        run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    // --- blocks ---
    {
        id: 'blockquote',
        label: 'Blockquote',
        Icon: Quote,
        isActive: (editor) => editor.isActive('blockquote'),
        run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
        id: 'code-block',
        label: 'Code block',
        Icon: CodeXml,
        isActive: (editor) => editor.isActive('codeBlock'),
        run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    // --- insert (Link is a toggle; Image is insert-only) ---
    {
        id: 'link',
        label: 'Link',
        Icon: LinkIcon,
        isActive: (editor) => editor.isActive('link'),
        run: (editor) => handleLink(editor),
    },
    {
        id: 'image',
        label: 'Image',
        Icon: ImageIcon,
        isActive: () => false,
        run: (editor) => handleImage(editor),
    },
];

// Link handler: toggle off if active, otherwise prompt for a URL. Rejects
// anything that isn't http(s)/mailto and explicitly rejects javascript:/data:.
// With a selection the mark wraps the selected text; with no selection it
// prompts for display text and inserts a fresh <a>.
function handleLink(editor: Editor): void {
    if (editor.isActive('link')) {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
    }
    const url = window.prompt('Link URL');
    if (!url || REJECT_SCHEMES.test(url) || !HTTP_OR_MAILTO.test(url)) {
        return;
    }
    const { from, to } = editor.state.selection;
    if (from !== to) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    } else {
        const displayText = window.prompt('Link display text');
        editor.chain().focus().insertContent(`<a href="${url}">${displayText}</a>`).run();
    }
}

// Image handler: URL-only insert (no file input, no upload UI, no base64 —
// allowBase64:false on the extension reinforces this). Rejects non-http(s)
// schemes and javascript:/data: URIs.
function handleImage(editor: Editor): void {
    const url = window.prompt('Image URL');
    if (!url || REJECT_SCHEMES.test(url) || !HTTP_ONLY.test(url)) {
        return;
    }
    editor.chain().focus().setImage({ src: url, alt: '' }).run();
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
    const editor = useEditor({
        // T4: StarterKit v3.27.x now bundles Underline + Link (and Strike) by
        // default. We disable StarterKit's underline/link so we can register the
        // standalone, explicitly-configured extensions below without
        // double-registering (which throws at editor construction). Strike stays
        // in StarterKit — toggleStrike works out of the box. Image is NOT in
        // StarterKit, so it is added directly.
        extensions: [
            StarterKit.configure({
                underline: false,
                link: false,
            }),
            Underline,
            // v3 LinkOptions has no `openInNewWindow` (that was a v2 concept);
            // links-open-in-new-tab intent is realized via HTMLAttributes
            // (target=_blank + rel=noopener noreferrer nofollow). autolink off
            // so we only get links the user explicitly inserts.
            Link.configure({
                autolink: false,
                HTMLAttributes: {
                    rel: 'noopener noreferrer nofollow',
                    target: '_blank',
                },
            }),
            Image.configure({ inline: false, allowBase64: false }),
        ],
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
    // T4: now consumes every action's isActive(editor) so the pressed state
    // reflects ALL toggles (marks, headings, lists, blocks, link).
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
            return TOOLBAR_ACTIONS.filter((action) => action.isActive(editor)).map(
                (action) => action.id,
            );
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
                // flex-wrap on the CONSUMER className only — the shared ToggleGroup
                // primitive default (used unchanged by ThemeToggle) stays wrap-free.
                className="mb-2 flex-wrap gap-2 text-sm"
            >
                {TOOLBAR_ACTIONS.map((action) => (
                    <ToggleGroupItem
                        key={action.id}
                        value={action.id}
                        aria-label={action.label}
                        onClick={() => editor && action.run(editor)}
                    >
                        <action.Icon size={14} />
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            <EditorContent editor={editor} />
            {placeholder && !value && (
                <p className="text-xs text-muted-foreground">{placeholder}</p>
            )}
        </div>
    );
}
