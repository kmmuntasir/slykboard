// KMM-5: per-user Account Settings page at /account. Authenticated only (no
// platform-admin guard — everyone has an account). This ticket is UI-only: no
// backend endpoints exist yet, so name / display-name / avatar edits are kept in
// local component state (they do not mutate the auth store or hit the network).
// Email is Google-OAuth-managed and read-only. Theme reuses the shared useTheme
// controller (functional). Delete-account opens a confirm dialog (no-op confirm
// pending a backend DELETE /users/me).
//
// Layout mirrors ProjectSettingsPage: a left in-page section sidebar
// (Profile / Account / Preferences / Danger Zone) drives the right content pane.
// All chrome reuses F35 primitives (Button, Field, TextInput, Avatar, Card) so
// the surface stays token-consistent with the rest of the system.
import { useState, type ReactNode } from 'react';
import { Mail, Shield, Trash2, UserCog } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useTheme } from '@/hooks/useTheme';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { TextInput } from '@/components/ui/TextInput';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/components/ui/cn';
import type { ThemePreference } from '@/utils/theme';

// Unique aria title id for the delete-account dialog (mirrors the
// PROJECT_STATUS_DIALOG_TITLE_ID pattern from ProjectSettingsPage).
const DELETE_ACCOUNT_DIALOG_TITLE_ID = 'delete-account-title';

type SectionId = 'profile' | 'account' | 'preferences' | 'danger';

// The section registry — the single extension point for the in-page sidebar.
const SECTIONS: { id: SectionId; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'account', label: 'Account' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'danger', label: 'Danger Zone' },
];

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
];

export function AccountSettingsPage() {
    const user = useAuthStore((s) => s.user);

    if (!user) {
        return <div className="p-4">No account loaded.</div>;
    }

    return <AccountSettingsBody />;
}

function AccountSettingsBody() {
    const user = useAuthStore((s) => s.user)!;
    const [active, setActive] = useState<SectionId>('profile');

    return (
        <div className="p-4">
            <h1 className="mb-4 text-xl font-bold">Account Settings</h1>

            <div className="flex gap-6">
                <nav aria-label="Account settings sections" className="w-48 shrink-0">
                    <ul className="space-y-1">
                        {SECTIONS.map((section) => {
                            const isActive = active === section.id;
                            return (
                                <li key={section.id}>
                                    <button
                                        type="button"
                                        aria-current={isActive ? 'page' : undefined}
                                        onClick={() => setActive(section.id)}
                                        className={cn(
                                            'block w-full rounded px-3 py-2 text-left text-sm',
                                            isActive
                                                ? 'bg-muted font-medium text-foreground'
                                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                            section.id === 'danger' && !isActive
                                                ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                                                : '',
                                        )}
                                    >
                                        {section.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                <div className="flex-1 space-y-6">
                    {active === 'profile' && <ProfileSection />}
                    {active === 'account' && <AccountSection />}
                    {active === 'preferences' && <PreferencesSection />}
                    {active === 'danger' && <DangerZoneSection />}
                </div>
            </div>
        </div>
    );
}

interface SectionProps {
    title: string;
    description: string;
    children: ReactNode;
    className?: string;
}

function SettingsSection({ title, description, children, className }: SectionProps) {
    return (
        <section className="space-y-4 rounded border border-border p-4">
            <div className="space-y-1">
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className={cn('space-y-4', className)}>{children}</div>
        </section>
    );
}

function ProfileSection() {
    const user = useAuthStore((s) => s.user)!;
    // UI-only drafts — no backend yet. Avatar/name edits live in local state and
    // do not propagate to the auth store.
    const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);
    const [fullName, setFullName] = useState(user.name);
    const [displayName, setDisplayName] = useState(user.displayName ?? '');
    const [avatarInput, setAvatarInput] = useState('');

    const fullNameDirty = fullName.trim() !== user.name && fullName.trim() !== '';
    const displayNameDirty = displayName !== (user.displayName ?? '');

    const handleSaveFullName = () => {
        // KMM-5: UI-only — no PATCH yet. Draft is already committed to local state.
    };

    const handleSaveDisplayName = () => {
        // KMM-5: UI-only — no PATCH yet. Draft is already committed to local state.
    };

    const handleApplyAvatar = () => {
        const trimmed = avatarInput.trim();
        if (!trimmed) return;
        setAvatarUrl(trimmed);
        setAvatarInput('');
    };

    const handleRemoveAvatar = () => {
        setAvatarUrl(null);
        setAvatarInput('');
    };

    return (
        <SettingsSection
            title="Profile"
            description="Update how others see you across Slykboard."
        >
            <div className="flex items-center gap-4">
                <Avatar src={avatarUrl} name={user.name || user.email} size="lg" />
                <div className="flex-1 space-y-2">
                    <Field
                        label="Avatar URL"
                        htmlFor="avatar-url"
                        action={
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleRemoveAvatar}
                                disabled={!avatarUrl}
                            >
                                Remove
                            </Button>
                        }
                    >
                        <TextInput
                            id="avatar-url"
                            value={avatarInput}
                            onChange={(e) => setAvatarInput(e.target.value)}
                            placeholder="https://…"
                            className="block w-full"
                        />
                    </Field>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleApplyAvatar}
                        disabled={!avatarInput.trim()}
                    >
                        Change avatar
                    </Button>
                </div>
            </div>

            <Field
                label="Full name"
                htmlFor="full-name"
                action={
                    <Button size="sm" onClick={handleSaveFullName} disabled={!fullNameDirty}>
                        Save
                    </Button>
                }
            >
                <TextInput
                    id="full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="block w-full"
                />
            </Field>

            <Field
                label="Display name"
                htmlFor="display-name"
                action={
                    <Button
                        size="sm"
                        onClick={handleSaveDisplayName}
                        disabled={!displayNameDirty}
                    >
                        Save
                    </Button>
                }
            >
                <TextInput
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Optional"
                    className="block w-full"
                />
            </Field>
        </SettingsSection>
    );
}

function AccountSection() {
    const user = useAuthStore((s) => s.user)!;

    return (
        <SettingsSection
            title="Account"
            description="Your sign-in identity and system role."
        >
            <Field label="Email" htmlFor="email">
                <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <TextInput
                        id="email"
                        value={user.email}
                        readOnly
                        aria-readonly="true"
                        className="block flex-1"
                    />
                </div>
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground">
                Email is managed by Google and cannot be changed here.
            </p>

            <Field label="Role" htmlFor="role">
                <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span
                        id="role"
                        className={cn(
                            'inline-flex items-center rounded-md border px-2 py-1 text-sm font-medium',
                            user.isPlatformAdmin
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : 'border-border bg-muted text-foreground',
                        )}
                    >
                        {user.isPlatformAdmin ? 'Platform Admin' : 'Member'}
                    </span>
                </div>
            </Field>

            <Field label="User ID" htmlFor="user-id">
                <div className="flex items-center gap-2">
                    <UserCog
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <code
                        id="user-id"
                        className="block flex-1 truncate rounded border border-border bg-muted px-2 py-2 font-mono text-sm text-muted-foreground"
                    >
                        {user.id}
                    </code>
                </div>
            </Field>
        </SettingsSection>
    );
}

function PreferencesSection() {
    const { theme, setTheme } = useTheme();

    return (
        <SettingsSection
            title="Preferences"
            description="Customize your local Slykboard experience."
        >
            {/* Labeled 3-way control wired to the shared useTheme controller (same
                source of truth as the navbar ThemeToggle / profile menu). Rendered
                WITHOUT the Field primitive: Field's no-action branch wraps children
                in a <label>, and a <label> associates with its first labelable
                descendant — which would be the segmented buttons, not an input —
                hijacking their accessible names. Plain span label + group instead. */}
            <div>
                <span className="mb-1 block text-sm font-medium">Theme</span>
                <div role="group" aria-label="Theme" className="inline-flex gap-1">
                    {THEME_OPTIONS.map((option) => {
                        const isActive = theme === option.value;
                        return (
                            <Button
                                key={option.value}
                                type="button"
                                size="sm"
                                variant={isActive ? 'primary' : 'outline'}
                                aria-pressed={isActive}
                                onClick={() => setTheme(option.value)}
                            >
                                {option.label}
                            </Button>
                        );
                    })}
                </div>
            </div>
        </SettingsSection>
    );
}

function DangerZoneSection() {
    const [confirmOpen, setConfirmOpen] = useState(false);

    // KMM-5: UI-only — no DELETE /users/me yet. Confirm is a no-op beyond closing
    // the dialog; wiring lands with the backend ticket.
    const handleConfirmDelete = () => {
        setConfirmOpen(false);
    };

    return (
        <section className="space-y-4 rounded border border-destructive/40 p-4">
            <div className="space-y-1">
                <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
                <p className="text-sm text-muted-foreground">
                    Irreversible and destructive actions.
                </p>
            </div>
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <p className="text-sm font-medium">Delete account</p>
                    <p className="text-sm text-muted-foreground">
                        Permanently remove your account and personal data. This cannot be undone.
                    </p>
                </div>
                <Button
                    variant="destructive"
                    className="shrink-0"
                    onClick={() => setConfirmOpen(true)}
                >
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Delete account
                </Button>
            </Card>
            <ConfirmDialog
                isOpen={confirmOpen}
                title="Delete account?"
                titleId={DELETE_ACCOUNT_DIALOG_TITLE_ID}
                variant="destructive"
                confirmLabel="Delete account"
                cancelLabel="Cancel"
                message="This will permanently delete your account and personal data. This action cannot be undone."
                onConfirm={handleConfirmDelete}
                onCancel={() => setConfirmOpen(false)}
            />
        </section>
    );
}
