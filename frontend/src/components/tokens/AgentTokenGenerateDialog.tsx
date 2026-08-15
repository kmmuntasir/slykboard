// SLYK-0380 — <AgentTokenGenerateDialog>, the generate-a-dispatcher-HMAC-token
// modal (docs/agentic-automation/06-frontend-ui.md § AgentTokenGenerateDialog).
// Hosted on /admin/tokens.
//
// Two-step flow: (1) form — name + optional project scoping; (2) reveal — the
// RAW token appears exactly once with a copy button. Dismissal is gated on
// "I've copied it": the acknowledge checkbox enables Close only after a copy
// (clipboard write or fallback selection) has happened. There is NO way to
// re-display the token — only sha256(raw) is stored server-side — so the
// reveal step is the operator's one chance.
//
// Agent-mode gating is structural (see OnboardingForm.tsx header note): the
// page is only reachable through the __AGENT_MODE__ agent routes.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound } from 'lucide-react';

import { ApiClientError } from '@/api/client';
import { agentTokenApi, agentTokenKeys, type GeneratedAgentToken } from '@/api/agentTokens';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Field } from '@/components/ui/Field';
import { TextInput } from '@/components/ui/TextInput';
import { cn } from '@/components/ui/cn';

export interface AgentTokenGenerateDialogProps {
    isOpen: boolean;
    onClose: () => void;
    // Options for the project-scoping select; empty = platform-wide only.
    projects: Array<{ id: string; name: string }>;
}

export function AgentTokenGenerateDialog({
    isOpen,
    onClose,
    projects,
}: AgentTokenGenerateDialogProps) {
    const queryClient = useQueryClient();

    const [name, setName] = useState('');
    const [projectId, setProjectId] = useState<string>('');
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [generated, setGenerated] = useState<GeneratedAgentToken | null>(null);
    const [copied, setCopied] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    // Reset both steps whenever the dialog reopens.
    useEffect(() => {
        if (isOpen) {
            setName('');
            setProjectId('');
            setSubmitError(null);
            setGenerated(null);
            setCopied(false);
            setAcknowledged(false);
        }
    }, [isOpen]);

    const mutation = useMutation({
        mutationFn: () =>
            agentTokenApi.generate({
                name: name.trim(),
                projectId: projectId === '' ? null : projectId,
            }),
        meta: { suppressGlobalToast: true },
        onSuccess: (result) => {
            void queryClient.invalidateQueries({ queryKey: agentTokenKeys.all });
            setSubmitError(null);
            setGenerated(result);
        },
        onError: (err: unknown) => {
            setSubmitError(err instanceof Error ? err.message : 'Token generation failed.');
        },
    });

    const tokenRef = useRef<HTMLDivElement>(null);

    const handleCopy = async () => {
        if (!generated) return;
        // navigator.clipboard needs a secure context; the fallback selects the
        // token text so Ctrl+C is a single keystroke away.
        try {
            await navigator.clipboard.writeText(generated.token);
            setCopied(true);
        } catch {
            const selection = window.getSelection();
            const range = document.createRange();
            if (tokenRef.current) range.selectNodeContents(tokenRef.current);
            selection?.removeAllRanges();
            selection?.addRange(range);
            setCopied(true);
        }
    };

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed.length < 1 || trimmed.length > 200 || mutation.isPending) return;
        setSubmitError(null);
        mutation.mutate();
    };

    const handleClose = () => {
        // No mid-flight closes; past the reveal, only the acknowledgement
        // ("I've copied it") lets the operator out — the gate is the point.
        if (mutation.isPending) return;
        if (generated && !acknowledged) return;
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            titleId="agent-token-generate-title"
            title={generated ? 'Token created' : 'Generate agent token'}
            blockBackdropClose={generated !== null}
        >
            {generated === null ? (
                <form onSubmit={handleFormSubmit} className="space-y-4" noValidate>
                    <div className="flex items-start gap-3">
                        <KeyRound aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                            Generates a dispatcher HMAC token. The raw value is shown{' '}
                            <strong>once</strong> — store it in the dispatcher env immediately.
                        </p>
                    </div>

                    <Field
                        label="Name (e.g. dispatcher-prod)"
                        htmlFor="agent-token-name"
                        error={submitError ?? undefined}
                    >
                        <TextInput
                            id="agent-token-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoComplete="off"
                            className="w-full"
                            placeholder="dispatcher-prod"
                            disabled={mutation.isPending}
                        />
                    </Field>

                    {projects.length > 0 && (
                        <Field
                            label="Project scope — optional, unscoped tokens work platform-wide"
                            htmlFor="agent-token-scope"
                        >
                            <select
                                id="agent-token-scope"
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                disabled={mutation.isPending}
                            >
                                <option value="">Platform-wide</option>
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClose}
                            disabled={mutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            disabled={mutation.isPending || name.trim().length < 1}
                        >
                            {mutation.isPending ? 'Generating…' : 'Generate token'}
                        </Button>
                    </div>
                </form>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm font-medium">
                        Token <span className="font-mono">{generated.name}</span> created. Copy it
                        now — it cannot be retrieved again.
                    </p>
                    <div className="flex items-center gap-2">
                        <div
                            ref={tokenRef}
                            data-testid="generated-token"
                            className="min-w-0 flex-1 truncate rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs"
                        >
                            {generated.token}
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCopy}
                            aria-label="Copy token"
                        >
                            {copied ? (
                                <Check aria-hidden className="h-4 w-4" />
                            ) : (
                                <Copy aria-hidden className="h-4 w-4" />
                            )}
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                    <label
                        className={cn(
                            'flex items-start gap-2 text-sm',
                            !copied && 'text-muted-foreground',
                        )}
                    >
                        <Checkbox
                            checked={acknowledged}
                            onCheckedChange={(v) => setAcknowledged(v === true)}
                            disabled={!copied}
                        />
                        <span>I&apos;ve copied the token somewhere safe</span>
                    </label>
                    <div className="flex justify-end">
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleClose}
                            disabled={!acknowledged}
                        >
                            Close
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
