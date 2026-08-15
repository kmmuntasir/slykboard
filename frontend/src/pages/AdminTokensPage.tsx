// SLYK-0380 — /admin/tokens page (agent mode only, platform-admin-gated via
// the route registration). Lists dispatcher HMAC tokens (SLYK-0370 backend),
// hosts <AgentTokenGenerateDialog>, and revokes with a lightweight confirm —
// revoke is destructive so the repo's modal-before-execute rule applies, but
// it is reversible-by-regeneration, so a plain confirm (not a typed slug)
// matches DecommissionDialog's heavyweight tiering.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agentTokenApi, agentTokenKeys, type AgentTokenListItem } from '@/api/agentTokens';
import { AgentTokenGenerateDialog } from '@/components/tokens/AgentTokenGenerateDialog';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/hooks/useToast';

export function AdminTokensPage() {
    const toast = useToast();
    const queryClient = useQueryClient();

    const [generateOpen, setGenerateOpen] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<AgentTokenListItem | null>(null);

    const tokensQuery = useQuery({
        queryKey: agentTokenKeys.all,
        queryFn: () => agentTokenApi.list(),
    });

    const revokeMutation = useMutation({
        mutationFn: (id: string) => agentTokenApi.revoke(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: agentTokenKeys.all });
            toast.success('Token revoked.');
            setRevokeTarget(null);
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'Revoke failed.');
        },
    });

    const tokens = tokensQuery.data ?? [];

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-4">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">Agent Tokens</h1>
                    <p className="text-sm text-muted-foreground">
                        Dispatcher HMAC tokens. Raw values are shown once at generation.
                    </p>
                </div>
                <Button size="sm" onClick={() => setGenerateOpen(true)}>
                    Generate token
                </Button>
            </div>

            <div className="rounded-lg border">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-left text-muted-foreground">
                            <th className="px-4 py-2 font-medium">Name</th>
                            <th className="px-4 py-2 font-medium">Scope</th>
                            <th className="px-4 py-2 font-medium">Created</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tokensQuery.isLoading && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                    Loading tokens…
                                </td>
                            </tr>
                        )}
                        {tokensQuery.isError && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-destructive">
                                    Failed to load tokens.
                                </td>
                            </tr>
                        )}
                        {!tokensQuery.isLoading && !tokensQuery.isError && tokens.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                                    No tokens yet. Generate one and paste it into the dispatcher env.
                                </td>
                            </tr>
                        )}
                        {tokens.map((t) => (
                            <tr key={t.id} className="border-b last:border-b-0">
                                <td className="px-4 py-2 font-medium">{t.name}</td>
                                <td className="px-4 py-2 text-muted-foreground">
                                    {t.projectId === null ? 'Platform-wide' : t.projectId}
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">
                                    {new Date(t.createdAt).toLocaleString()}
                                </td>
                                <td className="px-4 py-2">
                                    {t.revokedAt === null ? (
                                        <Badge>Active</Badge>
                                    ) : (
                                        <Badge variant="outline">Revoked</Badge>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                    {t.revokedAt === null && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setRevokeTarget(t)}
                                        >
                                            Revoke
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <AgentTokenGenerateDialog
                isOpen={generateOpen}
                onClose={() => setGenerateOpen(false)}
                projects={[]}
            />

            <Modal
                isOpen={revokeTarget !== null}
                onClose={() => {
                    if (!revokeMutation.isPending) setRevokeTarget(null);
                }}
                titleId="revoke-token-title"
                title={`Revoke token ${revokeTarget?.name ?? ''}?`}
                blockBackdropClose
            >
                <p className="text-sm text-muted-foreground">
                    Dispatcher requests signed with this token will start failing (401). You can
                    generate a replacement token afterwards.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRevokeTarget(null)}
                        disabled={revokeMutation.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
                        disabled={revokeMutation.isPending}
                    >
                        {revokeMutation.isPending ? 'Revoking…' : 'Revoke token'}
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
