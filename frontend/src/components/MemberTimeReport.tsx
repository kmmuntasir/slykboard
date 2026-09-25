import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { AssigneeAvatar } from '@/components/AssigneeAvatar';
import { Card } from '@/components/ui/Card';
import { Retry } from '@/components/Retry';
import { EmptyState } from '@/components/EmptyState';
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
import type { ReportUser } from '@/types/report';
import type { TicketType } from '@/types/ticket';
import type { TimeReportFilters } from '@/api/reports';
import { Inbox } from 'lucide-react';

// CR-06: the member-wise time report with a per-ticket breakdown. Each member
// row expands to show where their time went (ticket + epic + auto/manual split),
// and the row sums always equal the member's headline total because the server
// derives both from the same windowed read.
//
// FR-06.3: member/source/ticket-type filters narrow the headline totals AND
// their breakdown rows server-side (the page owns the state and feeds it into
// the useReport query key). The expanded breakdown's Time header toggles a
// local time-desc sort on top of the server order.

// Sentinel for the Radix Select "no filter" option (empty values are invalid).
const ALL = '__all__';

// Hierarchy types for the type filter; display labels come from the same map
// the breakdown rows use.
const TICKET_TYPES = Object.keys(TICKET_TYPE_DISPLAY) as TicketType[];

interface MemberTimeReportProps {
    projectSlug: string;
    label?: string;
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
    users: ReportUser[];
    /** Server-side narrowing filters, owned by the page (part of the query key). */
    filters: TimeReportFilters;
    onFiltersChange: (filters: TimeReportFilters) => void;
}

function TimeReportSkeleton() {
    return (
        <div className="mt-4 space-y-2" role="status" aria-label="Loading time report">
            <div className="h-10 rounded bg-muted" />
            <div className="h-10 rounded bg-muted" />
        </div>
    );
}

export function MemberTimeReport({
    projectSlug,
    label,
    isLoading,
    error,
    onRetry,
    users,
    filters,
    onFiltersChange,
}: MemberTimeReportProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sortDesc, setSortDesc] = useState(true);
    // FR-06.3: breakdown rows arrive in server order; 'time' is a local
    // time-desc projection (same toggle convention as NodeBreakdownTable).
    const [breakdownSort, setBreakdownSort] = useState<'default' | 'time'>('default');

    const sorted = [...users].sort((a, b) =>
        sortDesc ? b.totalMs - a.totalMs : a.totalMs - b.totalMs,
    );

    return (
        <>
            {label && <p className="mt-4 text-lg font-medium text-foreground">{label}</p>}

            {/* FR-06.3: narrowing filters — every change refetches server-side
                so headline totals and breakdown rows stay coherent. Member
                options mirror HierarchyTimeReport: they come from the report's
                own query result. */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
                <Select
                    value={filters.member ?? ALL}
                    onValueChange={(next) =>
                        onFiltersChange({ ...filters, member: next === ALL ? null : next })
                    }
                >
                    <SelectTrigger className="w-48" aria-label="Filter by member">
                        <SelectValue placeholder="All members" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL} textValue="All members">
                            All members
                        </SelectItem>
                        {users.map((user) => (
                            <SelectItem key={user.id} value={user.id} textValue={user.fullName}>
                                {user.fullName}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={filters.source ?? ALL}
                    onValueChange={(next) =>
                        onFiltersChange({
                            ...filters,
                            source: next === ALL ? null : (next as 'auto' | 'manual'),
                        })
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

                <Select
                    value={filters.type ?? ALL}
                    onValueChange={(next) =>
                        onFiltersChange({
                            ...filters,
                            type: next === ALL ? null : (next as TicketType),
                        })
                    }
                >
                    <SelectTrigger className="w-40" aria-label="Filter by ticket type">
                        <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL} textValue="All types">
                            All types
                        </SelectItem>
                        {TICKET_TYPES.map((type) => (
                            <SelectItem
                                key={type}
                                value={type}
                                textValue={TICKET_TYPE_DISPLAY[type]}
                            >
                                {TICKET_TYPE_DISPLAY[type]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {isLoading && <TimeReportSkeleton />}
            {!isLoading && error && <Retry message="Failed to load report." onRetry={onRetry} />}
            {!isLoading && !error && users.length === 0 && (
                <EmptyState
                    icon={<Inbox />}
                    title="No time tracked"
                    description="No time tracked in this period."
                />
            )}
            {!isLoading && !error && users.length > 0 && (
                <Card className="mt-4 overflow-hidden">
                    <table className="w-full text-sm" aria-label="Member time report">
                        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th scope="col" className="px-4 py-2.5">
                                    User
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    <button
                                        type="button"
                                        onClick={() => setSortDesc((d) => !d)}
                                        aria-pressed={!sortDesc}
                                        className="inline-flex items-center gap-1 hover:text-foreground"
                                    >
                                        Total Time
                                        <span aria-hidden="true">{sortDesc ? '↓' : '↑'}</span>
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {sorted.map((user) => {
                                const expanded = expandedId === user.id;
                                // FR-06.3: server order is totalMs DESC; the
                                // Time header toggle is a pure client projection.
                                const tickets =
                                    breakdownSort === 'time'
                                        ? [...user.tickets].sort((a, b) => b.totalMs - a.totalMs)
                                        : user.tickets;
                                return [
                                    <tr key={user.id} className="hover:bg-muted">
                                        <td className="px-4 py-2.5">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setExpandedId(expanded ? null : user.id)
                                                }
                                                aria-expanded={expanded}
                                                className="flex items-center gap-2 text-left"
                                            >
                                                {expanded ? (
                                                    <ChevronDown size={14} aria-hidden="true" />
                                                ) : (
                                                    <ChevronRight size={14} aria-hidden="true" />
                                                )}
                                                <AssigneeAvatar
                                                    assignee={{
                                                        id: user.id,
                                                        fullName: user.fullName,
                                                        avatarUrl: user.avatarUrl,
                                                    }}
                                                />
                                                <span className="text-foreground">
                                                    {user.fullName}
                                                </span>
                                            </button>
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            <span className="font-mono tabular-nums text-sm text-foreground">
                                                {formatDuration(user.totalMs)}
                                            </span>
                                        </td>
                                    </tr>,
                                    ...(expanded
                                        ? [
                                              <tr
                                                  key={`${user.id}-breakdown`}
                                                  className="bg-muted/10"
                                              >
                                                  <td colSpan={2} className="px-8 py-3">
                                                      {user.tickets.length === 0 ? (
                                                          <p className="text-sm text-muted-foreground">
                                                              No ticket breakdown for the current
                                                              filters.
                                                          </p>
                                                      ) : (
                                                          <table
                                                              className="w-full text-sm"
                                                              aria-label={`Breakdown for ${user.fullName}`}
                                                          >
                                                              <thead>
                                                                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                                                      <th
                                                                          scope="col"
                                                                          className="py-1 font-medium"
                                                                      >
                                                                          Ticket
                                                                      </th>
                                                                      <th
                                                                          scope="col"
                                                                          className="py-1 font-medium"
                                                                      >
                                                                          Type
                                                                      </th>
                                                                      <th
                                                                          scope="col"
                                                                          className="py-1 text-right font-medium"
                                                                      >
                                                                          Split
                                                                      </th>
                                                                      <th
                                                                          scope="col"
                                                                          className="py-1 text-right font-medium"
                                                                      >
                                                                          <button
                                                                              type="button"
                                                                              onClick={() =>
                                                                                  setBreakdownSort(
                                                                                      (current) =>
                                                                                          current ===
                                                                                          'time'
                                                                                              ? 'default'
                                                                                              : 'time',
                                                                                  )
                                                                              }
                                                                              aria-pressed={
                                                                                  breakdownSort ===
                                                                                  'time'
                                                                              }
                                                                              className="inline-flex items-center gap-1 hover:text-foreground"
                                                                          >
                                                                              Time
                                                                              {breakdownSort ===
                                                                                  'time' && (
                                                                                  <span aria-hidden="true">
                                                                                      ↓
                                                                                  </span>
                                                                              )}
                                                                          </button>
                                                                      </th>
                                                                  </tr>
                                                              </thead>
                                                              <tbody className="divide-y divide-border">
                                                                  {tickets.map((ticket) => (
                                                                      <tr key={ticket.id}>
                                                                          <td className="py-1.5">
                                                                              <span className="font-mono text-xs text-muted-foreground">
                                                                                  {formatTicketId(
                                                                                      projectSlug,
                                                                                      ticket.ticketNumber,
                                                                                      {
                                                                                          padded: true,
                                                                                      },
                                                                                  )}
                                                                              </span>{' '}
                                                                              <span className="min-w-0">
                                                                                  {ticket.title}
                                                                              </span>
                                                                              {ticket.epic && (
                                                                                  <span className="ml-1 text-xs text-muted-foreground">
                                                                                      (in{' '}
                                                                                      {
                                                                                          ticket
                                                                                              .epic
                                                                                              .title
                                                                                      }
                                                                                      )
                                                                                  </span>
                                                                              )}
                                                                          </td>
                                                                          <td className="py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                                                                              {
                                                                                  TICKET_TYPE_DISPLAY[
                                                                                      ticket.type
                                                                                  ]
                                                                              }
                                                                          </td>
                                                                          <td className="py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                                                                              {ticket.autoMs >
                                                                                  0 && (
                                                                                  <span className="block">
                                                                                      {`${formatDuration(
                                                                                          ticket.autoMs,
                                                                                      )} auto`}
                                                                                  </span>
                                                                              )}
                                                                              {ticket.manualMs >
                                                                                  0 && (
                                                                                  <span className="block">
                                                                                      {`${formatDuration(
                                                                                          ticket.manualMs,
                                                                                      )} manual`}
                                                                                  </span>
                                                                              )}
                                                                          </td>
                                                                          <td className="py-1.5 text-right font-medium tabular-nums">
                                                                              {formatDuration(
                                                                                  ticket.totalMs,
                                                                              )}
                                                                          </td>
                                                                      </tr>
                                                                  ))}
                                                              </tbody>
                                                          </table>
                                                      )}
                                                  </td>
                                              </tr>,
                                          ]
                                        : []),
                                ];
                            })}
                        </tbody>
                    </table>
                </Card>
            )}
        </>
    );
}
