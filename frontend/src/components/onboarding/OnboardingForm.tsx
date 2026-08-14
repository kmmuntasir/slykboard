// SLYK-0230 — <OnboardingForm>, the /admin/onboarding page body
// (docs/agentic-automation/06-frontend-ui.md § "Add Project page" +
// 05-backend-routes.md § POST /api/v1/admin/projects).
//
// Form conventions follow AddMemberModal.tsx: plain useState (no form
// library), UI-kit inputs, UI-kit Field wrappers, inline role="alert" errors.
// Client-side validation mirrors the backend's Zod rules (admin-agent.schema.ts)
// so invalid payloads never leave the browser; server 4xx (CONFLICT on slug/
// subdomain taken) still render inline, 5xx/502 (dispatcher down) toasts —
// per the ticket: "inline 4xx errors; 5xx toast".
//
// Agent-mode gating is structural, not conditional: this module is only
// reachable through the agent-routes array in routes/index.tsx (React.lazy),
// which plain-mode builds statically prune — no runtime check needed here.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '@/api/client';
import { onboardingApi, onboardingKeys, projectKeysRef } from '@/api/onboarding';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/hooks/useToast';
import type {
    AgentStack,
    AgentVisibility,
    CreateAgentProjectBody,
    SourceMode,
} from '@/types/onboarding';

export interface OnboardingFormProps {
    /** Test seam: override navigation (production default = react-router). */
    navigate?: (path: string) => void;
}

// ── Validation rules — mirror backend admin-agent.schema.ts exactly ─────────

const KEBAB_REGEX = /^[a-z0-9-]+$/;
const GITHUB_REPO_SSH_REGEX = /^git@github\.com:[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.git$/;
const GITHUB_REPO_HTTPS_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.git$/;

// Reserved subdomains (05-backend-routes.md § validation — shared infra hostnames).
const RESERVED_SUBDOMAINS: readonly string[] = ['api', 'www', 'admin', 'dispatcher', 'cyrus'];

const STACK_OPTIONS: ReadonlyArray<{ value: AgentStack; label: string }> = [
    { value: 'node-express', label: 'Node / Express' },
    { value: 'next', label: 'Next.js' },
    { value: 'python-fastapi', label: 'Python / FastAPI' },
    { value: 'go', label: 'Go' },
    { value: 'static', label: 'Static site' },
];

// Agent backend select: null = "Use global default" (06-frontend-ui.md). The
// registered backends today are just 'cyrus'; more arrive in later phases.
const AGENT_BACKEND_OPTIONS: ReadonlyArray<{ value: string | null; label: string }> = [
    { value: null, label: 'Use global default' },
    { value: 'cyrus', label: 'Cyrus' },
];

const VISIBILITY_OPTIONS: ReadonlyArray<{ value: AgentVisibility; label: string; hint: string }> = [
    { value: 'internal', label: 'Internal', hint: 'Workspace members only' },
    { value: 'public', label: 'Public', hint: 'Anyone with the URL' },
];

const SOURCE_MODE_OPTIONS: ReadonlyArray<{ value: SourceMode; label: string }> = [
    { value: 'new', label: 'New from template' },
    { value: 'existing', label: 'Existing repo' },
];

// Slug derivation for the name → slug auto-fill: lowercase, spaces/underscores
// → hyphens, strip anything outside [a-z0-9-], collapse runs of hyphens. The
// field stays editable; this only seeds it while untouched.
function deriveSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function isGithubRepoUrl(value: string): boolean {
    return GITHUB_REPO_SSH_REGEX.test(value) || GITHUB_REPO_HTTPS_REGEX.test(value);
}

interface FieldErrors {
    name?: string;
    slug?: string;
    subdomain?: string;
    githubRepo?: string;
}

export function OnboardingForm({ navigate: navigateOverride }: OnboardingFormProps = {}) {
    const routerNavigate = useNavigate();
    const navigate = navigateOverride ?? ((path: string) => routerNavigate(path));
    const toast = useToast();
    const queryClient = useQueryClient();

    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [slugEdited, setSlugEdited] = useState(false);
    const [subdomain, setSubdomain] = useState('');
    const [sourceMode, setSourceMode] = useState<SourceMode>('new');
    const [githubRepo, setGithubRepo] = useState('');
    const [stack, setStack] = useState<AgentStack>('node-express');
    const [agentBackend, setAgentBackend] = useState<string | null>(null);
    const [visibility, setVisibility] = useState<AgentVisibility>('internal');
    const [initialAgentContext, setInitialAgentContext] = useState('');
    const [contextOpen, setContextOpen] = useState(false);
    const [errors, setErrors] = useState<FieldErrors>({});
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Slug auto-derives from the name until the user edits it directly.
    const handleNameChange = (value: string) => {
        setName(value);
        if (!slugEdited) setSlug(deriveSlug(value));
    };

    // Client-side validation — same rules as the backend so the button gates
    // before any request fires. Shows a hint only for touched fields.
    const validate = (): FieldErrors => {
        const next: FieldErrors = {};
        if (!name.trim()) next.name = 'Name is required';
        else if (name.trim().length > 200) next.name = 'Name must be ≤200 chars';

        if (!slug) next.slug = 'Slug is required';
        else if (slug.length > 63) next.slug = 'Slug must be ≤63 chars';
        else if (!KEBAB_REGEX.test(slug))
            next.slug = 'Slug must be lowercase alphanumeric with hyphens';

        if (!subdomain) next.subdomain = 'Subdomain is required';
        else if (subdomain.length > 63) next.subdomain = 'Subdomain must be ≤63 chars';
        else if (!KEBAB_REGEX.test(subdomain))
            next.subdomain = 'Subdomain must be lowercase alphanumeric with hyphens';
        else if (RESERVED_SUBDOMAINS.includes(subdomain))
            next.subdomain = `Subdomain is reserved (${RESERVED_SUBDOMAINS.join(', ')})`;

        if (sourceMode === 'existing') {
            if (!githubRepo.trim()) next.githubRepo = 'GitHub repo URL is required';
            else if (!isGithubRepoUrl(githubRepo.trim()))
                next.githubRepo =
                    'Must be an SSH (git@github.com:org/repo.git) or HTTPS (.git) URL';
        }

        return next;
    };

    const fieldErrors = validate();
    const formValid = Object.keys(fieldErrors).length === 0;

    const mutation = useMutation({
        mutationFn: (body: CreateAgentProjectBody) => onboardingApi.createProject(body),
        meta: { suppressGlobalToast: true },
        onSuccess: (_project, body) => {
            // Fresh admin list + timeline on next visit.
            void queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
            void queryClient.invalidateQueries({ queryKey: projectKeysRef.lists() });
            // 06-frontend-ui.md submit step 2: redirect to the timeline page.
            // Uses the SUBMITTED agent slug — the response carries the core
            // project row whose slug is the mapped uppercase board form
            // (SLYK-0190 mapCoreSlug), which is not an agent URL.
            navigate(`/admin/projects/${body.slug}/onboarding`);
        },
        onError: (err: unknown) => {
            if (err instanceof ApiClientError && err.status >= 400 && err.status < 500) {
                // 4xx → inline (CONFLICT slug/subdomain taken, VALIDATION_FAILED).
                setSubmitError(err.message);
            } else {
                // 5xx/502 (dispatcher unreachable) → toast per the ticket.
                setSubmitError(null);
                toast.error('Failed to start onboarding — see project page for details');
            }
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);
        if (!formValid || mutation.isPending) {
            setErrors(fieldErrors);
            return;
        }
        setErrors({});
        mutation.mutate({
            name: name.trim(),
            slug,
            subdomain,
            sourceMode,
            githubRepo: sourceMode === 'existing' ? githubRepo.trim() : null,
            stack,
            agentBackend,
            visibility,
            initialAgentContext: initialAgentContext.trim() ? initialAgentContext : null,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            <Card className="space-y-4 p-6">
                <Field label="Project name" htmlFor="onboarding-name" error={errors.name}>
                    <TextInput
                        id="onboarding-name"
                        value={name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="Inventory Tracker"
                        className="w-full"
                        disabled={mutation.isPending}
                        required
                    />
                </Field>

                <Field label="Slug" htmlFor="onboarding-slug" error={errors.slug}>
                    <TextInput
                        id="onboarding-slug"
                        value={slug}
                        onChange={(e) => {
                            setSlugEdited(true);
                            setSlug(e.target.value);
                        }}
                        placeholder="inventory-tracker"
                        className="w-full"
                        disabled={mutation.isPending}
                        required
                    />
                </Field>

                <Field label="Subdomain" htmlFor="onboarding-subdomain" error={errors.subdomain}>
                    <div className="flex items-center gap-2">
                        <TextInput
                            id="onboarding-subdomain"
                            value={subdomain}
                            onChange={(e) => setSubdomain(e.target.value)}
                            placeholder="inventory-tracker"
                            className="w-full"
                            disabled={mutation.isPending}
                            required
                        />
                        <span className="shrink-0 text-sm text-muted-foreground">.kmlab.dev</span>
                    </div>
                </Field>

                {/* Source mode toggle — 06-frontend-ui.md toggle UX (two
                    buttons, checked one highlighted; repo URL only under
                    'existing'). */}
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Source mode</legend>
                    <div className="flex gap-2" role="group" aria-label="Source mode">
                        {SOURCE_MODE_OPTIONS.map((opt) => {
                            const active = sourceMode === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setSourceMode(opt.value)}
                                    disabled={mutation.isPending}
                                    className={
                                        'flex-1 rounded-md border px-3 py-2 text-sm transition-colors ' +
                                        (active
                                            ? 'border-primary bg-primary/10 font-medium text-primary'
                                            : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground')
                                    }
                                >
                                    {opt.label}
                                    {active ? ' ✓' : ''}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>

                {sourceMode === 'existing' ? (
                    <Field
                        label="GitHub repo URL"
                        htmlFor="onboarding-repo"
                        error={errors.githubRepo}
                    >
                        <TextInput
                            id="onboarding-repo"
                            value={githubRepo}
                            onChange={(e) => setGithubRepo(e.target.value)}
                            placeholder="git@github.com:org/repo.git"
                            className="w-full font-mono text-sm"
                            disabled={mutation.isPending}
                            required
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            SSH URL preferred (matches Cyrus&apos;s GitHub user auth). HTTPS
                            accepted for PAT-authenticated repos.
                        </p>
                    </Field>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Stack" htmlFor="onboarding-stack">
                        <Select value={stack} onValueChange={(v) => setStack(v as AgentStack)}>
                            <SelectTrigger
                                id="onboarding-stack"
                                aria-label="Stack"
                                className="w-full"
                                disabled={mutation.isPending}
                            >
                                <SelectValue placeholder="Stack">
                                    {STACK_OPTIONS.find((o) => o.value === stack)?.label}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {STACK_OPTIONS.map((opt) => (
                                    <SelectItem
                                        key={opt.value}
                                        value={opt.value}
                                        textValue={opt.label}
                                    />
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field label="Agent backend" htmlFor="onboarding-backend">
                        <Select
                            value={agentBackend ?? '__default__'}
                            onValueChange={(v) => setAgentBackend(v === '__default__' ? null : v)}
                        >
                            <SelectTrigger
                                id="onboarding-backend"
                                aria-label="Agent backend"
                                className="w-full"
                                disabled={mutation.isPending}
                            >
                                <SelectValue placeholder="Agent backend">
                                    {
                                        AGENT_BACKEND_OPTIONS.find((o) => o.value === agentBackend)
                                            ?.label
                                    }
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {AGENT_BACKEND_OPTIONS.map((opt) => (
                                    <SelectItem
                                        key={opt.value ?? '__default__'}
                                        value={opt.value ?? '__default__'}
                                        textValue={opt.label}
                                    />
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </div>

                {/* Visibility radios — 06-frontend-ui.md RadioGroup. */}
                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Visibility</legend>
                    <div className="flex gap-4" role="radiogroup" aria-label="Visibility">
                        {VISIBILITY_OPTIONS.map((opt) => {
                            const active = visibility === opt.value;
                            return (
                                <label
                                    key={opt.value}
                                    className={
                                        'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ' +
                                        (active
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border hover:bg-accent/50')
                                    }
                                >
                                    <input
                                        type="radio"
                                        name="visibility"
                                        value={opt.value}
                                        checked={active}
                                        onChange={() => setVisibility(opt.value)}
                                        disabled={mutation.isPending}
                                        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                    <span className="font-medium">{opt.label}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {opt.hint}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                {/* Optional agent context — collapsed by default (06 doc). */}
                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                            checked={contextOpen}
                            onCheckedChange={(checked) => setContextOpen(checked === true)}
                            aria-label="Add initial agent context (optional)"
                        />
                        Initial agent context (optional)
                    </label>
                    {contextOpen ? (
                        <div className="space-y-1">
                            <Textarea
                                id="onboarding-context"
                                value={initialAgentContext}
                                onChange={(e) => setInitialAgentContext(e.target.value)}
                                placeholder="This project manages warehouse inventory… (markdown — becomes the AGENTS.md seed)"
                                rows={6}
                                className="w-full font-mono text-sm"
                                disabled={mutation.isPending}
                            />
                            <p className="text-xs text-muted-foreground">
                                Markdown, ≤10,000 chars. Seeds AGENTS.md for the agent.
                            </p>
                        </div>
                    ) : null}
                </div>
            </Card>

            {submitError ? (
                <p role="alert" className="text-sm text-destructive">
                    {submitError}
                </p>
            ) : null}

            <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={!formValid || mutation.isPending}>
                    {mutation.isPending ? 'Starting onboarding…' : 'Create project'}
                </Button>
            </div>
        </form>
    );
}
