'use client';

import { useState, useEffect, useCallback } from 'react';
import { listHolidays, type Holiday } from '../../../../services/holidays';

function getCurrentYear() {
  return new Date().getFullYear();
}

export default function LeaveHolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(getCurrentYear());
  const [loading, setLoading] = useState(true);
  const todayStr = new Date().toISOString().slice(0, 10);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listHolidays({ year, limit: 100 });
      if (res.data) setHolidays(res.data);
      else setHolidays([]);
    } catch {
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Holidays</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            aria-label="Previous year"
          >
            ←
          </button>
          <span className="min-w-[80px] text-center font-medium">{year}</span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            aria-label="Next year"
          >
            →
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Day</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Holiday Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Type</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => {
                const dateStr = typeof h.date === 'string' ? h.date : new Date(h.date).toISOString().slice(0, 10);
                const isUpcoming = dateStr >= todayStr;
                const dayName = new Date(dateStr + 'Z').toLocaleDateString(undefined, { weekday: 'long' });
                return (
                  <tr
                    key={h.id}
                    className={`border-b border-gray-100 dark:border-gray-700 ${
                      isUpcoming ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'opacity-80'
                    }`}
                  >
                    <td className="px-4 py-3">{new Date(dateStr).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{dayName}</td>
                    <td className="px-4 py-3 font-medium">{h.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                          h.isOptional
                            ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                            : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                        }`}
                      >
                        {h.isOptional ? 'Optional' : 'Mandatory'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {holidays.length === 0 && (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">No holidays for this year.</div>
          )}
        </div>
      )}
    </div>
  );
}
