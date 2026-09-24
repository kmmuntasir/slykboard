import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { formatDuration } from '@/utils/formatDuration';
import { formatTicketId } from '@/utils/formatTicketId';
import { formatDate } from '@/utils/formatDate';
import { TICKET_TYPE_DISPLAY } from '@/types/ticket';
import type { NodeBreakdownRow, NodeTimeEntry } from '@/types/report';

// CR-05: the drill-down table. One row per ticket with tracked time in the
// window (own time plus its folded descendants), sortable by tracked or own
// time, and expandable to the raw entries (who / when / duration / source).
// CR-11: every duration is source-labeled — entries carry an Auto/Manual chip.

export type BreakdownSortKey = 'rollup' | 'own';

interface NodeBreakdownTableProps {
    projectSlug: string;
    rows: NodeBreakdownRow[];
    /** Raw entries for the expanded row (already scoped + filtered). */
    entries?: NodeTimeEntry[];
    /** Controlled expansion (the report section owns the entries query). */
    expandedId: string | null;
    onToggleRow: (row: NodeBreakdownRow) => void;
    isLoading?: boolean;
    isEntriesLoading?: boolean;
}

function SourceChip({ type }: { type: 'manual' | 'timer' }) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                type === 'manual' ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary'
            }`}
        >
            {type === 'manual' ? 'Manual' : 'Auto'}
        </span>
    );
}

export function NodeBreakdownTable({
    projectSlug,
    rows,
    entries,
    expandedId,
    onToggleRow,
    isLoading = false,
    isEntriesLoading = false,
}: NodeBreakdownTableProps) {
    const [sortKey, setSortKey] = useState<BreakdownSortKey>('rollup');

    // FR-05.4: sortable by tracked (roll-up) or own time. Server order is
    // rollupMs DESC; re-sorting is a pure client projection.
    const sorted = [...rows].sort((a, b) =>
        sortKey === 'rollup' ? b.rollupMs - a.rollupMs : b.ownMs - a.ownMs,
    );

    const toggleSort = (key: BreakdownSortKey) => {
        setSortKey(key);
    };

    if (isLoading) {
        return (
            <p className="text-sm text-muted-foreground" role="status">
                Loading breakdown…
            </p>
        );
    }
    if (sorted.length === 0) {
        return <p className="text-sm text-muted-foreground">No tracked time in this window.</p>;
    }

    return (
        <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm" aria-label="Time breakdown by ticket">
                <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-4 py-2 font-medium">
                            Ticket
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium">
                            Type
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                            <button
                                type="button"
                                onClick={() => toggleSort('own')}
                                aria-pressed={sortKey === 'own'}
                                className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                                Own
                                {sortKey === 'own' && <span aria-hidden="true">↓</span>}
                            </button>
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                            <button
                                type="button"
                                onClick={() => toggleSort('rollup')}
                                aria-pressed={sortKey === 'rollup'}
                                className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                                Tracked
                                {sortKey === 'rollup' && <span aria-hidden="true">↓</span>}
                            </button>
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                            Split
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                            Entries
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((row) => {
                        const expanded = expandedId === row.id;
                        const rowEntries = expanded ? entries : undefined;
                        return [
                            <tr
                                key={row.id}
                                className="border-b border-border last:border-0 hover:bg-muted/20"
                            >
                                <td className="px-4 py-2">
                                    <button
                                        type="button"
                                        onClick={() => onToggleRow(row)}
                                        aria-expanded={expanded}
                                        className="inline-flex items-center gap-1.5 text-left hover:underline"
                                    >
                                        {expanded ? (
                                            <ChevronDown size={14} aria-hidden="true" />
                                        ) : (
                                            <ChevronRight size={14} aria-hidden="true" />
                                        )}
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {formatTicketId(projectSlug, row.ticketNumber, {
                                                padded: true,
                                            })}
                                        </span>
                                        <span className="min-w-0 truncate">{row.title}</span>
                                    </button>
                                </td>
                                <td className="px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                                    {TICKET_TYPE_DISPLAY[row.type]}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                    {formatDuration(row.ownMs)}
                                </td>
                                <td className="px-4 py-2 text-right font-medium tabular-nums">
                                    {formatDuration(row.rollupMs)}
                                </td>
                                {/* CR-11: aggregates that mix sources show the
                                    split (tracked column = rollup split). */}
                                <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
                                    {row.rollupAutoMs > 0 && (
                                        <span className="block">
                                            {formatDuration(row.rollupAutoMs)} auto
                                        </span>
                                    )}
                                    {row.rollupManualMs > 0 && (
                                        <span className="block">
                                            {formatDuration(row.rollupManualMs)} manual
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                    {row.entryCount}
                                </td>
                            </tr>,
                            ...(expanded
                                ? [
                                      <tr key={`${row.id}-entries`} className="bg-muted/10">
                                          <td colSpan={6} className="px-6 py-3">
                                              {rowEntries === undefined || isEntriesLoading ? (
                                                  <p
                                                      className="text-sm text-muted-foreground"
                                                      role="status"
                                                  >
                                                      Loading entries…
                                                  </p>
                                              ) : rowEntries.length === 0 ? (
                                                  <p className="text-sm text-muted-foreground">
                                                      No entries match the current filters.
                                                  </p>
                                              ) : (
                                                  <ul className="space-y-1.5">
                                                      {rowEntries.map((entry) => (
                                                          <li
                                                              key={entry.id}
                                                              className="flex flex-wrap items-center gap-2 text-sm"
                                                          >
                                                              <SourceChip type={entry.type} />
                                                              <span className="min-w-0 truncate">
                                                                  {entry.userFullName ??
                                                                      'Unknown user'}
                                                              </span>
                                                              <span className="text-xs text-muted-foreground">
                                                                  {formatDate(entry.startTime)} ·{' '}
                                                                  {entry.ticketNumber > 0 &&
                                                                      `on ${formatTicketId(
                                                                          projectSlug,
                                                                          entry.ticketNumber,
                                                                          { padded: true },
                                                                      )}`}
                                                              </span>
                                                              {entry.description && (
                                                                  <span className="text-xs text-muted-foreground">
                                                                      “{entry.description}”
                                                                  </span>
                                                              )}
                                                              {entry.adjusted && (
                                                                  <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                                                                      Adjusted
                                                                  </span>
                                                              )}
                                                              <span className="ml-auto tabular-nums">
                                                                  {formatDuration(entry.durationMs)}
                                                              </span>
                                                          </li>
                                                      ))}
                                                  </ul>
                                              )}
                                          </td>
                                      </tr>,
                                  ]
                                : []),
                        ];
                    })}
                </tbody>
            </table>
        </div>
    );
}
