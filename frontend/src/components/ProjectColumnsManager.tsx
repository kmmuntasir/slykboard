// F27 / SLYK-02 T3: column management surface (rename/reorder/add/delete).
// Columns are reordered via drag-and-drop (pangea) and auto-saved on drag-end;
// names persist on blur; add appends + persists immediately; delete is gated by
// a ConfirmDialog (destructive-action rule). No manual Save button or Up/Down
// arrows — drag is the only reorder affordance. Hosted on ProjectSettingsPage.
import { useState, type CSSProperties } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { GripVertical } from 'lucide-react';
import { useUpdateProject } from '@/hooks/useUpdateProject';
import { toast } from '@/hooks/useToast';
import { ApiClientError } from '@/api/client';
import { ConfirmDialog } from './ConfirmDialog';
import type { Column } from '@/types/project';

interface ProjectColumnsManagerProps {
    projectSlug: string;
    columns: Column[];
}

const DELETE_DIALOG_TITLE_ID = 'confirm-delete-column-title';

// Pure reorder helper: returns a new array with the item at `source` moved to
// `destination`, or null when the drop is a no-op (missing destination or same
// index). Extracted so the onDragEnd contract is unit-testable without driving
// pangea's pointer sensor in jsdom (mirrors the boardReorder.test.ts approach).
// NOTE: @hello-pangea/dnd does not export arrayMove (unlike react-beautiful-dnd),
// so the splice is implemented inline here.
export function reorderColumns(
    columns: Column[],
    source: number,
    destination: number | null | undefined,
): Column[] | null {
    if (destination === null || destination === undefined) return null;
    if (source === destination) return null;
    const next = [...columns];
    const [moved] = next.splice(source, 1);
    if (moved === undefined) return null;
    next.splice(destination, 0, moved);
    return next;
}

export function ProjectColumnsManager({ projectSlug, columns }: ProjectColumnsManagerProps) {
    const updateMut = useUpdateProject(projectSlug);

    // Local draft of the column list. Seeded from server data and re-synced when
    // the server data changes (e.g. after our own mutation invalidates + refetches).
    // The sync key guards against clobbering an in-progress user edit on a
    // background refetch that didn't actually change the columns.
    const [draft, setDraft] = useState<Column[]>(columns);
    const [lastSync, setLastSync] = useState<string>(JSON.stringify(columns));
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // Adjusting state during render: when the server data changes (e.g. after our
    // own mutation invalidates + refetches), reset the draft. The sync key guards
    // against clobbering an in-progress user edit on a background refetch that
    // didn't actually change the columns. React will re-render before committing.
    // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
    const incoming = JSON.stringify(columns);
    if (incoming !== lastSync) {
        setDraft(columns);
        setLastSync(incoming);
    }

    const updateName = (id: string, name: string) => {
        setDraft((curr) => curr.map((c) => (c.id === id ? { ...c, name } : c)));
    };

    // D5: drag-end auto-persists the reordered draft immediately, mirroring
    // BoardPage's handleDragEnd. Errors funnel through meta.revertMessage.
    const handleDragEnd = async (result: DropResult) => {
        const reordered = reorderColumns(draft, result.source.index, result.destination?.index);
        if (!reordered) return;
        setDraft(reordered);
        try {
            await updateMut.mutateAsync({ columns: reordered });
            toast.success('Columns saved.');
        } catch {
            // error surfaced via the global mutation toast funnel (revertMessage).
        }
    };

    const addColumn = async () => {
        const next = [...draft, { id: crypto.randomUUID(), name: 'New Column' }];
        setDraft(next);
        try {
            await updateMut.mutateAsync({ columns: next });
        } catch {
            // error surfaced via the global mutation toast funnel (revertMessage).
        }
    };

    // Name persist on blur — no Save button. The draft already holds the typed
    // name (updateName on change). No toast on rename per the T3 criterion.
    const persistName = async () => {
        try {
            await updateMut.mutateAsync({ columns: draft });
        } catch {
            // error surfaced via the global mutation toast funnel (revertMessage).
        }
    };

    const handleConfirmDelete = async () => {
        const id = confirmDeleteId;
        setConfirmDeleteId(null);
        if (!id) return;
        const remaining = draft.filter((c) => c.id !== id);
        // Persist immediately and let the draft re-sync from the refetched data.
        try {
            await updateMut.mutateAsync({ columns: remaining });
        } catch {
            // error surfaced via updateMut.error; keep draft as-is so the user
            // sees the column is still present (server blocked the delete).
        }
    };

    const errMsg =
        updateMut.error instanceof ApiClientError
            ? updateMut.error.message
            : updateMut.error?.message;

    return (
        <section className="space-y-4 rounded border border-border p-4">
            <h2 className="text-lg font-semibold">Columns</h2>

            <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="columns" type="COLUMN" direction="vertical">
                    {(provided) => (
                        <ul
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className="space-y-2"
                        >
                            {draft.map((col, index) => (
                                <Draggable key={col.id} draggableId={col.id} index={index}>
                                    {(dragProvided, snapshot) => (
                                        <li
                                            ref={dragProvided.innerRef}
                                            {...dragProvided.draggableProps}
                                            style={dragProvided.draggableProps.style as CSSProperties | undefined}
                                            className={
                                                snapshot.isDragging
                                                    ? 'flex items-center gap-2 rounded border border-border bg-card p-1 shadow-md ring-2 ring-primary/40'
                                                    : 'flex items-center gap-2'
                                            }
                                        >
                                            {/* Dedicated drag handle so the name input stays
                                                clickable/editable (handle is NOT the whole row). */}
                                            <span
                                                {...dragProvided.dragHandleProps}
                                                aria-label={`Drag handle for column ${index + 1}`}
                                                className="cursor-grab self-stretch rounded px-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
                                            >
                                                <GripVertical size={16} />
                                            </span>
                                            <input
                                                type="text"
                                                aria-label={`Column ${index + 1} name`}
                                                value={col.name}
                                                onChange={(e) => updateName(col.id, e.target.value)}
                                                onBlur={persistName}
                                                className="block w-full rounded border border-border px-2 py-1"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setConfirmDeleteId(col.id)}
                                                className="text-sm text-destructive"
                                            >
                                                Delete
                                            </button>
                                        </li>
                                    )}
                                </Draggable>
                            ))}
                            {provided.placeholder}
                        </ul>
                    )}
                </Droppable>
            </DragDropContext>

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={addColumn}
                    className="rounded border border-border px-3 py-1"
                >
                    Add Column
                </button>
            </div>

            {errMsg && <p className="text-sm text-destructive">{errMsg}</p>}

            <ConfirmDialog
                isOpen={confirmDeleteId !== null}
                title="Delete column?"
                titleId={DELETE_DIALOG_TITLE_ID}
                variant="destructive"
                confirmLabel="Delete"
                cancelLabel="Cancel"
                pending={updateMut.isPending}
                message="Are you sure? Tickets in this column must be moved first."
                onConfirm={handleConfirmDelete}
                onCancel={() => setConfirmDeleteId(null)}
            />
        </section>
    );
}
