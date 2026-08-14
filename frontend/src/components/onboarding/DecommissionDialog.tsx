// SLYK-0240 — <DecommissionDialog>, the destructive-confirm modal for project
// decommission (docs/agentic-automation/06-frontend-ui.md § DecommissionDialog
// + 03-security.md § Decommission safety layer 2). Hosted on the admin project
// (timeline) page's "Remove" button.
//
// Slug-match gate: the Remove button enables only when the typed text equals
// project.slug EXACTLY (case/space sensitive — the near-miss cases the ticket
// lists must all stay disabled). Submit POSTs
// /api/v1/admin/projects/:slug/decommission with {confirmSlug}.
//
// Response handling per the ticket: 202 → close modal (the timeline's own
// polling then carries DECOMMISSIONING → DECOMMISSIONED); 400 → inline error;
// 502 → toast "dispatcher unavailable — retry from project page" (the
// DECOMMISSIONING write has already committed server-side, so the modal stays
// open for a manual retry per 03-security layer 4).
//
// Cancel always available; Escape closes (Modal → useModalA11y handles both).
//
// Agent-mode gating is structural (see OnboardingForm.tsx header note).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';

import { ApiClientError } from '@/api/client';
import { onboardingApi, onboardingKeys } from '@/api/onboarding';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { TextInput } from '@/components/ui/TextInput';
import { useToast } from '@/hooks/useToast';

// The fields the consequence bullets quote (03-security.md § Decommission
// safety — the four teardown targets). Everything here comes off the widened
// SLYK-0230 timeline payload, so the dialog adds no fetch of its own.
export interface DecommissionProjectInfo {
    slug: string;
    name: string;
    subdomain: string;
    lxcCtid: number | null;
    githubRepoCreated: boolean;
}

export interface DecommissionDialogProps {
    isOpen: boolean;
    project: DecommissionProjectInfo;
    onClose: () => void;
    /** Test seam: suppresses the toast so jsdom tests assert it directly. */
    onRemoved?: () => void;
}

export function DecommissionDialog({
    isOpen,
    project,
    onClose,
    onRemoved,
}: DecommissionDialogProps) {
    const toast = useToast();
    const queryClient = useQueryClient();

    const [confirmText, setConfirmText] = useState('');
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Exact match only: case mismatch, stray spaces, and wrong slugs all stay
    // disabled (the ticket's near-miss acceptance cases).
    const slugMatches = confirmText === project.slug;

    const mutation = useMutation({
        mutationFn: (confirmSlug: string) =>
            onboardingApi.decommissionProject(project.slug, { confirmSlug }),
        meta: { suppressGlobalToast: true },
        onSuccess: () => {
            // The timeline flips to DECOMMISSIONING on the next 3s poll; a
            // fresh fetch now closes that gap immediately.
            void queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
            onClose();
            onRemoved?.();
        },
        onError: (err: unknown) => {
            if (err instanceof ApiClientError && err.status === 502) {
                // Dispatcher down. The DECOMMISSIONING write already committed
                // (03-security layer 4) — the admin retries from the project
                // page, so close the modal and toast rather than inline-block.
                setSubmitError(null);
                toast.error('dispatcher unavailable — retry from project page');
                onClose();
                return;
            }
            // 400 VALIDATION_FAILED (confirmSlug mismatch server-side) and any
            // other 4xx render inline; the modal stays open.
            setSubmitError(err instanceof Error ? err.message : 'Decommission failed.');
        },
    });

    const handleCancel = () => {
        if (mutation.isPending) return; // no mid-flight cancels on a destructive POST
        onClose();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!slugMatches || mutation.isPending) return;
        setSubmitError(null);
        mutation.mutate(confirmText);
    };

    // Consequence bullets per the 06 sketch. The GitHub bullet varies on
    // githubRepoCreated: the repo is deleted only when onboarding created it.
    const bullets: string[] = [
        project.lxcCtid === null
            ? 'destroy the LXC container (not yet provisioned)'
            : `destroy LXC container ${project.lxcCtid}`,
        `delete Zoraxy proxy host ${project.subdomain}.kmlab.dev`,
        'deregister the repo from the Cyrus agent',
        project.githubRepoCreated
            ? 'delete the GitHub repo (created by onboarding)'
            : 'close any open onboarding PR (repo left intact)',
    ];

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleCancel}
            titleId="decommission-dialog-title"
            title={`Remove project ${project.name}?`}
            blockBackdropClose
        >
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="flex items-start gap-3">
                    <TriangleAlert
                        aria-hidden
                        className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
                    />
                    <div>
                        <p className="text-sm font-medium">This will:</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {bullets.map((bullet) => (
                                <li key={bullet}>{bullet}</li>
                            ))}
                        </ul>
                    </div>
                </div>

                <p className="text-sm font-medium text-destructive">
                    This action cannot be undone.
                </p>

                <Field
                    label={`Type the project slug (${project.slug}) to confirm:`}
                    htmlFor="decommission-confirm-slug"
                    error={submitError ?? undefined}
                >
                    <TextInput
                        id="decommission-confirm-slug"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full font-mono text-sm"
                        placeholder={project.slug}
                        disabled={mutation.isPending}
                        aria-invalid={submitError ? true : undefined}
                    />
                </Field>

                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancel}
                        disabled={mutation.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="destructive"
                        size="sm"
                        disabled={!slugMatches || mutation.isPending}
                    >
                        {mutation.isPending ? 'Removing…' : 'Remove project'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
