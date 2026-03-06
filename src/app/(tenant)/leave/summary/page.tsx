'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getLeaveSummary, type LeaveSummary } from '../../../../services/leave-summary';
import { LeaveBalanceCards } from '../../../../components/modules/leave/leave-balance-cards';
import { ApplyLeaveModal } from '../../../../components/modules/leave/apply-leave-modal';

export default function LeaveSummaryPage() {
  const [summary, setSummary] = useState<LeaveSummary | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [applyModalOpen, setApplyModalOpen] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLeaveSummary(year);
      if (res.data) setSummary(res.data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const yearLabel = summary?.leaveYearLabel ?? '—';
  const currentYear = summary?.year;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">Leave Summary</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => currentYear != null && setYear(currentYear - 1)}
              className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              aria-label="Previous year"
            >
              ←
            </button>
            <span className="min-w-[220px] text-center text-sm text-gray-600 dark:text-gray-400">
              {yearLabel}
            </span>
            <button
              type="button"
              onClick={() => currentYear != null && setYear(currentYear + 1)}
              className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              aria-label="Next year"
            >
              →
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/leave/requests"
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Export
          </Link>
          <button
            type="button"
            onClick={() => setApplyModalOpen(true)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Apply Leave
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !summary ? (
        <p className="text-muted-foreground">Unable to load summary.</p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">Balance overview</h2>
            <LeaveBalanceCards balances={summary.balances} onApplyLeave={() => setApplyModalOpen(true)} />
          </section>

          <section className="mb-8">
            <details className="rounded-lg border border-gray-200 dark:border-gray-700" open>
              <summary className="cursor-pointer px-4 py-3 font-medium">
                Upcoming Leaves & Holidays
              </summary>
              <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                {summary.upcomingLeaves.length === 0 && summary.upcomingHolidays.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming leaves or holidays.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {summary.upcomingLeaves.map((l) => (
                      <li key={l.id} className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: l.leaveType.color ?? '#6b7280' }}
                        />
                        {new Date(l.startDate).toLocaleDateString()} – {new Date(l.endDate).toLocaleDateString()}{' '}
                        · {l.leaveType.name} · {l.totalDays} day(s) · {l.status}
                      </li>
                    ))}
                    {summary.upcomingHolidays.map((h) => (
                      <li key={h.date + h.name} className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                        {new Date(h.date).toLocaleDateString()} · {h.name}
                        {h.isOptional ? ' (Optional)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </section>

          <section>
            <details className="rounded-lg border border-gray-200 dark:border-gray-700">
              <summary className="cursor-pointer px-4 py-3 font-medium">
                Past Leaves & Holidays
              </summary>
              <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                {summary.pastLeaves.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No past leaves.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {summary.pastLeaves.map((l) => (
                      <li key={l.id} className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: l.leaveType.color ?? '#6b7280' }}
                        />
                        {new Date(l.startDate).toLocaleDateString()} – {new Date(l.endDate).toLocaleDateString()}{' '}
                        · {l.leaveType.name} · {l.totalDays} day(s) · {l.status}
                        {l.reason ? ` · ${l.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </section>
        </>
      )}

      <ApplyLeaveModal
        open={applyModalOpen}
        onClose={() => setApplyModalOpen(false)}
        onSuccess={fetchSummary}
      />
    </div>
  );
}
