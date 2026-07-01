// DEL-02: admin label-management surface rewritten on shared ui/ primitives
// and the DEL-01 ColorPicker. Inline CRUD pattern (Linear/Trello): create row
// at top; each label row is a full-width Card with hover/focus-revealed
// Edit/Delete icon buttons (wrapped in Tooltip); inline edit mirrors the create
// row. Hosted on ProjectSettingsPage.
import { useState } from 'react';
import { Pencil, Trash2, Tag } from 'lucide-react';
import { useLabels } from '@/hooks/useLabels';
import { useCreateLabel, useUpdateLabel, useDeleteLabel } from '@/hooks/useLabelMutations';
import { toast } from '@/hooks/useToast';
import { LabelChip } from './LabelChip';
import { ConfirmDialog } from './ConfirmDialog';
import { ColorPicker } from './ui/ColorPicker';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { TextInput } from './ui/TextInput';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/Tooltip';

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
                <ColorPicker value={newColor} onChange={setNewColor} aria-label="New label color" />
                <TextInput
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Label name"
                    aria-label="New label name"
                    className="flex-1"
                />
                <Button onClick={handleCreate} disabled={!newName.trim() || createMut.isPending}>
                    Add
                </Button>
            </div>

            {/* Label list */}
            {labels.length === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                    <Tag className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
                    No labels yet — create your first one.
                </Card>
            ) : (
                <div className="space-y-2">
                    {labels.map((l) =>
                        editingId === l.id ? (
                            <Card key={l.id} className="p-3">
                                <div className="flex items-center gap-2">
                                    <ColorPicker
                                        value={editColor}
                                        onChange={setEditColor}
                                        aria-label={'Edit color for ' + editName}
                                    />
                                    <TextInput
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        aria-label="Label name"
                                        className="flex-1"
                                    />
                                    <Button
                                        onClick={saveEdit}
                                        disabled={!editName.trim() || updateMut.isPending}
                                    >
                                        Save
                                    </Button>
                                    <Button variant="outline" onClick={() => setEditingId(null)}>
                                        Cancel
                                    </Button>
                                </div>
                            </Card>
                        ) : (
                            <Card key={l.id} className="group p-3">
                                <div className="flex items-center gap-3">
                                    <LabelChip label={l} />
                                    <div className="ml-auto flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 w-8 p-0"
                                                    aria-label={'Edit ' + l.name}
                                                    onClick={() =>
                                                        startEdit(l.id, l.name, l.color)
                                                    }
                                                >
                                                    <Pencil
                                                        className="h-4 w-4"
                                                        aria-hidden="true"
                                                    />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">Edit</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 w-8 p-0"
                                                    aria-label={'Delete ' + l.name}
                                                    onClick={() => setConfirmDeleteId(l.id)}
                                                >
                                                    <Trash2
                                                        className="h-4 w-4"
                                                        aria-hidden="true"
                                                    />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                Delete
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            </Card>
                        ),
                    )}
                </div>
            )}

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
