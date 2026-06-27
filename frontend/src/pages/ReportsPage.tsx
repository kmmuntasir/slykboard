import { useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

import { AssigneeAvatar } from '@/components/AssigneeAvatar';
import { Retry } from '@/components/Retry';
import { SkeletonLine } from '@/components/Skeleton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiClientError } from '@/api/client';
import { useReport, useTicketSummary } from '@/hooks/useReport';
import type { ReportUser, TicketSummaryUser } from '@/types/report';
import { formatDuration } from '@/utils/formatDuration';

type Period = 'weekly' | 'monthly';

// F49: project-scoped Reports. The route is /projects/:slug/reports; the slug
// threads through to the F48 scoped endpoints via useReport. A missing slug
// (only reachable by manual URL surgery) bounces to the chooser. Non-member
// denial arrives as a BE 403 from requireProjectMember and is handled in the
// body (D7: redirect to /projects, not a rendered 403).
export function ReportsPage() {
    const { slug } = useParams<{ slug: string }>();

    if (!slug) {
        return <Navigate to="/projects" replace />;
    }

    return <ReportsBody slug={slug} />;
}

interface ReportsBodyProps {
    slug: string;
}

function ReportsBody({ slug }: ReportsBodyProps) {
    const [period, setPeriod] = useState<Period>('weekly');
    const [offset, setOffset] = useState<number>(0);

    const time = useReport(period, offset, slug);
    const ticketSummary = useTicketSummary(period, offset, slug);

    // D7: non-member (BE 403 FORBIDDEN) → bounce to the project chooser.
    if (isForbidden(time.error) || isForbidden(ticketSummary.error)) {
        return <Navigate to="/projects" replace />;
    }

    const handlePeriodChange = (next: Period) => {
        if (next === period) return;
        setPeriod(next);
        setOffset(0); // reset to current window on granularity change
    };

    return (
        <div className="p-8">
            <h1 className="text-2xl font-semibold">Reports</h1>

            {/* Controls: period toggle (Button variant group) + window navigation */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-md" role="group" aria-label="Report period">
                    <Button
                        variant={period === 'weekly' ? 'primary' : 'outline'}
                        size="sm"
                        aria-pressed={period === 'weekly'}
                        onClick={() => handlePeriodChange('weekly')}
                        className="rounded-r-none"
                    >
                        Weekly
                    </Button>
                    <Button
                        variant={period === 'monthly' ? 'primary' : 'outline'}
                        size="sm"
                        aria-pressed={period === 'monthly'}
                        onClick={() => handlePeriodChange('monthly')}
                        className="rounded-l-none"
                    >
                        Monthly
                    </Button>
                </div>

                <div className="inline-flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Prev
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOffset((o) => o + 1)}
                        disabled={offset >= 0}
                    >
                        Next
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                </div>
            </div>

            <TimeReportSection
                label={time.data?.window?.label}
                isLoading={time.isLoading}
                error={time.error}
                onRetry={() => time.refetch()}
                users={time.data?.users ?? []}
            />

            {/* F24: Ticket Summary — resolved-ticket counts grouped by priority,
                same shared period/offset window as the time report. */}
            <h2 className="mt-8 text-2xl font-semibold">Ticket Summary (Resolved by Priority)</h2>

            <TicketSummarySection
                label={ticketSummary.data?.window?.label}
                isLoading={ticketSummary.isLoading}
                error={ticketSummary.error}
                onRetry={() => ticketSummary.refetch()}
                users={ticketSummary.data?.users ?? []}
            />
        </div>
    );
}

// --- Section helpers ---------------------------------------------------------

function isForbidden(error: unknown): boolean {
    return error instanceof ApiClientError && (error.code === 'FORBIDDEN' || error.status === 403);
}

interface SectionLabelProps {
    label?: string;
}

function WindowLabel({ label }: SectionLabelProps) {
    if (!label) return null;
    return <p className="mt-4 text-lg font-medium text-foreground">{label}</p>;
}

interface TimeReportSectionProps {
    label?: string;
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
    users: ReportUser[];
}

function TimeReportSection({ label, isLoading, error, onRetry, users }: TimeReportSectionProps) {
    return (
        <>
            <WindowLabel label={label} />

            {isLoading && <TimeReportSkeleton />}
            {!isLoading && error && <Retry message="Failed to load report." onRetry={onRetry} />}
            {!isLoading && !error && users.length === 0 && (
                <EmptyState
                    icon={Inbox}
                    title="No time tracked"
                    message="No time tracked in this period."
                />
            )}
            {!isLoading && !error && users.length > 0 && (
                <Card className="mt-4 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th scope="col" className="px-4 py-2.5">
                                    User
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Total Time
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-muted">
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <AssigneeAvatar
                                                assignee={{
                                                    id: user.id,
                                                    fullName: user.fullName,
                                                    avatarUrl: user.avatarUrl,
                                                }}
                                            />
                                            <span className="text-foreground">{user.fullName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {formatDuration(user.totalMs)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}
        </>
    );
}

interface TicketSummarySectionProps {
    label?: string;
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
    users: TicketSummaryUser[];
}

function TicketSummarySection({
    label,
    isLoading,
    error,
    onRetry,
    users,
}: TicketSummarySectionProps) {
    return (
        <>
            <WindowLabel label={label} />

            {isLoading && <TicketSummarySkeleton />}
            {!isLoading && error && <Retry message="Failed to load report." onRetry={onRetry} />}
            {!isLoading && !error && users.length === 0 && (
                <EmptyState
                    icon={CheckCircle2}
                    title="No resolved tickets"
                    message="No resolved tickets in this period."
                />
            )}
            {!isLoading && !error && users.length > 0 && (
                <Card className="mt-4 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th scope="col" className="px-4 py-2.5">
                                    Assignee
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Low
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Medium
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    High
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Urgent
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Critical
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Total
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-muted">
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <AssigneeAvatar
                                                assignee={{
                                                    id: user.id,
                                                    fullName: user.fullName,
                                                    avatarUrl: user.avatarUrl,
                                                }}
                                            />
                                            <span className="text-foreground">{user.fullName}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {user.counts.LOW}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {user.counts.MEDIUM}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {user.counts.HIGH}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {user.counts.URGENT}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {user.counts.CRITICAL}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {user.counts.total}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}
        </>
    );
}

// --- Empty / loading surfaces ------------------------------------------------

interface EmptyStateProps {
    icon: typeof Inbox;
    title: string;
    message: string;
}

function EmptyState({ icon: Icon, title, message }: EmptyStateProps) {
    return (
        <Card className="mt-4">
            <div role="status" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground">{message}</p>
            </div>
        </Card>
    );
}

function TimeReportSkeleton() {
    return (
        <Card className="mt-4 p-0">
            <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5">
                        <SkeletonLine className="h-6 w-40" />
                        <SkeletonLine className="h-6 w-20" />
                    </div>
                ))}
            </div>
        </Card>
    );
}

function TicketSummarySkeleton() {
    return (
        <Card className="mt-4 p-0">
            <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-2.5">
                        <SkeletonLine className="h-6 w-40" />
                        {Array.from({ length: 6 }).map((_, j) => (
                            <SkeletonLine key={j} className="h-6 w-10" />
                        ))}
                    </div>
                ))}
            </div>
        </Card>
    );
}

// --- Types (re-exported from @/types/report; ReportUser, TicketSummaryUser) -
