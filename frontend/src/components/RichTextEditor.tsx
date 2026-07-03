// DEL-02 T4 — Rich text editor backed by a self-hosted, FREE/GPL CKEditor 5
// build (no cloud license, no premium). Replaces the prior TipTap + Radix
// ToggleGroup surface. Only the documented free plugins are bundled; the image
// insert UX stays prompt-based (window.prompt) with the original http(s)-only
// / reject-javascript:/data: security posture via a custom PromptImageInsert
// plugin.
import { useEffect, useMemo, useRef } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
    Autoformat,
    BlockQuote,
    Bold,
    ButtonView,
    ClassicEditor,
    Code,
    CodeBlock,
    Essentials,
    Heading,
    IconImage,
    Image,
    ImageCaption,
    ImageStyle,
    ImageToolbar,
    Italic,
    Link,
    List,
    ListProperties,
    Paragraph,
    Plugin,
    Strikethrough,
    Underline,
} from 'ckeditor5';
import type { Editor, EditorConfig } from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';

interface RichTextEditorProps {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
}

// URL allow-lists carried over verbatim from the TipTap implementation (T4).
// HTTP_ONLY + REJECT_SCHEMES back the image-insert validation below; HTTP_OR_MAILTO
// documents the link-side security posture and is retained for any future custom
// link guard. CKEditor's built-in Link feature now owns runtime href handling
// (defaultProtocol + the openExternal decorator), so HTTP_OR_MAILTO is a reference
// rather than invoked in this build.
const HTTP_OR_MAILTO = /^(https?:\/\/|mailto:)/i;
const HTTP_ONLY = /^https?:\/\//i;
const REJECT_SCHEMES = /javascript:|data:/i;

// Reference the link allow-list so the constant stays load-bearing (not dead)
// alongside the image guard, keeping both halves of the original T4 security
// posture in one place.
void HTTP_OR_MAILTO;

// Pure validation helper for the custom image-insert plugin. Exported so it can
// be unit-tested in isolation (no editor instance required). http(s) only and
// explicitly rejects javascript:/data: URIs (defense against XSS injection via
// the prompt surface; reinforces the no-upload / no-base64 policy).
export function isValidImageUrl(url: string): boolean {
    return HTTP_ONLY.test(url) && !REJECT_SCHEMES.test(url);
}

// Toolbar item names map to CKEditor 5 commands / dropdowns. '|' is a visual
// separator rendered by the toolbar (not a button). 'promptImageInsert' is the
// factory name registered by the custom PromptImageInsert plugin below.
const TOOLBAR_ITEMS = [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'code',
    '|',
    'heading',
    '|',
    'bulletedList',
    'numberedList',
    '|',
    'blockQuote',
    'codeBlock',
    'link',
    'promptImageInsert',
    '|',
    'undo',
    'redo',
] as const;

const HEADING_OPTIONS = [
    { model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
    { model: 'heading1', view: 'h1', title: 'Heading 1', class: 'ck-heading_heading1' },
    { model: 'heading2', view: 'h2', title: 'Heading 2', class: 'ck-heading_heading2' },
    { model: 'heading3', view: 'h3', title: 'Heading 3', class: 'ck-heading_heading3' },
    { model: 'heading4', view: 'h4', title: 'Heading 4', class: 'ck-heading_heading4' },
    { model: 'heading5', view: 'h5', title: 'Heading 5', class: 'ck-heading_heading5' },
    { model: 'heading6', view: 'h6', title: 'Heading 6', class: 'ck-heading_heading6' },
] as const;

// Custom plugin: registers a single toolbar button ('promptImageInsert') that
// opens a window.prompt for the image URL and inserts it via the 'insertImage'
// command (registered by the Image plugin). Preserves the original prompt-based,
// URL-only UX plus the http(s)-only / reject-javascript:/data: guard.
class PromptImageInsert extends Plugin {
    public static readonly pluginName = 'PromptImageInsert';

    public init(): void {
        this.editor.ui.componentFactory.add('promptImageInsert', (locale) => {
            const button = new ButtonView(locale);
            button.set({ label: 'Image', icon: IconImage, tooltip: true });
            button.on('execute', () => {
                const url = window.prompt('Image URL');
                if (url && isValidImageUrl(url)) {
                    this.editor.execute('insertImage', { source: [{ src: url }] });
                    this.editor.editing.view.focus();
                }
            });
            return button;
        });
    }
}

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
    // The editor instance is created asynchronously by the React wrapper in
    // onReady; stash it so the controlled-value effect can read/write data.
    const editorRef = useRef<Editor | null>(null);
    // Loop guard: while WE push external data into the editor (setData), CKEditor
    // fires change:data synchronously → the wrapper calls onChange. Setting this
    // before setData and clearing it after stops that re-emit from echoing back
    // to the parent as a "user edit".
    const applyingExternalData = useRef(false);

    // config is stable per placeholder; memoized so a parent re-render (which
    // happens on every keystroke) does not rebuild the plugin/toolbar arrays.
    const config = useMemo<EditorConfig>(
        () => ({
            licenseKey: 'GPL',
            plugins: [
                Essentials,
                Paragraph,
                Bold,
                Italic,
                Underline,
                Strikethrough,
                Code,
                CodeBlock,
                Heading,
                List,
                ListProperties,
                Link,
                BlockQuote,
                Image,
                ImageCaption,
                ImageStyle,
                ImageToolbar,
                Autoformat,
                PromptImageInsert,
            ],
            toolbar: { items: [...TOOLBAR_ITEMS] },
            heading: { options: [...HEADING_OPTIONS] },
            link: {
                addTargetToExternalLinks: true,
                defaultProtocol: 'https://',
                decorators: {
                    openExternal: {
                        mode: 'automatic' as const,
                        callback: () => true,
                        attributes: {
                            rel: 'noopener noreferrer nofollow',
                            target: '_blank',
                        },
                    },
                },
            },
            placeholder,
        }),
        [placeholder],
    );

    // Controlled-value sync. `data={value}` supplies the INITIAL content; this
    // effect handles subsequent external updates (form reset, programmatic set).
    // The trimmed-equality guard skips setData when the incoming value already
    // matches the editor's current data — so a setValue triggered by our own
    // onChange (parent echoing the same HTML back) does not re-feed
    // setData → onChange → setValue forever.
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const current = editor.getData().trim();
        if (current === value.trim()) return;
        applyingExternalData.current = true;
        editor.setData(value);
        applyingExternalData.current = false;
    }, [value]);

    return (
        // D1: focus-within (not focus) — the editable surface lives inside the
        // CKEditor; the ring must fire when the editable OR a toolbar button is
        // focused. `.rich-text` is the shared content stylesheet (index.css)
        // used by the read-only sanitized view too, so edit + read render
        // identically. border-input + the family ring tokens (ring-ring /
        // border-primary) keep the editor reading as a TextInput/Textarea family
        // member. bg-card retained (editor ≠ plain input).
        <div className="rich-text rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-primary">
            <CKEditor
                editor={ClassicEditor}
                data={value}
                config={config}
                onReady={(editor) => {
                    editorRef.current = editor;
                }}
                onChange={(_event, editor) => {
                    if (applyingExternalData.current) return;
                    onChange(editor.getData());
                }}
            />
        </div>
    );
}
