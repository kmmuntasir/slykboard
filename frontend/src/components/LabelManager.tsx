// F14 T9: admin label-management surface. Inline CRUD pattern (Linear/Trello):
// create row at top; each label row has an inline rename input + react-colorful
// color popover + trash with confirm. Hosted on ProjectSettingsPage.
import { useState } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useLabels } from '@/hooks/useLabels';
import { useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/useLabelMutations';
import { toast } from '@/hooks/useToast';
import { LabelChip } from './LabelChip';
import { ConfirmDialog } from './ConfirmDialog';

interface LabelManagerProps {
    projectSlug: string;
}

// D16: neutral gray default for migrated / new labels (recolorable post-create).
const DEFAULT_COLOR = '#6B7280';
const DELETE_DIALOG_TITLE_ID = 'confirm-delete-label-title';

export function LabelManager({ projectSlug }: LabelManagerProps) {
    const { data: labels = [] } = useLabels(projectSlug);
    const createMut = useCreateLabel(projectSlug);
    const updateMut = useUpdateLabel(projectSlug);
    const deleteMut = useDeleteLabel(projectSlug);

    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState(DEFAULT_COLOR);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    function handleCreate() {
        if (!newName.trim()) {
            return;
        }
        createMut.mutate(
            { name: newName.trim(), color: newColor },
            { onSuccess: () => toast.success('Label created.') },
        );
        setNewName('');
        setNewColor(DEFAULT_COLOR);
    }

    function startEdit(id: string, name: string, color: string) {
        setEditingId(id);
        setEditName(name);
        setEditColor(color);
    }

    function saveEdit() {
        if (!editingId || !editName.trim()) {
            return;
        }
        updateMut.mutate(
            { labelId: editingId, dto: { name: editName.trim(), color: editColor } },
            { onSuccess: () => toast.success('Label updated.') },
        );
        setEditingId(null);
    }

    function handleConfirmDelete() {
        if (confirmDeleteId === null) {
            return;
        }
        deleteMut.mutate(confirmDeleteId, {
            onSuccess: () => toast.success('Label deleted.'),
        });
        setConfirmDeleteId(null);
    }

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold">Labels</h2>

            {/* Create row */}
            <div className="flex items-center gap-2">
                <span
                    aria-hidden="true"
                    className="inline-block h-6 w-6 rounded border border-border"
                    style={{ backgroundColor: newColor }}
                />
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="New label name"
                    aria-label="New label name"
                    className="rounded border border-border p-1"
                />
                <HexColorInput
                    aria-label="New label color"
                    color={newColor}
                    onChange={setNewColor}
                    className="w-20 rounded border border-border p-1"
                />
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!newName.trim() || createMut.isPending}
                    className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                >
                    Add
                </button>
            </div>

            {/* Label list */}
            <ul className="space-y-2">
                {labels.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2">
                        {editingId === l.id ? (
                            <>
                                <span
                                    aria-hidden="true"
                                    className="inline-block h-6 w-6 rounded border border-border"
                                    style={{ backgroundColor: editColor }}
                                />
                                <HexColorPicker
                                    color={editColor}
                                    onChange={setEditColor}
                                    aria-label="Edit label color picker"
                                />
                                <HexColorInput
                                    aria-label="Edit label color"
                                    color={editColor}
                                    onChange={setEditColor}
                                    className="w-20 rounded border border-border p-1"
                                />
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    aria-label="Edit label name"
                                    className="rounded border border-border p-1"
                                />
                                <button
                                    type="button"
                                    onClick={saveEdit}
                                    className="rounded bg-success px-2 py-1 text-success-foreground"
                                >
                                    Save
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="rounded border px-2 py-1"
                                >
                                    Cancel
                                </button>
                            </>
                        ) : (
                            <>
                                <LabelChip label={l} />
                                <button
                                    type="button"
                                    onClick={() => startEdit(l.id, l.name, l.color)}
                                    className="text-sm text-primary"
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(l.id)}
                                    className="text-sm text-destructive"
                                >
                                    Delete
                                </button>
                            </>
                        )}
                    </li>
                ))}
            </ul>

            <ConfirmDialog
                isOpen={confirmDeleteId !== null}
                title="Delete label?"
                titleId={DELETE_DIALOG_TITLE_ID}
                variant="destructive"
                confirmLabel="Delete"
                cancelLabel="Cancel"
                pending={deleteMut.isPending}
                message="This label will be removed from all tickets. This cannot be undone."
                onConfirm={handleConfirmDelete}
                onCancel={() => setConfirmDeleteId(null)}
            />
        </div>
    );
}
