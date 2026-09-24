import { ConfirmDialog } from './ConfirmDialog';

// CR-09: switching an active timer to another ticket is never silent. Render this
// from any start surface (timer controls, hero card, top-bar restart): the guard
// in useTimer raises `pending` and the host confirms before the server auto-stops
// the running session.

export const TIMER_SWITCH_DIALOG_TITLE_ID = 'timer-switch-dialog-title';

export interface TimerSwitchConfirmProps {
    pending: { ticketId: string; title: string; displayId: string } | null;
    onConfirm: () => void;
    onCancel: () => void;
}

export function TimerSwitchConfirm({ pending, onConfirm, onCancel }: TimerSwitchConfirmProps) {
    return (
        <ConfirmDialog
            isOpen={pending !== null}
            titleId={TIMER_SWITCH_DIALOG_TITLE_ID}
            title="Stop the current timer?"
            confirmLabel="Stop it and start"
            cancelLabel="Keep tracking"
            message={
                pending ? (
                    <>
                        You are currently tracking time for{' '}
                        <span className="font-mono text-xs">{pending.displayId}</span>{' '}
                        <span className="font-medium">{pending.title}</span>. Starting this timer
                        stops the current one.
                    </>
                ) : null
            }
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
