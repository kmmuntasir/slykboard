import { useState } from 'react';

import { Button } from './ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { TextInput } from './ui/TextInput';
import { cn } from './ui/cn';
import type { ChecklistItem } from '@/types/ticket';

// F15 D9: item ids are client-generated (crypto.randomUUID); the backend only
// validates the uuid format + caps. F15 D10: text capped at CHECKLIST_MAX_TEXT,
// array capped at CHECKLIST_MAX_ITEMS (both edges). D4: full-array replace on
// every change (last-write-wins). D11: no drag-reorder — items render in order.
const CHECKLIST_MAX_ITEMS = 50;
const CHECKLIST_MAX_TEXT = 200;

// D2: dense variant — repeating list rows are deliberately compact (px-2 py-1)
// vs the px-3 py-2 primary-field family. A named prop, not a one-off className.
const DENSE_ITEM_CLASS = 'px-2 py-1 text-sm';

interface ChecklistEditorProps {
    value: ChecklistItem[];
    onChange: (items: ChecklistItem[]) => void;
    disabled?: boolean;
    /** F44: when true, suppress the leading <span>Checklist</span> word (the
     *  surrounding <Field> supplies the label). The done/total count and the
     *  progress bar always render. */
    hideLabel?: boolean;
    /** D2: when true, item inputs use compact px-2 py-1 (repeating-row variant). */
    dense?: boolean;
}

export function ChecklistEditor({
    value,
    onChange,
    disabled,
    hideLabel = false,
    dense = false,
}: ChecklistEditorProps) {
    const [draft, setDraft] = useState('');

    const doneCount = value.filter((i) => i.done).length;
    const total = value.length;
    const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
    const atCapacity = total >= CHECKLIST_MAX_ITEMS;
    const itemClassName = dense ? DENSE_ITEM_CLASS : undefined;

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
            value.map((i) => (i.id === id ? { ...i, text: text.slice(0, CHECKLIST_MAX_TEXT) } : i)),
        );
    }

    function removeItem(id: string) {
        onChange(value.filter((i) => i.id !== id));
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                {!hideLabel && <span className="text-sm font-medium">Checklist</span>}
                <span className="text-xs text-muted-foreground">
                    {doneCount}/{total}
                </span>
            </div>

            {total > 0 && (
                <div
                    className="h-1.5 w-full overflow-hidden rounded bg-muted"
                    role="progressbar"
                    aria-valuenow={doneCount}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-label={`Checklist progress: ${doneCount} of ${total} done`}
                >
                    {/* Dynamic percentage width — only legitimate use of an inline style. */}
                    <div className="h-full bg-success" style={{ width: `${pct}%` }} />
                </div>
            )}

            <ul className="space-y-1">
                {value.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                        <Checkbox
                            checked={item.done}
                            onCheckedChange={() => toggle(item.id)}
                            aria-label={`Toggle "${item.text}"`}
                        />
                        <TextInput
                            type="text"
                            value={item.text}
                            maxLength={CHECKLIST_MAX_TEXT}
                            onChange={(e) => editText(item.id, e.target.value)}
                            aria-label={`Edit checklist item "${item.text}"`}
                            className={cn('flex-1 text-sm', itemClassName)}
                        />
                        <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label={`Delete checklist item "${item.text}"`}
                            className="text-sm text-destructive hover:underline"
                        >
                            Delete
                        </button>
                    </li>
                ))}
            </ul>

            <div className="flex items-center gap-2">
                <TextInput
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
                    className={cn('flex-1 text-sm', itemClassName)}
                />
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={addItem}
                    disabled={disabled || !draft.trim() || atCapacity}
                >
                    Add
                </Button>
            </div>

            {atCapacity && (
                <p className="text-xs text-muted-foreground">
                    Maximum {CHECKLIST_MAX_ITEMS} items reached.
                </p>
            )}
        </div>
    );
}
