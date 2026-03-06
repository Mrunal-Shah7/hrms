'use client';

import type { BreakdownRow } from '../../../services/leave-requests';

interface LeaveCalendarStripProps {
  breakdown: BreakdownRow[];
  totalDays: number;
}

export function LeaveCalendarStrip({ breakdown, totalDays }: LeaveCalendarStripProps) {
  if (!breakdown.length) return null;
  return (
    <div className="rounded border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Date</th>
            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Day</th>
            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">Type</th>
            <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">Days</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <tr key={row.date} className="border-b border-gray-100 dark:border-gray-700">
              <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.date}</td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.day}</td>
              <td className="px-3 py-2">
                {row.type === 'holiday' && row.holiday ? (
                  <span className="text-amber-600 dark:text-amber-400">Holiday ({row.holiday})</span>
                ) : row.type === 'weekend' ? (
                  <span className="text-gray-400">Weekend</span>
                ) : row.type === 'first_half' || row.type === 'second_half' ? (
                  <span className="text-blue-600 dark:text-blue-400">
                    {row.type === 'first_half' ? 'First half' : 'Second half'}
                  </span>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">Full day</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-medium">{row.days}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-medium dark:bg-gray-800">
            <td colSpan={3} className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
              Total
            </td>
            <td className="px-3 py-2 text-right">{totalDays} Day(s)</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
