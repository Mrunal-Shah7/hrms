'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  listLeaveRequests,
  getLeaveRequestsExportUrl,
  type LeaveRequestListItem,
} from '../../../../services/leave-requests';
import { LeaveRequestDetailDrawer } from '../../../../components/modules/leave/leave-request-detail-drawer';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function LeaveRequestsPage() {
  const [requests, setRequests] = useState<LeaveRequestListItem[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [status, setStatus] = useState('');
  const [year, setYear] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [canApprove, setCanApprove] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listLeaveRequests({
        page,
        limit: 10,
        status: status || undefined,
        year,
      });
      if (res.data) setRequests(res.data);
      else setRequests([]);
      if (res.meta) setMeta(res.meta);
      else setMeta(null);
    } catch {
      setRequests([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [page, status, year]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const handleExport = (format: 'csv' | 'xlsx' | 'pdf') => {
    const url = getLeaveRequestsExportUrl(format, { status: status || undefined, year });
    window.open(url, '_blank');
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Leave Requests</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Export XLSX
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value || 'all'}
            type="button"
            onClick={() => { setStatus(tab.value); setPage(1); }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === tab.value
                ? 'bg-blue-600 text-white'
                : 'border border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Employee</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Leave Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Start</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">End</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-300">Days</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Duration</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Applied</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50"
                  onClick={() => openDetail(r.id)}
                >
                  <td className="px-4 py-3">
                    {r.employee.firstName} {r.employee.lastName}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex rounded px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: (r.leaveType.color ?? '#6b7280') + '20',
                        color: r.leaveType.color ?? '#6b7280',
                      }}
                    >
                      {r.leaveType.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">{new Date(r.startDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3">{new Date(r.endDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">{r.totalDays}</td>
                  <td className="px-4 py-3">
                    {r.durationType === 'first_half' ? 'First Half' : r.durationType === 'second_half' ? 'Second Half' : 'Full Day'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                        r.status === 'pending'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
                          : r.status === 'approved'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                            : r.status === 'rejected'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openDetail(r.id); }}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && meta.totalPages > 1 && (
            <div className="flex justify-end gap-2 border-t border-gray-200 p-2 dark:border-gray-700">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded border px-2 py-1 text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <span className="py-1 text-sm">
                Page {page} of {meta.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border px-2 py-1 text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      <LeaveRequestDetailDrawer
        requestId={selectedId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        onSuccess={fetchRequests}
        currentUserId={currentUserId}
        canApprove={canApprove}
      />
    </div>
  );
}
