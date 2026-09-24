import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/Select';
import { Retry } from '@/components/Retry';
import { NodeBreakdownTable } from '@/components/NodeBreakdownTable';
import { useNodeBreakdown, useNodeEntries, useNodeRollup } from '@/hooks/useReport';
import { formatDuration } from '@/utils/formatDuration';
import { formatTicketId } from '@/utils/formatTicketId';
import { TICKET_TYPE_DISPLAY } from '@/types/ticket';
import type { Ticket } from '@/types/ticket';
import type { NodeTimeEntry } from '@/types/report';

// CR-04 + CR-05: the hierarchy time report section. A node picker (any epic /
// story / task in the project) drives a windowed roll-up summary, a per-member
// table, and the per-ticket breakdown. Member + source filters recompute every
// aggregate server-side, so rows, members, totals, and entries always agree.
//
// Expansion is parent-controlled: the table reports toggles, the parent keeps
// the mounted useNodeEntries query keyed to the expanded row's display id, and
// loadEntries reads that query's cache so an open row shows its raw entries.

interface HierarchyTimeReportProps {
    projectSlug: string;
    period: 'weekly' | 'monthly';
    offset: number;
    /** Live tickets of the project (from the board query) for the node picker. */
    tickets: Ticket[];
}

const ALL = '__all__';

export function HierarchyTimeReport({
    projectSlug,
    period,
    offset,
    tickets,
}: HierarchyTimeReportProps) {
    // Roll-up roots are epics, stories, and tasks (a subtask's time rolls up
    // through its parent).
    const options = useMemo(
        () =>
            tickets
                .filter((ticket) => ticket.type !== 'SUBTASK')
                .sort((a, b) => a.ticketNumber - b.ticketNumber),
        [tickets],
    );

    const [nodeId, setNodeId] = useState<string | null>(null);
    const [memberFilter, setMemberFilter] = useState<string | null>(null);
    const [sourceFilter, setSourceFilter] = useState<'auto' | 'manual' | null>(null);
    const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

    const selected = options.find((ticket) => ticket.id === nodeId) ?? null;
    const nodeRef = selected ? formatTicketId(projectSlug, selected.ticketNumber) : null;
    const filters = { member: memberFilter, source: sourceFilter };

    const rollup = useNodeRollup(period, offset, projectSlug, nodeRef, filters);
    const breakdown = useNodeBreakdown(period, offset, projectSlug, nodeRef, filters);

    // The expanded row's display id keys the mounted entries query.
    const expandedRow = breakdown.data?.rows.find((row) => row.id === expandedRowId) ?? null;
    const expandedDisplayId = expandedRow
        ? formatTicketId(projectSlug, expandedRow.ticketNumber)
        : null;
    const entriesQuery = useNodeEntries(
        period,
        offset,
        projectSlug,
        nodeRef,
        expandedDisplayId,
        filters,
    );
    const entries: NodeTimeEntry[] | undefined = entriesQuery.data?.entries;

    const members = breakdown.data?.members ?? [];
    const error = rollup.error ?? breakdown.error;
    const hasNode = nodeRef !== null;

    return (
        <section className="mt-8 space-y-4" aria-label="Hierarchy time report">
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <Clock size={20} className="text-muted-foreground" />
                Hierarchy Time
            </h2>

            <div className="flex flex-wrap items-center gap-3">
                <Select
                    value={nodeId ?? ''}
                    onValueChange={(next) => {
                        setNodeId(next === '' ? null : next);
                        setMemberFilter(null);
                        setExpandedRowId(null);
                    }}
                >
                    <SelectTrigger className="w-72" aria-label="Report node">
                        <SelectValue placeholder="Select an epic, story, or task" />
                    </SelectTrigger>
                    <SelectContent>
                        {options.length === 0 && (
                            <SelectItem value="" disabled textValue="No epics or stories yet">
                                No epics or stories yet
                            </SelectItem>
                        )}
                        {options.map((ticket) => (
                            <SelectItem
                                key={ticket.id}
                                value={ticket.id}
                                textValue={`${formatTicketId(projectSlug, ticket.ticketNumber)} ${ticket.title}`}
                            >
                                {formatTicketId(projectSlug, ticket.ticketNumber, {
                                    padded: true,
                                })}{' '}
                                · {TICKET_TYPE_DISPLAY[ticket.type]} · {ticket.title}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={memberFilter ?? ALL}
                    onValueChange={(next) => setMemberFilter(next === ALL ? null : next)}
                >
                    <SelectTrigger className="w-48" aria-label="Filter by member">
                        <SelectValue placeholder="All members" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL} textValue="All members">
                            All members
                        </SelectItem>
                        {members.map((member) => (
                            <SelectItem
                                key={member.id}
                                value={member.id}
                                textValue={member.fullName}
                            >
                                {member.fullName}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={sourceFilter ?? ALL}
                    onValueChange={(next) =>
                        setSourceFilter(next === ALL ? null : (next as 'auto' | 'manual'))
                    }
                >
                    <SelectTrigger className="w-40" aria-label="Filter by source">
                        <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL} textValue="All sources">
                            All sources
                        </SelectItem>
                        <SelectItem value="auto" textValue="Auto-tracked">
                            Auto-tracked
                        </SelectItem>
                        <SelectItem value="manual" textValue="Manual">
                            Manual
                        </SelectItem>
                    </SelectContent>
                </Select>

                {rollup.data && (
                    <span className="text-sm text-muted-foreground">
                        {rollup.data.window.label}
                    </span>
                )}
            </div>

            {!hasNode && (
                <p className="text-sm text-muted-foreground">
                    Pick an epic, story, or task to see its rolled-up time.
                </p>
            )}

            {hasNode && error instanceof Error && (
                <Retry message={error.message} onRetry={() => void rollup.refetch()} />
            )}

            {hasNode && rollup.data && (
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg border border-border p-4">
                    <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Total tracked
                        </p>
                        <p className="text-2xl font-semibold tabular-nums">
                            {formatDuration(rollup.data.totalMs)}
                        </p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Auto-tracked
                        </p>
                        <p className="tabular-nums">{formatDuration(rollup.data.autoMs)}</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Manual
                        </p>
                        <p className="tabular-nums">{formatDuration(rollup.data.manualMs)}</p>
                    </div>
                    <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Entries
                        </p>
                        <p className="tabular-nums">{rollup.data.entryCount}</p>
                    </div>
                </div>
            )}

            {hasNode && members.length > 0 && (
                <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        By member
                    </h3>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {members.map((member) => (
                            <li
                                key={member.id}
                                className="flex items-center gap-3 px-4 py-2 text-sm"
                            >
                                <span className="min-w-0 flex-1 truncate">{member.fullName}</span>
                                <span className="text-xs text-muted-foreground">
                                    {member.autoMs > 0
                                        ? `${formatDuration(member.autoMs)} auto`
                                        : ''}
                                    {member.autoMs > 0 && member.manualMs > 0 ? ' · ' : ''}
                                    {member.manualMs > 0
                                        ? `${formatDuration(member.manualMs)} manual`
                                        : ''}
                                </span>
                                <span className="w-20 text-right font-medium tabular-nums">
                                    {formatDuration(member.totalMs)}
                                </span>
                                <span className="w-16 text-right text-xs text-muted-foreground">
                                    {member.entryCount} entries
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {hasNode && breakdown.data && (
                <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        By ticket
                    </h3>
                    <NodeBreakdownTable
                        projectSlug={projectSlug}
                        rows={breakdown.data.rows}
                        isLoading={breakdown.isLoading}
                        expandedId={expandedRowId}
                        onToggleRow={(row) =>
                            setExpandedRowId((current) => (current === row.id ? null : row.id))
                        }
                        entries={entries}
                        isEntriesLoading={entriesQuery.isLoading}
                    />
                </div>
            )}
        </section>
    );
}
