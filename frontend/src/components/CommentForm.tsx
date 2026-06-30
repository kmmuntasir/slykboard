import { useState, type FormEvent } from 'react';

import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';

// SLYK-13 T11 — Reusable comment form supporting create and edit modes.
// Owns only the draft state + trim/empty validation; persistence lives in the
// caller's onSubmit. In create mode the field clears after submit; in edit mode
// the parent controls teardown (Cancel restores the initialValue here).
export type CommentFormMode = 'create' | 'edit';

export interface CommentFormProps {
    mode: CommentFormMode;
    initialValue?: string;
    isPending?: boolean;
    onSubmit: (body: string) => void;
    onCancel?: () => void;
    submitLabel?: string;
}

const MAX_COMMENT_LENGTH = 5000;

const DEFAULT_LABEL: Record<CommentFormMode, string> = {
    create: 'Comment',
    edit: 'Save',
};

export function CommentForm({
    mode,
    initialValue = '',
    isPending = false,
    onSubmit,
    onCancel,
    submitLabel,
}: CommentFormProps) {
    const [body, setBody] = useState(initialValue);

    const trimmed = body.trim();
    const isDisabled = trimmed.length === 0 || isPending;

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (isDisabled) return;
        onSubmit(trimmed);
        if (mode === 'create') setBody('');
    };

    const handleCancel = () => {
        setBody(initialValue);
        onCancel?.();
    };

    const label = submitLabel ?? DEFAULT_LABEL[mode];
    const textareaLabel = mode === 'edit' ? 'Edit comment' : 'Write a comment';

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                aria-label={textareaLabel}
                maxLength={MAX_COMMENT_LENGTH}
                rows={3}
                className="text-sm"
            />
            <div className="flex items-center justify-end gap-2">
                {mode === 'edit' && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancel}
                        disabled={isPending}
                    >
                        Cancel
                    </Button>
                )}
                <Button type="submit" variant="primary" size="sm" disabled={isDisabled}>
                    {label}
                </Button>
            </div>
        </form>
    );
}
