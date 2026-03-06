'use client';

import type { TeamOnLeaveEntry } from '../../../services/leave-summary';

interface TeamLeaveListProps {
  entries: TeamOnLeaveEntry[];
  emptyMessage?: string;
}

function formatDate(s: string) {
  try {
    return new Date(s).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  return s;
}

function durationLabel(durationType: string) {
  if (durationType === 'first_half') return 'First Half';
  if (durationType === 'second_half') return 'Second Half';
  return 'Full Day';
}

export function TeamLeaveList({ entries, emptyMessage = 'No one is on leave on this date.' }: TeamLeaveListProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <div
          key={`${entry.employee.id}-${entry.startDate}-${entry.endDate}`}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="flex items-start gap-3">
            {entry.employee.photoUrl ? (
              <img
                src={entry.employee.photoUrl}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600 dark:bg-gray-600 dark:text-gray-300">
                {(entry.employee.firstName?.[0] ?? '') + (entry.employee.lastName?.[0] ?? '')}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {entry.employee.firstName} {entry.employee.lastName}
              </p>
              {(entry.employee.department || entry.employee.designation) && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {[entry.employee.department, entry.employee.designation].filter(Boolean).join(' · ')}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: (entry.leaveType.color ?? '#6b7280') + '20',
                    color: entry.leaveType.color ?? '#6b7280',
                  }}
                >
                  {entry.leaveType.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(entry.startDate)} – {formatDate(entry.endDate)}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">
                  {durationLabel(entry.durationType)} · {entry.totalDays} day(s)
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
