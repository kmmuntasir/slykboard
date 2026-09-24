import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { AssigneeAvatar } from '@/components/AssigneeAvatar';
import { Card } from '@/components/ui/Card';
import { Retry } from '@/components/Retry';
import { EmptyState } from '@/components/EmptyState';
import { formatDuration } from '@/utils/formatDuration';
import { formatTicketId } from '@/utils/formatTicketId';
import { TICKET_TYPE_DISPLAY } from '@/types/ticket';
import type { ReportUser } from '@/types/report';
import { Inbox } from 'lucide-react';

// CR-06: the member-wise time report with a per-ticket breakdown. Each member
// row expands to show where their time went (ticket + epic + auto/manual split),
// and the row sums always equal the member's headline total because the server
// derives both from the same windowed read.

interface MemberTimeReportProps {
    projectSlug: string;
    label?: string;
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
    users: ReportUser[];
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
}: MemberTimeReportProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [sortDesc, setSortDesc] = useState(true);

    const sorted = [...users].sort((a, b) =>
        sortDesc ? b.totalMs - a.totalMs : a.totalMs - b.totalMs,
    );

    return (
        <>
            {label && <p className="mt-4 text-lg font-medium text-foreground">{label}</p>}

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
                                                                          Time
                                                                      </th>
                                                                  </tr>
                                                              </thead>
                                                              <tbody className="divide-y divide-border">
                                                                  {user.tickets.map((ticket) => (
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
