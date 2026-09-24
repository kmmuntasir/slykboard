import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { NodeBreakdownTable } from './NodeBreakdownTable';
import type { NodeBreakdownRow, NodeTimeEntry } from '@/types/report';

// CR-05: the breakdown table contract — own vs tracked columns, controlled
// expansion, source labels, and the local sort toggle.

const HOUR = 3_600_000;

const rows: NodeBreakdownRow[] = [
    {
        id: 's1',
        ticketNumber: 2,
        title: 'Checkout story',
        type: 'STORY',
        ownMs: 30 * 60_000,
        rollupMs: 3 * HOUR + 30 * 60_000,
        entryCount: 2,
        members: [{ id: 'u1', totalMs: HOUR }],
    },
    {
        id: 'b1',
        ticketNumber: 3,
        title: 'Hook subtask',
        type: 'SUBTASK',
        ownMs: 3 * HOUR,
        rollupMs: 3 * HOUR,
        entryCount: 1,
        members: [],
    },
];

const entries: NodeTimeEntry[] = [
    {
        id: 'te1',
        ticketId: 'b1',
        ticketNumber: 3,
        ticketTitle: 'Hook subtask',
        ticketType: 'SUBTASK',
        userId: 'u1',
        userFullName: 'Ada',
        userAvatarUrl: null,
        startTime: '2026-09-22T10:00:00.000Z',
        endTime: '2026-09-22T13:00:00.000Z',
        durationMs: 3 * HOUR,
        type: 'timer',
        description: 'research spike',
        adjusted: false,
        adjustmentReason: null,
    },
    {
        id: 'me1',
        ticketId: 'b1',
        ticketNumber: 3,
        ticketTitle: 'Hook subtask',
        ticketType: 'SUBTASK',
        userId: 'u2',
        userFullName: 'Bob',
        userAvatarUrl: null,
        startTime: '2026-09-23T09:00:00.000Z',
        endTime: '2026-09-23T09:30:00.000Z',
        durationMs: 30 * 60_000,
        type: 'manual',
        description: null,
        adjusted: false,
        adjustmentReason: null,
    },
];

describe('NodeBreakdownTable (CR-05)', () => {
    it('renders a row per ticket with own + tracked + entry count', () => {
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={rows}
                expandedId={null}
                onToggleRow={vi.fn()}
            />,
        );
        expect(screen.getByText('Checkout story')).toBeInTheDocument();
        expect(screen.getByText('Hook subtask')).toBeInTheDocument();
        expect(screen.getByText('SLYK-002')).toBeInTheDocument();
        expect(screen.getByText('SLYK-003')).toBeInTheDocument();
    });

    it('shows an empty state when nothing matched the filters', () => {
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={[]}
                expandedId={null}
                onToggleRow={vi.fn()}
            />,
        );
        expect(screen.getByText('No tracked time in this window.')).toBeInTheDocument();
    });

    it('reports the expanded row upward (controlled)', () => {
        const onToggleRow = vi.fn();
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={rows}
                expandedId={null}
                onToggleRow={onToggleRow}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /SLYK-003/ }));
        expect(onToggleRow).toHaveBeenCalledWith(rows[1]);
    });

    it('renders the raw entries with Auto/Manual labels when expanded', () => {
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={rows}
                expandedId="b1"
                onToggleRow={vi.fn()}
                entries={entries}
            />,
        );
        const auto = screen.getByText('Auto').closest('li')!;
        expect(within(auto).getByText('Ada')).toBeInTheDocument();
        expect(within(auto).getByText(/research spike/)).toBeInTheDocument();
        const manual = screen.getByText('Manual').closest('li')!;
        expect(within(manual).getByText('Bob')).toBeInTheDocument();
    });

    it('shows a loading state for an expanded row with no entries yet', () => {
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={rows}
                expandedId="b1"
                onToggleRow={vi.fn()}
            />,
        );
        expect(screen.getByText('Loading entries…')).toBeInTheDocument();
    });

    it('explains when an expanded row has no matching entries', () => {
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={rows}
                expandedId="b1"
                onToggleRow={vi.fn()}
                entries={[]}
            />,
        );
        expect(screen.getByText('No entries match the current filters.')).toBeInTheDocument();
    });

    it('re-sorts by own time when the Own header is clicked', () => {
        render(
            <NodeBreakdownTable
                projectSlug="SLYK"
                rows={rows}
                expandedId={null}
                onToggleRow={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /^Own/ }));
        const dataRows = screen.getAllByRole('row').slice(1);
        expect(dataRows[0]!.textContent).toContain('Hook subtask');
    });
});
