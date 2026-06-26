import { useState } from 'react';

import type { ChecklistItem } from '@/types/ticket';

// F15 D9: item ids are client-generated (crypto.randomUUID); the backend only
// validates the uuid format + caps. F15 D10: text capped at CHECKLIST_MAX_TEXT,
// array capped at CHECKLIST_MAX_ITEMS (both edges). D4: full-array replace on
// every change (last-write-wins). D11: no drag-reorder — items render in order.
const CHECKLIST_MAX_ITEMS = 50;
const CHECKLIST_MAX_TEXT = 200;

interface ChecklistEditorProps {
    value: ChecklistItem[];
    onChange: (items: ChecklistItem[]) => void;
    disabled?: boolean;
    /** F44: when true, suppress the leading <span>Checklist</span> word (the
     *  surrounding <Field> supplies the label). The done/total count and the
     *  progress bar always render. */
    hideLabel?: boolean;
}

export function ChecklistEditor({ value, onChange, disabled, hideLabel = false }: ChecklistEditorProps) {
    const [draft, setDraft] = useState('');

    const doneCount = value.filter((i) => i.done).length;
    const total = value.length;
    const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
    const atCapacity = total >= CHECKLIST_MAX_ITEMS;

    function addItem() {
        const text = draft.trim();
        if (!text || atCapacity) return;
        onChange([
            ...value,
            { id: crypto.randomUUID(), text: text.slice(0, CHECKLIST_MAX_TEXT), done: false },
        ]);
        setDraft('');
    }

    function toggle(id: string) {
        onChange(value.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
    }

    function editText(id: string, text: string) {
        onChange(
            value.map((i) =>
                i.id === id ? { ...i, text: text.slice(0, CHECKLIST_MAX_TEXT) } : i,
            ),
        );
    }

    function removeItem(id: string) {
        onChange(value.filter((i) => i.id !== id));
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                {!hideLabel && <span className="text-sm font-medium">Checklist</span>}
                <span className="text-xs text-gray-500">
                    {doneCount}/{total}
                </span>
            </div>

            {total > 0 && (
                <div
                    className="h-1.5 w-full overflow-hidden rounded bg-gray-200"
                    role="progressbar"
                    aria-valuenow={doneCount}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-label={`Checklist progress: ${doneCount} of ${total} done`}
                >
                    {/* Dynamic percentage width — only legitimate use of an inline style. */}
                    <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
                </div>
            )}

            <ul className="space-y-1">
                {value.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() => toggle(item.id)}
                            aria-label={`Toggle "${item.text}"`}
                            className="h-4 w-4"
                        />
                        <input
                            type="text"
                            value={item.text}
                            maxLength={CHECKLIST_MAX_TEXT}
                            onChange={(e) => editText(item.id, e.target.value)}
                            aria-label={`Edit checklist item "${item.text}"`}
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                        <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Delete checklist item "${item.text}"`}
                            className="text-sm text-red-600 hover:underline"
                        >
                            Delete
                        </button>
                    </li>
                ))}
            </ul>

            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={draft}
                    maxLength={CHECKLIST_MAX_TEXT}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            addItem();
                        }
                    }}
                    placeholder="Add an item"
                    aria-label="New checklist item"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                    type="button"
                    onClick={addItem}
                    disabled={disabled || !draft.trim() || atCapacity}
                    className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    Add
                </button>
            </div>

            {atCapacity && (
                <p className="text-xs text-gray-500">
                    Maximum {CHECKLIST_MAX_ITEMS} items reached.
                </p>
            )}
        </div>
    );
}
