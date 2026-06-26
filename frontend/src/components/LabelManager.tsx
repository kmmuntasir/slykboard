// F14 T9: admin label-management surface. Inline CRUD pattern (Linear/Trello):
// create row at top; each label row has an inline rename input + react-colorful
// color popover + trash with confirm. Hosted on ProjectSettingsPage.
import { useState } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useLabels } from '@/hooks/useLabels';
import { useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/useLabelMutations';
import { LabelChip } from './LabelChip';

interface LabelManagerProps {
    projectSlug: string;
}

// D16: neutral gray default for migrated / new labels (recolorable post-create).
const DEFAULT_COLOR = '#6B7280';

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
        createMut.mutate({ name: newName.trim(), color: newColor });
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
        updateMut.mutate({ labelId: editingId, dto: { name: editName.trim(), color: editColor } });
        setEditingId(null);
    }

    function handleConfirmDelete(id: string) {
        deleteMut.mutate(id);
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
                        ) : confirmDeleteId === l.id ? (
                            <>
                                <LabelChip label={l} />
                                <span className="text-sm">
                                    Delete? Removes from all tickets.
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleConfirmDelete(l.id)}
                                    className="rounded bg-destructive px-2 py-1 text-destructive-foreground"
                                >
                                    Confirm
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
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
        </div>
    );
}
