'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { listReviews, type ReviewListItem } from '../../../../services/reviews';

export default function PerformanceReviewsPage() {
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listReviews({
        page,
        limit: 10,
        status: statusFilter || undefined,
      });
      if (res.data) setReviews(res.data);
      else setReviews([]);
      if (res.meta) setMeta(res.meta);
      else setMeta(null);
    } catch {
      setReviews([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const statusBadge = (status: string) => {
    const classes =
      status === 'acknowledged'
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
        : status === 'submitted'
          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
    return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${classes}`}>{status}</span>;
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Reviews</h1>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {['', 'pending', 'submitted', 'acknowledged'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              statusFilter === s ? 'bg-blue-600 text-white' : 'border border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-600">
          <p className="text-gray-500 dark:text-gray-400">No reviews</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Cycle</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Subject</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Reviewer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Rating</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Submitted</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.cycle.name}</span>
                    <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">{r.cycle.type}</span>
                  </td>
                  <td className="px-4 py-3">{r.subject.firstName} {r.subject.lastName}</td>
                  <td className="px-4 py-3">{r.reviewer.firstName} {r.reviewer.lastName}</td>
                  <td className="px-4 py-3">{r.rating != null ? `${r.rating}/5` : '—'}</td>
                  <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <Link href={`/performance/reviews/${r.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta && meta.totalPages > 1 && (
            <div className="flex justify-end gap-2 border-t border-gray-200 p-2 dark:border-gray-700">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 text-sm disabled:opacity-50">Previous</button>
              <span className="py-1 text-sm">Page {page} of {meta.totalPages}</span>
              <button type="button" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 text-sm disabled:opacity-50">Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
