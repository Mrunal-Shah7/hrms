'use client';

import type { SummaryBalance } from '../../../services/leave-summary';

interface LeaveBalanceCardsProps {
  balances: SummaryBalance[];
  onApplyLeave?: (leaveTypeId: string) => void;
}

export function LeaveBalanceCards({ balances, onApplyLeave }: LeaveBalanceCardsProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {balances.map((b) => {
        const color = b.leaveType.color ?? '#6b7280';
        return (
          <div
            key={b.leaveType.id}
            className="min-w-[180px] rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <div
              className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: color }}
            >
              {b.leaveType.icon ? (
                <span className="text-lg">{b.leaveType.icon}</span>
              ) : (
                <span className="text-sm font-medium">{b.leaveType.code?.slice(0, 2) ?? '—'}</span>
              )}
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{b.leaveType.name}</p>
            <p className="mt-1 text-2xl font-bold" style={{ color }}>
              {b.available}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Booked: {b.booked}
            </p>
            {onApplyLeave && (
              <button
                type="button"
                onClick={() => onApplyLeave(b.leaveType.id)}
                className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                Apply Leave
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
