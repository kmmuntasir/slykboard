import { useState } from 'react';
import { CreateTicketModal } from './CreateTicketModal';

interface NewTicketButtonProps {
    slug: string;
    columnId?: string;
    disabled?: boolean;
}

export function NewTicketButton({ slug, columnId, disabled }: NewTicketButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={disabled}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                aria-label="New ticket"
            >
                + New ticket
            </button>
            <CreateTicketModal
                open={open}
                onClose={() => setOpen(false)}
                slug={slug}
                columnId={columnId}
            />
        </>
    );
}
