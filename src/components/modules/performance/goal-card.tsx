'use client';

import type { GoalListItem } from '../../../services/goals';

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

function progressBarColor(progress: number): string {
  if (progress >= 60) return 'bg-emerald-500';
  if (progress >= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

interface GoalCardProps {
  goal: GoalListItem;
  onSelect: () => void;
  onUpdateProgress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  showAssignee?: boolean;
}

export function GoalCard({
  goal,
  onSelect,
  onUpdateProgress,
  onEdit,
  onDelete,
  showAssignee = false,
}: GoalCardProps) {
  const priorityClass = PRIORITY_COLORS[goal.priority] ?? PRIORITY_COLORS.medium;
  const progressClass = progressBarColor(goal.progress);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{goal.title}</h3>
            <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${priorityClass}`}>
              {goal.priority.charAt(0).toUpperCase() + goal.priority.slice(1)}
            </span>
          </div>
          {goal.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">{goal.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpdateProgress?.(); }}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            title="Update progress"
            aria-label="Update progress"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
          </button>
          {(onEdit || onDelete) && (
            <div className="relative group">
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                aria-label="More actions"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
              </button>
              <div className="absolute right-0 top-full z-10 mt-1 hidden w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg group-hover:block dark:border-gray-700 dark:bg-gray-800">
                {onEdit && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700">Edit Goal</button>
                )}
                {onUpdateProgress && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onUpdateProgress(); }} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700">Update Progress</button>
                )}
                {onDelete && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">Delete Goal</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>{goal.progress}%</span>
          <span>{STATUS_LABELS[goal.status] ?? goal.status}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${progressClass}`}
            style={{ width: `${Math.min(100, Math.max(0, goal.progress))}%` }}
          />
        </div>
      </div>

      {showAssignee && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Assigned to: {goal.assignedTo.name}
        </p>
      )}
      {goal.isOverdue && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">Overdue</p>
      )}
    </article>
  );
}
