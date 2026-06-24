import { useState } from 'react';

import { AssigneeAvatar } from '@/components/AssigneeAvatar';
import { useReport, useTicketSummary } from '@/hooks/useReport';
import { formatDuration } from '@/utils/formatDuration';

type Period = 'weekly' | 'monthly';

// F23: per-user aggregated time report. Toggle weekly/monthly window, page
// back through periods, and list each user's tracked total. Any authenticated
// user may view (no role gate). Mirror TimeLog's avatar + duration styling.
export function ReportsPage() {
    const [period, setPeriod] = useState<Period>('weekly');
    const [offset, setOffset] = useState<number>(0);

    const { data, isLoading, isError } = useReport(period, offset);
    const users = data?.users ?? [];

    // F24: resolved-ticket summary reuses the SAME period + offset window.
    const ticketSummary = useTicketSummary(period, offset);
    const summaryUsers = ticketSummary.data?.users ?? [];

    const handlePeriodChange = (next: Period) => {
        if (next === period) return;
        setPeriod(next);
        setOffset(0); // reset to current window on granularity change
    };

    return (
        <div className="p-8">
            <h1 className="text-2xl font-semibold">Reports</h1>

            {/* Controls: period toggle + window navigation */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="inline-flex overflow-hidden rounded-md border border-gray-200">
                    <PeriodButton
                        label="Weekly"
                        active={period === 'weekly'}
                        onClick={() => handlePeriodChange('weekly')}
                    />
                    <PeriodButton
                        label="Monthly"
                        active={period === 'monthly'}
                        onClick={() => handlePeriodChange('monthly')}
                    />
                </div>

                <div className="inline-flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setOffset((o) => o - 1)}
                        className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        ← Prev
                    </button>
                    <button
                        type="button"
                        onClick={() => setOffset((o) => o + 1)}
                        disabled={offset >= 0}
                        className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                    >
                        Next →
                    </button>
                </div>
            </div>

            {/* Window label */}
            {data?.window?.label && (
                <p className="mt-4 text-lg font-medium text-gray-800">
                    {data.window.label}
                </p>
            )}

            {/* Body */}
            {isLoading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
            {isError && (
                <p className="mt-4 text-sm text-red-600">Failed to load report.</p>
            )}
            {!isLoading && !isError && users.length === 0 && (
                <p className="mt-4 text-sm text-gray-500">No time tracked in this period.</p>
            )}
            {!isLoading && !isError && users.length > 0 && (
                <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <tr>
                                <th scope="col" className="px-4 py-2.5">
                                    User
                                </th>
                                <th
                                    scope="col"
                                    className="px-4 py-2.5 text-right"
                                >
                                    Total Time
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <AssigneeAvatar
                                                assignee={{
                                                    id: user.id,
                                                    fullName: user.fullName,
                                                    avatarUrl: user.avatarUrl,
                                                }}
                                            />
                                            <span className="text-gray-800">
                                                {user.fullName}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {formatDuration(user.totalMs)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* F24: Ticket Summary — resolved-ticket counts grouped by priority,
                same shared period/offset window as the time report. */}
            <h2 className="mt-8 text-2xl font-semibold">
                Ticket Summary (Resolved by Priority)
            </h2>

            {ticketSummary.data?.window?.label && (
                <p className="mt-4 text-lg font-medium text-gray-800">
                    {ticketSummary.data.window.label}
                </p>
            )}

            {ticketSummary.isLoading && (
                <p className="mt-4 text-sm text-gray-500">Loading…</p>
            )}
            {ticketSummary.isError && (
                <p className="mt-4 text-sm text-red-600">
                    Failed to load report.
                </p>
            )}
            {!ticketSummary.isLoading && !ticketSummary.isError && summaryUsers.length === 0 && (
                <p className="mt-4 text-sm text-gray-500">
                    No resolved tickets in this period.
                </p>
            )}
            {!ticketSummary.isLoading && !ticketSummary.isError && summaryUsers.length > 0 && (
                <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                        <tbody className="divide-y divide-gray-100">
                            {summaryUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <AssigneeAvatar
                                                assignee={{
                                                    id: user.id,
                                                    fullName: user.fullName,
                                                    avatarUrl: user.avatarUrl,
                                                }}
                                            />
                                            <span className="text-gray-800">
                                                {user.fullName}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {user.counts.LOW}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {user.counts.MEDIUM}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {user.counts.HIGH}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {user.counts.URGENT}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {user.counts.CRITICAL}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <span className="font-mono tabular-nums text-sm text-gray-700">
                                            {user.counts.total}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

interface PeriodButtonProps {
    label: string;
    active: boolean;
    onClick: () => void;
}

function PeriodButton({ label, active, onClick }: PeriodButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={
                active
                    ? 'bg-primary px-3 py-1.5 text-sm text-white'
                    : 'bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'
            }
        >
            {label}
        </button>
    );
}
