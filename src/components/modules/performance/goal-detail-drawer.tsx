'use client';

import { useState, useEffect } from 'react';
import { getGoal, type GoalDetail } from '../../../services/goals';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return d.toLocaleDateString();
}

interface GoalDetailDrawerProps {
  open: boolean;
  goalId: string | null;
  onClose: () => void;
  onUpdateProgress: () => void;
  onSuccess: () => void;
}

export function GoalDetailDrawer({ open, goalId, onClose, onUpdateProgress, onSuccess }: GoalDetailDrawerProps) {
  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !goalId) {
      setGoal(null);
      return;
    }
    setLoading(true);
    getGoal(goalId)
      .then((res) => {
        if (res.data) setGoal(res.data);
        else setGoal(null);
      })
      .catch(() => setGoal(null))
      .finally(() => setLoading(false));
  }, [open, goalId]);

  if (!open) return null;

  const priorityClass = goal ? PRIORITY_COLORS[goal.priority] ?? PRIORITY_COLORS.medium : '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl dark:bg-gray-900 flex flex-col max-h-full overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold truncate pr-8">{goal?.title ?? 'Goal'}</h2>
          <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading…</p>
          ) : !goal ? (
            <p className="text-gray-500 dark:text-gray-400">Goal not found.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${priorityClass}`}>
                  {goal.priority.charAt(0).toUpperCase() + goal.priority.slice(1)}
                </span>
                <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {STATUS_LABELS[goal.status] ?? goal.status}
                </span>
              </div>
              <section className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Details</h3>
                <dl className="space-y-1 text-sm">
                  <div><dt className="text-gray-500 dark:text-gray-400">Assigned to</dt><dd>{goal.assignedTo.name} <span className="text-gray-400 capitalize">({goal.assignedTo.type})</span></dd></div>
                  <div><dt className="text-gray-500 dark:text-gray-400">Created by</dt><dd>{goal.createdBy.firstName} {goal.createdBy.lastName}</dd></div>
                  <div><dt className="text-gray-500 dark:text-gray-400">Dates</dt><dd>{goal.startDate ? new Date(goal.startDate).toLocaleDateString() : '—'} – {goal.dueDate ? new Date(goal.dueDate).toLocaleDateString() : '—'}</dd></div>
                  {goal.isOverdue && <p className="text-red-600 dark:text-red-400 text-sm">Overdue</p>}
                </dl>
              </section>
              {goal.description && <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">{goal.description}</p>}
              <section className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Progress</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">{goal.progress}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div className={`h-full rounded-full ${goal.progress >= 60 ? 'bg-emerald-500' : goal.progress >= 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${goal.progress}%` }} />
                </div>
                {goal.status !== 'completed' && (
                  <button type="button" onClick={onUpdateProgress} className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                    Update Progress
                  </button>
                )}
              </section>
              <section>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Progress History</h3>
                {goal.progressHistory.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No updates yet.</p>
                ) : (
                  <ul className="space-y-4 border-l-2 border-gray-200 pl-4 dark:border-gray-700">
                    {goal.progressHistory.map((h) => (
                      <li key={h.id} className="relative">
                        <p className="text-sm font-medium">{h.user.firstName} {h.user.lastName} updated progress from {h.oldProgress}% to {h.newProgress}%</p>
                        {h.note && <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">&quot;{h.note}&quot;</p>}
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{formatRelative(h.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
