import { useState } from 'react';

import { Modal } from './Modal';
import { Button } from './ui/Button';
import { formatTicketId } from '@/utils/formatTicketId';
import type { HierarchyNode } from '@/utils/hierarchy';
import { countNodes } from '@/utils/hierarchy';
import { TICKET_TYPE_DISPLAY } from '@/types/ticket';

// F17 + CR-03 FR-03.6: ticket soft-delete confirmation. When the ticket has
// live descendants, the modal first shows the FULL descendant tree and requires
// a second explicit confirmation before the cascade delete runs.

interface DeleteTicketConfirmProps {
    isOpen: boolean;
    isDeleting?: boolean;
    /** Live descendant tree (board data); empty/omitted → simple confirmation. */
    descendants?: ReadonlyArray<HierarchyNode>;
    projectSlug: string;
    onConfirm: () => void;
    onCancel: () => void;
}

function TreeList({
    nodes,
    projectSlug,
    depth = 0,
}: {
    nodes: ReadonlyArray<HierarchyNode>;
    projectSlug: string;
    depth?: number;
}) {
    return (
        <ul
            className={depth > 0 ? 'ml-4 border-l border-border pl-3' : 'ml-1'}
            aria-label={depth === 0 ? 'Tickets to delete' : undefined}
        >
            {nodes.map(({ ticket, children }) => (
                <li key={ticket.id} className="py-0.5">
                    <span className="flex items-baseline gap-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">
                            {formatTicketId(projectSlug, ticket.ticketNumber, { padded: true })}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                            {TICKET_TYPE_DISPLAY[ticket.type]}
                        </span>
                        <span className="min-w-0 truncate">{ticket.title}</span>
                    </span>
                    {children.length > 0 && (
                        <TreeList nodes={children} projectSlug={projectSlug} depth={depth + 1} />
                    )}
                </li>
            ))}
        </ul>
    );
}

export function DeleteTicketConfirm({
    isOpen,
    isDeleting = false,
    descendants = [],
    projectSlug,
    onConfirm,
    onCancel,
}: DeleteTicketConfirmProps) {
    // CR-03: two-stage confirm for cascade deletes. Stage resets whenever the
    // dialog reopens (isOpen toggling false unmounts this state via the key below).
    const [stage, setStage] = useState(0);
    const descendantCount = countNodes(descendants);
    const isCascade = descendantCount > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            titleId="delete-ticket-dialog-title"
            title={isCascade ? `Delete ticket + ${descendantCount} more?` : 'Delete ticket?'}
            blockBackdropClose
        >
            <div className="mb-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                    This removes the ticket from the board. Its activity history and label links are
                    archived and the ticket number is not reused. This cannot be undone from the UI.
                </p>

                {isCascade && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                        <p className="mb-2 text-sm font-medium text-destructive">
                            {descendantCount} nested ticket
                            {descendantCount === 1 ? '' : 's'} will be deleted together:
                        </p>
                        <div className="max-h-56 overflow-y-auto">
                            <TreeList nodes={descendants} projectSlug={projectSlug} />
                        </div>
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    disabled={isDeleting}
                >
                    Cancel
                </Button>
                {isCascade && stage === 0 ? (
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setStage(1)}
                    >
                        Delete {descendantCount + 1} tickets…
                    </Button>
                ) : isCascade ? (
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={onConfirm}
                        disabled={isDeleting}
                    >
                        {isDeleting
                            ? 'Deleting…'
                            : `Yes, delete all ${descendantCount + 1} tickets`}
                    </Button>
                ) : (
                    <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={onConfirm}
                        disabled={isDeleting}
                    >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                    </Button>
                )}
            </div>
        </Modal>
    );
}
