import type { ReactNode } from 'react';

interface EmptyStateActionProps {
    label: string;
    onClick: () => void;
}

interface EmptyStateProps {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: EmptyStateActionProps | ReactNode;
}

function isActionProps(value: unknown): value is EmptyStateActionProps {
    return (
        typeof value === 'object' &&
        value !== null &&
        'label' in value &&
        'onClick' in value &&
        typeof (value as EmptyStateActionProps).label === 'string' &&
        typeof (value as EmptyStateActionProps).onClick === 'function'
    );
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div
            role="status"
            className="rounded border border-dashed p-8 text-center text-muted-foreground"
        >
            {icon ? <div className="mb-2 flex justify-center text-2xl">{icon}</div> : null}
            <p className="font-medium text-foreground">{title}</p>
            {description ? <p className="mt-1 text-sm">{description}</p> : null}
            {isActionProps(action) ? (
                <button
                    type="button"
                    onClick={action.onClick}
                    className="mt-4 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
                >
                    {action.label}
                </button>
            ) : action ? (
                <div className="mt-4">{action}</div>
            ) : null}
        </div>
    );
}
