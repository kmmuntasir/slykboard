import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/Select';
import { formatDuration } from '@/utils/formatDuration';
import { formatTicketId } from '@/utils/formatTicketId';
import { TICKET_TYPE_DISPLAY } from '@/types/ticket';
import type { Ticket } from '@/types/ticket';
import type { ColumnTimeReport, ColumnTimeRow } from '@/types/report';
import { fetchColumnTimeReport } from '@/api/reports';

// CR-08: per-column time for one ticket — wall-clock residence AND the tracked
// working time that overlapped each column. Rows are sortable; the member and
// source filters narrow the TRACKED metric (residence is wall-clock, so it is
// member-independent by definition).

const ALL = '__all__';

type SortKey = 'column' | 'residence' | 'tracked';

interface ColumnTimePanelProps {
    projectSlug: string;
    ticket: Ticket;
    /** Members seen in the project (for the filter). */
    members: ReadonlyArray<{ id: string; fullName: string }>;
}

function sortRows(rows: ColumnTimeRow[], key: SortKey, desc: boolean): ColumnTimeRow[] {
    const sorted = [...rows].sort((a, b) => {
        if (key === 'column') return a.columnName.localeCompare(b.columnName);
        if (key === 'residence') return a.residenceMs - b.residenceMs;
        return a.trackedMs - b.trackedMs;
    });
    return desc ? sorted.reverse() : sorted;
}

export function ColumnTimePanel({ projectSlug, ticket, members }: ColumnTimePanelProps) {
    const [period, setPeriod] = useState<'weekly' | 'monthly' | null>(null);
    const [member, setMember] = useState<string | null>(null);
    const [source, setSource] = useState<'auto' | 'manual' | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('column');
    const [sortDesc, setSortDesc] = useState(false);

    const displayId = formatTicketId(projectSlug, ticket.ticketNumber, { padded: true });
    const { data, isLoading } = useQuery({
        queryKey: ['column-time', projectSlug, displayId, period, member, source],
        queryFn: () =>
            fetchColumnTimeReport(projectSlug, {
                ticket: displayId,
                period,
                member,
                source,
            }),
    });

    const rows = data ? sortRows(data.columns, sortKey, sortDesc) : [];
    const header = (key: SortKey, label: string, align = 'left') => (
        <th
            scope="col"
            className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : ''}`}
        >
            <button
                type="button"
                onClick={() => {
                    if (sortKey === key) setSortDesc((d) => !d);
                    else {
                        setSortKey(key);
                        setSortDesc(false);
                    }
                }}
                aria-pressed={sortKey === key}
                className="inline-flex items-center gap-1 hover:text-foreground"
            >
                {label}
                {sortKey === key && <span aria-hidden="true">{sortDesc ? '↓' : '↑'}</span>}
            </button>
        </th>
    );

    return (
        <section className="space-y-3 rounded-md border border-border p-3" aria-label="Column time">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Time by column</h3>
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={period ?? 'all'}
                        onValueChange={(next) =>
                            setPeriod(next === 'all' ? null : (next as 'weekly' | 'monthly'))
                        }
                    >
                        <SelectTrigger className="w-36" aria-label="Column time window">
                            <SelectValue placeholder="All time" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all" textValue="All time">
                                All time
                            </SelectItem>
                            <SelectItem value="weekly" textValue="This week">
                                This week
                            </SelectItem>
                            <SelectItem value="monthly" textValue="This month">
                                This month
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <Select
                        value={member ?? ALL}
                        onValueChange={(next) => setMember(next === ALL ? null : next)}
                    >
                        <SelectTrigger className="w-40" aria-label="Column time member">
                            <SelectValue placeholder="All members" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL} textValue="All members">
                                All members
                            </SelectItem>
                            {members.map((m) => (
                                <SelectItem key={m.id} value={m.id} textValue={m.fullName}>
                                    {m.fullName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={source ?? ALL}
                        onValueChange={(next) =>
                            setSource(next === ALL ? null : (next as 'auto' | 'manual'))
                        }
                    >
                        <SelectTrigger className="w-36" aria-label="Column time source">
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
                </div>
            </div>

            {isLoading && (
                <p className="text-sm text-muted-foreground" role="status">
                    Loading column time…
                </p>
            )}

            {!isLoading && data && (
                <>
                    <table className="w-full text-sm" aria-label="Time by column">
                        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                {header('column', 'Column')}
                                {header('residence', 'Residence', 'right')}
                                {header('tracked', 'Tracked', 'right')}
                                <th scope="col" className="px-3 py-2 text-right font-medium">
                                    Visits
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.map((row) => (
                                <tr key={row.columnId}>
                                    <td className="px-3 py-2">
                                        {row.columnName}
                                        {row.columnId === ticket.statusColumn && (
                                            <span className="ml-1 text-xs text-muted-foreground">
                                                (current)
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {formatDuration(row.residenceMs)}
                                        <span className="ml-1 text-xs text-muted-foreground">
                                            {row.sharePct}%
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {formatDuration(row.trackedMs)}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                        {row.visits}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="text-xs text-muted-foreground">
                        {displayId} · {TICKET_TYPE_DISPLAY[ticket.type]} · residence{' '}
                        {formatDuration(data.totalResidenceMs)} · tracked{' '}
                        {formatDuration(data.totalTrackedMs)}
                        {data.window ? ` · ${data.window.label}` : ' · all time'}
                    </p>
                </>
            )}
        </section>
    );
}

export type { ColumnTimeReport };
