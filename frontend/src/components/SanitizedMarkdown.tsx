import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// SLYK-0340 — sanitized markdown renderer for agent-chat message bodies
// (03-security.md § Input validation: "Rendered as markdown on the frontend —
// never raw HTML. Use react-markdown with rehype-sanitize to strip dangerous
// tags"). Applies to AGENT + PM bodies (SYSTEM too — it is dispatcher-fed,
// same trust boundary).
//
// Defense-in-depth, not just the default schema:
//   1. react-markdown never renders raw HTML by default — an inline <script>
//      in a body is parsed as literal text and re-escaped, so the tag can never
//      reach the DOM as an element.
//   2. rehype-sanitize (GitHub's allow-list profile) runs on the generated
//      hast anyway: stripping is opt-out only — we narrow it to a chat-minimal
//      tag set and DROP the `className` allowances (defaultSchema permits
//      code/header classNames) so no attribute survives that we did not vet.
//   3. `javascript:` URLs: the default schema's protocols allow-list (http,
//      https, mailto, etc.) drops any other scheme, so
//      [x](javascript:alert(1)) renders with the href stripped (link text
//      kept, navigation impossible).
//   4. target/rel are not in the allow-list, so sanitize never emits an
//      unsandboxed target=_blank either.

/** Chat-minimal tag allow-list — the GitHub profile minus everything a
 *  chat bubble cannot meaningfully contain (tables, task lists, images
 *  from arbitrary origins, headings above h3). */
const CHAT_SCHEMA = {
    ...defaultSchema,
    tagNames: [
        'p',
        'br',
        'strong',
        'em',
        'del',
        'code',
        'pre',
        'blockquote',
        'ul',
        'ol',
        'li',
        'a',
        'h3',
        'h4',
        'hr',
    ],
    attributes: {
        ...defaultSchema.attributes,
        // `a` keeps ONLY vetted href — no target/rel/title passthrough.
        a: ['href'],
        // code/pre lose their className allowances (no highlight classes).
        code: [],
        pre: [],
        span: [],
    },
    // No raw HTML passthrough even if a future remark plugin were to add one.
    allowDangerousProtocol: false,
};

export interface SanitizedMarkdownProps {
    /** Markdown source (message body). */
    children: string;
}

/** Render `children` as sanitized markdown. Never throws on adversarial input. */
export const SanitizedMarkdown = memo(function SanitizedMarkdown({
    children,
}: SanitizedMarkdownProps) {
    return (
        <div className="markdown-body text-sm leading-relaxed break-words">
            <ReactMarkdown rehypePlugins={[[rehypeSanitize, CHAT_SCHEMA]]}>
                {children}
            </ReactMarkdown>
        </div>
    );
});
