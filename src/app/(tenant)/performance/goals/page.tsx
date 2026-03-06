'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  listGoals,
  getGoalsExportUrl,
  type GoalListItem,
  type TimeFilter,
} from '../../../../services/goals';
import { GoalCard } from '../../../../components/modules/performance/goal-card';
import { GoalFormDrawer } from '../../../../components/modules/performance/goal-form-drawer';
import { GoalDetailDrawer } from '../../../../components/modules/performance/goal-detail-drawer';
import { ProgressUpdateModal } from '../../../../components/modules/performance/progress-update-modal';

const TIME_FILTERS: { value: TimeFilter; label: string }[] = [
  { value: 'all', label: 'All Goals' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
];

export default function PerformanceGoalsPage() {
  const [goals, setGoals] = useState<GoalListItem[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [counts, setCounts] = useState<Record<TimeFilter, number>>({
    all: 0,
    this_week: 0,
    last_week: 0,
    this_month: 0,
    last_month: 0,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [progressGoalId, setProgressGoalId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const fetchGoals = useCallback(
    async (filter: TimeFilter = timeFilter, pageNum: number = 1) => {
      setLoading(true);
      try {
        const res = await listGoals({
          page: pageNum,
          limit: 10,
          filter,
        });
        if (res.data) setGoals(res.data);
        else setGoals([]);
        if (res.meta) setMeta(res.meta);
        else setMeta(null);
      } catch {
        setGoals([]);
        setMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [timeFilter]
  );

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  useEffect(() => {
    TIME_FILTERS.forEach(({ value }) => {
      if (value === 'all') return;
      listGoals({ page: 1, limit: 1, filter: value })
        .then((r) => setCounts((c) => ({ ...c, [value]: r.meta?.total ?? 0 })))
        .catch(() => {});
    });
    listGoals({ page: 1, limit: 1, filter: 'all' })
      .then((r) => setCounts((c) => ({ ...c, all: r.meta?.total ?? 0 })))
      .catch(() => {});
  }, [goals]);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  const handleExport = (format: 'csv' | 'xlsx' | 'pdf') => {
    const url = getGoalsExportUrl(format, { filter: timeFilter });
    window.open(url, '_blank');
    setExportOpen(false);
  };

  const refresh = () => {
    fetchGoals(timeFilter, page);
    setDetailOpen(false);
    setSelectedId(null);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Goals</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              aria-expanded={exportOpen}
              aria-haspopup="true"
            >
              Export
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" aria-hidden onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  <button type="button" onClick={() => handleExport('csv')} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">CSV</button>
                  <button type="button" onClick={() => handleExport('xlsx')} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">XLSX</button>
                  <button type="button" onClick={() => handleExport('pdf')} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700">PDF</button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setSelectedId(null); setFormOpen(true); }}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Goals
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {TIME_FILTERS.map(({ value, label }) => {
          const count = value === 'all' ? (meta?.total ?? counts.all) : counts[value];
          const active = timeFilter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTimeFilter(value);
                setPage(1);
                fetchGoals(value, 1);
              }}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'
              }`}
            >
              {label} {count}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 py-16 dark:border-gray-600">
          <p className="text-gray-500 dark:text-gray-400">No Goals defined</p>
          <button
            type="button"
            onClick={() => { setSelectedId(null); setFormOpen(true); }}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Goals
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onSelect={() => openDetail(goal.id)}
              onUpdateProgress={() => setProgressGoalId(goal.id)}
              onEdit={() => {
                setSelectedId(goal.id);
                setFormOpen(true);
              }}
              onDelete={async () => {
                if (!confirm('Delete this goal?')) return;
                try {
                  const { deleteGoal } = await import('../../../../services/goals');
                  await deleteGoal(goal.id);
                  refresh();
                } catch (e) {
                  alert((e as Error).message);
                }
              }}
            />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => { setPage((p) => p - 1); fetchGoals(timeFilter, page - 1); }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-600"
          >
            Previous
          </button>
          <span className="py-1.5 text-sm text-gray-600 dark:text-gray-400">
            Page {page} of {meta.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= meta.totalPages}
            onClick={() => { setPage((p) => p + 1); fetchGoals(timeFilter, page + 1); }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-600"
          >
            Next
          </button>
        </div>
      )}

      <GoalFormDrawer
        open={formOpen}
        onClose={() => { setFormOpen(false); setSelectedId(null); }}
        goalId={selectedId}
        onSuccess={refresh}
      />
      <GoalDetailDrawer
        open={detailOpen}
        goalId={selectedId}
        onClose={() => { setDetailOpen(false); setSelectedId(null); }}
        onUpdateProgress={() => selectedId && setProgressGoalId(selectedId)}
        onSuccess={refresh}
      />
      <ProgressUpdateModal
        open={!!progressGoalId}
        goalId={progressGoalId}
        onClose={() => setProgressGoalId(null)}
        onSuccess={() => { setProgressGoalId(null); refresh(); }}
      />
    </div>
  );
}
