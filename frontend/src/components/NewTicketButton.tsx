import { useState } from 'react';
import type { CreateTicketDto } from '@/api/tickets';

interface NewTicketButtonProps {
    onCreate: (dto: CreateTicketDto) => void;
    disabled?: boolean;
}

export function NewTicketButton({ onCreate, disabled }: NewTicketButtonProps) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        onCreate({ title: trimmed });
        setTitle('');
        setOpen(false);
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={disabled}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                aria-label="New ticket"
            >
                + New ticket
            </button>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="flex gap-2" aria-label="Create ticket form">
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ticket title"
                maxLength={200}
                className="flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                aria-label="Ticket title"
                autoFocus
            />
            <button
                type="submit"
                disabled={!title.trim() || disabled}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
                Create
            </button>
            <button
                type="button"
                onClick={() => {
                    setTitle('');
                    setOpen(false);
                }}
                className="rounded border px-3 py-1.5 text-sm"
            >
                Cancel
            </button>
        </form>
    );
}
