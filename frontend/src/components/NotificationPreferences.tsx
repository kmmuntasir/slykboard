// SLYK-0390 — <NotificationPreferences>, the per-project per-user email
// opt-ins (06-frontend-ui.md § Notifications + 09-implementation-phases.md
// Phase 5). Three toggles: DONE / BLOCKED_HUMAN / AGENT_WAITING — the only
// states that trigger email ("No intermediate-state emails").
//
// Loads via GET, saves via PUT with a success toast. Checkbox per the UI-kit
// boolean control (same as ChecklistEditor); a group-with-span-label layout
// so the row's clickable surface doesn't fight the checkbox's own label
// semantics (AccountSettingsPage PreferencesSection precedent).
//
// Agent-mode gating is RUNTIME (useRuntimeConfigStore selector per the
// TicketDetailModal precedent) — the host page is shared with plain mode, so
// this component renders nothing when agent mode is off.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
    notificationPreferenceApi,
    notificationPreferenceKeys,
} from '@/api/notificationPreferences';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { SkeletonLine } from '@/components/Skeleton';
import { useRuntimeConfigStore } from '@/stores/useRuntimeConfigStore';
import { useToast } from '@/hooks/useToast';
import type { NotificationPreferences } from '@/types/notificationPreferences';

const TOGGLES: ReadonlyArray<{
    key: keyof NotificationPreferences;
    label: string;
    hint: string;
}> = [
    {
        key: 'notifyOnDone',
        label: 'Ticket deployed',
        hint: 'Email me when my ticket reaches DONE',
    },
    {
        key: 'notifyOnBlockedHuman',
        label: 'Blocked — needs human help',
        hint: 'Email me when my ticket is blocked',
    },
    {
        key: 'notifyOnAgentWaiting',
        label: 'Agent has a question',
        hint: 'Email me when the agent asks for input',
    },
];

export interface NotificationPreferencesProps {
    projectSlug: string;
}

export function NotificationPreferences({ projectSlug }: NotificationPreferencesProps) {
    const agentMode = useRuntimeConfigStore((s) => s.agentMode);
    const toast = useToast();
    const queryClient = useQueryClient();

    const { data, isLoading, isError } = useQuery({
        queryKey: notificationPreferenceKeys.forProject(projectSlug),
        queryFn: () => notificationPreferenceApi.get(projectSlug),
        enabled: agentMode && !!projectSlug,
    });

    // Draft state tracks the server copy: each new fetch (or the post-save
    // cache write) RESETS the toggles, and between syncs the toggles are the
    // source of truth. Keyed by `data` reference so toggling never reverts
    // the draft mid-edit ("adjust state during render" — the React-blessed
    // alternative to a setState-in-effect sync).
    const [draft, setDraft] = useState<NotificationPreferences | null>(null);
    const [syncedTo, setSyncedTo] = useState<NotificationPreferences | undefined>(undefined);
    if (data !== syncedTo) {
        setSyncedTo(data);
        setDraft(data ?? null);
    }

    const saveMutation = useMutation({
        mutationFn: (values: NotificationPreferences) =>
            notificationPreferenceApi.save(projectSlug, values),
        onSuccess: (saved) => {
            queryClient.setQueryData(notificationPreferenceKeys.forProject(projectSlug), saved);
            toast.success('Notification preferences saved');
        },
    });

    if (!agentMode) return null;

    if (isLoading) {
        return (
            <section className="space-y-2 rounded border border-border p-4">
                <h2 className="text-lg font-semibold">Notifications</h2>
                <SkeletonLine className="h-16 w-full" />
            </section>
        );
    }
    if (isError || !draft) {
        return (
            <section className="space-y-2 rounded border border-border p-4">
                <h2 className="text-lg font-semibold">Notifications</h2>
                <p className="text-sm text-muted-foreground">
                    Failed to load notification preferences.
                </p>
            </section>
        );
    }

    const dirty = data !== undefined && TOGGLES.some(({ key }) => draft[key] !== data[key]);

    const handleToggle = (key: keyof NotificationPreferences) => {
        setDraft((current) => (current ? { ...current, [key]: !current[key] } : current));
    };

    const handleSave = () => {
        saveMutation.mutate(draft);
    };

    return (
        <section className="space-y-3 rounded border border-border p-4">
            <div>
                <h2 className="text-lg font-semibold">Notifications</h2>
                <p className="text-sm text-muted-foreground">
                    Choose when this project emails you about your tickets.
                </p>
            </div>
            <ul className="space-y-3">
                {TOGGLES.map(({ key, label, hint }) => (
                    <li key={key} className="flex items-start gap-2">
                        <Checkbox
                            id={`pref-${key}`}
                            checked={draft[key]}
                            onCheckedChange={() => handleToggle(key)}
                            aria-label={label}
                            disabled={saveMutation.isPending}
                        />
                        <div className="text-sm">
                            <label htmlFor={`pref-${key}`} className="font-medium text-foreground">
                                {label}
                            </label>
                            <p className="text-muted-foreground">{hint}</p>
                        </div>
                    </li>
                ))}
            </ul>
            <Button onClick={handleSave} disabled={saveMutation.isPending || !dirty}>
                {saveMutation.isPending ? 'Saving…' : 'Save preferences'}
            </Button>
        </section>
    );
}
