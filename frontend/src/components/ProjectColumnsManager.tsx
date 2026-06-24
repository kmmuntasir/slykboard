// F27: column management surface (rename/reorder/add/delete). Maintains a local
// draft synced from server data; edits/reorders/add mutate the draft only, while
// "Save Columns" persists the whole draft and delete persists immediately
// (gated by a confirm modal per the destructive-action rule). Hosted on
// ProjectSettingsPage.
import { useState } from 'react';
import { useUpdateProject } from '@/hooks/useUpdateProject';
import { ApiClientError } from '@/api/client';
import { Modal } from './Modal';
import type { Column } from '@/types/project';

interface ProjectColumnsManagerProps {
    projectSlug: string;
    columns: Column[];
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

    const move = (index: number, dir: -1 | 1) => {
        setDraft((curr) => {
            const target = index + dir;
            if (target < 0 || target >= curr.length) return curr;
            const next = [...curr];
            const a = next[index];
            const b = next[target];
            if (!a || !b) return curr;
            next[index] = b;
            next[target] = a;
            return next;
        });
    };

    const addColumn = () => {
        setDraft((curr) => [...curr, { id: crypto.randomUUID(), name: 'New Column' }]);
    };

    const handleSaveColumns = async () => {
        try {
            await updateMut.mutateAsync({ columns: draft });
        } catch {
            // error surfaced via updateMut.error below
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

            <ul className="space-y-2">
                {draft.map((col, index) => (
                    <li key={col.id} className="flex items-center gap-2">
                        <input
                            type="text"
                            aria-label={`Column ${index + 1} name`}
                            value={col.name}
                            onChange={(e) => updateName(col.id, e.target.value)}
                            className="block w-full rounded border border-border px-2 py-1"
                        />
                        <button
                            type="button"
                            aria-label={`Move column ${index + 1} up`}
                            onClick={() => move(index, -1)}
                            disabled={index === 0}
                            className="rounded border px-2 py-1 disabled:opacity-50"
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            aria-label={`Move column ${index + 1} down`}
                            onClick={() => move(index, 1)}
                            disabled={index === draft.length - 1}
                            className="rounded border px-2 py-1 disabled:opacity-50"
                        >
                            ↓
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirmDeleteId(col.id)}
                            className="text-sm text-red-600"
                        >
                            Delete
                        </button>
                    </li>
                ))}
            </ul>

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={addColumn}
                    className="rounded border border-border px-3 py-1"
                >
                    Add Column
                </button>
                <button
                    type="button"
                    onClick={handleSaveColumns}
                    disabled={updateMut.isPending}
                    className="rounded bg-primary px-3 py-1 text-background disabled:opacity-50"
                >
                    {updateMut.isPending ? 'Saving…' : 'Save Columns'}
                </button>
            </div>

            {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}

            <Modal
                isOpen={confirmDeleteId !== null}
                onClose={() => setConfirmDeleteId(null)}
                titleId="confirm-delete-column-title"
                title="Delete column?"
            >
                <p className="mb-4 text-sm">
                    Delete this column? Tickets still in this column must be moved first.
                </p>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded border px-3 py-1"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirmDelete}
                        className="rounded bg-red-600 px-3 py-1 text-white"
                    >
                        Confirm
                    </button>
                </div>
            </Modal>
        </section>
    );
}
