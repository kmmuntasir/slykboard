import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Checkbox } from '@/components/ui/Checkbox';
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
// working time that overlapped each column. Rows arrive in board column order
// (the default sort) and can be re-sorted by name or the numeric metrics; the
// member and source filters narrow the TRACKED metric (residence is wall-clock,
// so it is member-independent by definition).

const ALL = '__all__';

type SortKey = 'order' | 'column' | 'residence' | 'tracked';

interface ColumnTimePanelProps {
    projectSlug: string;
    ticket: Ticket;
    /** Members seen in the project (for the filter). */
    members: ReadonlyArray<{ id: string; fullName: string }>;
}

function sortRows(rows: ColumnTimeRow[], key: SortKey, desc: boolean): ColumnTimeRow[] {
    const sorted = [...rows].sort((a, b) => {
        // 'order' keeps the server's board-column order: a 0 comparator plus a
        // stable sort is a no-op, so the desc flip must be skipped too.
        if (key === 'order') return 0;
        if (key === 'column') return a.columnName.localeCompare(b.columnName);
        if (key === 'residence') return a.residenceMs - b.residenceMs;
        return a.trackedMs - b.trackedMs;
    });
    if (key === 'order' || !desc) return sorted;
    return sorted.reverse();
}

// CR-11: "1h 20m auto · 30m manual" explains a mixed tracked total. A
// single-source total is already unambiguous (one segment is 0), so no split
// line is rendered for it.
function sourceSplitText(autoMs: number, manualMs: number): string | null {
    if (autoMs <= 0 || manualMs <= 0) return null;
    return `${formatDuration(autoMs)} auto · ${formatDuration(manualMs)} manual`;
}

export function ColumnTimePanel({ projectSlug, ticket, members }: ColumnTimePanelProps) {
    const [period, setPeriod] = useState<'weekly' | 'monthly' | null>(null);
    const [member, setMember] = useState<string | null>(null);
    const [source, setSource] = useState<'auto' | 'manual' | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('order');
    const [sortDesc, setSortDesc] = useState(false);
    const [hideEmpty, setHideEmpty] = useState(false);

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

    // The backend returns every project column; the hide-empty toggle drops
    // rows with nothing to show (no residence, no tracked time, no visits).
    const rows = data
        ? sortRows(
              hideEmpty
                  ? data.columns.filter(
                        (row) => row.residenceMs !== 0 || row.trackedMs !== 0 || row.visits !== 0,
                    )
                  : data.columns,
              sortKey,
              sortDesc,
          )
        : [];
    const totalSplit = data ? sourceSplitText(data.autoMs, data.manualMs) : null;
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
                    <Select
                        value={sortKey}
                        onValueChange={(next) => {
                            setSortKey(next as SortKey);
                            setSortDesc(false);
                        }}
                    >
                        <SelectTrigger className="w-40" aria-label="Column time sort">
                            <SelectValue placeholder="Sort" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="order" textValue="Board order">
                                Board order
                            </SelectItem>
                            <SelectItem value="column" textValue="Column name">
                                Column name
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <Checkbox
                            checked={hideEmpty}
                            onCheckedChange={(checked) => setHideEmpty(checked === true)}
                            aria-label="Hide empty columns"
                        />
                        Hide empty columns
                    </label>
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
                                <th scope="col" className="px-3 py-2 font-medium">
                                    Column
                                </th>
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
                                        {sourceSplitText(row.autoMs, row.manualMs) && (
                                            <span className="block text-xs text-muted-foreground">
                                                {sourceSplitText(row.autoMs, row.manualMs)}
                                            </span>
                                        )}
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
                        {totalSplit && ` (${totalSplit})`}
                        {data.window ? ` · ${data.window.label}` : ' · all time'}
                    </p>
                </>
            )}
        </section>
    );
}

export type { ColumnTimeReport };
